/**
 * Which of a field's own options a person meant — judged on words alone, never on the page.
 *
 * Shared by the gate (may this go in now?) and every widget adapter (which option do I press?),
 * so a dropdown whose options were read in advance and one whose options exist only once open are
 * held to exactly the same standard. Returns `null` rather than a best guess, everywhere: every
 * caller treats `null` as "leave it and ask".
 */

import type { FieldSpec } from "./types";

export type Choice = { value: string; label: string };

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words that mean no, in either of the two languages Longtake is built to hear. */
export const MEANS_NO = /\b(no|not|false|never|decline|disagree|refuse|nahi|nahin)\b/i;
/** Words that mean yes. Only consulted once the negatives have had their say. */
export const MEANS_YES = /\b(yes|true|agree|agreed|accept|confirm|ok|okay|sure|haan|han|ji|sahi)\b/i;

/**
 * Did the speaker mean yes?
 *
 * The negative is tested first and that ordering is the whole point: "I do not agree" contains
 * the word "agree", and a tick-box for a privacy policy is not the place to get that backwards.
 * Anchoring on the first word instead — which is the obvious implementation — fails on "I agree",
 * which is how most people actually say it.
 */
export function readAsYesOrNo(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value);
  if (MEANS_NO.test(text)) return false;
  return MEANS_YES.test(text);
}

/**
 * An option's name without what a person never says aloud: a trailing dialling code ("India +91")
 * or a bracketed short form ("… Kharagpur (IITKGP)"). Normalised.
 */
export function bareName(label: string): string {
  return normalise(label.replace(/\s*\+\d[\d\s-]*$/, "").replace(/\s*\([^)]*\)\s*$/, ""));
}

/**
 * Does a widget showing this text hold this choice?
 *
 * Usually it shows the choice's words. Some show only part of them: Greenhouse's phone Country
 * picker, given "India +91", shows a flag and "+91". Checked for the whole label only, that write
 * was reported as refused by the page — twice — while India sat in the box.
 */
export function showsChoice(showing: string, chosen: string): boolean {
  const shown = normalise(showing);
  const wanted = normalise(chosen);
  if (!shown) return false;
  return shown.includes(wanted) || (shown.length >= 2 && ` ${wanted} `.includes(` ${shown} `));
}

/**
 * The matching rule itself, over any list of candidate wordings: the index of the single
 * candidate the speaker meant, or `null`.
 */
export function matchAmong(candidates: string[], spoken: string): number | null {
  const want = normalise(spoken);
  if (!want) return null;

  const exact = candidates.findIndex((candidate) => normalise(candidate) === want);
  if (exact >= 0) return exact;

  // The same once a dialling code or a bracketed short name is set aside: "India +91" is India,
  // "Indian Institute of Technology Kharagpur (IITKGP)" is the institute.
  const plain = candidates.map(bareName);
  if (plain.filter((text) => text === want).length === 1) return plain.indexOf(want);

  // The spoken words as whole words. Greenhouse's phone Country search for "India" returns
  // "British Indian Ocean Territory +246" and "India +91": as a bare substring "india" is in
  // both, and the field was refused as ambiguous with India right there on the list.
  const whole: number[] = [];
  candidates.forEach((candidate, index) => {
    if (` ${normalise(candidate)} `.includes(` ${want} `)) whole.push(index);
  });
  if (whole.length === 1) return whole[0]!;

  // One candidate contains the spoken words, or the spoken words contain it — but only if
  // exactly one does. Two means we do not actually know which was meant, and a coin flip on
  // "United States" versus "United Kingdom" is not a thing to do to somebody's application.
  const partial: number[] = [];
  candidates.forEach((candidate, index) => {
    const text = normalise(candidate);
    if (text.length > 0 && (text.includes(want) || want.includes(text))) partial.push(index);
  });
  return partial.length === 1 ? partial[0]! : null;
}

/**
 * The one option the person named, word for word, somewhere in what they said.
 *
 * ## Why
 *
 * Live run: "I'm based in Kolkata, India." The Glean application has no City box, so the agent put
 * the location into Country — as "Kolkata" — and the form, correctly, did not offer Kolkata. The
 * agent then announced "India is not an option", which was false: India was on the list, and the
 * person had said it, and the agent's own evidence quote contained it.
 *
 * So when the value does not match, the evidence is read for an option named in it. This does not
 * loosen the rule that nothing unspoken is written — the option has to appear in the person's own
 * words, as a whole word or phrase, and exactly one option may. "Twitter" still matches nothing on
 * a list without Twitter; "yes, no problem" names two answers and is left alone.
 */
export function optionNamedIn(spec: FieldSpec, evidence: string | undefined): Choice | null {
  const heard = ` ${normalise(evidence ?? "")} `;
  if (!heard.trim()) return null;

  // Named in full, or by the name a person actually says — "India" for "India +91". Longest names
  // first, each taking its words out of what was heard: "Computer Science" names Computer Science
  // and not also "Science", an option of its own on Discord's list — two names meant "not sure",
  // and a plainly named answer waited for a yes.
  const names = (spec.options ?? [])
    .filter((option) => option.value !== "")
    .flatMap((option) => [normalise(option.label), bareName(option.label)].filter((label) => label.length >= 2).map((label) => ({ option, label })))
    .sort((a, b) => b.label.length - a.label.length);
  let rest = heard;
  const named = new Set<Choice>();
  for (const { option, label } of names) {
    if (!rest.includes(` ${label} `)) continue;
    named.add(option);
    rest = rest.split(` ${label} `).join("  ");
  }

  return named.size === 1 ? [...named][0]! : null;
}

/** Which of the page's own options did the speaker mean? */
export function matchOption(spec: FieldSpec, spoken: string): Choice | null {
  if (!spec.options || spec.options.length === 0) return null;

  // Labels and values are both offered, because a person says "India" and a form stores "in".
  const labels = spec.options.map((option) => option.label);
  const byLabel = matchAmong(labels, spoken);
  if (byLabel !== null) return spec.options[byLabel]!;

  const values = spec.options.map((option) => option.value);
  const byValue = matchAmong(values, spoken);
  return byValue !== null ? spec.options[byValue]! : null;
}

/**
 * The page's own wording for what this field will accept, as a sentence the agent can say.
 *
 * Capped, because the agent has to read it out loud and a person cannot hold thirty options in
 * their head. Past the cap it says how many more there are, which is enough for the agent to
 * offer to go through them.
 */
const MOST_CHOICES_TO_SAY = 10;

/**
 * The options a person could actually pick, with the placeholder dropped.
 *
 * A `<select>` almost always opens with `<option value="">Select…</option>`. It is not a real
 * answer, and an agent reading "choose from: Select, India, United States" out loud sounds broken.
 */
export function realChoices(options: Choice[] | undefined): string[] {
  const real = (options ?? []).filter((option) => option.value !== "");
  // If every option has an empty value the form is unusual, not placeholder-only — keep them all
  // rather than telling the person this field has no choices at all.
  return (real.length > 0 ? real : (options ?? [])).map((option) => option.label).filter(Boolean);
}

export function sayableChoices(labels: string[]): string {
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  const shown = clean.slice(0, MOST_CHOICES_TO_SAY);
  const rest = clean.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
}
