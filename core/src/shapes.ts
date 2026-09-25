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
