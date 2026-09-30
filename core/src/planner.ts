/**
 * What happens next in the conversation — decided in code, said by the model.
 *
 * ## Why this is not the model's job any more
 *
 * The model used to carry the plan in its head: which fields were left, whether the optional ones
 * had been offered, whether a correction was still outstanding. It lost track in every way it
 * could — stalling with "let me know when you're ready", asking for a Country that was already
 * filled, asking the same question three times. A plan is state, and state belongs in code.
 *
 * `nextMove` looks at the form as it is and returns the one thing to do next. `brief` turns the
 * form and that move into a short block of text the agent reads on every turn — pushed into its
 * prompt after every tool result, so even a turn with no tool call sees the form as it is now.
 * The model still chooses every word it says. It no longer chooses what to talk about.
 */

import { factsOf, inAskingOrder, type FieldFacts } from "./conversation";
import { isOpen, type FieldState, type FormState } from "./form-state";
import { shownValue } from "./profile";
import { fieldName } from "./types";

export type Move =
  /** An answer is waiting for their yes. Always first: nothing else makes sense until it is settled. */
  | { kind: "confirm"; field: FieldFacts; suggestion: string; heard: string; reason: "not_named" | "hedged" | "inferred" | "draft" }
  /** Answers from last time that wait for a yes — a few at once, since one yes can settle them all. */
  | { kind: "confirm_recalled"; fields: { field: FieldFacts; suggestion: string; why?: string }[] }
  /** The form rejected something that went in. Before anything new — it is a mistake on the page now. */
  | { kind: "resolve"; field: FieldFacts; problem: string; value: string }
  /** What to keep for next time: an answer that changed, or one they cleared. Straight after it happened. */
  | { kind: "update_profile"; asks: ProfileQuestionFacts[] }
  /**
   * Ask for the next required field — or group of fields that is one question to a person. A long
   * answer they gave on an earlier form to the same question comes with it, to offer.
   */
  | { kind: "ask"; fields: FieldFacts[]; library?: { question: string; text: string } }
  /** The required part is done. Offer the optional part, once — and, if another page follows, that. */
  | { kind: "offer_optional"; fields: FieldFacts[]; next?: string }
  /** The offer has been made: go through these if they wanted them, move on if not. */
  | { kind: "optional"; fields: FieldFacts[]; next?: string; submit?: string; keep?: KeepFacts }
  /** This page is done and the form has another. Ask, and press Next only on their yes. */
  | { kind: "next_page"; label: string; keep?: KeepFacts }
  /** Nothing left that is ours to do. */
  | { kind: "handover"; theirs: string[]; submit?: string; keep?: KeepFacts; review?: Review };

/** Answers they did not just speak, worth their eye before they send: from last time, typed by them. */
export type Review = { fromLastTime: number; typed: number };

/** One thing to settle about next time. */
export type ProfileQuestionFacts = { field: string; question: string; kind: "changed" | "forget"; was: string; now?: string };

/** Personal answers given on this form, to offer keeping — once, before handing over. */
export type KeepFacts = { fields: string[]; questions: string[] };

/** How many "from last time" answers are put to them in one breath. */
const RECALLED_AT_ONCE = 4;
/** How many "keep it for next time?" questions at once. */
const UPDATES_AT_ONCE = 3;

/**
 * How many questions are asked in one breath.
 *
 * One at a time made a forty-field form a forty-turn interview — the live complaint was that after
 * the first answers it "starts doing one by one, so it's very slow". People answer a short list
 * easily ("phone, city and LinkedIn?"); past four they lose track of what was asked.
 */
const ASK_AT_ONCE = 4;

/**
 * The next few questions to ask together, starting from the first.
 *
 * A long answer ("why do you want to work here?") is asked on its own — it is a paragraph, not a
 * list item — and ends the batch when it comes up. A list read out from the screen (more choices
 * than can be said aloud) is also asked on its own: "look at the list" does not combine.
 */
/**
 * The next questions, asked together, by how much each asks of a person. A short one — a pick from
 * a list, a number, a name — is 1; a long answer is 2, and no more than two long ones at once.
 *
 * Live, a list too long to read out ("How did you hear about Glean?") and every long answer were
 * asked alone, so after the opening batch the call went one question per turn: "how did you hear",
 * then "years of experience", then "what AI tools" — three turns for three small asks.
 */
function batch(facts: FieldFacts[]): FieldFacts[] {
  const out: FieldFacts[] = [];
  let weight = 0;
  let long = 0;
  for (const f of facts) {
    const isLong = f.answer_type === "long answer";
    const w = isLong ? LONG_WEIGHT : 1;
    if (out.length > 0 && (weight + w > ASK_AT_ONCE || (isLong && long >= LONG_AT_ONCE))) break;
    out.push(f);
    weight += w;
    if (isLong) long++;
  }
  return out;
}

/** A long answer counts double; two of them at most in one question. */
const LONG_WEIGHT = 2;
const LONG_AT_ONCE = 2;

/** What the planner has to remember between moves. Tiny on purpose — the form is the rest. */
export type Plan = { optionalOffered: boolean };

export function nextMove(state: FormState, plan: Plan): Move {
  const specs = state.fields.map((f) => f.spec);

  const waiting = state.fields.find((f) => f.pending && f.pending.reason !== "from_last_time");
  if (waiting?.pending && waiting.pending.reason !== "from_last_time") {
    return {
      kind: "confirm",
      field: factsOf(waiting.spec, specs),
      suggestion: waiting.pending.suggestion,
      heard: waiting.pending.heard,
      reason: waiting.pending.reason,
    };
  }

  const recalled = state.fields.filter((f) => f.pending?.reason === "from_last_time").slice(0, RECALLED_AT_ONCE);
  if (recalled.length > 0) {
    return {
      kind: "confirm_recalled",
      fields: recalled.map((f) => ({
        field: factsOf(f.spec, specs),
        suggestion: f.pending!.suggestion,
        ...(f.pending!.why ? { why: f.pending!.why } : {}),
      })),
    };
  }

  // A value the form says is wrong, only once something is in it — an empty required field's
  // "this field is required" is just the ordinary next question, asked in its turn.
  const wrong = state.fields.find((f) => f.error && f.value !== null);
  if (wrong?.error) {
    return { kind: "resolve", field: factsOf(wrong.spec, specs), problem: wrong.error, value: shown(wrong.value) };
  }

  const updates = state.asks.filter((a) => a.ask.kind !== "sensitive").slice(0, UPDATES_AT_ONCE);
  if (updates.length > 0) {
    return {
      kind: "update_profile",
      asks: updates.map(({ spec, ask }) => ({
        field: spec.id,
        question: fieldName(spec),
        kind: ask.kind === "changed" ? ("changed" as const) : ("forget" as const),
        was: ask.kind === "sensitive" ? "" : shownValue(ask.was),
        ...(ask.kind === "changed" ? { now: shownValue(ask.now) } : {}),
      })),
    };
  }

  const open = state.fields.filter(isOpen);
  // What they put off comes last: asked again only when nothing else is left.
  const later = new Set(open.filter((f) => f.later).map((f) => f.spec.id));
  const lastIfLater = (specs: FieldState["spec"][]) => [
    ...specs.filter((spec) => !later.has(spec.id)),
    ...specs.filter((spec) => later.has(spec.id)),
  ];
  // A form that marks nothing required does not say anything is optional either — GOV.UK marks
  // nothing and needs every answer. Its questions are simply asked, in their order; offering them
  // as "the optional ones" once nothing is required told a person their date of birth could wait.
  const marksNone = state.fields.every((f) => !f.spec.required);
  const toAsk = (f: FieldState) => f.spec.required || marksNone;
  const required = lastIfLater(inAskingOrder(open.filter(toAsk).map((f) => f.spec)));

  if (required.length > 0) {
    const first = factsOf(required[0]!, specs);
    // An address — or a phone number split from its country code — is one question to a person,
    // however many boxes the form splits it into.
    if (first.group) {
      const together = open
        .filter((f) => later.has(first.field) || !later.has(f.spec.id))
        .map((f) => factsOf(f.spec, specs))
        .filter((facts) => facts.group === first.group && facts.section === first.section && facts.whole === first.whole);
      return { kind: "ask", fields: together };
    }
    // A long answer they gave before, to a question meaning the same: offered on its own.
    const library = open.find((f) => f.spec.id === first.field)?.library;
    if (library) return { kind: "ask", fields: [first], library: { question: library.question, text: library.text } };
    // The next few, together — but not across into a group, which is asked as its own question.
    return { kind: "ask", fields: batch(required.map((spec) => factsOf(spec, specs)).filter((f) => !f.group || f.field === first.field)) };
  }

  const optional = lastIfLater(inAskingOrder(open.filter((f) => !toAsk(f)).map((f) => f.spec))).map((spec) =>
    factsOf(spec, specs),
  );
  const next = state.actions.find((a) => a.kind === "next");
  // Personal answers (health, documents) are kept only if they say so — asked once, on the way out.
  const personal = state.asks.filter((a) => a.ask.kind === "sensitive");
  const keep: { keep?: KeepFacts } = personal.length
    ? { keep: { fields: personal.map((a) => a.spec.id), questions: personal.map((a) => fieldName(a.spec)) } }
    : {};
  if (optional.length > 0) {
    if (!plan.optionalOffered) return next ? { kind: "offer_optional", fields: optional, next: next.label } : { kind: "offer_optional", fields: optional };
    if (next) return { kind: "optional", fields: optional, next: next.label, ...keep };
    return state.submitLabel
      ? { kind: "optional", fields: optional, submit: state.submitLabel, ...keep }
      : { kind: "optional", fields: optional, ...keep };
  }
  if (next) return { kind: "next_page", label: next.label, ...keep };

  const fromLastTime = state.fields.filter((f) => f.source === "memory").length;
  const typed = state.fields.filter((f) => f.source === "typed").length;
  const review: { review?: Review } = fromLastTime + typed > 0 ? { review: { fromLastTime, typed } } : {};
  return state.submitLabel
    ? { kind: "handover", theirs: state.theirs, submit: state.submitLabel, ...keep, ...review }
    : { kind: "handover", theirs: state.theirs, ...keep, ...review };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// The brief — the form and the next move, as the agent reads them
// ═══════════════════════════════════════════════════════════════════════════════════════

const SOURCE_WORDS: Record<FieldState["source"], string> = {
  spoken: "they said it",
  memory: "from their last form",
  drafted: "drafted from their words, and they said yes",
  typed: "they typed it",
  page: "was already there",
  empty: "",
};

function shown(value: FieldState["value"]): string {
  const text = value === true ? "ticked" : Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** One field's facts as a short phrase: "How did you hear? — 11 options, point them at the list". */
function describe(facts: FieldFacts): string {
  const where = facts.section ? ` (under "${facts.section}")` : "";
  if (facts.searchable) return `${facts.question}${where} — a searchable list; whatever they say is looked up, and if several match they'll be offered`;
  if (facts.range) return `${facts.question}${where} — a number from ${facts.range.min} to ${facts.range.max}`;
  if (facts.choices) return `${facts.question}${where} — choices: ${facts.choices.join(", ")}`;
  if (facts.choice_count) return `${facts.question}${where} — ${facts.choice_count} options; ask them to look at the list on screen`;
  if (facts.answer_type === "yes or no") return `${facts.question}${where} — yes or no`;
  if (facts.answer_type === "long answer") return `${facts.question}${where} — a longer answer: put in what they say, in their words; only if they ask you to improve it or write it up, draft it with draft_answer`;
  return `${facts.question}${where}`;
}

/** ", 1 waiting for their yes" — so "everything is in" can never be said over one. */
function waitingCount(state: FormState): string {
  const n = state.fields.filter((f) => f.pending).length;
  return n > 0 ? `, ${n} waiting for their yes` : "";
}

/** The next optional ones, several at once when they combine. */
function askFor(fields: FieldFacts[]): string {
  const now = batch(fields);
  return now.length > 1 ? `these together, in one question: ${now.map(describe).join("; ")}` : describe(now[0]!);
}

/** "look it over — especially the 12 from their last form" */
function lookFirst(review: Review): string {
  const parts = [
    review.fromLastTime > 0 ? `the ${review.fromLastTime} from their last form` : "",
    review.typed > 0 ? `the ${review.typed} they typed` : "",
  ].filter(Boolean);
  return `look it over — especially ${parts.join(" and ")} —`;
}

/** Before moving on: once, whether to keep the personal answers they gave for next time. */
function keepFirst(keep: KeepFacts | undefined): string {
  if (!keep) return "";
  return `First, once: ask whether to remember their answers to ${keep.questions.join(", ")} for next time — they stay on this device — and call save_for_next_time for ${keep.fields.join(", ")} with agreed true or false. Then: `;
}

/** The instruction for the next move. What to do, never the words to say. */
/**
 * Before asking for anything: fill what they already said. Live (rehearsal, 30 Sep): a long take
 * named eight answers, the first call carried six, and the agent then asked for one of the two it had
 * dropped ("I missed how you heard about Glean") and never put in the other.
 */
const ALREADY_SAID =
  "If they already said any of these, put it in now with fill_fields from their words (a choice the form lacks: the closest option, how inferred) instead of asking. ";

export function doNext(move: Move): string {
  const text = nextFor(move);
  return move.kind === "ask" || move.kind === "offer_optional" || move.kind === "optional" ? ALREADY_SAID + text : text;
}

function nextFor(move: Move): string {
  switch (move.kind) {
    case "confirm":
      // Read word for word: they are agreeing to the words that will go in, so they must hear them.
      if (move.reason === "draft") return `A draft for "${move.field.question}" is ready, written from their words. Read it to them word for word, exactly as written, nothing added: "${move.suggestion}". Then ask if it should go in as it is, or what to change. On their yes, confirm_answer for ${move.field.field} with agreed true; to change it, draft_answer with mode revise and their words.`;
      if (move.reason === "hedged") return `They weren't sure for "${move.field.question}" (they said: "${move.heard}"). Ask which it is before anything goes in.`;
      if (move.reason === "inferred") return `You worked out "${move.suggestion}" for "${move.field.question}" from "${move.heard}" — they did not say it. Ask if that's right — it is not in yet, so never say you put it in — then call confirm_answer for ${move.field.field} with agreed true or false.`;
      return `"${move.field.question}" is waiting for their yes: they said "${move.heard}", and the closest the form offers is "${move.suggestion}". Ask if that's right — it is not in yet, so never say you put it in — then call confirm_answer for ${move.field.field} with agreed true or false; you judge their reply, in whatever words. If not, offer the other choices.`;
    case "confirm_recalled": {
      const list = move.fields.map((f) => `${f.field.question}: "${f.suggestion}"`).join("; ");
      return `From their last form, ready to go in on their yes: ${list}. Say them briefly and ask if they are still right. For each, call confirm_answer with agreed true if they accept it, in any words, or false if not; if they give a new answer, fill it with fill_fields instead.`;
    }
    case "update_profile": {
      const each = move.asks
        .map((a) =>
          a.kind === "changed"
            ? `"${a.question}" was "${a.was}" last time and is "${a.now}" now — keep the new one for next time?`
            : `they cleared "${a.question}", which came from last time — forget it for next time too?`,
        )
        .join(" ");
      return `Before the next question, one thing about next time: ${each} Ask in a few words, then call save_for_next_time for ${move.asks.map((a) => a.field).join(", ")} with agreed true or false — you judge their reply.`;
    }
    case "resolve":
      return `The form won't accept "${move.value}" for "${move.field.question}" — it says: "${move.problem}". Tell them in a few words and ask for it again.`;
    case "ask": {
      if (move.fields.length > 1 && move.fields.every((f) => f.group === "address")) {
        const where = move.fields[0]!.section ? ` under "${move.fields[0]!.section}"` : "";
        return `Ask for their address${where} as one question — ${move.fields.map((f) => f.question).join(", ")}.`;
      }
      if (move.fields.length > 1 && move.fields.every((f) => f.group === "split")) {
        return `Ask for "${move.fields[0]!.whole}" as one answer, the way a person says it — it goes into ${move.fields.map((f) => f.question.split(" — ").pop()).join(", ")}.`;
      }
      if (move.fields.length > 1 && move.fields.every((f) => f.group === "phone")) {
        return `Ask for their phone number, with its country code, as one question.`;
      }
      if (move.fields.length > 1) {
        return `Ask for these together in one short question — they can answer them all at once: ${move.fields.map(describe).join("; ")}.`;
      }
      if (move.library) {
        return `For "${move.fields[0]!.question}": last time, for "${move.library.question}", they answered: "${move.library.text}". Tell them briefly, and ask whether to use it as it is, change it, or start fresh. Use it: draft_answer with mode reuse. Change it: draft_answer with mode revise and their words. Fresh: ask for their points.`;
      }
      return `Ask for ${describe(move.fields[0]!)}.`;
    }
    // With a page still to come, "or are we done?" is the wrong other half of the question: live, the
    // agent offered the optional ones that way, heard "we're done", and told them to submit a form
    // with a whole page left. The other half is the next page, and it is said.
    case "offer_optional":
      return move.next
        ? `Every required field on this page is in. Say so, and ask if they want the ${move.fields.length} optional ones here or to go on to the next page — there is another page after this one. Optional: ${move.fields.map((f) => f.question).join("; ")}. ${NOT_LAST}`
        : `Every required field is in. Say so, and ask if they want to do the ${move.fields.length} optional ones or hear what they are: ${move.fields.map((f) => f.question).join("; ")}.`;
    case "optional":
      return keepFirst(move.keep) + (move.next
        ? `If they wanted the optional ones, ask for ${askFor(move.fields)}. If they didn't — or they say they're done — this page is done: ask if they're ready for the next page, and press "${move.next}" with press_form_button only on their yes. ${NOT_LAST}`
        : `If they wanted the optional ones, ask for ${askFor(move.fields)}. If they didn't, hand over: everything they told you is in, and they should ${move.submit ? `look it over and press "${move.submit}" themselves` : "look it over and send it themselves"}.`);
    case "next_page":
      return keepFirst(move.keep) + `Everything needed on this page is in. Ask if they're ready for the next page, and press "${move.label}" with press_form_button only on their yes. ${NOT_LAST}`;
    case "handover": {
      const look = move.review ? lookFirst(move.review) : "look it over";
      const send = move.submit ? `${look} and press "${move.submit}" themselves` : `${look} and send it themselves`;
      return keepFirst(move.keep) + (move.theirs.length > 0
        ? `Nothing left for you. Say everything they told you is in, that ${move.theirs.join(" and ")} is theirs to do by hand, and that they should ${send}.`
        : `Nothing left for you. Say everything they told you is in, and that they should ${send}.`);
    }
  }
}

/**
 * The form as it is and the next move, as text for the agent's prompt.
 *
 * Compact, because it is read on every turn: answered fields as one line each, empty ones with
 * what they accept, and the one thing to do next.
 */
/** Said wherever a page is not the last: the one sentence that stops "you can submit it now". */
const NOT_LAST = "It is not the last page: never say the form is finished or tell them to submit.";

export function brief(state: FormState, move: Move): string {
  const { progress } = state;
  const specs = state.fields.map((f) => f.spec);
  const lines: string[] = [];

  lines.push(
    `FORM NOW${state.title ? ` — ${state.title}` : ""}: ${progress.filled} of ${progress.total} answered, ${progress.requiredLeft} required left, ${progress.optionalLeft} optional left${waitingCount(state)}.`,
  );

  const answered = state.fields.filter((f) => f.value !== null);
  if (answered.length > 0) {
    lines.push("Answered:");
    for (const f of answered) {
      lines.push(`  ${factsOf(f.spec, specs).question}: ${shown(f.value)} (${SOURCE_WORDS[f.source]})`);
    }
  }

  const left = state.fields.filter((f) => isOpen(f) && !f.pending && !f.later);
  if (left.length > 0) {
    lines.push("Still empty:");
    for (const f of left) {
      lines.push(`  ${describe(factsOf(f.spec, specs))}${f.spec.required ? " [required]" : ""}`);
    }
  }

  const putOff = state.fields.filter((f) => isOpen(f) && f.later);
  if (putOff.length > 0) {
    lines.push(
      `Set aside for later, at their request — ask again only once everything else is done: ${putOff.map((f) => factsOf(f.spec, specs).question).join(", ")}`,
    );
  }

  const declined = state.fields.filter((f) => f.declined && f.value === null);
  if (declined.length > 0) {
    lines.push(`Left empty on purpose (do not ask again): ${declined.map((f) => factsOf(f.spec, specs).question).join(", ")}`);
  }

  const waiting = state.fields.filter((f) => f.pending);
  for (const f of waiting) {
    lines.push(
      f.pending!.reason === "from_last_time"
        ? `Waiting for their yes: ${factsOf(f.spec, specs).question} → "${f.pending!.suggestion}" (from their last form)`
        : `Waiting for their yes: ${factsOf(f.spec, specs).question} → "${f.pending!.suggestion}" (they said "${f.pending!.heard}")`,
    );
  }

  for (const f of state.fields.filter((f) => f.claimedIn)) {
    lines.push(`You told them "${factsOf(f.spec, specs).question}" went in ("${f.claimedIn}"); it did not. Put it in with their words, or say plainly it isn't in.`);
  }

  const problems = state.fields.filter((f) => f.error && f.value !== null);
  for (const f of problems) {
    lines.push(`The form rejects: ${factsOf(f.spec, specs).question} = "${shown(f.value)}" — "${f.error}"`);
  }

  if (state.theirs.length > 0) lines.push(`Theirs to do by hand: ${state.theirs.join(", ")}`);
  if (state.actions.length > 0) {
    lines.push(`Buttons you can press when they ask: ${state.actions.map((a) => `"${a.label}"`).join(", ")}`);
  }
  const onward = state.actions.find((a) => a.kind === "next");
  if (onward) lines.push(`This is not the last page: "${onward.label}" leads to more questions.`);
  if (state.submitLabel) lines.push(`"${state.submitLabel}" sends the form — only they press it, never you.`);

  lines.push("", `DO NEXT: ${doNext(move)}`);
  return lines.join("\n");
}

/**
 * What the agent says first after the line dropped and a new session had to start.
 *
 * A greeting is spoken verbatim, so it is built here, from the form, like the opening line. It
 * owns up to the drop in five words, says where things stand, and asks the next thing — the new
 * agent has no memory of the call, but the form does, and the person should not have to repeat
 * what is already in it.
 */
export function resumeLine(state: FormState, move: Move, pageTurn = false): string {
  const { filled, total } = state.progress;
  // A new page starts a new session (the server ends one when the page goes — rehearsal, 30 Sep:
  // session_not_found every time), so this is where a page turn is announced. "Lost the line" there
  // sounded like a fault.
  const where = pageTurn
    ? `Right, the next page: ${total} question${total === 1 ? "" : "s"}${filled ? `, ${filled} already in` : ""}`
    : `Sorry, lost the line for a second. ${filled} of ${total} are in`;
  switch (move.kind) {
    case "confirm":
      return move.reason === "hedged"
        ? `${where}. For ${move.field.question}, which was it?`
        : `${where}. For ${move.field.question}, is ${move.suggestion} right?`;
    case "confirm_recalled":
      return `${where}. From last time I have ${move.fields.map((f) => f.field.question).join(", ")} — still right?`;
    case "update_profile": {
      const [first] = move.asks;
      return `${where}. Quick one for next time: ${first!.kind === "changed" ? `keep the new ${first!.question}?` : `forget ${first!.question} for next time too?`}`;
    }
    case "resolve":
      return `${where}. The form won't take ${move.value} for ${move.field.question} — can you say it again?`;
    case "ask": {
      const [first] = move.fields;
      const what =
        move.fields.length > 1 && first?.group === "address"
          ? "your address"
          : move.fields.length > 1 && first?.group === "split"
            ? (first.whole ?? "the next one")
          : move.fields.length > 1 && first?.group === "phone"
            ? "your phone number"
            : move.fields.length > 1
              ? move.fields.map((f) => f.question).join(", ")
              : (first?.question ?? "the next one");
      return `${where}. Next up: ${what}.`;
    }
    case "offer_optional":
      return move.next
        ? `${where} — all the required ones on this page. Want the ${move.fields.length} optional ones, or on to the next page?`
        : `${where} — all the required ones. Want to do the ${move.fields.length} optional ones too?`;
    case "optional":
      return `${where}. Shall we carry on with the optional ones?`;
    case "next_page":
      return `${where} — this page is done. Ready for the next one?`;
    case "handover":
      return `${where} — that's everything. Have a look and ${move.submit ? `press ${move.submit}` : "send it"} yourself.`;
  }
}
