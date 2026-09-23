/**
 * Whether an answer may go in now, or has to wait for the person's yes.
 *
 * ## The two live failures this closes
 *
 * - "I heard from Twitter." The form offers no Twitter; the agent put in "Social Media" and moved
 *   on. A reasonable guess — and a guess all the same, on a form the person is about to sign.
 * - "About two and a half or three years." The agent wrote "3 years".
 *
 * Both break the rule this product is built on: nothing goes in that the person did not say. So a
 * choice goes in only when the person NAMED it (or said yes / no to a yes-or-no question), and an
 * answer they hedged waits. Held answers are not lost — they become a question the agent asks
 * ("Social Media's closest — that one?"), and the next call with their yes lets it through.
 *
 * Pure. Decides; writes nothing.
 */

import type { Pending } from "./ledger";
import type { FieldSpec, SpokenValue } from "./types";
import { MEANS_NO, MEANS_YES, matchOption, optionNamedIn } from "./writer";

export type GateVerdict = { write: true } | { write: false; pending: Pending };

/** A choice between answers the person could not make up their mind about. */
const NUMBER_RANGE =
  /\d+(\.\d+)?(\s+and\s+a\s+half)?\s+(or|to|ya)\s+\d|\d\s*[-–]\s*\d+\s*(years?|yrs?|months?|weeks?|days?|lakhs?|k)\b/i;
// A bare dash is not a range: "98765-43210" is a phone number, "2026-10-01" a date. Only a dash
// followed by a unit — "2-3 years" — is someone not sure.
/** Approximately a number — a hedge on a value, not on the whole sentence. */
const ABOUT_A_NUMBER = /\b(about|around|roughly|approximately|approx|nearly|almost|lagbhag|kareeb|takriban)\s+\d/i;
/** Uncertainty about which option. Only consulted for choices, where it cannot mean anything else. */
const UNSURE = /\b(maybe|perhaps|probably|not sure|i guess|shayad|pata nahi)\b/i;

function isYesNo(spec: FieldSpec): { yes?: string; no?: string } | null {
  const labels = (spec.options ?? []).map((o) => o.label);
  const yes = labels.find((l) => /^\s*yes\b/i.test(l));
  const no = labels.find((l) => /^\s*no\b/i.test(l));
  return yes || no ? { yes, no } : null;
}

/** The option the person's words point at, if exactly one — by name, or by yes / no. */
function named(spec: FieldSpec, evidence: string): string | null {
  const byName = optionNamedIn(spec, evidence);
  if (byName) return byName.label;

  const yesNo = isYesNo(spec);
  if (yesNo) {
    // Negatives first, as everywhere: "no, not really" contains no yes-word, but "I don't agree"
    // contains "agree".
    if (MEANS_NO.test(evidence) && yesNo.no) return yesNo.no;
    if (MEANS_YES.test(evidence) && yesNo.yes) return yesNo.yes;
  }
  return null;
}

function isChoice(spec: FieldSpec): boolean {
  return spec.kind === "select" || spec.kind === "radio";
}

/**
 * May this claim be written now?
 *
 * `held` is what is already waiting for this field, so a yes can release it.
 */
export function gate(spec: FieldSpec, claim: SpokenValue, held?: Pending): GateVerdict {
  const evidence = claim.evidence ?? "";
  const value = Array.isArray(claim.value) ? claim.value.join(", ") : String(claim.value);

  // ── Something we were holding ──────────────────────────────────────
  // A yes to an offered answer is NOT recognised here. It used to be, by a list of yes-words, and
  // live it failed four times running: "do it", "do that", "kar do" were on no list, the answer
  // never went in, and the agent was left insisting it was still waiting. What counts as agreeing
  // is language, and language is the model's job: it hears the reply and calls `confirm_answer`
  // (session.ts) with agreed true or false and the person's words. Code only checks those words
  // were really said.
  //
  // A hedge is different: it is settled by any answer that is not itself hedged.
  if (held?.reason === "hedged" && !hedged(spec, evidence)) return { write: true };

  // ── Choices: the person has to have named the option ─────────────────────────────
  if (isChoice(spec) && spec.options?.length) {
    const want = matchOption(spec, value);
    const said = named(spec, evidence);

    // Unsure between options — "maybe LinkedIn, or a job board".
    if (UNSURE.test(evidence) && !(held && MEANS_YES.test(evidence))) {
      return { write: false, pending: { suggestion: want?.label ?? value, heard: evidence, reason: "hedged" } };
    }
    // The value is not an option at all: the writer refuses it with the choices, as before.
    if (!want) return { write: true };
    // Named, or the value is exactly what they said — fine.
    if (said === want.label || sameText(evidence, want.label)) return { write: true };
    // They said something else, and the agent mapped it to this option. Ask first.
    return { write: false, pending: { suggestion: want.label, heard: evidence, reason: "not_named" } };
  }

  // ── Everything else: a hedged number waits ───────────────────────────────────────
  // Not in a long answer. "I've used Discord for about five years" in a paragraph is a sentence,
  // not an unsure number — and holding the whole answer for a yes left "why do you want to work
  // here?" empty while the agent said "got it".
  if (!isLongAnswer(spec) && hedged(spec, evidence) && /\d/.test(value)) {
    return { write: false, pending: { suggestion: value, heard: evidence, reason: "hedged" } };
  }

  return { write: true };
}

function isLongAnswer(spec: FieldSpec): boolean {
  return Boolean(spec.longForm);
}

function hedged(spec: FieldSpec, evidence: string): boolean {
  if (NUMBER_RANGE.test(evidence) || ABOUT_A_NUMBER.test(evidence)) return true;
  return isChoice(spec) && UNSURE.test(evidence);
}

function sameText(a: string, b: string): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return flat(a) === flat(b);
}
