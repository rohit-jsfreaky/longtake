/**
 * ⭐ Per-field shaping, and keeping the verbatim.
 *
 * The Voice Agent already gives us a transcript and a tidy value. So why call a second API?
 *
 * Because of what the tidying costs. On a live run somebody said *"I, um, I think I just want
 * this role for my growth"* and the agent wrote *"I think I just want this role for my growth"* —
 * a good edit. But it also **cleaned the quote it gave us**, so the "um" and the restart were
 * gone from everything we held. The one thing this product promises is that your own words stay
 * attached to your answer, and for that field they did not.
 *
 * The Dictation API is the only one that hands back both halves from a single call:
 *
 * ```
 * text          the words exactly as spoken — always present
 * llm_response  the cleaned-up version — null if the rewrite failed
 * ```
 *
 * That gap is the thing nobody else keeps. It is what lets a field say *"want another look at
 * this one?"* in Phase 5, and it is what lets somebody hear themselves say it.
 *
 * ## Three limits that shape everything here
 *
 * 1. **It will not return JSON.** Structured output comes from the Voice Agent's tool calling.
 *    This API only ever reshapes prose, which is why it runs *after* the field is chosen, not
 *    instead of choosing it.
 * 2. **It has a 429**, and a 503, both with `Retry-After`. So: a handful of calls per utterance,
 *    never one per field.
 * 3. **The rewrite has a 5-second deadline** and failing it still returns **HTTP 200**, with
 *    `llm_response: null` and `llm_error` set. Always fall back to `text`.
 *
 * This file is pure — it builds the request and shapes the reply. The network call lives in
 * `web/src/app/api/dictate/`, because the API key must never reach a browser.
 */

import { fieldName, type FieldSpec } from "./types";

/** The request `config` part. Unknown fields are rejected with a 400, so this list is exact. */
export type DictationConfig = {
  /** Required for raw PCM, ignored for WAV. */
  sample_rate?: number;
  /** Required for raw PCM. */
  channels?: number;
  language_codes?: string[];
  /** Describes the situation the audio comes from. Max 6000 characters. Applied BEFORE. */
  stt_prompt?: string;
  /** Exact strings to expect. Max 100 terms / 8000 characters. Applied BEFORE. */
  keyterms_prompt?: string[];
  /** The rewrite you want. Max 2048 characters. Applied AFTER. */
  llm_instruction?: string;
};

/** The response, as the service returns it. */
export type DictationResult = {
  text: string;
  llm_response: string | null;
  llm_error?: string | null;
  final_text?: string | null;
};

/** One long answer, in both of its forms. Neither is thrown away. */
export type ShapedAnswer = {
  fieldId: string;
  /** What was actually said, word for word, fillers and restarts intact. */
  verbatim: string;
  /** The version that goes in the box. */
  clean: string;
  /** False when the rewrite failed and `clean` is just the verbatim again. */
  rewritten: boolean;
  /** Why the rewrite did not happen, when it did not. */
  note?: string;
};

/** Hard caps from the docs, kept here so a caller cannot quietly exceed them. */
const MAX_STT_PROMPT = 6000;
const MAX_INSTRUCTION = 2048;
const MAX_KEYTERMS = 100;
const MAX_KEYTERMS_CHARS = 8000;

/**
 * Never more than this many calls for one utterance.
 *
 * A form can have a dozen long-answer boxes and the temptation is one call each. That is how you
 * find the 429. In practice a person answers one or two long questions per breath, so the cap is
 * rarely reached — it exists so that a strange form cannot turn into forty requests.
 */
export const MAX_CALLS_PER_UTTERANCE = 3;

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * Terms the transcriber should expect, drawn from the form itself.
 *
 * This is the part worth noticing. The answers already in the form — the person's name, their
 * city, their employer — are exactly the strings speech-to-text mangles, and they are sitting
 * right there. So the form improves the transcription of its own remaining questions. Option
 * labels go in too: a dropdown's real wording is likely to be said out loud.
 */
export function keytermsFrom(specs: FieldSpec[], known: Record<string, string>): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined) => {
    const term = (raw ?? "").trim();
    if (!term || term.length < 2 || term.length > 60) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  // Proper nouns the person has already given us, one word at a time as well as whole.
  for (const value of Object.values(known)) {
    add(value);
    for (const word of value.split(/\s+/)) {
      if (/^[A-Z]/.test(word)) add(word);
    }
  }

  for (const spec of specs) {
    for (const option of spec.options ?? []) add(option.label);
  }

  // Trim to the documented limits rather than letting the request be rejected.
  const capped: string[] = [];
  let chars = 0;
  for (const term of terms) {
    if (capped.length >= MAX_KEYTERMS) break;
    if (chars + term.length > MAX_KEYTERMS_CHARS) break;
    capped.push(term);
    chars += term.length;
  }
  return capped;
}

/**
 * The config for one field's answer.
 *
 * `stt_prompt` describes the situation rather than instructing the model — that is what the docs
 * ask for, and it is applied before a single word is decoded. This is the sentence CLAUDE.md is
 * pointing at: *the first API you can tell what a field expects before it decides what the words
 * mean.*
 */
export function configForField(
  spec: FieldSpec,
  options: {
    specs?: FieldSpec[];
    known?: Record<string, string>;
    languageCodes?: string[];
    sampleRate?: number;
  } = {},
): DictationConfig {
  const { specs = [], known = {}, languageCodes = ["en", "hi"], sampleRate = 24000 } = options;
  const question = fieldName(spec);

  const config: DictationConfig = {
    sample_rate: sampleRate,
    channels: 1,
    language_codes: languageCodes,
    stt_prompt: clip(
      `Someone is filling in a form and speaking their answer to the question "${question}" out loud, in their own words, the way they would tell a friend. They may pause, restart, or switch between English and Hindi mid-sentence.`,
      MAX_STT_PROMPT,
    ),
    llm_instruction: clip(instructionForField(spec), MAX_INSTRUCTION),
  };

  const keyterms = keytermsFrom(specs, known);
  if (keyterms.length > 0) config.keyterms_prompt = keyterms;

  return config;
}

/**
 * What the rewrite should do.
 *
 * Deliberately conservative, and the three refusals are the important part: it may not add,
 * answer, or improve. A form is not the place to discover that a model has made you sound more
 * certain than you were — and the hedge is often the honest part of the sentence.
 */
export function instructionForField(spec: FieldSpec): string {
  const question = fieldName(spec);
  const parts = [
    `This is somebody's spoken answer to "${question}" on a form.`,
    "Write it as the person would have typed it: remove filler words and false starts, resolve self-corrections to what they landed on, and punctuate it properly.",
    "Keep their own words, their own phrasing and their own tone.",
    "Keep hedges like I think or probably — those change the meaning and are not filler.",
    "Do not add anything they did not say. Do not answer the question for them. Do not make them sound more certain, more formal or more impressive than they were.",
    "Return only the answer itself, with no preamble and no quotation marks.",
  ];

  if (spec.maxLength) {
    parts.push(`It must fit in ${spec.maxLength} characters.`);
  }

  return parts.join(" ");
}

/**
 * Which answers are worth a second call.
 *
 * Only the long ones. A name or an email is already right, and spending a network round trip —
 * and a slice of the rate limit — to re-transcribe "Rohit" would be absurd. The cap is the last
 * line of defence for the rate limit.
 */
export function fieldsWorthShaping(
  specs: FieldSpec[],
  filledIds: Iterable<string>,
  limit = MAX_CALLS_PER_UTTERANCE,
): FieldSpec[] {
  const filled = new Set(filledIds);
  return specs
    .filter((spec) => spec.longForm && filled.has(spec.id) && !spec.suspectedHoneypot)
    .slice(0, limit);
}

/**
 * Turn a response into the two versions we keep.
 *
 * ⚠️ `llm_response` being null is **not** an error, and the response that carries it is a 200.
 * The rewrite has a five-second deadline; missing it returns the transcription intact and
 * `llm_error` set. Treating that as a failure would throw away a perfectly good transcript.
 */
export function shapeResult(fieldId: string, result: DictationResult): ShapedAnswer {
  const verbatim = (result.text ?? "").trim();
  const rewrite = (result.llm_response ?? "").trim();

  if (rewrite) {
    return { fieldId, verbatim, clean: rewrite, rewritten: true };
  }

  return {
    fieldId,
    verbatim,
    clean: verbatim,
    rewritten: false,
    note: result.llm_error
      ? `The tidy-up did not finish (${result.llm_error}), so this is exactly what you said.`
      : "The tidy-up did not run, so this is exactly what you said.",
  };
}
