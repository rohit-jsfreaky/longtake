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

  // The same words in the other script. Live: a Hinglish take came back from speech-to-text as
  // "…और मैं veteran नहीं हूँ", the agent quoted it as "main veteran nahi hoon", and the answer was
  // refused as unsaid — then asked again. Compared by sound, the quote is what was said.
  // A sound key is lossy, so two guards: a number must be heard exactly ("ten" is never "था"), and
  // only words whose key keeps two letters count — "main", "hoon", "ke" say nothing on their own.
  if (heardBySound(quoteWords, heardWords, words(transcript))) return { ok: true };

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

// ── One word, however it was written: Devanagari or its Latin spelling ──────────────────────────

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh",
  ष: "sh", स: "s", ह: "h", क़: "k", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y",
};
const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ii", उ: "u", ऊ: "uu", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e",
};
const SIGNS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॉ": "o", "ॅ": "e", "ं": "n", "ँ": "n", "ः": "h", "्": "", "़": "",
};
const NUKTA: Record<string, string> = { ज: "z", फ: "f", ड: "r", क: "k", ख: "kh", ग: "g" };

/** Devanagari spelled out in Latin letters, roughly as people type Hindi in English letters. */
function romanise(word: string): string {
  let out = "";
  const chars = [...word.normalize("NFC")];
  chars.forEach((char, i) => {
    const next = chars[i + 1];
    if (CONSONANTS[char] !== undefined) {
      out += next === "़" && NUKTA[char] ? NUKTA[char] : CONSONANTS[char];
      // The vowel every consonant carries, unless a sign replaces or removes it.
      const after = next === "़" ? chars[i + 2] : next;
      if (after === undefined || (SIGNS[after] === undefined && CONSONANTS[after] !== undefined)) out += "a";
      else if (after !== undefined && ["ं", "ँ", "ः"].includes(after)) out += "a";
    } else if (VOWELS[char] !== undefined) out += VOWELS[char];
    else if (SIGNS[char] !== undefined) out += SIGNS[char];
    else out += char;
  });
  return out;
}

/**
 * A key for how a word sounds, the same for "नहीं" and "nahi", "हूँ" and "hoon", "करता" and "karta":
 * Latin letters, no vowels (Hindi in Latin letters spells them any way it likes), no h (aspiration
 * is spelled both ways), doubled letters once, and no nasal n at the end. Names and numbers keep
 * their consonants, so a made-up name still does not match.
 */
function soundKey(word: string): string {
  const latin = /[ऀ-ॿ]/.test(word) ? romanise(word) : word;
  if (/[^\x00-\x7F]/.test(latin)) return ""; // another script: only exact matching applies
  const key = latin
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/h/g, "")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");
  return key.length > 1 ? key.replace(/n$/, "") : key;
}

const NUMBER_WORDS = new Set(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand lakh crore million half".split(" "),
);

/** The quote's words, heard in the other script: numbers exactly, the rest by how they sound. */
function heardBySound(quoteWords: string[], heardWords: Set<string>, heard: string[]): boolean {
  const numbers = quoteWords.filter((word) => /\d/.test(word) || NUMBER_WORDS.has(word));
  if (numbers.some((word) => !heardWords.has(word))) return false;
  const heardKeys = new Set(heard.map(soundKey));
  const content = quoteWords.map(soundKey).filter((key) => key.length >= 2);
  if (content.length === 0) return false;
  return content.filter((key) => heardKeys.has(key)).length / content.length >= MIN_WORD_OVERLAP;
}
