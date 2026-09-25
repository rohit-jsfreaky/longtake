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
 * choice goes in only when the person NAMED it, and an answer they hedged waits. Held answers are
 * not lost — they become a question the agent asks ("Social Media's closest — that one?"), and
 * their yes, through `confirm_answer`, lets it through.
 *
 * ## Who judges what
 *
 * Whether someone hedged ("2 or 3 years", "shayad", "about forty thousand") and whether a "haan"
 * answered a yes-or-no question is language, and language is the model's: it says, for every
 * answer, HOW it heard it — `named`, `inferred` or `unsure`. Code no longer keeps word lists for
 * either. What code still checks is structure it can see: for a choice, whether the words the person
 * said contain the option's own name. An agent that calls "Twitter" a named "Social Media" is still
 * held, because "Social Media" is not in what they said.
 *
 * Pure. Decides; writes nothing.
 */

import { matchOption, optionNamedIn } from "./choices";
import type { Pending } from "./ledger";
import type { FieldSpec, SpokenValue } from "./types";

export type GateVerdict = { write: true } | { write: false; pending: Pending };

/** The form's own yes and no options, when a question is answered by one of them. */
function yesNoOptions(spec: FieldSpec): string[] {
  return (spec.options ?? []).map((o) => o.label).filter((label) => /^\s*(yes|no)\b/i.test(label));
}

function isChoice(spec: FieldSpec): boolean {
  return spec.kind === "select" || spec.kind === "radio";
}

/**
 * May this claim be written now?
 *
 * `held` is what is already waiting for this field.
 */
export function gate(spec: FieldSpec, claim: SpokenValue, held?: Pending): GateVerdict {
  const evidence = claim.evidence ?? "";
  const value = Array.isArray(claim.value) ? claim.value.join(", ") : String(claim.value);
  const how = claim.how ?? "named";

  // ── Something we were holding ──────────────────────────────────────
  // A yes to an offered answer is not recognised here: the model hears it and calls
  // `confirm_answer` (session.ts). A hedge is different: any answer that is not itself unsure
  // settles it.
  if (held?.reason === "hedged" && how !== "unsure") return { write: true };

  const want = isChoice(spec) && spec.options?.length ? matchOption(spec, value) : null;

  // ── Not sure: "2 or 3 years", "maybe LinkedIn" — they choose, not us ─────────────
  // Not for a long answer: "I've used Discord for about five years" in a paragraph is a sentence,
  // not an unsure number.
  if (how === "unsure" && !spec.longForm) {
    return { write: false, pending: { suggestion: want?.label ?? value, heard: evidence, reason: "hedged" } };
  }

  // ── Choices: the person has to have named the option ─────────────────────────────
  if (isChoice(spec) && spec.options?.length) {
    // The value is not an option at all: the writer refuses it with the choices, as before.
    if (!want) return { write: true };
    // Their words carry the option's own name — fine, whatever the model called it.
    if (optionNamedIn(spec, evidence)?.label === want.label || sameText(evidence, want.label)) return { write: true };
    // A yes or a no, in whatever language they said it: the model heard it as this option.
    if (how === "named" && yesNoOptions(spec).includes(want.label)) return { write: true };
    // They said something else, and the agent mapped it to this option. Ask first.
    return { write: false, pending: { suggestion: want.label, heard: evidence, reason: "not_named" } };
  }

  // ── Everything else: worked out, not said, waits ─────────────────────────────────
  if (how === "inferred" && !spec.longForm) {
    return { write: false, pending: { suggestion: value, heard: evidence, reason: "inferred" } };
  }
  return { write: true };
}

function sameText(a: string, b: string): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return flat(a) === flat(b);
}
