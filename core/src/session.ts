/**
 * One person, one form, one conversation — everything that happens to the form goes through here.
 *
 * ## Why this exists
 *
 * All of this used to live in a React hook more than a thousand lines long: seven hand-kept lists
 * of what was filled, written, declined and remembered, a re-read routine, two tool handlers, the
 * memory pass, the page watcher's bookkeeping. Every live bug of the last week was one of those
 * lists disagreeing with another, or with the page.
 *
 * Here there is one ledger, one registry, and one way to know what the form holds (`snapshot`,
 * which reads the page). Every operation — reading, filling, clearing, reshaping — ends by asking
 * the planner what comes next, and the answer goes to the agent as a brief it reads every turn.
 *
 * Framework-free, so it runs the same in the landing page, the workbench, the extension, and the
 * test harness.
 */

import { pressAction, readActions, type ActionsRead } from "./actions";
import {
  buildClearTool,
  buildConfirmTool,
  buildFillTool,
  buildLaterTool,
  buildDraftTool,
  buildLeaveTool,
  buildPressTool,
  buildSaveTool,
  PRESS_TOOL_NAME,
  validateTool,
  type VoiceAgentTool,
} from "./binder";
import { conceptById } from "./concepts";
import { openingLine, phoneFields, summarise, type FormReshape } from "./conversation";
import { exclusively, whenSettled } from "./dom-path";
import { checkEvidence, keepOnlyWhatWasSaid } from "./evidence";
import { snapshot, type FormState } from "./form-state";
import { gate } from "./gate";
import { Ledger, type Pending } from "./ledger";
import { systemPrompt } from "./persona";
import { brief, doNext, nextMove, resumeLine, type Move, type Plan } from "./planner";
import {
  emptyProfile,
  factId,
  factKeys,
  knownFacts,
  RECALL_WHY_WORDS,
  recallFor,
  sayFact,
  shownValue,
  type KnownFact,
  type LongAnswer,
  type Profile,
  type ProfileChange,
  type Provenance,
} from "./profile";
import { dialCodeOf, optionForDialCode, PHONE_NUMBER, PHONE_WHOLE, withoutDialCode } from "./phones";
import { memoryProfileStore, type ProfileStore } from "./profile-store";
import { harvestOptions, readForm, titleOf, waitForForm } from "./reader";
import { FieldRegistry } from "./reconcile";
import { fieldName, type FieldSpec, type FormRead, type SpokenValue } from "./types";
import { applyMeaningHints, fallbackMeanings, snapshotOf, structureKey, validateMeanings, type FormSnapshot, type Meanings } from "./understand";
import { clearValues, writeValues, type ClearOutcome, type WriteOutcome } from "./writer";

export type SessionOptions = {
  /** The part of the page the form is in. */
  root: () => Document | Element;
  /** Anything inside these is not the person's form (our own widget, dev overlays). */
  ignore: string;
  /** What is known about the person, and its one owner. Held in memory for this page when absent. */
  profile?: ProfileStore;
  /**
   * What each field means, from the model — `/api/understand` on the site, relayed by the
   * extension's worker. Absent, failing or slow: the offline reading, which puts nothing in unasked.
   */
  understand?: (snapshot: FormSnapshot) => Promise<unknown>;
  log?: (line: string) => void;
  /** The form's set of questions changed: the agent needs new tools and a new prompt, now. */
  onReshape?: () => void;
  /** Something about the form may have changed — for the UI to redraw from `state()`. */
  onChange?: () => void;
  /** The brief changed with no tool call to carry it — answers from last time arrived late. */
  onPromptStale?: () => void;
};

/** What a fill or clear did, for the UI — alongside what the agent is told. */
export type Done<Result> = {
  result: Result;
  outcomes: WriteOutcome[];
  /** Answers that went in, with the words they came from. */
  spoken: SpokenValue[];
};

const CHOICE_KINDS = new Set(["select", "radio", "multiselect", "checkbox"]);

/**
 * How long answers from last time wait for the form to be understood before the call opens. Past
 * this the call starts anyway, and they go in the moment the meanings arrive.
 */
const UNDERSTAND_WAIT_MS = 4000;

type Learned = "spoken" | "confirmed";

export class LongtakeSession {
  readonly ledger = new Ledger();
  private registry = new FieldRegistry();
  private current: FormRead | null = null;
  private readonly store: ProfileStore;
  private profile: Profile = emptyProfile();
  /** What each field means: the offline reading until the model's arrives, then the model's. */
  private meanings: Meanings = {};
  private understanding: Promise<void> | null = null;
  /** Answers given before the model said what their fields mean — learned once it has. */
  private unlearned: { value: SpokenValue; how: Learned }[] = [];
  private recalled = false;
  /** This call, for the profile's history: a correction within one call replaces, it does not ask. */
  private readonly call = Math.random().toString(36).slice(2, 10);
  private plan: Plan = { optionalOffered: false };
  private title = "";
  private chain: Promise<unknown> = Promise.resolve();
  private prefilled: Promise<unknown> = Promise.resolve();
  private writing = false;
  private movedWhileWriting = false;

  constructor(private readonly options: SessionOptions) {
    this.store = options.profile ?? memoryProfileStore();
  }

  // ── Reading ──────────────────────────────────────────────────────────────────────

  get read(): FormRead | null {
    return this.current;
  }

  /** The form as it is right now. The only answer to "what is filled" anywhere in the product. */
  state(): FormState {
    if (!this.current) {
      return { title: "", fields: [], theirs: [], actions: [], asks: [], progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 } };
    }
    const state = snapshot(this.current, this.ledger, this.title, this.buttons());
    for (const field of state.fields) {
      const library = this.libraryFor(field);
      if (library) field.library = { id: library.id, question: library.question, text: library.text };
    }
    return state;
  }

  /**
   * A long answer they gave on an earlier form, to a question meaning the same (the model's reading
   * of both), for an empty long field that has nothing waiting — the newest one.
   */
  private libraryFor(field: FormState["fields"][number]): LongAnswer | null {
    if (!field.spec.longForm || field.value !== null || field.pending || field.declined) return null;
    const concept = this.meanings[field.spec.id]?.concept;
    if (!concept || concept === "other") return null;
    const same = Object.values(this.profile.answers).filter((answer) => answer.concept === concept);
    return same.sort((a, b) => b.at - a.at)[0] ?? null;
  }

  /**
   * What a draft for this field is written from, beside their words: the question, the form's
   * limit, their saved answers (never a personal one), and what is waiting or saved for it.
   */
  draftRequest(fieldId: string): { question: string; maxChars?: number; facts: { name: string; value: string }[]; pending?: Pending; library?: LongAnswer } | null {
    const spec = this.current?.specs.find((s) => s.id === fieldId);
    if (!spec?.longForm) return null;
    const field = this.state().fields.find((f) => f.spec.id === fieldId);
    const facts = Object.values(this.profile.facts)
      .filter((fact) => !fact.sensitive)
      .slice(0, 12)
      .map((fact) => ({ name: sayFact(fact), value: shownValue(fact.value) }));
    const pending = this.ledger.pendingFor(fieldId);
    const library = field ? this.libraryFor({ ...field, pending: undefined }) : null;
    return {
      question: fieldName(spec),
      ...(spec.maxLength ? { maxChars: spec.maxLength } : {}),
      facts,
      ...(pending?.reason === "draft" ? { pending } : {}),
      ...(library ? { library } : {}),
    };
  }

  /** A draft, waiting for their yes — never written until they give it. */
  holdDraft(fieldId: string, text: string, said: string[], missing: string[], flagged: string[]): Record<string, unknown> {
    this.ledger.hold(fieldId, { reason: "draft", suggestion: text, heard: said.join(" … "), value: text, draft: { said, missing, flagged } });
    this.options.onChange?.();
    return { do_next: doNext(this.move()) };
  }

  /** What to do next. Offering the optional fields is a one-time move, so it is recorded. */
  move(): Move {
    const move = nextMove(this.state(), this.plan);
    if (move.kind === "offer_optional") this.plan.optionalOffered = true;
    return move;
  }

  /** What the next move would be, without taking it — offering the optional ones is not marked. */
  peekMove(): Move {
    return nextMove(this.state(), this.plan);
  }

  /** The agent said this field went in; it did not. Told in the brief until the field has an answer. */
  noteClaimedIn(id: string, said: string): void {
    this.ledger.claimedIn(id, said);
    this.options.onChange?.();
  }

  /** The agent's whole prompt: who it is, the form as it is, and what to do next. */
  prompt(): string {
    return systemPrompt(brief(this.state(), this.move()));
  }

  tools(): VoiceAgentTool[] {
    const specs = this.current?.specs ?? [];
    const press = this.current ? buildPressTool(this.buttons().actions) : null;
    const always = [buildFillTool(specs), buildConfirmTool(specs), buildClearTool(specs), buildLaterTool(specs), buildLeaveTool(specs), buildSaveTool(specs)];
    const draft = buildDraftTool(specs);
    return [...always, ...(draft ? [draft] : []), ...(press ? [press] : [])];
  }

  /**
   * The `confirm_answer` tool: their reply to "is that right?", as the agent understood it.
   *
   * Agreed: the answer that was waiting goes in, through the same write, record and re-read as a
   * fill — its evidence is their original words plus their yes. Not agreed: it stops waiting, and
   * the plan goes back to asking the question.
   */
  async confirm(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
    const id = typeof args.field === "string" ? args.field : "";
    const agreed = args.agreed === true;
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    const spec = read.specs.find((s) => s.id === id);
    const pending = this.ledger.pendingFor(id);

    if (!spec || !pending) {
      return { result: { error: `Nothing is waiting for a yes on "${id}".`, do_next: doNext(this.move()), submitted: false }, outcomes: [], spoken: [] };
    }
    if (!checkEvidence(heard, evidence).ok) {
      return { result: { confirmed: false, why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
    }

    const question = fieldName(spec);
    if (!agreed) {
      this.ledger.release(id);
      const state = this.state();
      this.options.onChange?.();
      return {
        result: { not_confirmed: { field: id, question }, progress: state.progress, do_next: doNext(this.move()), submitted: false },
        outcomes: [],
        spoken: [],
      };
    }

    const recalled = pending.reason === "from_last_time";
    const drafted = pending.reason === "draft";
    const claim: SpokenValue = { fieldId: id, value: pending.value ?? pending.suggestion, evidence: `${pending.heard} — ${evidence}` };
    this.writing = true;
    this.movedWhileWriting = false;
    let results: WriteOutcome[];
    try {
      results = await writeValues(read.specs, read.handles, [claim]);
    } finally {
      this.writing = false;
    }
    // An answer from last time, now confirmed: from last time on the page, and trusted next time.
    await this.record(results, [claim], read, recalled ? "memory" : drafted ? "drafted" : "spoken", recalled && pending.factId ? { [id]: pending.factId } : {});
    if (drafted && results[0]?.status === "written") await this.keepLongAnswer(spec, String(claim.value), pending.draft?.said ?? [], read);
    if (recalled) await this.learn([{ ...claim, value: pending.value ?? pending.suggestion }], read, "confirmed");
    const reshaped =
      (results[0]?.status === "written" && CHOICE_KINDS.has(spec.kind)) || this.movedWhileWriting ? await this.pageChanged() : null;
    const result = this.report(results, [claim], reshaped, { waiting_for_yes: [] });
    this.options.onChange?.();
    return { result, outcomes: results, spoken: [claim] };
  }

  /**
   * The `skip_for_now` tool: "leave that, we'll do it at the end". Needs their words, like
   * everything else; changes nothing on the page — only the order things are asked in.
   */
  /**
   * The `leave_empty` tool: they said a question doesn't apply to them, or they'd rather not answer
   * it. It stays empty and is not asked again (ledger: declined). A field that already has an answer
   * is left as it is — emptying one is `clear_fields`, which undoes and asks about next time.
   */
  leaveEmpty(args: Record<string, unknown>, heard: string): Done<Record<string, unknown>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
    const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    if (!checkEvidence(heard, evidence).ok) {
      return { result: { left_empty: [], why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
    }
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const values = new Map(this.state().fields.map((f) => [f.spec.id, f.value]));
    const known = fields.filter((id) => byId.has(id));
    const answered = known.filter((id) => values.get(id) !== null && values.get(id) !== undefined);
    const left = known.filter((id) => !answered.includes(id));
    for (const id of left) this.ledger.decline(id);
    const name = (id: string) => fieldName(byId.get(id)!);
    const state = this.state();
    const result = {
      left_empty: left.map(name),
      ...(answered.length ? { has_an_answer: answered.map(name) } : {}),
      progress: state.progress,
      do_next: doNext(this.move()),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  setAside(args: Record<string, unknown>, heard: string): Done<Record<string, unknown>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
    const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    if (!checkEvidence(heard, evidence).ok) {
      return { result: { set_aside: [], why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
    }
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const moved = fields.filter((id) => byId.has(id));
    for (const id of moved) this.ledger.setAside(id);
    const state = this.state();
    const result = {
      set_aside: moved.map((id) => { const spec = byId.get(id); return spec ? fieldName(spec) : id; }),
      progress: state.progress,
      do_next: doNext(this.move()),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  /** The form's buttons as they are right now — read fresh, since a page can rename them. */
  private buttons(): ActionsRead {
    return readActions(this.scope(), this.options.ignore);
  }

  /**
   * The `press_form_button` tool: "Add another", or "Next" — never a submit button.
   *
   * Needs the person's words like everything else. After a Next the form is a new page: the
   * optional offer is owed again, and the agent gets new tools and a new brief straight away.
   */
  /**
   * The answer to a tool call this page's last document made and never answered: it went when the
   * page did. A Next that loaded this page is answered as pressed, with this page's questions — so
   * the agent says where it is and asks for them. Anything else did not finish.
   */
  carriedResult(name: string): Record<string, unknown> {
    const state = this.state();
    if (name === PRESS_TOOL_NAME) {
      return {
        pressed: true,
        form_changed: { new_page: true, new_questions: state.fields.map((f) => fieldName(f.spec)).slice(0, 15) },
        progress: state.progress,
        do_next: doNext(this.move()),
        submitted: false,
      };
    }
    return { error: "The page moved on before this finished. Whatever went in on the last page stays there; FORM NOW is the new page.", submitted: false };
  }

  async press(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const id = typeof args.action === "string" ? args.action : "";
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    if (!checkEvidence(heard, evidence).ok) {
      return { result: { not_pressed: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
    }

    const buttons = this.buttons();
    const action = buttons.actions.find((a) => a.id === id);
    const el = buttons.handles.get(id);
    if (!action || !el) {
      return { result: { not_pressed: "That button is not on the page.", submitted: false }, outcomes: [], spoken: [] };
    }

    this.writing = true;
    let pressed: ReturnType<typeof pressAction>;
    try {
      pressed = await exclusively(async () => pressAction(el));
    } finally {
      this.writing = false;
    }
    if (!pressed.pressed) {
      return { result: { not_pressed: pressed.reason, submitted: false }, outcomes: [], spoken: [] };
    }

    const reshaped = await this.pageChanged();
    // Buttons change even when fields do not — a Next that became Submit on the last page.
    this.options.onReshape?.();

    // A Next the form refused. Google Forms stays put when a required question is empty and says
    // so under it; reporting "pressed" there let the agent announce a page that never came.
    const stayed = action.kind === "next" && !reshaped;
    if (action.kind === "next" && !stayed) this.plan = { optionalOffered: false };

    const state = this.state();
    const says = state.fields
      .filter((f) => f.error)
      .map((f) => ({ question: fieldName(f.spec), form_says: f.error }));
    const result = {
      pressed: action.label,
      ...(stayed ? { page_did_not_change: true, ...(says.length ? { the_form_says: says } : {}) } : {}),
      ...(reshaped ? { form_changed: this.changeFacts(reshaped) } : {}),
      progress: state.progress,
      do_next: doNext(this.move()),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  /** Problems with the tools, checked before they are ever sent — the API accepts bad ones silently. */
  toolProblems(): string[] {
    return this.tools().flatMap((tool) => validateTool(tool));
  }

  /** The first thing the agent says, built from the form as it is — remembered answers included. */
  greeting(): string {
    const state = this.state();
    return openingLine(
      state.fields.map((f) => f.spec),
      this.title,
      {
        filled: state.fields.filter((f) => f.value !== null).map((f) => f.spec.id),
        remembered: state.fields.some((f) => f.source === "memory"),
        toConfirm: state.fields.filter((f) => f.pending?.reason === "from_last_time").map((f) => fieldName(f.spec)),
        recalled: state.fields.filter((f) => f.source === "memory").length,
        fresh: state.fields.filter((f) => f.value === null && !f.pending && !f.declined).length,
        learns: Boolean(this.options.understand),
      },
    );
  }

  /** The first words of a new session after the line dropped — where things stand, then the next ask. */
  resumeGreeting(): string {
    return resumeLine(this.state(), this.move());
  }

  /** Everything known about the person, newest first — for a surface to show and let them change. */
  known(): KnownFact[] {
    return knownFacts(this.profile);
  }

  /** The profile changed somewhere else — a settings page, another tab. */
  profileChanged(profile: Profile): void {
    this.profile = profile;
    this.options.onChange?.();
  }

  // ── Opening ──────────────────────────────────────────────────────────────────────

  private scope(): Document | Element {
    return this.options.root();
  }

  private readNow(): FormRead {
    const scope = this.scope();
    const url = ("ownerDocument" in scope && scope.ownerDocument ? scope.ownerDocument : (scope as Document)).location?.href ?? "";
    return readForm(scope, url, this.options.ignore);
  }

  /**
   * Bring back answers from an earlier form, before anybody speaks.
   *
   * Runs at page load. Every value carries the words originally used, so the writer applies its
   * usual rules — memory gets no special permission.
   */
  prefill(): Promise<unknown> {
    this.prefilled = (async () => {
      this.profile = await this.store.load().catch(() => emptyProfile());
      if (Object.keys(this.profile.facts).length === 0) return 0;

      await waitForForm();
      const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
      this.current = read;
      // A fresh read has fresh fields: what their words add is added again.
      applyMeaningHints(read.specs, this.meanings);
      this.title = titleOf(read, this.scope());

      // What the form's questions mean decides what may go in — waited for, but not for long.
      const understood = this.understandForm(read);
      await Promise.race([understood, new Promise((done) => setTimeout(done, UNDERSTAND_WAIT_MS))]);
      return this.recall(read);
    })();
    return this.prefilled;
  }

  /**
   * Answers from last time, for fields still empty and untouched: the sure ones go in, the rest wait
   * for a yes with their reason. Runs at open, and again when the form's meanings arrive late.
   */
  private async recall(read: FormRead): Promise<number> {
    this.recalled = true;
    const state = this.state();
    const free = new Set(
      state.fields
        // An answer from last time already waiting for a yes may go in now: the model arrived and is sure.
        .filter((f) => f.value === null && (!f.pending || f.pending.reason === "from_last_time") && !f.declined && !this.ledger.entry(f.spec.id))
        .map((f) => f.spec.id),
    );
    const found = recallFor(read.specs, this.meanings, this.profile).filter((r) => free.has(r.fieldId));
    if (found.length === 0) return 0;

    const sure = found.filter((r) => r.sure);
    const values: SpokenValue[] = sure.map((r) => ({ fieldId: r.fieldId, value: r.value, evidence: r.evidence }));
    this.writing = true;
    let results: WriteOutcome[] = [];
    try {
      results = values.length > 0 ? await writeValues(read.specs, read.handles, values) : [];
    } finally {
      this.writing = false;
    }
    await this.record(results, values, read, "memory", Object.fromEntries(sure.map((r) => [r.fieldId, r.factId])));
    const wentIn = results.filter((r) => r.status === "written").map((r) => r.fieldId);
    if (wentIn.length > 0) {
      const ids = sure.filter((r) => wentIn.includes(r.fieldId)).map((r) => r.factId);
      void this.store.apply([{ type: "used", ids }]).catch(() => undefined);
    }

    // The rest wait for a yes. So does a sure one the page would not take as it was.
    const refused = new Set(results.filter((r) => r.status !== "written").map((r) => r.fieldId));
    for (const r of found.filter((r) => !r.sure || refused.has(r.fieldId))) {
      this.ledger.hold(r.fieldId, {
        reason: "from_last_time",
        suggestion: shownValue(r.value),
        value: r.value,
        heard: r.evidence,
        factId: r.factId,
        why: RECALL_WHY_WORDS[r.why ?? "closest_choice"],
      });
    }
    this.options.log?.(`from last time: ${wentIn.length} in, ${found.length - wentIn.length} waiting for a yes`);
    this.options.onChange?.();
    return wentIn.length;
  }

  // ── What the form means ──────────────────────────────────────────────────────────

  /**
   * Ask what each field means — once per form structure, and cached on the device. A field already
   * understood keeps its meaning; a field the form grew gets its own. A late answer upgrades the
   * call: answers from last time go in, and what was said before it arrived is learned.
   */
  private understandForm(read: FormRead): Promise<void> {
    for (const [id, meaning] of Object.entries(fallbackMeanings(read.specs))) {
      if (!this.meanings[id]) this.meanings[id] = meaning;
    }
    const ask = this.options.understand;
    if (!ask) return Promise.resolve();

    const run = async () => {
      const unknown = read.specs.filter((spec) => this.meanings[spec.id]?.source !== "model");
      if (unknown.length === 0) return;
      const scope = this.scope();
      const doc = "ownerDocument" in scope && scope.ownerDocument ? scope.ownerDocument : (scope as Document);
      const snapshot = snapshotOf(read.specs, { host: doc.location?.host ?? "", title: this.title });
      if (snapshot.fields.length === 0) return;
      // No hash outside a secure context (a plain-http page): then there is simply no cache.
      const key = await structureKey(snapshot).catch(() => null);
      let meanings = key ? await this.store.meanings?.get(key).catch(() => null) : null;
      if (!meanings) {
        meanings = validateMeanings(await ask(snapshot), read.specs);
        if (key && Object.keys(meanings).length > 0) await this.store.meanings?.put(key, meanings).catch(() => undefined);
      }
      await this.adopt(meanings);
    };
    const next = (this.understanding ?? Promise.resolve()).then(run).catch((cause: unknown) => {
      this.options.log?.(`could not understand the form: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    this.understanding = next;
    return next;
  }

  private async adopt(meanings: Meanings): Promise<void> {
    const present = new Set(this.current?.specs.map((spec) => spec.id));
    let fresh = 0;
    for (const [id, meaning] of Object.entries(meanings)) {
      if (!present.has(id) || this.meanings[id]?.source === "model") continue;
      this.meanings[id] = meaning;
      fresh++;
    }
    if (fresh === 0 || !this.current) return;
    this.options.log?.(`understood ${fresh} field(s)`);
    // What the page's words add to its markup — a question required only in words, a choice that
    // only asks to choose, a date box that shows no format — and the agent gets the new tool.
    if (applyMeaningHints(this.current.specs, this.meanings)) this.options.onReshape?.();

    const waiting = this.unlearned;
    this.unlearned = [];
    for (const how of ["spoken", "confirmed"] as const) {
      const values = waiting.filter((w) => w.how === how).map((w) => w.value);
      if (values.length > 0) await this.learn(values, this.current, how);
    }
    // Late for the opening: what last time can offer goes in now, and the agent is told.
    if (this.recalled && Object.keys(this.profile.facts).length > 0) {
      const wentIn = await this.recall(this.current);
      if (wentIn > 0 || this.state().fields.some((f) => f.pending?.reason === "from_last_time")) this.options.onPromptStale?.();
    }
  }

  /** Read the form, completely, before the conversation starts. */
  async open(): Promise<void> {
    // Remembered answers go in first, so the opening line knows about them. Bounded: a prefill
    // that hangs must not stop the microphone working.
    await Promise.race([this.prefilled, new Promise((done) => setTimeout(done, 15000))]);
    await waitForForm();

    const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
    this.current = read;
    // A fresh read has fresh fields: what their words add is added again.
    applyMeaningHints(read.specs, this.meanings);
    this.title = titleOf(read, this.scope());
    this.plan = { optionalOffered: false };
    // Meanings for what was said on this form, and for a form that grew. Never waited for here.
    void this.understandForm(read);

    // Anything already in the form that we did not put there was there before we arrived.
    this.ledger.markAtOpen(
      this.state()
        .fields.filter((f) => f.value !== null && !this.ledger.entry(f.spec.id))
        .map((f) => f.spec.id),
    );
    this.options.log?.(`read ${read.specs.length} fields, ${read.skipped.length} skipped`);
    this.options.onChange?.();
  }

  // ── Filling ──────────────────────────────────────────────────────────────────────

  /** Write down what went in, for the ledger — and learn what was said, for next time. */
  private async record(
    results: WriteOutcome[],
    values: SpokenValue[],
    read: FormRead,
    source: "spoken" | "memory" | "drafted",
    facts: Record<string, string> = {},
    wholePhones: Map<string, string> = new Map(),
  ): Promise<void> {
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const said: SpokenValue[] = [];
    for (const result of results) {
      if (result.status !== "written") continue;
      const spec = byId.get(result.fieldId);
      const claim = values.find((v) => v.fieldId === result.fieldId);
      if (!spec || !claim) continue;
      this.ledger.wrote(result.fieldId, {
        source,
        value: result.wrote,
        evidence: claim.evidence,
        spec,
        ...(facts[result.fieldId] ? { factId: facts[result.fieldId] } : {}),
      });
      // What they said is kept as they said it, not as this form shaped it: "India", not "India (+91)";
      // a phone number whole, not the part left in this form's number box.
      const whole = wholePhones.get(result.fieldId);
      said.push(whole ? { ...claim, value: whole } : claim);
    }
    if (source === "spoken" && said.length > 0) await this.learn(said, read, "spoken");
  }

  /**
   * An approved long answer, kept whole for a later form's question meaning the same — one per
   * meaning per site, the newest. Never a personal one (health, documents), and never one that is
   * not to be kept at all.
   */
  private async keepLongAnswer(spec: FieldSpec, text: string, said: string[], read: FormRead): Promise<void> {
    const meaning = this.meanings[spec.id];
    const concept = meaning?.concept && meaning.concept !== "other" ? meaning.concept : undefined;
    const scope = concept ? conceptById(concept)?.scope : undefined;
    if (scope === "sensitive" || scope === "never") return;
    let host = "";
    try {
      host = new URL(read.url).host;
    } catch {
      // a page with no URL (a test) keeps its answers under no site
    }
    const answer: LongAnswer = {
      id: `answer:${concept ?? spec.id}:${host}`,
      gist: meaning?.gist || fieldName(spec),
      question: fieldName(spec),
      text,
      said,
      host,
      at: Date.now(),
      uses: 0,
      ...(concept ? { concept } : {}),
    };
    try {
      this.profile = (await this.store.apply([{ type: "saveAnswer", answer }])).profile;
    } catch (cause) {
      this.options.log?.(`could not keep the answer for next time: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /** Where an answer was given, for its history. */
  private provenance(value: SpokenValue, read: FormRead, how: Learned | "typed"): Provenance {
    const spec = read.specs.find((s) => s.id === value.fieldId);
    let host = "";
    try {
      host = new URL(read.url).host;
    } catch {
      // a page with no address
    }
    return {
      value: value.value,
      evidence: value.evidence,
      source: how,
      host,
      url: read.url,
      askedAs: spec ? fieldName(spec).slice(0, 300) : value.fieldId,
      formTitle: this.title.slice(0, 200),
      at: Date.now(),
      session: this.call,
      field: value.fieldId,
    };
  }

  /**
   * Keep what they said for next time — only their own answers, to questions that are asked the
   * same way everywhere, on a meaning the model named with at least some confidence. Something
   * already known, said differently, is not overwritten: it becomes a question for them. A
   * personal answer is kept only if they say so, asked once at the end.
   */
  private async learn(values: SpokenValue[], read: FormRead, how: Learned | "typed"): Promise<void> {
    const keys = factKeys(read.specs, this.meanings);
    const changes: ProfileChange[] = [];
    const personal: { id: string; change: Extract<ProfileChange, { type: "observe" }> }[] = [];
    for (const value of values) {
      const meaning = this.meanings[value.fieldId];
      if (!meaning || meaning.source !== "model") {
        if (how !== "typed" && this.options.understand) this.unlearned.push({ value, how });
        continue;
      }
      let key = keys.get(value.fieldId);
      // A number box given the whole number, code and all: the whole phone is what is known now.
      if (key?.concept === PHONE_NUMBER && typeof value.value === "string" && dialCodeOf(value.value)) key = { concept: PHONE_WHOLE };
      const concept = key ? conceptById(key.concept) : undefined;
      if (!key || !concept || meaning.confidence === "low") continue;
      if (concept.scope !== "remember" && concept.scope !== "sensitive") continue;
      const change = {
        type: "observe" as const,
        key,
        gist: meaning.gist || concept.say,
        value: value.value,
        from: this.provenance(value, read, how),
      };
      if (concept.scope === "sensitive" && !this.profile.settings.rememberSensitive) {
        personal.push({ id: value.fieldId, change });
        continue;
      }
      changes.push(change);
    }

    if (how !== "typed") {
      for (const { id, change } of personal) {
        this.ledger.ask(id, { kind: "sensitive", key: change.key, gist: change.gist, value: change.value, from: change.from });
      }
    }
    if (changes.length === 0) return;

    try {
      const applied = await this.store.apply(changes);
      this.profile = applied.profile;
      const asked = new Set<string>();
      for (const question of applied.questions) {
        const field = question.from.field;
        if (!field || how === "typed") continue;
        // "Was X before — keep this for next time?" says two questions mean the same thing, so only
        // on a meaning the model is sure of. Live, it read "How many hours per week can you
        // volunteer?" as years of experience, not sure of it, and the agent asked: "hours you can
        // volunteer was 3 years before, but I've put 40 — keep that 40?". Unsure, nothing changes
        // either way: what was saved stays, and nobody is asked about it.
        if (this.meanings[field]?.confidence !== "high") continue;
        asked.add(field);
        this.ledger.ask(field, { kind: "changed", factId: question.id, key: question.key, gist: question.gist, was: question.was, now: question.now, from: question.from });
      }
      // Said again, the same as what was saved: nothing left to ask about that box.
      for (const change of changes) {
        const field = change.type === "observe" ? change.from.field : undefined;
        if (field && !asked.has(field) && this.ledger.askFor(field)?.kind === "changed") this.ledger.settle(field);
      }
    } catch (cause) {
      this.options.log?.(`could not keep answers for next time: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /** The `fill_fields` tool. `heard` is everything the person has said so far, turn in progress included. */
  async fill(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };

    const claimed: SpokenValue[] = [];
    for (const [fieldId, raw] of Object.entries(args)) {
      if (!raw || typeof raw !== "object") continue;
      const { value, evidence, how } = raw as { value?: unknown; evidence?: unknown; how?: unknown };
      if (value === undefined || value === null) continue;
      claimed.push({
        fieldId,
        value: value as SpokenValue["value"],
        evidence: typeof evidence === "string" ? evidence : "",
        ...(how === "named" || how === "inferred" || how === "unsure" ? { how } : {}),
      });
    }

    // Every quote is checked against what was actually said, then every choice against the gate.
    const { spoken, unsupported } = keepOnlyWhatWasSaid(heard, claimed);
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const phones = this.splitPhones(spoken, read.specs);
    const toWrite: SpokenValue[] = [...phones.extra];
    const held: { field: string; question: string; suggestion: string; they_said: string }[] = [];
    for (const claim of spoken) {
      const spec = byId.get(claim.fieldId);
      const verdict = spec ? gate(spec, claim, this.ledger.pendingFor(claim.fieldId)) : { write: true as const };
      if (verdict.write) {
        toWrite.push(claim);
      } else {
        this.ledger.hold(claim.fieldId, verdict.pending);
        held.push({
          field: claim.fieldId,
          question: spec ? fieldName(spec) : claim.fieldId,
          suggestion: verdict.pending.suggestion,
          they_said: verdict.pending.heard,
        });
      }
    }

    this.writing = true;
    this.movedWhileWriting = false;
    let results: WriteOutcome[];
    try {
      results = await writeValues(read.specs, read.handles, toWrite);
    } finally {
      this.writing = false;
    }
    await this.record(results, toWrite, read, "spoken", {}, phones.whole);

    const invented: WriteOutcome[] = unsupported.map((item) => ({
      fieldId: item.fieldId,
      status: "refused" as const,
      reason: item.reason,
    }));

    // Picking an option is what reshapes forms, so a re-read is paid for only then.
    const picked = results.some((r) => r.status === "written" && CHOICE_KINDS.has(byId.get(r.fieldId)?.kind ?? ""));
    const reshaped = picked || this.movedWhileWriting ? await this.pageChanged() : null;

    const outcomes = [...results, ...invented];
    const result = this.report(outcomes, claimed, reshaped, { waiting_for_yes: held });
    this.options.onChange?.();
    return { result, outcomes, spoken: toWrite };
  }

  /**
   * "+91 98765 43210" on a form that splits the country code into its own picker.
   *
   * The code goes into the picker — they said it, in those words — and the number box gets the
   * number without it, because a box next to a code picker will not take a second code. Only when
   * the code names exactly one option: "+1" is the United States AND Canada, and picking one of them
   * would be a guess, so that picker is left to be asked about.
   *
   * Mutates the claims it is given (strips the code from the number); returns the extra claims.
   */
  private splitPhones(spoken: SpokenValue[], specs: FieldSpec[]): { extra: SpokenValue[]; whole: Map<string, string> } {
    const pairs = phoneFields(specs);
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    const extra: SpokenValue[] = [];
    // The number as they said it, code and all — what is kept for next time, whatever this form splits.
    const whole = new Map<string, string>();

    for (const claim of spoken) {
      const codeId = pairs.get(claim.fieldId);
      if (byId.get(claim.fieldId)?.kind !== "tel" || !codeId) continue;
      if (spoken.some((c) => c.fieldId === codeId)) continue; // the agent already filled the picker

      const value = String(claim.value);
      const code = dialCodeOf(value) ?? /\+\s*(\d{1,4})\b/.exec(claim.evidence)?.[1];
      if (!code) continue;
      claim.value = withoutDialCode(value);
      whole.set(claim.fieldId, `+${code} ${claim.value}`);

      const option = optionForDialCode(byId.get(codeId)!, code);
      if (option) extra.push({ fieldId: codeId, value: option, evidence: claim.evidence });
    }
    return { extra, whole };
  }

  /** The `clear_fields` tool. */
  async clear(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };

    const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const question = (id: string) => { const spec = byId.get(id); return spec ? fieldName(spec) : id; };

    if (!checkEvidence(heard, evidence).ok) {
      return {
        result: { cleared: [], not_cleared: fields.map((id) => ({ field: id, question: question(id), why: "quote_not_found" })), submitted: false },
        outcomes: [],
        spoken: [],
      };
    }

    this.writing = true;
    this.movedWhileWriting = false;
    let results: ClearOutcome[];
    try {
      results = await clearValues(read.specs, read.handles, fields);
    } finally {
      this.writing = false;
    }

    const cleared = results.filter((r) => r.status === "cleared").map((r) => r.fieldId);
    const keys = factKeys(read.specs, this.meanings);
    const undo: ProfileChange[] = [];
    const fromLastTime: { field: string; question: string }[] = [];
    for (const id of cleared) {
      const entry = this.ledger.entry(id);
      this.ledger.decline(id);
      if (this.ledger.askFor(id)?.kind !== "forget") this.ledger.settle(id);
      if (entry?.source === "memory" && entry.factId) {
        // From last time: whether it goes from next time too is theirs to say, not a side effect.
        this.ledger.ask(id, { kind: "forget", factId: entry.factId, was: this.profile.facts[entry.factId]?.value ?? entry.value });
        fromLastTime.push({ field: id, question: question(id) });
      } else if (entry?.source === "spoken") {
        // Said in this call, then taken back: it was never really their answer.
        const key = keys.get(id);
        if (key) undo.push({ type: "unobserve", id: factId(key), session: this.call, field: id });
      }
    }
    if (undo.length > 0) {
      await this.store.apply(undo).then((applied) => void (this.profile = applied.profile)).catch(() => undefined);
    }

    const reshaped =
      cleared.some((id) => CHOICE_KINDS.has(byId.get(id)?.kind ?? "")) || this.movedWhileWriting
        ? await this.pageChanged()
        : null;

    const state = this.state();
    const move = this.move();
    const result = {
      cleared: cleared.map((id) => ({ field: id, question: question(id) })),
      not_cleared: results
        .filter((r): r is Extract<ClearOutcome, { status: "cannot-clear" }> => r.status === "cannot-clear")
        .map((r) => ({ field: r.fieldId, question: question(r.fieldId), why: r.reason })),
      ...(fromLastTime.length > 0 ? { was_from_last_time: fromLastTime } : {}),
      progress: state.progress,
      ...(reshaped ? { form_changed: this.changeFacts(reshaped) } : {}),
      do_next: doNext(move),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  /**
   * The `save_for_next_time` tool: their reply to a question about next time. A yes keeps the new
   * answer, forgets the cleared one, or remembers the personal one; a no leaves what was saved as
   * it was. Needs their words, like everything else. Nothing on the page changes.
   */
  async saveForNextTime(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };
    const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const agreed = args.agreed === true;
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    if (!checkEvidence(heard, evidence).ok) {
      return { result: { saved: [], why: "quote_not_found", submitted: false }, outcomes: [], spoken: [] };
    }

    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const changes: ProfileChange[] = [];
    const settled: string[] = [];
    const nothingAsked: string[] = [];
    for (const id of fields) {
      const ask = this.ledger.askFor(id);
      if (!ask) {
        nothingAsked.push(id);
        continue;
      }
      if (agreed) {
        if (ask.kind === "changed") changes.push({ type: "replace", id: ask.factId, value: ask.now, from: { ...ask.from, evidence: `${ask.from.evidence} — ${evidence}` }, key: ask.key, gist: ask.gist });
        if (ask.kind === "forget") changes.push({ type: "delete", id: ask.factId });
        if (ask.kind === "sensitive") changes.push({ type: "observe", key: ask.key, gist: ask.gist, value: ask.value, from: ask.from, allowSensitive: true });
      }
      this.ledger.settle(id);
      settled.push(id);
    }
    if (changes.length > 0) {
      try {
        this.profile = (await this.store.apply(changes)).profile;
      } catch (cause) {
        this.options.log?.(`could not save for next time: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }

    const name = (id: string) => { const spec = byId.get(id); return spec ? fieldName(spec) : id; };
    const state = this.state();
    const result = {
      ...(agreed ? { kept_for_next_time: settled.map(name) } : { left_as_before: settled.map(name) }),
      ...(nothingAsked.length > 0 ? { nothing_to_settle: nothingAsked.map(name) } : {}),
      progress: state.progress,
      do_next: doNext(this.move()),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  /**
   * The call is over. What they typed by hand into their own answers is kept — but only ever offered
   * back for a yes, since nobody heard them say it.
   */
  async finish(): Promise<void> {
    const read = this.current;
    if (!read) return;
    const typed = this.state()
      .fields.filter((f) => f.source === "typed" && f.value !== null)
      .map((f) => ({ fieldId: f.spec.id, value: f.value as SpokenValue["value"], evidence: "" }));
    const keys = factKeys(read.specs, this.meanings);
    const fresh = typed.filter((t) => { const key = keys.get(t.fieldId); return key && !this.profile.facts[factId(key)]; });
    if (fresh.length > 0) await this.learn(fresh, read, "typed");
  }

  /** Replace an answer with a better-shaped version of the same words (the Dictation pass). */
  async rewrite(fieldId: string, value: string, evidence: string): Promise<void> {
    const read = this.current;
    if (!read) return;
    const values = [{ fieldId, value, evidence }];
    const results = await writeValues(read.specs, read.handles, values);
    await this.record(results, values, read, "spoken");
    this.options.onChange?.();
  }

  /** What the agent is told after a fill: facts about this call, and the next move. */
  private report(
    outcomes: WriteOutcome[],
    claimed: SpokenValue[],
    reshaped: FormReshape | null,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    const state = this.state();
    const facts = summarise({
      specs: state.fields.map((f) => f.spec),
      before: this.current?.specs,
      filled: state.fields.filter((f) => f.value !== null).map((f) => f.spec.id),
      outcomes,
      claimed,
      reshaped,
    });
    const move = this.move();
    return {
      just_filled: facts.just_filled,
      not_filled: facts.not_filled,
      ...extra,
      progress: state.progress,
      ...(facts.form_changed ? { form_changed: facts.form_changed } : {}),
      do_next: doNext(move),
      // Always false, always here — rule 5b. Read at the exact moment the model once claimed to
      // have submitted an application it had only typed into.
      submitted: false,
    };
  }

  private changeFacts(reshaped: FormReshape) {
    return {
      new_questions: reshaped.appeared.map(fieldName),
      gone: reshaped.disappeared.map(fieldName),
      kept: reshaped.restored,
    };
  }

  // ── The form changing shape ──────────────────────────────────────────────────────

  /** A write is running; the page watcher should leave the form alone and let the write re-read. */
  get isWriting(): boolean {
    return this.writing;
  }

  noteMoveDuringWrite(): void {
    this.movedWhileWriting = true;
  }

  /**
   * Read the form again, and bring everything in line with what is on the page now.
   *
   * A field that comes back empty gets back what was said for it. A new field that asks what a
   * departed one asked is offered, never filled — it is a different question. Serialised: two
   * re-reads never adopt at once.
   */
  pageChanged(): Promise<FormReshape | null> {
    const run = async (): Promise<FormReshape | null> => {
      if (!this.current) return null;
      await whenSettled(this.scope(), 200, 1200);

      const change = this.registry.adopt(this.readNow());
      await harvestOptions({ ...change.read, specs: change.appeared });
      const read = change.read;
      this.current = read;
      // A fresh read has fresh fields: what their words add is added again.
      applyMeaningHints(read.specs, this.meanings);

      if (change.appeared.length === 0 && change.disappeared.length === 0) {
        this.options.onChange?.();
        return null;
      }

      const state = this.state();
      const empty = new Set(state.fields.filter((f) => f.value === null).map((f) => f.spec.id));

      // What was said for a field that has come back empty goes back in.
      const restorable: SpokenValue[] = change.appeared
        .filter((spec) => empty.has(spec.id))
        .flatMap((spec) => {
          const entry = this.ledger.entry(spec.id);
          return entry ? [{ fieldId: spec.id, value: entry.value, evidence: entry.evidence }] : [];
        });
      const restored = change.appeared
        .filter((spec) => !empty.has(spec.id) && this.ledger.entry(spec.id))
        .map(fieldName);
      if (restorable.length > 0) {
        const results = await writeValues(read.specs, read.handles, restorable);
        for (const r of results) {
          if (r.status === "written") { const spec = read.specs.find((s) => s.id === r.fieldId); restored.push(spec ? fieldName(spec) : r.fieldId); }
        }
      }

      // A new field asking what a departed one asked: offered, never filled.
      const present = new Set(read.specs.map((s) => s.id));
      const maybeSame = change.appeared
        .filter((spec) => empty.has(spec.id) && !this.ledger.entry(spec.id))
        .flatMap((spec) => {
          const earlier = this.ledger
            .entries()
            .find(([id, e]) => id !== spec.id && !present.has(id) && e.spec.kind === spec.kind && e.spec.label === spec.label && e.spec.part === spec.part);
          if (!earlier) return [];
          return [{
            field: spec.id,
            question: fieldName(spec),
            earlier_answer: String(earlier[1].value),
            earlier_question: fieldName(earlier[1].spec),
          }];
        });

      if (change.appeared.length > 0) void this.understandForm(read);
      this.options.log?.(`form changed: +${change.appeared.length} −${change.disappeared.length}, restored ${restored.length}`);
      this.options.onReshape?.();
      this.options.onChange?.();
      return { appeared: change.appeared, disappeared: change.disappeared, restored, maybeSame };
    };

    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // ── What is known about them ─────────────────────────────────────────────────────

  async forgetOne(id: string): Promise<void> {
    this.profile = (await this.store.apply([{ type: "delete", id }])).profile;
    this.options.onChange?.();
  }

  async forgetEverything(): Promise<void> {
    this.profile = (await this.store.apply([{ type: "deleteAll" }])).profile;
    this.options.onChange?.();
  }

  /** What each field means, as far as is known now — for tests and the review panel. */
  meaningOf(id: string) {
    return this.meanings[id];
  }

  /** Specs as they are now — for callers that still need the raw field list. */
  specs(): FieldSpec[] {
    return this.current?.specs ?? [];
  }
}
