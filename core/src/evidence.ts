/**
 * Checking that the person actually said it.
 *
 * ## Why this file exists
 *
 * `binder.ts` makes every answer carry an `evidence` quote, and `writer.ts` refuses any answer
 * whose quote is empty. That stops a model filling blanks it was never told about. It does not
 * stop a model **inventing the quote**, and on the first real run that is exactly what happened:
 *
 * ```
 * said:     मेरा नाम रोहित कृष्णप्प है, मैं कोलकाता से हूँ, इंडिया।
 * tool call: first_name = "Arjun"   evidence: "My name is Arjun"
 * ```
 *
 * Neither the name nor the sentence existed. Every layer we had would have written it, because
 * every layer was checking that evidence was *present* rather than *true*.
 *
 * So the quote is checked against the transcript. We have the transcript — it arrives as
 * `transcript.user` on the same socket — and an answer whose words cannot be found in what was
 * actually said does not go on the form. This is the difference between an honour system and a
 * guarantee, and it is the same promise the product makes out loud: every answer keeps the
 * person's own voice attached to it.
 *
 * ## What it deliberately does not require
 *
 * The **value** may be nothing like the quote, and usually is: somebody says
 * "मेरा नाम रोहित कश्यप है" and the field needs `Rohit Kashyap`. Transliteration, tidying and
 * formatting are the model's job. Only the *quote* has to be real.
 */

import type { SpokenValue } from "./types";

/** How much of a quote must be accounted for when it is not a clean substring. */
const MIN_WORD_OVERLAP = 0.7;

/** Quotes shorter than this are too small to verify meaningfully, so they are not trusted. */
const MIN_QUOTE_CHARS = 2;

/**
 * Lowercase, strip punctuation, collapse whitespace — and **keep every script**.
 *
 * ⚠️ Not the `[^a-z0-9]` normaliser used for matching dropdown options. That one would erase a
 * Devanagari transcript completely and quietly pass everything, which is the precise opposite of
 * what this file is for.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return normalise(text).split(" ").filter(Boolean);
}

export type EvidenceCheck = {
  ok: boolean;
  /** Only set when it failed — safe to show a person, and read by the agent. */
  reason?: string;
};

/**
 * Were these words really said?
 *
 * Two ways to pass, in order of confidence:
 *
 *   1. The quote appears in the transcript, once punctuation and case are set aside. This is the
 *      normal case for a model that quotes properly.
 *   2. Most of the quote's words appear in the transcript. Speech-to-text output shifts between
 *      partial and final results, and a model quoting from memory of a long turn drops or
 *      reorders the odd word. Demanding a perfect substring would refuse honest answers.
 *
 * Anything below that is treated as not said.
 */
export function checkEvidence(transcript: string, evidence: string): EvidenceCheck {
  const quote = (evidence ?? "").trim();

  if (quote.length < MIN_QUOTE_CHARS) {
    return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
  }

  const heard = normalise(transcript);
  if (!heard) {
    return { ok: false, reason: "Nothing has been said yet, so there is nothing to go on." };
  }

  // ⚠️ Check the quote AFTER normalising, not before.
  //
  // `"..."` is three characters and survives a length check, but normalises away to nothing —
  // and every string contains the empty string, so `includes("")` would wave it straight
  // through. A check that accepts punctuation as proof is worse than no check, because it
  // looks like one.
  const normalisedQuote = normalise(quote);
  if (normalisedQuote.length < MIN_QUOTE_CHARS) {
    return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
  }

  if (heard.includes(normalisedQuote)) return { ok: true };

  const quoteWords = words(quote);
  if (quoteWords.length === 0) {
    return { ok: false, reason: "Nothing was spoken about this field, so it stays empty." };
  }

  const heardWords = new Set(words(transcript));
  const found = quoteWords.filter((word) => heardWords.has(word)).length;

  if (found / quoteWords.length >= MIN_WORD_OVERLAP) return { ok: true };

  return {
    ok: false,
    reason: `Those words were not in what was said, so this field stays empty. Quote the person exactly, or leave the field out.`,
  };
}

export type EvidenceSplit = {
  /** Answers whose quotes were found in the transcript. These go on to `writer.ts`. */
  spoken: SpokenValue[];
  /** Answers that were not, with the reason — reported to the agent so it can ask instead. */
  unsupported: { fieldId: string; reason: string }[];
};

/**
 * Split a tool call into the answers the person really gave and the ones they did not.
 *
 * Runs before `writer.ts`, so an invented answer never reaches the page at all.
 */
export function keepOnlyWhatWasSaid(transcript: string, values: SpokenValue[]): EvidenceSplit {
  const spoken: SpokenValue[] = [];
  const unsupported: { fieldId: string; reason: string }[] = [];

  for (const value of values) {
    const check = checkEvidence(transcript, value.evidence);
    if (check.ok) spoken.push(value);
    else unsupported.push({ fieldId: value.fieldId, reason: check.reason! });
  }

  return { spoken, unsupported };
}
