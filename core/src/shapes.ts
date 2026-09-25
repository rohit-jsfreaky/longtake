/**
 * Placeholders that are really a format — a date's "DD-MM-YYYY", a phone's "(000) 000-0000".
 *
 * Shared by the reader, which learns from one what kind of answer a plain text box takes, and the
 * writer, which puts the answer in that very shape. A format is not language: it is the page
 * saying, in characters, what it will accept.
 */

/** A placeholder that is a date's format: "MM/DD/YYYY", "dd-mm-yyyy", "YYYY-MM-DD". */
export const DATE_MASK = /^(mm|dd|yyyy)([/.\-\s])(mm|dd)\2(yyyy|mm|dd)$/i;

/** A placeholder that is a number's shape: "(000) 000-0000", "###-###-####". */
export const DIGIT_MASK = /^[\s()+\-./]*[09#](?:[\s()+\-./]*[09#])*[\s()+\-./]*$/;

/**
 * A date someone gave, as a calendar day: "1996-05-14", "14 May 1996", "May 14th, 1996". Null when
 * it is not one. Shared by the writer, which puts a date in a field's own shape, and the profile,
 * which hands a form that splits a date into boxes the piece each box asks for.
 */
export function calendarDay(value: string): { y: number; m: number; d: number } | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const parsed = new Date(value.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1"));
  if (Number.isNaN(parsed.getTime())) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}
