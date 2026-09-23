/**
 * Answers you have already given, offered to the next form that asks.
 *
 * You tell Longtake about yourself once. The second form arrives filled in. That is the whole
 * feature, and it is the reason somebody would install this rather than admire it.
 *
 * ## Why it does not break the rule
 *
 * Rule 2 says never fill a field the person did not speak to. Memory does not break it: every
 * remembered answer carries **the words they originally said**, and that evidence travels with
 * the value onto the new form. A recalled answer is not a guess, it is a quote from an earlier
 * conversation. Nothing is ever invented, only re-offered.
 *
 * ## The dangerous part is the matching, not the storing
 *
 * Field ids are meaningless across sites — `first_name` here, `question_69292246` there — so
 * answers are keyed by what they *mean*. Which means a sloppy match writes your legal name into
 * "Preferred name", your current employer into "Previous employer", or the university you
 * attended into "Where did your parents study".
 *
 * So every key carries **exclusions**, and an ambiguous label matches nothing. Filling the next
 * form with almost-right answers is worse than leaving it empty, because a person skimming a
 * pre-filled form trusts it.
 *
 * ## Where it lives
 *
 * Nowhere but the person's own browser. This file is pure and holds no storage of its own; the
 * web app keeps it in `localStorage` and the extension in `chrome.storage`. It is never sent
 * anywhere, and there is no account. That is not a feature we are being modest about — it is the
 * only version of this that anybody should accept.
 */

import type { FieldSpec, SpokenValue } from "./types";

export type RememberedAnswer = {
  /** What this answer *is*, independent of any one form's naming. */
  key: string;
  value: string | string[] | boolean;
  /** Their own words from the telling this came out of. Travels with the value, always. */
  evidence: string;
  /** How the form that first asked it worded the question. */
  askedAs: string;
  savedAt: number;
  /** Which form it was first given to, so a person can see where it came from. */
  sourceUrl: string;
};

export type Memory = Record<string, RememberedAnswer>;

export const MEMORY_VERSION = 1;

/**
 * The things a form asks that are worth remembering, and how each one is worded in the wild.
 *
 * `match` is checked against the **normalised** label, and normalising has already replaced every
 * punctuation mark with a space. So write patterns against what survives: `location city`, never
 * `location \(city\)`. A pattern carrying punctuation is not a stricter match, it is a dead one —
 * it silently matches nothing and the key quietly stops existing.
 *
 * `never` is checked first and wins — those are the labels that look like the key and mean
 * something else entirely.
 */
const KEYS: { key: string; match: RegExp; never?: RegExp }[] = [
  // ── identity ──────────────────────────────────────────────────────────────
  {
    key: "first_name",
    match: /^(first|given|fore)[ ]?name$|^first$/,
    // "Preferred first name" is a different question with a different answer.
    never: /preferred|maiden|previous|former|parent|guardian|emergency|referrer|referee|alternate|secondary/,
  },
  {
    key: "last_name",
    match: /^(last|sur|family)[ ]?name$|^surname$/,
    never: /preferred|maiden|previous|former|parent|guardian|emergency|referrer|referee|alternate|secondary/,
  },
  {
    key: "full_name",
    match: /^(full|legal|your)?[ ]?name$/,
    never: /first|last|sur|family|preferred|maiden|previous|former|user|company|employer|school|parent|guardian|emergency|referee|alternate|secondary|organi[sz]ation/,
  },
  {
    key: "preferred_name",
    match: /preferred[ ]?(first)?[ ]?name|nickname|what should we call you/,
  },

  // ── contact ───────────────────────────────────────────────────────────────
  {
    key: "email",
    match: /e[ -]?mail/,
    // A referrer's email is not yours.
    never: /confirm|repeat|verify|parent|guardian|emergency|referrer|referee|manager|alternate|secondary/,
  },
  {
    key: "phone",
    match: /phone|mobile|telephone|contact number|cell/,
    never: /confirm|parent|guardian|emergency|referrer|referee|alternate|secondary|work phone/,
  },

  // ── where you are ─────────────────────────────────────────────────────────
  {
    key: "city",
    // "Location (City)" arrives here as "location city" — the parens are gone by now.
    match: /^(current )?(city|town)$|city of residence|location city|^location$|where are you based/,
    never: /birth|company|office|preferred work|desired|willing|organi[sz]ation|business/,
  },
  { key: "country", match: /^country$|country of residence/, never: /birth|citizenship|company|organi[sz]ation|business/ },
  { key: "postal_code", match: /post(al)? ?code|zip ?code|pin ?code/, never: /company|organi[sz]ation|business/ },

  // ── links ─────────────────────────────────────────────────────────────────
  { key: "linkedin", match: /linked ?in/ },
  { key: "github", match: /git ?hub/ },
  { key: "portfolio", match: /portfolio|personal (web)?site|^website$/, never: /company|employer|organi[sz]ation|business/ },

  // ── work ──────────────────────────────────────────────────────────────────
  {
    key: "current_employer",
    match: /current (employer|company)|present employer|who do you work for|name of your current/,
    // "Previous employer" is a different job and a different answer.
    never: /previous|former|last employer|first employer|desired|target/,
  },
  { key: "current_title", match: /current (job )?title|current role|present title/, never: /desired|target/ },
  {
    key: "years_experience",
    match: /years? of (relevant )?experience|how (many|much) (years|experience)|total experience/,
  },
  { key: "notice_period", match: /notice period|when can you (start|join)|availability to start/ },
  { key: "expected_salary", match: /(expected|desired|target) (salary|compensation|ctc)|salary expectation/ },
  { key: "current_salary", match: /current (salary|compensation|ctc)/, never: /expected|desired|target/ },

  // ── the yes/no ones every job form asks ───────────────────────────────────
  { key: "willing_to_relocate", match: /relocat/ },
  { key: "work_authorization", match: /authoriz(ed|ation) to work|legally (authorized|able) to work|right to work/ },
  { key: "needs_sponsorship", match: /sponsorship|require.*visa|visa.*require/ },

  // ── the long ones ─────────────────────────────────────────────────────────
  { key: "about_you", match: /tell us about your ?self|about you|introduce yourself|summary|bio/ },
];

function normalise(label: string): string {
  return label
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What does this field mean, if we can tell?
 *
 * `null` whenever there is any doubt, and that is the common case by design. A form has twenty
 * questions and perhaps eight of them are things a person answers the same way everywhere; the
 * other twelve are that company's own, and guessing at them is exactly the failure mode.
 */
export function canonicalKey(spec: FieldSpec): string | null {
  const label = normalise(spec.label || spec.id.replace(/_/g, " "));
  if (!label) return null;

  // The exclusions read the section too. On a real Jotform application the alternate
  // representative's name box is labelled "First Name" and nothing else — only the heading above
  // it, "Alternate Designated Representative", says it is somebody else's. The label decides
  // what a field IS; the section can only ever rule a match out, never create one.
  const context = spec.section ? `${normalise(spec.section)} ${label}` : label;

  const hits = KEYS.filter((entry) => {
    if (entry.never?.test(context)) return false;
    return entry.match.test(label);
  });

  // Two keys claiming the same label means we do not actually know which it is.
  return hits.length === 1 ? hits[0]!.key : null;
}

/**
 * Add what was just filled in to what we already knew.
 *
 * Only answers with evidence are kept, for the same reason nothing without evidence is ever
 * written: an answer we cannot attribute is an answer we should not repeat on the next form.
 */
export function remember(
  memory: Memory,
  specs: FieldSpec[],
  values: SpokenValue[],
  sourceUrl = "",
  now = Date.now(),
): Memory {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const next: Memory = { ...memory };

  for (const spoken of values) {
    const spec = byId.get(spoken.fieldId);
    if (!spec) continue;
    if (!spoken.evidence || spoken.evidence.trim() === "") continue;
    if (spec.suspectedHoneypot) continue;

    const key = canonicalKey(spec);
    if (!key) continue;

    next[key] = {
      key,
      value: spoken.value,
      evidence: spoken.evidence,
      askedAs: spec.label || spec.id,
      savedAt: now,
      sourceUrl,
    };
  }

  return next;
}

/** One field on a new form, matched to something already known. */
export type Recalled = {
  fieldId: string;
  key: string;
  value: string | string[] | boolean;
  /** The words they used the first time. This is what makes it a quote and not a guess. */
  evidence: string;
  /** How the earlier form worded it, so the person can see why this was offered. */
  previouslyAskedAs: string;
};

/**
 * What can be offered to the form now on screen.
 *
 * Returns matches only — it writes nothing. The caller decides whether to fill them in or show
 * them first, and `writer.ts` still applies every one of its own rules afterwards, including
 * refusing a dropdown value that does not match one of that form's real options.
 */
export function recall(memory: Memory, specs: FieldSpec[]): Recalled[] {
  const found: Recalled[] = [];

  for (const spec of specs) {
    if (spec.suspectedHoneypot) continue;
    if (spec.kind === "file") continue;

    const key = canonicalKey(spec);
    if (!key) continue;

    const known = memory[key];
    if (!known) continue;

    found.push({
      fieldId: spec.id,
      key,
      value: known.value,
      evidence: known.evidence,
      previouslyAskedAs: known.askedAs,
    });
  }

  return found;
}

/**
 * Turn recalled answers into something `writer.ts` will accept.
 *
 * The evidence carried across is the original quote, unchanged. A person clicking into the field
 * later hears the recording that produced it, on whichever form they are now looking at.
 */
export function asSpokenValues(recalled: Recalled[]): SpokenValue[] {
  return recalled.map((item) => ({
    fieldId: item.fieldId,
    value: item.value,
    evidence: item.evidence,
  }));
}

/** Everything known, newest first — for showing a person exactly what is being kept. */
export function listMemory(memory: Memory): RememberedAnswer[] {
  return Object.values(memory).sort((a, b) => b.savedAt - a.savedAt);
}

/** Forget one answer. */
export function forget(memory: Memory, key: string): Memory {
  const next = { ...memory };
  delete next[key];
  return next;
}

/** Forget everything. Always one click away, and it really is everything. */
export function forgetAll(): Memory {
  return {};
}
