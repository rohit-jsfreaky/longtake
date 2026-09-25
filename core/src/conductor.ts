/**
 * One call, from Start to Stop: the session, the voice, and everything that joins them.
 *
 * ## Why this exists
 *
 * The landing page (`web/src/lib/use-longtake.ts`) and the extension (`extension/src/content.ts`)
 * each held their own copy of this: which tool does what, what counts as "heard", when to switch
 * to conversation timing, when to catch the agent up, how to watch the page, what to log, what to
 * show when an answer does not go in. The copies had already drifted — the extension showed every
 * failed answer, the site only some; the site logged every frame, the extension none. A scripted
 * replay could only ever prove one of them.
 *
 * Now both run this. They differ only in `ConductorServices` — where the token comes from, where
 * the audio worklet is served, whether Dictation is reachable — and in how they draw `view()`.
 *
 * Framework-free, like the rest of `core/`. A surface subscribes and redraws; it never reaches in.
 */

import { checkEvidence } from "./evidence";
import { clipFor, type TimelinePoint } from "./clip";
import { CLEAR_TOOL_NAME, CONFIRM_TOOL_NAME, FILL_TOOL_NAME, LATER_TOOL_NAME, LEAVE_TOOL_NAME, PRESS_TOOL_NAME, SAVE_TOOL_NAME } from "./binder";
import { configForField, fieldsWorthShaping, shapeResult, type DictationConfig, type DictationResult, type ShapedAnswer } from "./dictation";
import type { FormState } from "./form-state";
import { readHesitation, type Hesitation } from "./hesitation";
import { missesIn, type Missed } from "./notices";
import { Overlay } from "./overlay";
import { badgesFor, reviewList, type ReviewGroup } from "./review";
import { correction, mismatches, TrustWatch, validateClaims, type CheckInput, type Mismatch } from "./trust";
import type { KnownFact } from "./profile";
import type { ProfileStore } from "./profile-store";
import { LongtakeSession } from "./session";
import type { FormSnapshot } from "./understand";
import {
  CONVERSATION_MODE,
  startVoiceSession,
  VoiceStartError,
  type StartProblem,
  type VoiceSession,
  type VoiceSessionOptions,
} from "./voice";
import type { Move } from "./planner";
import { fieldName } from "./types";
import type { WriteOutcome } from "./writer";

export type ConductorStatus = "idle" | "reading" | "connecting" | "live" | "reconnecting" | "stopped" | "error";

export type LogEntry = { at: string; kind: "in" | "out" | "app" | "you" | "agent" | "tool"; text: string };

export type Turn = { who: "you" | "agent"; text: string };

/** What a surface draws. A new object every time something changes, so it can be compared by identity. */
export type ConductorView = {
  status: ConductorStatus;
  error: string | null;
  /** What kind of problem stopped the call starting — the microphone, most often. */
  problem: StartProblem | null;
  form: FormState;
  /** Every write this call, in order. */
  outcomes: WriteOutcome[];
  /** What did not go in and why, until the field has something in it. */
  missed: Missed[];
  turns: Turn[];
  /** The running text of the turn in progress. Replace, never append. */
  partial: string;
  /**
   * They are talking, as the microphone hears it — before any words come back. Over the agent, the
   * server can take seconds to decide it was interrupted; this says "heard you" at once.
   */
  hearing: boolean;
  shaped: Record<string, ShapedAnswer>;
  hesitations: Record<string, Hesitation>;
  /** Everything known about the person, newest first. */
  known: KnownFact[];
  /** What to look at before sending, grouped — the same reading as the badges on the page. */
  review: ReviewGroup[];
  log: LogEntry[];
};

/** What differs between the site and the extension. Nothing else does. */
export type ConductorServices = {
  getToken: () => Promise<string>;
  workletUrl: string;
  wsUrl?: string;
  voice?: string;
  /** One Dictation pass over one answer's audio. Absent where Dictation is not reachable. */
  dictate?: (config: DictationConfig, pcmBase64: string) => Promise<DictationResult>;
  /** What each field means, from the model. Absent: the offline reading, which fills nothing unasked. */
  understand?: (snapshot: FormSnapshot) => Promise<unknown>;
  /**
   * The judge: what the agent claimed about the form in one reply (`/api/check`). Absent: nothing
   * is judged — the trust layer never guesses without it.
   */
  check?: (input: CheckInput) => Promise<unknown>;
  /** The call itself. A fake in tests; `startVoiceSession` everywhere else. */
  startVoice?: (options: VoiceSessionOptions) => Promise<VoiceSession>;
};

/**
 * A call the page's last document was in, to carry on here: the session to resume, and the tool
 * calls it made that the page never answered (a Next that loaded this page, above all).
 */
export type CarriedCall = { sessionId: string; pending: { callId: string; name: string }[] };

/** What the agent is asked to say when the page changed and no pressed Next of its own says so. */
const PAGE_TURNED =
  "The form has moved on to a new page (they may have pressed Next themselves). In a few words say you're on the next page, then do what DO NEXT says. Don't repeat anything from before.";

export type ConductorOptions = {
  root: () => Document | Element;
  ignore: string;
  /** What is known about the person, and its one owner. In memory for this page when absent. */
  profile?: ProfileStore;
  services: ConductorServices;
  /** Log every frame in both directions, not just tool calls and turns. The site's debug view wants it. */
  logFrames?: boolean;
  /** A call started or ended — the extension tells its background worker, so a page load can carry it on. */
  onActive?: (active: boolean) => void;
  /** The voice session the call is in, as each opens — kept by the extension to carry the call on. */
  onSession?: (sessionId: string) => void;
  /** Badges beside each field on the page (overlay.ts). On unless turned off. */
  badges?: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  fields: [],
  theirs: [],
  asks: [],
  actions: [],
  progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 },
};

const LOG_LIMIT = 400;
/** Wait this long after the page stops moving before re-reading it. */
const SHAPE_SETTLE_MS = 500;
/** Wait this long after the person stops typing before telling the agent. */
const TYPING_SETTLE_MS = 1200;

/** PCM16 as base64, chunked so a long answer does not overflow `String.fromCharCode`'s arguments. */
export function pcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The fields a move asks about — what a "got that in" points at. */
function askingOf(move: Move): string[] {
  switch (move.kind) {
    case "ask":
    case "optional":
    case "offer_optional":
      return move.fields.map((f) => f.field);
    case "confirm":
    case "resolve":
      return [move.field.field];
    case "confirm_recalled":
      return move.fields.map((f) => f.field.field);
    case "update_profile":
      return move.asks.map((a) => a.field);
    default:
      return [];
  }
}

export class Conductor {
  readonly session: LongtakeSession;
  private voice: VoiceSession | null = null;
  private listeners = new Set<(view: ConductorView) => void>();
  private current: ConductorView;
  private prepared: Promise<unknown> | null = null;

  // ── Per call ───────────────────────────────────────────────────────────────────────
  private stopped = true;
  private transcript = "";
  /**
   * The turn being spoken, before it is final. The agent calls `fill_fields` mid-sentence, so a
   * quote is checked against what has been said so far INCLUDING this — otherwise the longest
   * answers were thrown away as invented, because their words were not in the transcript yet.
   */
  private partial = "";
  private switchedMode = false;
  private sentPrompt = "";
  private missed = new Map<string, Missed>();
  /** The last few finished turns: audio, words, and when each word arrived. */
  private turnAudio: { text: string; audio: Int16Array; timeline: TimelinePoint[] }[] = [];
  /** Long answers filled mid-sentence, waiting for their turn to end so their audio exists. */
  private pendingClips = new Map<string, string>();
  private askedAt: number | null = null;
  /** The trust layer: what the agent says, against what went in (trust.ts). One per call. */
  private trust = new TrustWatch();
  /** The voice session the call is in now, and the tool calls not answered yet. */
  private currentSession: string | null = null;
  private openCalls = new Map<string, string>();
  /** What each reply said, until it is done. */
  private replyText = new Map<string, string>();
  /** The form's answers when the person last spoke — to tell whether a reply changed anything. */
  private answersAtTurn = "";
  private pauseBeforeAnswer: number | undefined;
  private detach: (() => void) | null = null;

  constructor(private readonly options: ConductorOptions) {
    const session: LongtakeSession = new LongtakeSession({
      root: options.root,
      ignore: options.ignore,
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.services.understand ? { understand: options.services.understand } : {}),
      log: (line) => this.note("app", line),
      onChange: () => this.update({ form: session.state(), known: session.known() }),
      // Answers from last time went in after the call had opened: the agent hears about it now.
      onPromptStale: () => {
        this.refresh();
        this.syncPrompt();
      },
      // The form's questions changed under the call: new tools and a new prompt, straight away.
      onReshape: () => {
        const problems = session.toolProblems();
        if (problems.length > 0) {
          this.note("app", `form changed but the new tools are invalid: ${problems.join("; ")}`);
          return;
        }
        this.voice?.setTools(session.tools());
        this.sentPrompt = session.prompt();
        this.voice?.setSystemPrompt(this.sentPrompt);
      },
    });
    this.session = session;
    // A settings edit, or another tab, changed what is known: shown at once, used from here on.
    options.profile?.subscribe?.((profile) => session.profileChanged(profile));
    this.current = {
      status: "idle",
      error: null,
      problem: null,
      form: EMPTY_FORM,
      outcomes: [],
      missed: [],
      turns: [],
      partial: "",
      hearing: false,
      shaped: {},
      hesitations: {},
      known: [],
      review: [],
      log: [],
    };
  }

  // ── Watching ───────────────────────────────────────────────────────────────────────

  view(): ConductorView {
    return this.current;
  }

  subscribe(listener: (view: ConductorView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The whole call as JSON — every tool call and result in full — for a bug report. */
  copyLog(page = typeof location === "undefined" ? "" : location.href): string {
    return JSON.stringify({ page, turns: this.current.turns, log: this.current.log }, null, 2);
  }

  private update(patch: Partial<ConductorView>): void {
    this.current = { ...this.current, ...patch };
    // The list and the badges come from the same reading, whenever what they read changes.
    if (patch.form || patch.missed || patch.hesitations) {
      this.current.review = reviewList(this.current.form, this.current.missed);
      this.overlay?.show(badgesFor(this.current.form, this.current.missed, this.current.hesitations));
    }
    for (const listener of this.listeners) listener(this.current);
  }

  /** Bring a field into view and flash its badge — from the review list. */
  focus(fieldId: string): void {
    this.overlay?.focus(fieldId);
  }

  /** Where each badge sits in the viewport — for tests of placement. */
  badgePositions(): Record<string, { x: number; y: number; shown: boolean }> {
    return this.overlay?.positions() ?? {};
  }

  /** Take the badges off the page — the panel closed, the page is leaving. */
  dispose(): void {
    this.overlay?.destroy();
    this.overlay = null;
  }

  /** The badges on the page, made once, on the page's own document. */
  private overlay: Overlay | null = null;
  private showBadges(): void {
    if (this.options.badges === false || this.overlay || typeof document === "undefined") return;
    const scope = this.options.root();
    const doc = "ownerDocument" in scope && scope.ownerDocument ? scope.ownerDocument : (scope as Document);
    this.overlay = new Overlay(doc, () => this.session.read?.handles ?? new Map());
    this.overlay.show(badgesFor(this.current.form, this.current.missed, this.current.hesitations));
  }

  private note(kind: LogEntry["kind"], text: string): void {
    const log = [...this.current.log.slice(-(LOG_LIMIT - 1)), { at: new Date().toISOString(), kind, text }];
    this.update({ log });
  }

  /** Redraw the form, and drop "didn't go in" notices for fields that now have something in them. */
  private refresh(): void {
    const form = this.session.state();
    for (const field of form.fields) if (field.value !== null) this.missed.delete(field.spec.id);
    this.update({ form, known: this.session.known(), missed: [...this.missed.values()] });
  }

  // ── Before the call ────────────────────────────────────────────────────────────────

  /** Remembered answers go in when the page opens, before anybody presses anything. Once. */
  prepare(): Promise<unknown> {
    if (!this.prepared) this.prepared = this.session.prefill().then(() => this.refresh());
    return this.prepared;
  }

  forgetOne(id: string): Promise<void> {
    return this.session.forgetOne(id);
  }

  forgetEverything(): Promise<void> {
    return this.session.forgetEverything();
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** The voice session the call is in now, if one has opened. */
  get sessionId(): string | null {
    return this.currentSession;
  }

  /** Tool calls the agent made that have not been answered yet — what a page load would cut off. */
  pendingCalls(): { callId: string; name: string }[] {
    return [...this.openCalls].map(([callId, name]) => ({ callId, name }));
  }

  // ── The call ───────────────────────────────────────────────────────────────────────

  async start(carry?: CarriedCall): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.currentSession = null;
    this.openCalls = new Map();
    this.transcript = "";
    this.partial = "";
    this.switchedMode = false;
    this.missed = new Map();
    this.turnAudio = [];
    this.pendingClips = new Map();
    this.askedAt = null;
    this.pauseBeforeAnswer = undefined;
    this.trust = new TrustWatch();
    this.replyText = new Map();
    this.update({ status: "reading", error: null, problem: null, turns: [], partial: "", missed: [], log: [] });
    this.options.onActive?.(true);

    try {
      await this.prepare();
      await this.session.open();
      this.showBadges();
      this.refresh();

      const problems = this.session.toolProblems();
      if (problems.length > 0) throw new Error(`This form produced a tool the voice service would reject: ${problems[0]}`);

      const greeting = this.session.greeting();
      this.note("app", `opening line: ${greeting}`);
      this.update({ status: "connecting" });

      const { services } = this.options;
      const startVoice = services.startVoice ?? startVoiceSession;
      /** Carrying a call from the last page, until its session is back. */
      let carrying = Boolean(carry);
      this.sentPrompt = this.session.prompt();
      const voice = await startVoice({
        voice: services.voice ?? "charles",
        systemPrompt: this.sentPrompt,
        greeting,
        tools: this.session.tools(),
        getToken: services.getToken,
        workletUrl: services.workletUrl,
        ...(services.wsUrl ? { wsUrl: services.wsUrl } : {}),
        // The line dropped past saving: a new agent, told the form as it is and where to pick up.
        freshStart: () => {
          this.sentPrompt = this.session.prompt();
          return { systemPrompt: this.sentPrompt, greeting: this.session.resumeGreeting(), tools: this.session.tools() };
        },
        onToolCall: async (name, args, callId) => {
          if (callId) this.openCalls.set(callId, name);
          try {
            return await this.runTool(name, args, callId);
          } finally {
            if (callId) this.openCalls.delete(callId);
          }
        },
        // Carried from the page before: the same conversation, and its unanswered calls answered.
        ...(carry
          ? { resume: { sessionId: carry.sessionId, answers: () => carry.pending.map((call) => ({ callId: call.callId, result: this.session.carriedResult(call.name) })) } }
          : {}),
        onSession: (id) => {
          this.currentSession = id;
          this.options.onSession?.(id);
        },
        onToolCallStarted: (callId, name) => this.trust.toolCall(callId, name),
        onReply: (event) => {
          if (event.type === "started") this.trust.replyStarted(event.id);
          else this.replyOver(event.id);
        },
        // After results are out, the agent's prompt catches up with the form — so even a turn with
        // no tool call ("hello?", "what's left?") is answered from the form as it is.
        onResultsSent: () => {
          this.sentPrompt = this.session.prompt();
          this.voice?.setSystemPrompt(this.sentPrompt);
        },
        ...(this.options.logFrames
          ? { onEvent: (direction: "in" | "out", message: { type: string }) => this.note(direction, JSON.stringify(message).slice(0, 260)) }
          : {}),
        onReady: () => {
          this.update({ status: "live" });
          this.note("app", "session.ready — speak now");
        },
        onReconnecting: (attempt) => {
          this.update({ status: "reconnecting" });
          this.note("app", `line dropped — reconnecting (try ${attempt})`);
        },
        onReconnected: (how) => {
          this.update({ status: "live" });
          if (carrying) {
            carrying = false;
            this.note("app", how === "resumed" ? "carried on from the last page — same conversation" : "the last page's call was gone — new session, picked up from the form");
            // A Next the agent pressed is answered as pressed, and its reply says where they are;
            // a page they moved on themselves has nobody saying so — so the agent is asked to.
            if (how === "resumed" && !carry!.pending.some((call) => call.name === PRESS_TOOL_NAME)) {
              const say = () => this.voice?.createReply(PAGE_TURNED);
              if (this.voice) say();
              else setTimeout(say, 0);
            }
            return;
          }
          this.note("app", how === "resumed" ? "reconnected — same conversation" : "reconnected — new session, picked up from the form");
        },
        onUserPartial: (text) => {
          this.partial = text;
          this.update({ partial: text });
        },
        onUserTranscript: (text, audio, timeline) => this.heardTurn(text, audio, timeline),
        onAgentTranscript: (text, reply) => {
          if (reply?.id) this.replyText.set(reply.id, text);
          this.askedAt = Date.now();
          this.note("agent", text);
          this.update({ turns: [...this.current.turns, { who: "agent", text }] });
        },
        onLocalSpeech: (speaking) => {
          if (this.current.hearing !== speaking) this.update({ hearing: speaking });
        },
        onSpeechStart: () => {
          const now = Date.now();
          this.pauseBeforeAnswer = this.askedAt ? (now - this.askedAt) / 1000 : undefined;
        },
        onError: (message) => {
          if (this.stopped) return;
          this.finish();
          this.update({ status: "error", error: message });
        },
        onClosed: () => {
          if (this.stopped) return;
          this.finish();
          this.update({ status: "stopped" });
        },
      });
      this.voice = voice;
      if (this.stopped) {
        await voice.stop();
        return;
      }
      this.watchPage();
    } catch (cause) {
      this.finish();
      this.update({
        status: "error",
        problem: cause instanceof VoiceStartError ? cause.problem : null,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.finish();
    this.update({ status: "stopped", partial: "", hearing: false });
    await this.voice?.stop();
    this.voice = null;
  }

  private finish(): void {
    const wasLive = !this.stopped;
    this.stopped = true;
    this.detach?.();
    this.detach = null;
    this.options.onActive?.(false);
    // What they typed by hand is kept too — offered back only for a yes.
    if (wasLive) void this.session.finish().then(() => this.refresh(), () => undefined);
  }

  /** Everything said so far, the turn still being spoken included. */
  heard(): string {
    return `${this.transcript}\n${this.partial}`.trim();
  }

  private heardTurn(text: string, audio: Int16Array | null, timeline: TimelinePoint[]): void {
    if (audio && audio.length > 0) {
      this.turnAudio = [...this.turnAudio.slice(-5), { text, audio, timeline }];
      // Answers filled while this turn was being spoken can be placed now.
      for (const [fieldId, evidence] of this.pendingClips) {
        if (this.placeClip(fieldId, evidence)) this.pendingClips.delete(fieldId);
      }
    }
    this.partial = "";
    // A new exchange for the trust layer: what the agent was asking when they spoke, and the form then.
    const move = this.session.peekMove();
    this.trust.userTurn(text, move.kind, askingOf(move));
    this.answersAtTurn = this.answers();
    // Accumulated, not replaced: a quote may span two turns of one long take.
    this.transcript = `${this.transcript}\n${text}`.trim();
    this.note("you", text);
    this.update({ partial: "", turns: [...this.current.turns, { who: "you", text }] });
  }

  // ── The tools ──────────────────────────────────────────────────────────────────────

  /** Runs one tool call and returns what goes back to the agent. Public so replays can drive it. */
  async runTool(name: string, args: Record<string, unknown>, callId?: string): Promise<unknown> {
    this.note("tool", `call ${name} ${JSON.stringify(args)}`);
    const result = await this.route(name, args);
    if (callId) this.trust.toolResult(callId, result);
    this.note("tool", `result ${name} ${JSON.stringify(result)}`);
    for (const miss of missesIn(result)) this.missed.set(miss.fieldId, miss);
    this.refresh();
    return result;
  }

  private async route(name: string, args: Record<string, unknown>): Promise<unknown> {
    const session = this.session;
    const heard = this.heard();

    if (name === FILL_TOOL_NAME) {
      const done = await session.fill(args, heard);
      this.update({ outcomes: [...this.current.outcomes, ...done.outcomes] });
      const landed = done.outcomes.filter((o) => o.status === "written").map((o) => o.fieldId);
      if (landed.length > 0) {
        // A long answer is shaped from its own audio — or waits for the turn it is in to end.
        for (const said of done.spoken) {
          if (!landed.includes(said.fieldId)) continue;
          if (!this.placeClip(said.fieldId, said.evidence)) this.pendingClips.set(said.fieldId, said.evidence);
        }
        // The long take is over once the first answers land: conversational timing from here.
        if (!this.switchedMode) {
          this.switchedMode = true;
          this.voice?.setTranscriptionMode(CONVERSATION_MODE);
          this.note("app", "switched to conversation timing");
        }
      }
      return done.result;
    }

    if (name === CLEAR_TOOL_NAME) {
      const done = await session.clear(args, heard);
      const cleared = new Set(((done.result.cleared as { field: string }[] | undefined) ?? []).map((c) => c.field));
      if (cleared.size > 0) {
        for (const id of cleared) this.pendingClips.delete(id);
        const without = <T,>(record: Record<string, T>) =>
          Object.fromEntries(Object.entries(record).filter(([id]) => !cleared.has(id)));
        this.update({
          outcomes: this.current.outcomes.filter((o) => !cleared.has(o.fieldId)),
          hesitations: without(this.current.hesitations),
          shaped: without(this.current.shaped),
        });
      }
      return done.result;
    }

    if (name === CONFIRM_TOOL_NAME) {
      const done = await session.confirm(args, heard);
      this.update({ outcomes: [...this.current.outcomes, ...done.outcomes] });
      return done.result;
    }

    // A Next that is a real page load (Google Forms posts each page) ends this page's script; the
    // extension's background remembers the tab was live, and the next page offers to carry on.
    if (name === PRESS_TOOL_NAME) return (await session.press(args, heard)).result;
    if (name === LATER_TOOL_NAME) return session.setAside(args, heard).result;
    if (name === LEAVE_TOOL_NAME) return session.leaveEmpty(args, heard).result;
    if (name === SAVE_TOOL_NAME) return (await session.saveForNextTime(args, heard)).result;
    return { error: `Unknown tool "${name}".` };
  }

  // ── The trust layer ────────────────────────────────────────────────────────────────

  /** Every answer on the form, as one string — to tell whether a reply changed anything. */
  private answers(): string {
    return JSON.stringify(this.session.state().fields.map((f) => f.value));
  }

  /**
   * A reply is over. If it is one worth checking (trust.ts), the judge says what it claimed; every
   * "put in" that is not in is corrected at once — the agent asked to put it in, quoting the person,
   * or to say plainly it is not — and the person sees it on screen.
   */
  private replyOver(id: string): void {
    const said = this.replyText.get(id) ?? "";
    this.replyText.delete(id);
    const ask = this.trust.replyDone(id, said, this.answers() !== this.answersAtTurn);
    const check = this.options.services.check;
    if (!ask || !check) return;
    // The fields being asked first: a "got that in" points at them, and a small model reading a
    // long form lost them further down the list (RESEARCH.md §9h).
    const all = this.session.state().fields.map((f) => ({ id: f.spec.id, question: fieldName(f.spec) }));
    const fields = [...all.filter((f) => ask.asking.includes(f.id)), ...all.filter((f) => !ask.asking.includes(f.id))];
    void check({ said: ask.said, heard: ask.heard, asking: ask.asking, fields })
      .then((raw) => {
        const state = this.session.state();
        const byId = new Map(state.fields.map((f) => [f.spec.id, f]));
        const claims = validateClaims(raw, ask.said, [...byId.keys()]);
        const found = mismatches(
          claims,
          (field) => byId.get(field)?.value !== null && byId.get(field)?.value !== undefined && !ask.notIn.includes(field),
          (field) => { const f = byId.get(field); return f ? fieldName(f.spec) : field; },
        );
        if (found.length > 0) this.correct(found);
      })
      .catch((cause) => this.note("app", `could not check the reply: ${cause instanceof Error ? cause.message : String(cause)}`));
  }

  private correct(found: Mismatch[]): void {
    for (const m of found) {
      this.session.noteClaimedIn(m.field, m.said);
      this.missed.set(m.field, { fieldId: m.field, question: m.question, why: "the agent said it went in, but it did not — it's being put right" });
    }
    this.note("app", `said it went in, but it did not: ${found.map((m) => m.field).join(", ")}`);
    this.refresh();
    this.sentPrompt = this.session.prompt();
    this.voice?.setSystemPrompt(this.sentPrompt);
    this.voice?.createReply(correction(found));
  }

  // ── Watching the page ──────────────────────────────────────────────────────────────

  /**
   * Changes nobody told us about: a person clicking an option themselves, or typing into a box.
   * Shape changes re-read the form; typing only redraws, since `state()` reads values off the page.
   * Left alone while a tool call is writing — that call re-reads before it answers. Anything inside
   * our own furniture (`ignore`) is not the form, so it never triggers a re-read.
   */
  private watchPage(): void {
    const scope = this.options.root();
    const target = "body" in scope ? scope.body : scope;
    if (!target) return;
    const ignore = this.options.ignore;
    const ours = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return Boolean(ignore && element?.closest(ignore));
    };

    let shapeTimer: ReturnType<typeof setTimeout> | undefined;
    let typeTimer: ReturnType<typeof setTimeout> | undefined;
    // A change inside our own furniture, or the furniture itself arriving or leaving (the badges'
    // host), is not the form changing.
    const oursOnly = (record: MutationRecord) =>
      ours(record.target) ||
      (record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].length > 0 &&
        [...record.addedNodes, ...record.removedNodes].every((node) => ours(node)));
    const observer = new MutationObserver((records) => {
      if (records.every(oursOnly)) return;
      if (this.session.isWriting) {
        this.session.noteMoveDuringWrite();
        return;
      }
      clearTimeout(shapeTimer);
      shapeTimer = setTimeout(() => {
        void this.session.pageChanged().then(() => {
          this.refresh();
          this.syncPrompt();
        });
      }, SHAPE_SETTLE_MS);
    });
    observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-checked", "aria-selected"],
    });

    // Typing: redraw at once, tell the agent once they pause.
    const onInput = (event: Event) => {
      if (ours(event.target as Node | null) || this.session.isWriting) return;
      this.refresh();
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => this.syncPrompt(), TYPING_SETTLE_MS);
    };
    target.addEventListener("input", onInput, true);
    target.addEventListener("change", onInput, true);

    this.detach = () => {
      observer.disconnect();
      target.removeEventListener("input", onInput, true);
      target.removeEventListener("change", onInput, true);
      clearTimeout(shapeTimer);
      clearTimeout(typeTimer);
    };
  }

  /**
   * Give the agent the form as it is now — if it changed since it last heard. After tool results
   * the agent is caught up anyway; this is for what happens without one: the person typing, or
   * picking an option themselves. Without it the agent asked for a field typed in front of it.
   */
  private syncPrompt(): void {
    if (!this.voice || this.session.isWriting || this.stopped) return;
    const prompt = this.session.prompt();
    if (prompt === this.sentPrompt) return;
    this.sentPrompt = prompt;
    this.voice.setSystemPrompt(prompt);
    this.note("app", "form changed without a tool call — agent brought up to date");
  }

  // ── A long answer's own audio: the clip, and the Dictation pass that uses it ─────────

  /**
   * Find the words a long answer came from in the recent turns, and send just those seconds to
   * Dictation. Newest turn first. Where the words are in a turn but cannot be pinned to a moment,
   * the whole turn is sent. False when the turn has not finished yet — the caller waits for it.
   */
  private placeClip(fieldId: string, evidence: string): boolean {
    if (!this.options.services.dictate) return true; // nothing to wait for
    for (const turn of [...this.turnAudio].reverse()) {
      if (!checkEvidence(turn.text, evidence).ok) continue;
      const clip = clipFor(evidence, turn.timeline, turn.audio.length);
      const audio = clip ? turn.audio.subarray(clip.start, clip.end) : turn.audio;
      void this.shapeLongAnswer(fieldId, audio);
      return true;
    }
    return false;
  }

  /** One Dictation pass over one long answer, then the tidy text replaces what the agent typed. */
  private async shapeLongAnswer(fieldId: string, audio: Int16Array): Promise<void> {
    const dictate = this.options.services.dictate;
    const read = this.session.read;
    if (!dictate || !read || audio.length === 0) return;
    const [spec] = fieldsWorthShaping(read.specs, [fieldId]);
    if (!spec) return;

    const known: Record<string, string> = {};
    for (const field of this.session.state().fields) {
      if (typeof field.value === "string" && field.value.length < 60) known[field.spec.id] = field.value;
    }

    try {
      const payload = await dictate(configForField(spec, { specs: read.specs, known }), pcmToBase64(audio));
      const result = shapeResult(spec.id, payload);
      this.update({ shaped: { ...this.current.shaped, [spec.id]: result } });

      const hesitation = readHesitation(spec.id, result.verbatim, result.clean, this.pauseBeforeAnswer);
      if (hesitation.worthAnotherLook) this.update({ hesitations: { ...this.current.hesitations, [spec.id]: hesitation } });

      if (result.clean) await this.session.rewrite(spec.id, result.clean, result.verbatim);
      this.note(
        "app",
        result.rewritten
          ? `dictation shaped ${spec.id}, verbatim kept (${result.verbatim.length} chars)`
          : `dictation returned verbatim only for ${spec.id} — ${result.note}`,
      );
    } catch (cause) {
      this.note("app", `dictation for ${spec.id} errored: ${String(cause)}`);
    }
  }
}
