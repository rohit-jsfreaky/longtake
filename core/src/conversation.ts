/**
 * What the agent says, decided by code rather than by the model.
 *
 * ## Why the opening line is not the model's to write
 *
 * The first version greeted everyone with *"Go ahead, tell me about yourself and I will fill
 * this in."* On a twenty-field form nobody has read yet, that is a request to guess. The person
 * does not know what the form wants, so they say their name and stop, and the rest of the
 * session is the agent dragging answers out of them one field at a time — the form-shaped
 * questioning this product exists to remove.
 *
 * By the time the agent speaks, the form has already been read completely: every field, every
 * dropdown's real choices, what is required. So the opening line says what the form is, how big
 * it is, and names the easy answers first — the ones everybody knows without thinking — so the
 * person's first breath fills the most boxes.
 *
 * It is built here, in code, because the Voice Agent API speaks `greeting` verbatim ("the exact
 * words a voice agent speaks") and it cannot be changed after the session opens. A model asked
 * to summarise the form could invent a field that is not on it. This cannot.
 *
 * ## Why every question carries its own wording
 *
 * A dropdown asked as an open question gets an answer the dropdown does not offer — "I heard
 * about it on Twitter" to a list that has no Twitter — and the whole exchange is spent recovering.
 * So a choice field is asked WITH its choices when there are few enough to say out loud, and with
 * a pointer to the screen when there are not. The person knows what the form will accept before
 * they answer, which is the difference between being helped and being automated at.
 */

import { stillMissing, stillOptional } from "./binder";
import { conceptById } from "./concepts";
import { canonicalKey } from "./memory";
import { phoneFields } from "./phones";
import { fieldName, type FieldSpec, type SpokenValue } from "./types";
import { realChoices, type WriteOutcome } from "./writer";

/** More choices than this is a list to look at, not a list to hear. */
export const MOST_CHOICES_TO_READ_OUT = 6;

/**
 * The answers everybody knows without thinking, grouped and worded the way a person says them.
 *
 * By what the model says a field means (`spec.understood`) — "Vorname" is a first name, and an
 * emergency contact's phone is a phone but not theirs, so never an easy one. Before the model has
 * answered, or without it, by `canonicalKey`, the offline reading, with its exclusions intact.
 */
const EASY: { keys: string[]; concepts: string[]; say: string }[] = [
  {
    keys: ["first_name", "last_name", "full_name", "preferred_name"],
    concepts: ["identity.first_name", "identity.last_name", "identity.middle_name", "identity.full_name", "identity.preferred_name"],
    say: "your name",
  },
  { keys: ["email"], concepts: ["contact.email"], say: "email" },
  { keys: ["phone"], concepts: ["contact.phone", "contact.phone.number", "contact.phone.country_code", "contact.phone.area_code"], say: "phone number" },
  {
    keys: ["city", "country", "postal_code"],
    concepts: ["address.city", "address.country", "address.postal_code", "address.current_location", "address.country_of_residence"],
    say: "where you're based",
  },
  { keys: ["linkedin"], concepts: ["links.linkedin"], say: "LinkedIn" },
  { keys: ["github"], concepts: ["links.github"], say: "GitHub" },
  { keys: ["portfolio"], concepts: ["links.portfolio", "links.website"], say: "website" },
];

/** Which easy group a field belongs to, if any: by its meaning when known, else offline. */
function easyGroupOf(spec: FieldSpec): (typeof EASY)[number] | undefined {
  const understood = spec.understood;
  if (understood && understood.confidence !== "low") {
    if (understood.subject !== "self") return undefined;
    return EASY.find((group) => group.concepts.includes(understood.concept));
  }
  const key = canonicalKey(spec);
  return key === null ? undefined : EASY.find((group) => group.keys.includes(key));
}

/** How many easy answers to name before it stops being an invitation and starts being a list. */
const MOST_EASY_TO_NAME = 5;

/** Is this field one of the ones everybody can answer without thinking? */
export function isEasy(spec: FieldSpec): boolean {
  return easyGroupOf(spec) !== undefined;
}

/** "a, b and c" — how a person lists things out loud. "a, b or c" when only one can be picked. */
function spokenList(items: string[], last: "and" | "or" = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

/** A field answered by picking, rather than by saying something new. */
function isChoice(spec: FieldSpec): boolean {
  return spec.kind === "select" || spec.kind === "radio" || spec.kind === "multiselect";
}

/** The fields a person can be asked about at all. */
function answerable(specs: FieldSpec[]): FieldSpec[] {
  return specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file");
}

/**
 * The first thing the agent says.
 *
 * Three parts, in the order a person needs them: what this is, how big it is, and where to
 * start. Short, because it is spoken — and it has to end on an invitation, not a list, or the
 * person waits for more instead of talking.
 *
 * Written in the agent's own voice — calm, quick, a little dry — because this is the one line the
 * model does not get to phrase. Everything after it is the model's, steered by the persona.
 */
export function openingLine(
  specs: FieldSpec[],
  title = "",
  {
    filled = [],
    remembered = false,
    toConfirm = [],
  }: {
    /** Fields that already have an answer in them when the call opens. */
    filled?: Iterable<string>;
    /** Whether those answers came from an earlier form, rather than being typed by the person. */
    remembered?: boolean;
    /** Questions with an answer from last time that waits for their yes. Asked first. */
    toConfirm?: string[];
  } = {},
): string {
  const fields = answerable(specs);
  if (fields.length === 0) {
    return "I can't find anything to fill in on this page yet.";
  }

  const name = title.trim();
  const what = name ? `Right, this is ${name}` : "Right";

  // ── A form that opens with a gate ─────────────────────────────────────────────────
  //
  // A real Jotform membership application shows exactly one question when it loads — are you
  // applying as an individual or for an organisation — and twenty more appear only once it is
  // answered. Read at that moment, the form is "one question", and an opening line that says so
  // is both true and useless. What the person needs is to be asked the gate, with its choices,
  // and told the rest follows.
  if (fields.length <= 2 && fields.every(isChoice)) {
    return `${what}. It opens with one question: ${howToAsk(fields[0]!)} The rest appears once you answer.`;
  }

  const size = `${fields.length} ${fields.length === 1 ? "question" : "questions"}`;
  const intro = name ? `${what} — ${size}.` : `Right — this form has ${size}.`;

  // Which of the easy answers the form asks, and which of those already have something in them.
  const done = new Set(filled);
  const easyGroups = EASY.map((group) => ({
    say: group.say,
    fields: fields.filter((spec) => easyGroupOf(spec) === group),
  })).filter((group) => group.fields.length > 0);

  // A group is in when the parts the form needs are in. Greenhouse puts an optional "Preferred
  // First Name" beside First and Last: requiring all three said "I've put in your email" on a form
  // whose counter read 3 filled, name included. The optional one is asked later, in its turn.
  const alreadyIn = easyGroups.filter((group) => {
    const needed = group.fields.filter((spec) => spec.required);
    return (needed.length > 0 ? needed : group.fields).every((spec) => done.has(spec.id));
  });
  const toSay = easyGroups
    .filter((group) => !alreadyIn.includes(group))
    .map((group) => group.say)
    .slice(0, MOST_EASY_TO_NAME);

  // Said first, because a pre-filled form gets skimmed, and a person should know which answers
  // they did not just give.
  const kept = alreadyIn.length
    ? ` I've already put in ${spokenList(alreadyIn.map((group) => group.say).slice(0, MOST_EASY_TO_NAME))}${
        remembered ? " from last time" : ""
      } — give ${alreadyIn.length === 1 ? "it" : "them"} a quick look.`
    : "";

  // Answers from last time that wait for a yes are the first thing to settle — so the line ends on
  // that question, not on an invitation to talk that the next turn would have to take back.
  if (toConfirm.length > 0) {
    const named = toConfirm.slice(0, 3);
    const more = toConfirm.length > named.length ? ` and ${toConfirm.length - named.length} more` : "";
    return `${intro}${kept} From last time I also have ${spokenList(named)}${more} — they're on screen. Still right?`;
  }
  if (toSay.length > 0) {
    return `${intro}${kept} Easy ones first: ${spokenList(toSay)}. Say them all at once if you like.`;
  }
  if (alreadyIn.length > 0) {
    return `${intro}${kept} The rest needs you — ready when you are.`;
  }
  return `${intro} Tell me whatever you know and I'll put it in the right places.`;
}

/**
 * How to ask for one field, as an instruction the agent can follow word for word.
 *
 * The part that matters is the choices. Few enough to hold in your head, and they are read out
 * with the question. Too many, and the agent says how many there are and points at the screen —
 * reading twenty options aloud is not help, and neither is asking an open question the dropdown
 * cannot answer.
 */
export function howToAsk(spec: FieldSpec): string {
  const label = fieldName(spec);
  // The section rides along, because a bare "First Name" is ambiguous on a form that asks it
  // twice — for the person, and for somebody standing in for them.
  const question = spec.section ? `${label} (under "${spec.section}")` : label;

  if (spec.kind === "checkbox") {
    return `${question} — a yes or no.`;
  }

  if (isChoice(spec)) {
    const choices = realChoices(spec.options);
    if (choices.length === 0) return question;

    if (choices.length <= MOST_CHOICES_TO_READ_OUT) {
      return spec.kind === "multiselect"
        ? `${question} — any of: ${spokenList(choices)}.`
        : `${question} — ${spokenList(choices, "or")}?`;
    }

    return `${question} — there are ${choices.length} options, so ask them to look at the list on screen before they answer.`;
  }

  if (spec.longForm) {
    return `${question} — a longer answer; tell them a few sentences is fine.`;
  }

  return question;
}

/**
 * The order to ask about what is still empty.
 *
 * Easy ones first, then the rest in the form's own order. The form's order is kept for the rest
 * because it is the order the person sees on screen, and a question that jumps around the page
 * makes them hunt for where the answer went.
 */
export function inAskingOrder(specs: FieldSpec[]): FieldSpec[] {
  const fields = answerable(specs);
  return [...fields.filter(isEasy), ...fields.filter((spec) => !isEasy(spec))];
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// What the agent is told after every call — facts, never lines to read out
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The first version of the tool result carried scripts: `say_this: "Read the choices out and ask
// which one fits"`, `ask: "How did you hear about Glean? — there are 11 options…"`. The model did
// exactly as told, which is the problem — every question came out in the same template and the
// whole call sounded like a form reading itself aloud. AssemblyAI's prompting guide puts it in
// four words: "Write policies, not decision trees."
//
// So the result now says what IS — what went in and with what value, what is left, what each
// remaining field accepts — and the persona prompt says how to talk about it. The wording is the
// model's; the facts are ours.

/** One field, described the way the agent needs to talk about it. */
export type FieldFacts = {
  field: string;
  question: string;
  /** The heading it sits under, when the form has one — "Alternate Designated Representative". */
  section?: string;
  answer_type: "pick one" | "pick any" | "yes or no" | "long answer" | "text";
  required: boolean;
  /** The real options, when there are few enough to say out loud. */
  choices?: string[];
  /** How many options there are, when there are too many to say — point at the screen instead. */
  choice_count?: number;
  /** Fields that are one question to a person, however many boxes the form splits them into. */
  group?: "address" | "phone";
  /** A list that fills in as you type — nothing to read out; what they say is looked up. */
  searchable?: boolean;
  /** A slider's range. */
  range?: { min: number; max: number };
};

const ADDRESS_PART =
  /street|address|city|town|state|province|county|post(al)? ?code|zip|pin ?code|country/i;

/**
 * Which fields are parts of one address.
 *
 * A Jotform address is five boxes — street, line two, city, state, postal code — and asking for
 * each separately is exactly the form-shaped interrogation this product exists to remove. A
 * person says an address in one breath. Grouped only when a street line sits with at least one
 * other part under the same heading, so a lone "Country" dropdown stays its own question.
 */
function addressFields(specs: FieldSpec[]): Set<string> {
  // By meaning when the model has said: a part of an address, whoever's it is — the section and
  // whose it is keep one person's address apart from a business's. Else by the offline words.
  const known = (spec: FieldSpec) => spec.understood && spec.understood.confidence !== "low";
  const isPart = (spec: FieldSpec) =>
    known(spec) ? conceptById(spec.understood!.concept)?.group === "address" : ADDRESS_PART.test(spec.label);
  const isStreet = (spec: FieldSpec) =>
    known(spec) ? ["address.street", "address.full"].includes(spec.understood!.concept) : /street|address/i.test(spec.label);

  const bySection = new Map<string, FieldSpec[]>();
  for (const spec of specs) {
    if (!isPart(spec)) continue;
    const key = `${spec.section ?? ""}\u0000${spec.understood?.subject ?? ""}`;
    bySection.set(key, [...(bySection.get(key) ?? []), spec]);
  }

  const grouped = new Set<string>();
  for (const parts of bySection.values()) {
    const hasStreet = parts.some(isStreet);
    if (hasStreet && parts.length >= 2) for (const spec of parts) grouped.add(spec.id);
  }
  return grouped;
}

// The phone number's pieces are structure, shared with the fill and the profile: phones.ts.
export { phoneFields };

/** The question a field asks, with the form's required marker taken off. */
function questionOf(spec: FieldSpec): string {
  return fieldName(spec);
}

/** The facts about one field. `all` is the whole form, for grouping. */
export function factsOf(spec: FieldSpec, all: FieldSpec[] = [spec]): FieldFacts {
  const facts: FieldFacts = {
    field: spec.id,
    question: questionOf(spec),
    answer_type:
      spec.kind === "checkbox"
        ? "yes or no"
        : spec.kind === "multiselect"
          ? "pick any"
          : isChoice(spec)
            ? "pick one"
            : spec.longForm
              ? "long answer"
              : "text",
    required: spec.required,
  };
  if (spec.section) facts.section = spec.section;

  if (isChoice(spec)) {
    const choices = realChoices(spec.options);
    if (choices.length > 0 && choices.length <= MOST_CHOICES_TO_READ_OUT) facts.choices = choices;
    else if (choices.length > 0) facts.choice_count = choices.length;
  }

  if (addressFields(all).has(spec.id)) facts.group = "address";
  else if (phoneFields(all).has(spec.id)) facts.group = "phone";
  if (spec.searchable) facts.searchable = true;
  if (spec.range) facts.range = { min: spec.range.min, max: spec.range.max };
  return facts;
}

/** What a re-read found when the form changed shape under the call. */
export type FormReshape = {
  appeared: FieldSpec[];
  disappeared: FieldSpec[];
  /** Labels of fields that came back and have their answer in them again. */
  restored: string[];
  /** A new field that asks what a departed one asked — offered to the person, never filled. */
  maybeSame: { field: string; question: string; earlier_answer: string; earlier_question: string }[];
};

/** Why an answer did not go in, as a fact the persona has a policy for. */
export type NotFilledReason =
  /** The form does not offer what they said. Suggest the closest choice; fill only on a yes. */
  | "not_an_option"
  /** The quote given as evidence is not in what they said. Re-quote them exactly — do not re-ask. */
  | "quote_not_found"
  /** Nothing was said about it. The rule working as intended; not worth a word. */
  | "not_heard"
  /** The page threw the value away once. Ask them to say it again. */
  | "page_refused"
  /** The page threw it away twice. Hand it back: they type this one. */
  | "page_refused_twice"
  /** Cannot be done by voice — a file upload. Theirs to do. */
  | "needs_the_person"
  /** The field is no longer on the page. */
  | "gone";

/** Long answers are acknowledged, not read back. */
const MOST_VALUE_TO_ECHO = 60;

/** How many still-empty fields to describe at once — enough to plan with, not a wall of text. */
const MOST_TO_LIST = 8;

export type Summary = {
  just_filled: { field: string; question: string; value: string }[];
  not_filled: {
    field: string;
    question: string;
    why: NotFilledReason;
    /** What the agent tried to put in — so it can see its own mistake instead of blaming the form. */
    tried?: string;
    choices?: string[];
  }[];
  progress: { filled: number; total: number; required_left: number; optional_left: number };
  next_required: FieldFacts[];
  /** Present only once every required field is in — the moment to offer the rest. */
  optional?: FieldFacts[];
  form_changed?: {
    new_questions: FieldFacts[];
    gone: string[];
    kept: string[];
    maybe_same_answer?: FormReshape["maybeSame"];
  };
  /**
   * Always false, and always here — rule 5b. The model reads this at the moment it decides how
   * to announce the outcome, which is exactly when it once claimed to have submitted.
   */
  submitted: false;
};

/**
 * Everything the agent is told after a call, as facts.
 *
 * Pure. The hook gathers what happened and hands it over; this decides nothing about wording.
 */
export function summarise({
  specs,
  before = specs,
  filled,
  outcomes,
  claimed = [],
  reshaped = null,
  declined = [],
}: {
  /** The form as it is now — after any change the answers caused. */
  specs: FieldSpec[];
  /** The form as it was when the answers were written, for naming fields that have since gone. */
  before?: FieldSpec[];
  /** Ids with an answer in them now. */
  filled: Iterable<string>;
  /** One per answer the agent sent: written, refused, or rejected by the page. */
  outcomes: WriteOutcome[];
  /** What the agent claimed, evidence included — to tell "said nothing" from "misquoted". */
  claimed?: SpokenValue[];
  reshaped?: FormReshape | null;
  /**
   * Fields the person had cleared on purpose. Theirs to leave empty — not asked for again, the
   * way "remove the gender" would otherwise be followed straight away by "what's your gender?".
   */
  declined?: Iterable<string>;
}): Summary {
  const byId = new Map([...before, ...specs].map((spec) => [spec.id, spec] as const));
  const present = new Set(specs.map((spec) => spec.id));
  const done = new Set(filled);
  const question = (id: string) => {
    const spec = byId.get(id);
    return spec ? questionOf(spec) : id;
  };

  const just_filled = outcomes
    .filter((o): o is Extract<WriteOutcome, { status: "written" }> => o.status === "written")
    .map((o) => ({
      field: o.fieldId,
      question: question(o.fieldId),
      value:
        o.wrote.length > MOST_VALUE_TO_ECHO ? `${o.wrote.slice(0, MOST_VALUE_TO_ECHO)}…` : o.wrote,
    }));

  const not_filled = outcomes
    .filter((o) => o.status !== "written")
    .map((o) => {
      const spec = byId.get(o.fieldId);
      let why: NotFilledReason;
      if (o.status === "rejected-by-page") {
        why = o.retried ? "page_refused_twice" : "page_refused";
      } else if (o.status === "refused" && o.choices?.length) {
        why = "not_an_option";
      } else if (!present.has(o.fieldId)) {
        why = "gone";
      } else if (spec?.kind === "file") {
        why = "needs_the_person";
      } else {
        const quote = claimed.find((c) => c.fieldId === o.fieldId)?.evidence?.trim() ?? "";
        why = quote.length >= 2 && !spec?.suspectedHoneypot ? "quote_not_found" : "not_heard";
      }
      // Live run: the agent put "Kolkata" into Country, was refused, and told the person "India is
      // not an option" — blaming the form for its own wrong value. Showing it what it sent is what
      // lets it say the true thing: that was the wrong box for Kolkata, and India is right there.
      const tried = claimed.find((c) => c.fieldId === o.fieldId)?.value;
      return {
        field: o.fieldId,
        question: question(o.fieldId),
        why,
        ...(why === "not_an_option" && tried !== undefined ? { tried: String(tried) } : {}),
        ...(o.status === "refused" && why === "not_an_option" ? { choices: o.choices } : {}),
      };
    });

  const skip = new Set(declined);
  const notDeclined = (spec: FieldSpec) => !skip.has(spec.id);
  const requiredLeft = inAskingOrder(stillMissing(specs, done)).filter(notDeclined);
  const optionalLeft = inAskingOrder(stillOptional(specs, done)).filter(notDeclined);
  const all = answerable(specs);

  const summary: Summary = {
    just_filled,
    not_filled,
    progress: {
      filled: all.filter((spec) => done.has(spec.id)).length,
      total: all.length,
      required_left: requiredLeft.length,
      optional_left: optionalLeft.length,
    },
    next_required: requiredLeft.slice(0, MOST_TO_LIST).map((spec) => factsOf(spec, specs)),
    submitted: false,
  };

  if (requiredLeft.length === 0 && optionalLeft.length > 0) {
    summary.optional = optionalLeft.slice(0, MOST_TO_LIST * 2).map((spec) => factsOf(spec, specs));
  }

  if (reshaped && (reshaped.appeared.length > 0 || reshaped.disappeared.length > 0)) {
    summary.form_changed = {
      new_questions: inAskingOrder(reshaped.appeared).map((spec) => factsOf(spec, specs)),
      gone: reshaped.disappeared.map((spec) => questionOf(spec)),
      kept: reshaped.restored,
      ...(reshaped.maybeSame.length > 0 ? { maybe_same_answer: reshaped.maybeSame } : {}),
    };
  }

  return summary;
}
