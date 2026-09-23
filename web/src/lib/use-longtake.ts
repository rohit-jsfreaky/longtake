"use client";

/**
 * The voice, wired to the form.
 *
 * Everything about the form — what is on it, what went in and from where, what the person asked to
 * leave empty, what is waiting for their yes, what to ask next — lives in `LongtakeSession`
 * (core/src/session.ts). This hook only connects that session to the microphone and the agent, and
 * hands React the session's own view of the form to draw.
 *
 * It used to hold all of that itself, in more than a thousand lines and seven hand-kept lists, and
 * every live bug of the last week was two of those lists disagreeing. Now there is one form state,
 * read off the page, and the counter, the opening line, the "still empty" list and the agent's
 * brief are all the same thing seen from different sides.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLEAR_TOOL_NAME,
  checkEvidence,
  clipFor,
  configForField,
  fieldsWorthShaping,
  FILL_TOOL_NAME,
  LongtakeSession,
  readHesitation,
  shapeResult,
  type DictationResult,
  type FormState,
  type Hesitation,
  type RememberedAnswer,
  type TimelinePoint,
  type ShapedAnswer,
  type WriteOutcome,
} from "@longtake/core";

import { loadMemory, saveMemory } from "@/lib/memory-store";
import { CONVERSATION_TURN_DETECTION, startVoiceSession, type VoiceSession } from "@/lib/voice-session";

export type LogLine = { at: string; kind: "in" | "out" | "app"; text: string };

export type Written = Extract<WriteOutcome, { status: "written" }>;
export type NotWritten = Exclude<WriteOutcome, { status: "written" }>;

export type Status = "idle" | "reading" | "connecting" | "live" | "error";

/**
 * Longtake's own controls, and the Next.js dev overlay, are not part of anybody's form.
 *
 * The dev overlay earns its place here: its button declares `aria-haspopup="menu"` exactly like
 * a real dropdown, so without naming it the schema gains a question called "Open Next.js Dev
 * Tools" with a three-option enum. Other people's furniture looks just like a form field.
 */
export const IGNORE = "[data-longtake-ignore], nextjs-portal, [data-nextjs-dev-tools-button]";

/**
 * The agent's voice.
 *
 * British, because the brief is closer to JARVIS than to a call centre, and the Voice Agent API
 * has four British English voices. `?voice=paul` on the page swaps it, so they can be compared by
 * ear on the real demo rather than chosen from a table. Anything not on the list is ignored.
 */
const DEFAULT_VOICE = "charles";
const VOICES = new Set(["charles", "paul", "anna", "vera", "alba", "eve", "george", "jane", "jean", "mary", "michael"]);

function chooseVoice(): string {
  const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("voice");
  return asked && VOICES.has(asked) ? asked : DEFAULT_VOICE;
}

/**
 * PCM16 as base64, for the JSON body the dictate route takes.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a whole utterance is tens of thousands of
 * arguments at once, which overflows the call stack on exactly the long answers this is for.
 */
function pcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const EMPTY_FORM: FormState = {
  title: "",
  fields: [],
  theirs: [],
  progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 },
};

export type UseLongtake = {
  status: Status;
  live: boolean;
  error: string | null;
  /** The form as it is right now — the one source for everything below. */
  form: FormState;
  /** How many fields the reader found on the page. */
  fieldCount: number;
  /** How many have an answer in them, read off the page. */
  filledCount: number;
  /** Every write this session, in order. */
  outcomes: WriteOutcome[];
  written: Written[];
  refused: NotWritten[];
  /** Labels of required fields still empty. */
  missing: string[];
  optionalLeft: number;
  /** Answers waiting for the person's yes. */
  waiting: { fieldId: string; question: string; suggestion: string; heard: string }[];
  /** Fields the person spoke to that did not land — kept on screen until they act. */
  needsYou: { fieldId: string; question: string; why: string }[];
  turns: { who: "you" | "agent"; text: string }[];
  /** The running text of the turn in progress. Replace, never append. */
  partial: string;
  shaped: Record<string, ShapedAnswer>;
  hesitations: Record<string, Hesitation>;
  known: RememberedAnswer[];
  /** Answers that came from an earlier form. */
  fromMemory: { fieldId: string; question: string }[];
  log: LogLine[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  forgetOne: (key: string) => void;
  forgetEverything: () => void;
};

export function useLongtake({
  ignore = IGNORE,
  root,
}: {
  ignore?: string;
  /**
   * Where to look for the form. Defaults to the whole document.
   *
   * The landing page needs this: it has an FAQ, a nav and its own controls on it, and reading the
   * whole document there would hand the agent a tool built partly out of our own furniture.
   */
  root?: () => Element | null;
} = {}): UseLongtake {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [known, setKnown] = useState<RememberedAnswer[]>([]);
  const [outcomes, setOutcomes] = useState<WriteOutcome[]>([]);
  const [turns, setTurns] = useState<{ who: "you" | "agent"; text: string }[]>([]);
  const [partial, setPartial] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [shaped, setShaped] = useState<Record<string, ShapedAnswer>>({});
  const [hesitations, setHesitations] = useState<Record<string, Hesitation>>({});

  const voiceRef = useRef<VoiceSession | null>(null);
  const switchedModeRef = useRef(false);
  const transcriptRef = useRef("");
  /**
   * The turn currently being spoken, before it is finalised.
   *
   * The agent calls `fill_fields` mid-sentence, before `transcript.user` arrives, so a tool call's
   * evidence is checked against what has been said so far INCLUDING this — otherwise the longest
   * answers were thrown away as invented, because their words were not in the transcript yet.
   */
  const partialRef = useRef("");
  /** The last few finished turns: audio, words, and when each word arrived. */
  const turnsAudioRef = useRef<{ text: string; audio: Int16Array; timeline: TimelinePoint[] }[]>([]);
  /** Answers filled mid-sentence, whose turn has not finished yet — placed when it does. */
  const pendingClipsRef = useRef<Map<string, string>>(new Map());
  const speechStartedAtRef = useRef<number | null>(null);
  const askedAtRef = useRef<number | null>(null);
  const pauseBeforeAnswerRef = useRef<number | undefined>(undefined);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((lines) => [...lines.slice(-300), { at: new Date().toLocaleTimeString(), kind, text }]);
  }, []);

  /**
   * One session per mounted page. Created lazily so the root function is read after mount, and kept
   * for the life of the component so remembered answers and the ledger survive stopping and
   * starting the microphone.
   */
  const sessionRef = useRef<LongtakeSession | null>(null);
  const session = useCallback((): LongtakeSession => {
    if (!sessionRef.current) {
      const created: LongtakeSession = new LongtakeSession({
        root: () => root?.() ?? document,
        ignore,
        memory: { load: loadMemory, save: saveMemory },
        log: (line) => push("app", line),
        onChange: () => {
          setForm(created.state());
          setKnown(created.remembered());
        },
        // The form's questions changed under the call: new tools and a new prompt, straight away.
        onReshape: () => {
          const problems = created.toolProblems();
          if (problems.length > 0) {
            push("app", `form changed but the new tools are invalid: ${problems.join("; ")}`);
            return;
          }
          voiceRef.current?.setTools(created.tools());
          voiceRef.current?.setSystemPrompt(created.prompt());
        },
      });
      sessionRef.current = created;
    }
    return sessionRef.current;
  }, [ignore, root, push]);

  /** Remembered answers go in at page load, before anybody presses anything. */
  useEffect(() => {
    void session().prefill();
  }, [session]);

  /**
   * Mark the fields worth a second look, softly — a thin amber ring. An offer, not a verdict.
   */
  useEffect(() => {
    const read = sessionRef.current?.read;
    if (!read) return;
    const touched: HTMLElement[] = [];
    for (const fieldId of Object.keys(hesitations)) {
      const element = read.handles.get(fieldId);
      if (!element) continue;
      element.style.boxShadow = "0 0 0 2px rgba(217, 119, 6, 0.45)";
      element.style.borderRadius = element.style.borderRadius || "6px";
      touched.push(element);
    }
    return () => {
      for (const element of touched) element.style.boxShadow = "";
    };
  }, [hesitations]);

  // ── Watching the page ────────────────────────────────────────────────────────────

  /**
   * Changes nobody told us about: a person clicking "Organization" themselves, or typing into a
   * box. Shape changes (elements shown, hidden, added) re-read the form; typing only redraws, since
   * `state()` reads values off the page anyway. Left alone while a tool call is writing — that call
   * re-reads before it answers.
   */
  useEffect(() => {
    if (status !== "live") return;
    const scope = root?.() ?? document;
    const target = "body" in scope ? scope.body : scope;
    if (!target) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      const current = sessionRef.current;
      if (!current) return;
      if (current.isWriting) {
        current.noteMoveDuringWrite();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void current.pageChanged(), 500);
    });
    observer.observe(target, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });

    const onInput = () => {
      const current = sessionRef.current;
      if (current && !current.isWriting) setForm(current.state());
    };
    target.addEventListener("input", onInput, true);

    return () => {
      observer.disconnect();
      target.removeEventListener("input", onInput, true);
      clearTimeout(timer);
    };
  }, [status, root]);

  // ── The answer's own audio: a clip, and the Dictation pass that uses it ─────────────

  /**
   * Run one long answer through Dictation, with its own few seconds of audio.
   *
   * Used to be sent the whole previous turn — often the WRONG turn, because the agent fills a
   * field while the person is still mid-sentence, before that sentence's audio exists. Now it waits
   * for the clip, which is placed in the turn the answer was actually spoken in.
   */
  const shapeLongAnswer = useCallback(
    async (fieldId: string, audio: Int16Array) => {
      const current = sessionRef.current;
      const read = current?.read;
      if (!current || !read || audio.length === 0) return;
      const [spec] = fieldsWorthShaping(read.specs, [fieldId]);
      if (!spec) return;

      const knownValues: Record<string, string> = {};
      for (const f of current.state().fields) {
        if (typeof f.value === "string" && f.value.length < 60) knownValues[f.spec.id] = f.value;
      }

      try {
        const response = await fetch("/api/dictate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            config: configForField(spec, { specs: read.specs, known: knownValues }),
            audio: pcmToBase64(audio),
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          push("app", `dictation for ${spec.id} failed: ${payload.error ?? response.status}`);
          return;
        }

        const result = shapeResult(spec.id, payload as DictationResult);
        setShaped((previous) => ({ ...previous, [spec.id]: result }));

        const hesitation = readHesitation(spec.id, result.verbatim, result.clean, pauseBeforeAnswerRef.current);
        if (hesitation.worthAnotherLook) setHesitations((previous) => ({ ...previous, [spec.id]: hesitation }));

        if (result.clean) await current.rewrite(spec.id, result.clean, result.verbatim);
        push(
          "app",
          result.rewritten
            ? `dictation shaped ${spec.id}, verbatim kept (${result.verbatim.length} chars)`
            : `dictation returned verbatim only for ${spec.id} — ${result.note}`,
        );
      } catch (cause) {
        push("app", `dictation for ${spec.id} errored: ${String(cause)}`);
      }
    },
    [push],
  );

  /**
   * Find the words a long answer came from in the recent turns, and send just those seconds to
   * Dictation.
   *
   * Newest turn first. The agent usually fills a field while the person is still mid-sentence, so
   * the answer's turn may not have finished yet — it waits, and is shaped the moment that turn ends.
   * (Sending "the last turn" instead, as this once did, shaped long answers from the wrong audio.)
   * Where the words are in a turn but cannot be pinned to a moment, the whole turn is sent.
   */
  const placeClip = useCallback(
    (fieldId: string, evidence: string): boolean => {
      for (const turn of [...turnsAudioRef.current].reverse()) {
        if (!checkEvidence(turn.text, evidence).ok) continue;
        const clip = clipFor(evidence, turn.timeline, turn.audio.length);
        const audio = clip ? turn.audio.subarray(clip.start, clip.end) : turn.audio;
        void shapeLongAnswer(fieldId, audio);
        return true;
      }
      return false;
    },
    [shapeLongAnswer],
  );

  // ── The tools ────────────────────────────────────────────────────────────────────

  /** Everything the person has said so far — the turn still in progress included. */
  const heard = () => `${transcriptRef.current}\n${partialRef.current}`.trim();

  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      const current = session();

      if (name === FILL_TOOL_NAME) {
        const done = await current.fill(args, heard());
        setOutcomes((previous) => [...previous, ...done.outcomes]);

        const landed = done.outcomes.filter((o) => o.status === "written").map((o) => o.fieldId);
        if (landed.length > 0) {
          // A long answer is shaped from its own audio — or waits for the turn it is in to end.
          for (const said of done.spoken) {
            if (!landed.includes(said.fieldId)) continue;
            if (!placeClip(said.fieldId, said.evidence)) pendingClipsRef.current.set(said.fieldId, said.evidence);
          }
          // The long take is over once the first answers land: switch to conversational timing.
          if (!switchedModeRef.current) {
            switchedModeRef.current = true;
            voiceRef.current?.setTurnDetection(CONVERSATION_TURN_DETECTION);
            push("app", "switched to conversation timing");
          }
        }
        return done.result;
      }

      if (name === CLEAR_TOOL_NAME) {
        const done = await current.clear(args, heard());
        const cleared = new Set(
          ((done.result.cleared as { field: string }[] | undefined) ?? []).map((c) => c.field),
        );
        if (cleared.size > 0) {
          for (const id of cleared) pendingClipsRef.current.delete(id);
          const without = <T,>(record: Record<string, T>) =>
            Object.fromEntries(Object.entries(record).filter(([id]) => !cleared.has(id)));
          setOutcomes((previous) => previous.filter((o) => !cleared.has(o.fieldId)));
          setHesitations((previous) => without(previous));
          setShaped((previous) => without(previous));
        }
        return done.result;
      }

      return { error: `Unknown tool "${name}".` };
    },
    [session, push, placeClip],
  );

  // ── Starting and stopping ────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setStatus("reading");
    setError(null);
    setTurns([]);
    setLog([]);
    switchedModeRef.current = false;
    transcriptRef.current = "";
    partialRef.current = "";
    turnsAudioRef.current = [];
    pendingClipsRef.current = new Map();
    speechStartedAtRef.current = null;
    askedAtRef.current = null;
    pauseBeforeAnswerRef.current = undefined;

    try {
      const current = session();
      await current.open();
      setForm(current.state());

      const problems = current.toolProblems();
      if (problems.length > 0) throw new Error(`The generated tools are invalid: ${problems.join("; ")}`);

      const greeting = current.greeting();
      push("app", `opening line: ${greeting}`);

      setStatus("connecting");
      voiceRef.current = await startVoiceSession({
        voice: chooseVoice(),
        systemPrompt: current.prompt(),
        greeting,
        tools: current.tools(),
        onToolCall: async (name, args) => {
          const result = await runTool(name, args);
          // In full, never truncated — the frame log cuts at 260 characters, which is exactly the
          // part that was missing when a live run went wrong.
          push("app", `tool call ${name} ${JSON.stringify(args)}`);
          push("app", `tool result ${JSON.stringify(result)}`);
          console.info(`[longtake] ${name}`, { args, result });
          return result;
        },
        // After the result is out, the agent's prompt catches up with the form — so even a turn
        // with no tool call ("hello?", "what's left?") is answered from the form as it is.
        onResultsSent: () => voiceRef.current?.setSystemPrompt(current.prompt()),
        onEvent: (direction, message) => push(direction, JSON.stringify(message).slice(0, 260)),
        onReady: () => {
          setStatus("live");
          push("app", "session.ready — speak now");
        },
        onUserPartial: (text) => {
          partialRef.current = text;
          setPartial(text);
        },
        onUserTranscript: (text, audio, timeline) => {
          if (audio && audio.length > 0) {
            turnsAudioRef.current = [...turnsAudioRef.current.slice(-5), { text, audio, timeline }];
            // Answers filled while this turn was being spoken can be placed now.
            for (const [fieldId, evidence] of pendingClipsRef.current) {
              if (placeClip(fieldId, evidence)) pendingClipsRef.current.delete(fieldId);
            }
          }
          partialRef.current = "";
          setPartial("");
          // Accumulated, not replaced: a quote may span two turns of one long take.
          transcriptRef.current = `${transcriptRef.current}\n${text}`.trim();
          setTurns((t) => [...t, { who: "you", text }]);
        },
        onAgentTranscript: (text) => {
          askedAtRef.current = Date.now();
          setTurns((t) => [...t, { who: "agent", text }]);
        },
        onSpeechStart: () => {
          speechStartedAtRef.current = Date.now();
          pauseBeforeAnswerRef.current = askedAtRef.current
            ? (speechStartedAtRef.current - askedAtRef.current) / 1000
            : undefined;
        },
        onError: (message) => {
          setError(message);
          setStatus("error");
        },
        onClosed: () => setStatus((s) => (s === "error" ? s : "idle")),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, [session, runTool, push, placeClip]);

  const stop = useCallback(async () => {
    await voiceRef.current?.stop();
    voiceRef.current = null;
    setStatus("idle");
    setPartial("");
  }, []);

  useEffect(() => () => void voiceRef.current?.stop(), []);

  const forgetOne = useCallback((key: string) => session().forgetOne(key), [session]);
  const forgetEverything = useCallback(() => session().forgetEverything(), [session]);

  // ── What the page draws — all of it derived from the one form state ────────────────

  const derived = useMemo(() => {
    const label = (id: string) =>
      (form.fields.find((f) => f.spec.id === id)?.spec.label || id).replace(/\s*\*\s*$/, "").trim();

    const latest = new Map<string, WriteOutcome>();
    for (const outcome of outcomes) latest.set(outcome.fieldId, outcome);

    // Only failures the person has to act on: the page refused twice, or not one of the choices.
    // Anything since filled — by a later answer or by their own hand — is no longer theirs to fix.
    const filled = new Set(form.fields.filter((f) => f.value !== null).map((f) => f.spec.id));
    const needsYou = [...latest.values()]
      .filter((o) => !filled.has(o.fieldId))
      .filter(
        (o) => (o.status === "rejected-by-page" && o.retried) || (o.status === "refused" && (o.choices?.length ?? 0) > 0),
      )
      .map((o) => ({
        fieldId: o.fieldId,
        question: label(o.fieldId),
        why:
          o.status === "refused"
            ? `not one of the choices — pick from: ${o.choices!.slice(0, 6).join(", ")}`
            : "the page would not keep it",
      }));

    return {
      written: [...latest.values()].filter((o): o is Written => o.status === "written"),
      refused: [...latest.values()].filter((o): o is NotWritten => o.status !== "written"),
      needsYou,
      missing: form.fields
        .filter((f) => f.spec.required && f.value === null && !f.declined)
        .map((f) => label(f.spec.id)),
      waiting: form.fields
        .filter((f) => f.pending)
        .map((f) => ({ fieldId: f.spec.id, question: label(f.spec.id), suggestion: f.pending!.suggestion, heard: f.pending!.heard })),
      fromMemory: form.fields
        .filter((f) => f.source === "memory")
        .map((f) => ({ fieldId: f.spec.id, question: label(f.spec.id) })),
    };
  }, [form, outcomes]);

  return {
    status,
    live: status !== "idle" && status !== "error",
    error,
    form,
    fieldCount: form.progress.total,
    filledCount: form.progress.filled,
    outcomes,
    optionalLeft: form.progress.optionalLeft,
    ...derived,
    turns,
    partial,
    shaped,
    hesitations,
    known,
    log,
    start,
    stop,
    forgetOne,
    forgetEverything,
  };
}
