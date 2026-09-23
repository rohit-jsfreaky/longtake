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
  buildPressTool,
  validateTool,
  type VoiceAgentTool,
} from "./binder";
import { openingLine, phoneFields, summarise, type FormReshape } from "./conversation";
import { exclusively, whenSettled } from "./dom-path";
import { checkEvidence, keepOnlyWhatWasSaid } from "./evidence";
import { snapshot, type FormState } from "./form-state";
import { gate } from "./gate";
import { Ledger } from "./ledger";
import { asSpokenValues, canonicalKey, forget, forgetAll, listMemory, recall, remember } from "./memory";
import type { Memory, RememberedAnswer } from "./memory";
import { systemPrompt } from "./persona";
import { brief, doNext, nextMove, resumeLine, type Move, type Plan } from "./planner";
import { harvestOptions, readForm, titleOf, waitForForm } from "./reader";
import { FieldRegistry } from "./reconcile";
import type { FieldSpec, FormRead, SpokenValue } from "./types";
import { clearValues, writeValues, type ClearOutcome, type WriteOutcome } from "./writer";

/** Where remembered answers are kept — localStorage on the web, chrome.storage in the extension. */
export type MemoryStore = { load(): Memory; save(memory: Memory): void };

export type SessionOptions = {
  /** The part of the page the form is in. */
  root: () => Document | Element;
  /** Anything inside these is not the person's form (our own widget, dev overlays). */
  ignore: string;
  memory: MemoryStore;
  log?: (line: string) => void;
  /** The form's set of questions changed: the agent needs new tools and a new prompt, now. */
  onReshape?: () => void;
  /** Something about the form may have changed — for the UI to redraw from `state()`. */
  onChange?: () => void;
};

/** What a fill or clear did, for the UI — alongside what the agent is told. */
export type Done<Result> = {
  result: Result;
  outcomes: WriteOutcome[];
  /** Answers that went in, with the words they came from. */
  spoken: SpokenValue[];
};

const CHOICE_KINDS = new Set(["select", "radio", "multiselect", "checkbox"]);

export class LongtakeSession {
  readonly ledger = new Ledger();
  private registry = new FieldRegistry();
  private current: FormRead | null = null;
  private memory: Memory = {};
  private plan: Plan = { optionalOffered: false };
  private title = "";
  private chain: Promise<unknown> = Promise.resolve();
  private prefilled: Promise<unknown> = Promise.resolve();
  private writing = false;
  private movedWhileWriting = false;

  constructor(private readonly options: SessionOptions) {}

  // ── Reading ──────────────────────────────────────────────────────────────────────

  get read(): FormRead | null {
    return this.current;
  }

  /** The form as it is right now. The only answer to "what is filled" anywhere in the product. */
  state(): FormState {
    if (!this.current) {
      return { title: "", fields: [], theirs: [], actions: [], progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 } };
    }
    return snapshot(this.current, this.ledger, this.title, this.buttons());
  }

  /** What to do next. Offering the optional fields is a one-time move, so it is recorded. */
  move(): Move {
    const move = nextMove(this.state(), this.plan);
    if (move.kind === "offer_optional") this.plan.optionalOffered = true;
    return move;
  }

  /** The agent's whole prompt: who it is, the form as it is, and what to do next. */
  prompt(): string {
    return systemPrompt(brief(this.state(), this.move()));
  }

  tools(): VoiceAgentTool[] {
    const specs = this.current?.specs ?? [];
    const press = this.current ? buildPressTool(this.buttons().actions) : null;
    const always = [buildFillTool(specs), buildConfirmTool(specs), buildClearTool(specs), buildLaterTool(specs)];
    return press ? [...always, press] : always;
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

    const question = (spec.label || id).replace(/\s*\*\s*$/, "").trim();
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

    const claim: SpokenValue = { fieldId: id, value: pending.suggestion, evidence: `${pending.heard} — ${evidence}` };
    this.writing = true;
    this.movedWhileWriting = false;
    let results: WriteOutcome[];
    try {
      results = await writeValues(read.specs, read.handles, [claim]);
    } finally {
      this.writing = false;
    }
    this.record(results, [claim], read, "spoken");
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
      set_aside: moved.map((id) => (byId.get(id)?.label || id).replace(/\s*\*\s*$/, "").trim()),
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
      .map((f) => ({ question: f.spec.label, form_says: f.error }));
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
      },
    );
  }

  /** The first words of a new session after the line dropped — where things stand, then the next ask. */
  resumeGreeting(): string {
    return resumeLine(this.state(), this.move());
  }

  remembered(): RememberedAnswer[] {
    return listMemory(this.memory);
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
      this.memory = this.options.memory.load();
      if (Object.keys(this.memory).length === 0) return 0;

      await waitForForm();
      const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
      this.current = read;
      this.title = titleOf(read, this.scope());

      const recalled = recall(this.memory, read.specs);
      if (recalled.length === 0) return 0;

      const values = asSpokenValues(recalled);
      const results = await writeValues(read.specs, read.handles, values);
      this.record(results, values, read, "memory");
      this.options.log?.(`brought ${results.filter((r) => r.status === "written").length} answer(s) from an earlier form`);
      this.options.onChange?.();
      return results.length;
    })();
    return this.prefilled;
  }

  /** Read the form, completely, before the conversation starts. */
  async open(): Promise<void> {
    // Remembered answers go in first, so the opening line knows about them. Bounded: a prefill
    // that hangs must not stop the microphone working.
    await Promise.race([this.prefilled, new Promise((done) => setTimeout(done, 15000))]);
    await waitForForm();

    const read = await harvestOptions(this.registry.adopt(this.readNow()).read);
    this.current = read;
    this.title = titleOf(read, this.scope());
    this.plan = { optionalOffered: false };

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

  /** Write down what went in, for the ledger and for memory. */
  private record(results: WriteOutcome[], values: SpokenValue[], read: FormRead, source: "spoken" | "memory"): void {
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const kept: SpokenValue[] = [];
    for (const result of results) {
      if (result.status !== "written") continue;
      const spec = byId.get(result.fieldId);
      const said = values.find((v) => v.fieldId === result.fieldId);
      if (!spec || !said) continue;
      this.ledger.wrote(result.fieldId, { source, value: result.wrote, evidence: said.evidence, spec });
      kept.push({ ...said, value: result.wrote });
    }
    if (source === "spoken" && kept.length > 0) {
      this.memory = remember(this.memory, read.specs, kept, read.url);
      this.options.memory.save(this.memory);
    }
  }

  /** The `fill_fields` tool. `heard` is everything the person has said so far, turn in progress included. */
  async fill(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };

    const claimed: SpokenValue[] = [];
    for (const [fieldId, raw] of Object.entries(args)) {
      if (!raw || typeof raw !== "object") continue;
      const { value, evidence } = raw as { value?: unknown; evidence?: unknown };
      if (value === undefined || value === null) continue;
      claimed.push({ fieldId, value: value as SpokenValue["value"], evidence: typeof evidence === "string" ? evidence : "" });
    }

    // Every quote is checked against what was actually said, then every choice against the gate.
    const { spoken, unsupported } = keepOnlyWhatWasSaid(heard, claimed);
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const toWrite: SpokenValue[] = [...this.splitPhones(spoken, read.specs)];
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
          question: spec?.label ?? claim.fieldId,
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
    this.record(results, toWrite, read, "spoken");

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
  private splitPhones(spoken: SpokenValue[], specs: FieldSpec[]): SpokenValue[] {
    const pairs = phoneFields(specs);
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    const extra: SpokenValue[] = [];

    for (const claim of spoken) {
      const codeId = pairs.get(claim.fieldId);
      if (byId.get(claim.fieldId)?.kind !== "tel" || !codeId) continue;
      if (spoken.some((c) => c.fieldId === codeId)) continue; // the agent already filled the picker

      const said = /^\s*\+\s*(\d{1,4})\b/.exec(String(claim.value)) ?? /\+\s*(\d{1,4})\b/.exec(claim.evidence);
      if (!said) continue;
      claim.value = String(claim.value).replace(/^\s*\+\s*\d{1,4}[\s.-]*/, "");

      const code = new RegExp(`\\+\\s*${said[1]}\\b`);
      const matches = (byId.get(codeId)!.options ?? []).filter((o) => code.test(o.label));
      if (matches.length === 1) extra.push({ fieldId: codeId, value: matches[0]!.label, evidence: claim.evidence });
    }
    return extra;
  }

  /** The `clear_fields` tool. */
  async clear(args: Record<string, unknown>, heard: string): Promise<Done<Record<string, unknown>>> {
    const read = this.current;
    if (!read) return { result: { error: "The form has not been read yet." }, outcomes: [], spoken: [] };

    const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const evidence = typeof args.evidence === "string" ? args.evidence : "";
    const byId = new Map(read.specs.map((spec) => [spec.id, spec]));
    const question = (id: string) => (byId.get(id)?.label || id).replace(/\s*\*\s*$/, "").trim();

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
    for (const id of cleared) {
      this.ledger.decline(id);
      // Out of memory too, or the next form brings back the answer they just asked to remove.
      const spec = byId.get(id);
      const key = spec ? canonicalKey(spec) : null;
      if (key && this.memory[key]) this.memory = forget(this.memory, key);
    }
    if (cleared.length > 0) this.options.memory.save(this.memory);

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
      progress: state.progress,
      ...(reshaped ? { form_changed: this.changeFacts(reshaped) } : {}),
      do_next: doNext(move),
      submitted: false,
    };
    this.options.onChange?.();
    return { result, outcomes: [], spoken: [] };
  }

  /** Replace an answer with a better-shaped version of the same words (the Dictation pass). */
  async rewrite(fieldId: string, value: string, evidence: string): Promise<void> {
    const read = this.current;
    if (!read) return;
    const values = [{ fieldId, value, evidence }];
    const results = await writeValues(read.specs, read.handles, values);
    this.record(results, values, read, "spoken");
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
      new_questions: reshaped.appeared.map((spec) => spec.label || spec.id),
      gone: reshaped.disappeared.map((spec) => spec.label || spec.id),
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
        .map((spec) => spec.label || spec.id);
      if (restorable.length > 0) {
        const results = await writeValues(read.specs, read.handles, restorable);
        for (const r of results) {
          if (r.status === "written") restored.push(read.specs.find((s) => s.id === r.fieldId)?.label ?? r.fieldId);
        }
      }

      // A new field asking what a departed one asked: offered, never filled.
      const present = new Set(read.specs.map((s) => s.id));
      const maybeSame = change.appeared
        .filter((spec) => empty.has(spec.id) && !this.ledger.entry(spec.id))
        .flatMap((spec) => {
          const earlier = this.ledger
            .entries()
            .find(([id, e]) => id !== spec.id && !present.has(id) && e.spec.kind === spec.kind && e.spec.label === spec.label);
          if (!earlier) return [];
          return [{
            field: spec.id,
            question: spec.label || spec.id,
            earlier_answer: String(earlier[1].value),
            earlier_question: earlier[1].spec.label || earlier[0],
          }];
        });

      this.options.log?.(`form changed: +${change.appeared.length} −${change.disappeared.length}, restored ${restored.length}`);
      this.options.onReshape?.();
      this.options.onChange?.();
      return { appeared: change.appeared, disappeared: change.disappeared, restored, maybeSame };
    };

    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // ── Memory ───────────────────────────────────────────────────────────────────────

  forgetOne(key: string): void {
    this.memory = forget(this.memory, key);
    this.options.memory.save(this.memory);
    this.options.onChange?.();
  }

  forgetEverything(): void {
    this.memory = forgetAll();
    this.options.memory.save(this.memory);
    this.options.onChange?.();
  }

  /** Specs as they are now — for callers that still need the raw field list. */
  specs(): FieldSpec[] {
    return this.current?.specs ?? [];
  }
}
