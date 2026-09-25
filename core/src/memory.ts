/**
 * The first memory: 22 answers under regex keys. What is left of it has two jobs.
 *
 * 1. `canonicalKey` is the OFFLINE reading of what a field means. The model names meanings now
 *    (`understand.ts`); when it cannot be reached, `fallbackMeanings` reads what these keys can,
 *    at low confidence, so nothing is ever put in unasked on the strength of a regex. The opening
 *    line and the asking order still use it to name the easy questions.
 * 2. `Memory` is the shape the first memory saved, so `migrateV1` (profile.ts) can move it over.
 *
 * Everything a person is remembered by now lives in `profile.ts`.
 *
 * ## The dangerous part is the matching
 *
 * Field ids are meaningless across sites, so a key is a guess at what a label MEANS — and a sloppy
 * guess writes your legal name into "Preferred name". So every key carries exclusions, and an
 * ambiguous label matches nothing.
 */

import type { FieldSpec } from "./types";

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
  // A box that takes a piece of an answer — the month of a date of birth — is not the answer: a
  // saved date of birth written whole into it would be wrong however right the date.
  if (spec.part) return null;
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
