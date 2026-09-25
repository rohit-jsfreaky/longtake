/**
 * A phone number is one answer, however a form splits it.
 *
 * People say "+91 98765 43210" in one breath. One form takes it in one box; the next splits it into
 * a country-code picker and a number box; a third adds an area code. This file is the structure of
 * that, in code — dialling codes are digits after a plus, not language — shared by the reader's
 * pairing, the fill that splits what was said, the rules that name what a field means, and the
 * profile that keeps the whole number and hands each form the piece it asks for.
 *
 * Pure.
 */

import type { FieldSpec } from "./types";

/** Options that are dialling codes: "India (+91)", "+1 United States". */
export const DIAL_CODE = /\+\d{1,4}\b/;

/** The concepts that are pieces of one phone number. */
export const PHONE_WHOLE = "contact.phone";
export const PHONE_NUMBER = "contact.phone.number";
export const PHONE_CODE = "contact.phone.country_code";

/**
 * A phone number split across a country-code picker and a number box — one question to a person.
 *
 * Paired when a tel field shares its heading with a dropdown whose options are mostly dialling
 * codes, or one labelled as a code. People say "+91 98765 43210" in one breath.
 */
export function phoneFields(specs: FieldSpec[]): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const tel of specs.filter((spec) => spec.kind === "tel")) {
    const code = specs.find(
      (spec) =>
        spec !== tel &&
        spec.kind === "select" &&
        (spec.section ?? "") === (tel.section ?? "") &&
        (/country code|dial(ling)? code|^code$/i.test(spec.label) ||
          ((spec.options?.length ?? 0) > 0 && spec.options!.filter((o) => DIAL_CODE.test(o.label)).length >= spec.options!.length / 2)),
    );
    if (code) {
      pairs.set(tel.id, code.id);
      pairs.set(code.id, tel.id);
    }
  }
  return pairs;
}

/** The dialling code a number starts with — "+91 98765 43210" → "91" — or null. */
export function dialCodeOf(value: string): string | null {
  return /^\s*\+\s*(\d{1,4})\b/.exec(value)?.[1] ?? null;
}

/** A dialling code anywhere in some text — "India (+91)", "phone is +91 98765…" → "91" — or null. */
export function dialCodeIn(text: string): string | null {
  return /\+\s*(\d{1,4})\b/.exec(text)?.[1] ?? null;
}

/** The number without its leading dialling code: "+91 98765 43210" → "98765 43210". */
export function withoutDialCode(value: string): string {
  return value.replace(/^\s*\+\s*\d{1,4}[\s.-]*/, "");
}

/**
 * The one option of a code picker that is this dialling code, or null. "+1" is the United States
 * AND Canada: picking one of them would be a guess, so it is not picked.
 */
export function optionForDialCode(spec: Pick<FieldSpec, "options">, code: string): string | null {
  const pattern = new RegExp(`\\+\\s*${code}\\b`);
  const matches = (spec.options ?? []).filter((o) => pattern.test(o.label));
  return matches.length === 1 ? matches[0]!.label : null;
}
