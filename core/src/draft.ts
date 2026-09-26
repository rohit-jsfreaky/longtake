/**
 * A long answer, drafted from the person's own words — and held to them in code.
 *
 * "Why do you want to work at Glean?" is the question nobody can answer in one breath, and the one
 * a form's owner reads most closely. The person says their points, in any order and any language;
 * a model writes a few clean sentences; the agent reads them back word for word; nothing goes in
 * without their yes.
 *
 * ## No invention, enforced here
 *
 * The model is asked to cite, for every sentence, the words it stands on. `verifyDraft` then keeps
 * only what can be checked:
 *   - every sentence cites at least one of their words (`said`) or a saved answer (`fact`) — the
 *     page (`page`) may be cited for the company's name or what the role asks, never on its own;
 *   - every quote is really in the source it names (`checkEvidence`, the same check as a fill);
 *   - every number, email and link in the sentence is in what it cites;
 * A sentence that fails is dropped and reported, never repaired by code. A name that appears nowhere
 * in any source — not their words, not their answers, not the page — is flagged for them to see.
 *
 * Pure: the model is a service (`/api/draft`); this builds its prompt and judges its answer.
 */

import { checkEvidence } from "./evidence";

export type DraftInput = {
  /** The form's question, word for word. */
  question: string;
  /** What the form allows, when it says (a character limit). */
  maxChars?: number;
  /** What the page says around the form: who is asking (page-context.ts). Context, not evidence. */
  page: { title: string; text: string };
  /** Their own words for this answer, each as they said it. */
  said: string[];
  /** Saved answers chosen on the device that bear on it ("current employer: Acme"). */
  facts: { name: string; value: string }[];
  /** Revising: the draft they heard, and what they asked to change, in their words. */
  prior?: string;
  change?: string;
};

export type Support = { source: "said" | "fact" | "page"; ref: number; quote: string };
export type DraftSentence = { text: string; supports: Support[] };

export type VerifiedDraft = {
  /** The answer, as it would go in: the sentences that passed, in order. */
  text: string;
  sentences: DraftSentence[];
  /** Sentences that did not stand on their words, and why. */
  dropped: { text: string; why: string }[];
  /** Names in the draft found in no source at all — shown, for them to check. */
  flagged: string[];
  /** What the question asks for that they did not say, as the model saw it. */
  missing: string[];
};

const SOURCES = new Set(["said", "fact", "page"]);
const PAGE_CAP = 2500;

/** JSON only: the account's model rejects a response format; the gateway repairs, code checks. */
export function draftPrompt(input: DraftInput): { system: string; user: string } {
  const system = [
    "You write one short answer to a question on a web form, for the person filling it in, in the first person, from what they said. Answer with JSON only, no prose.",
    'Shape: {"sentences":[{"text":"…","supports":[{"source":"said","ref":0,"quote":"…"}]}],"missing":["…"]}',
    "- Every sentence stands on their own words: cite at least one quote from said (by its index in ref) or from facts, copied exactly as it appears there — in their language, even if you write in another.",
    "- page is what the page says: who is asking, what the role is. You may name the company or echo what it asks for, citing page — but never say anything about the person that they did not say.",
    "- Never add a number, date, name, place, link, employer, skill or achievement they did not say.",
    "- Keep their meaning, tidy the grammar. Two to five sentences, plain and specific. No clichés (\"I am passionate\", \"fast-paced environment\", \"I believe I would be a great fit\").",
    "- Write in the language the question is written in.",
    "- If the question clearly asks for something they did not say, leave it out and name it in missing.",
    "- Revising: prior is the draft they heard and change is what they asked to change. Change that, keep the rest.",
    ...(input.maxChars ? [`- The whole answer must be under ${input.maxChars} characters.`] : []),
  ].join("\n");
  const user = JSON.stringify({
    question: input.question,
    said: input.said,
    facts: input.facts,
    page: { title: input.page.title, text: input.page.text.slice(0, PAGE_CAP) },
    ...(input.prior ? { prior: input.prior } : {}),
    ...(input.change ? { change: input.change } : {}),
  });
  return { system, user };
}

// ── The checks ────────────────────────────────────────────────────────────────────────

/** Digits, emails and links: the facts a sentence may carry only if a cited source has them. */
const EXACT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|org|net|io|dev|ai|in|co|app)\b\S*|\d[\d,.]*/gi;
/** A capitalised word that is not the first of its sentence: a name, a place, a company. */
const NAME = /(?<=[^.!?]\s)[A-Z][\p{L}'’-]+/gu;

const flat = (text: string) => text.toLowerCase().replace(/[\s,]+/g, "");

/**
 * Numbers written as words. A digit check alone let "five years" through when they said "3 saal":
 * the model writes numbers as words as often as digits. A closed set, English, as drafts are written
 * in the form's language; a number word in a sentence must be in what it cites, as the word or as
 * its digits. (Not "one", "first", "second": ordinary words far more often than numbers.) A source that says it in another language ("teen saal") drops the sentence — a loss,
 * never an invention.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  third: 3, fourth: 4, fifth: 5, dozen: 12,
};
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");

/** The number words in a sentence that the sources it cites do not carry, as words or as digits. */
function unbackedNumberWords(text: string, cited: string): string[] {
  const sourceWords = new Set(cited.toLowerCase().match(NUMBER_WORD) ?? []);
  const sourceDigits = new Set((cited.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  return (text.match(NUMBER_WORD) ?? []).filter((word) => {
    const w = word.toLowerCase();
    return !sourceWords.has(w) && !sourceDigits.has(NUMBER_WORDS[w]!);
  });
}
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");

function sourceText(input: DraftInput, support: Support): string | null {
  if (support.source === "said") return input.said[support.ref] ?? null;
  if (support.source === "fact") {
    const fact = input.facts[support.ref];
    return fact ? `${fact.name}: ${fact.value}` : null;
  }
  return `${input.page.title}\n${input.page.text}`;
}

/**
 * The model's answer, held to their words. Anything malformed is dropped, not guessed at; an answer
 * that is not the expected shape is an empty draft.
 */
export function verifyDraft(raw: unknown, input: DraftInput): VerifiedDraft {
  const body = (raw && typeof raw === "object" ? raw : {}) as { sentences?: unknown; missing?: unknown };
  const list = Array.isArray(body.sentences) ? body.sentences : [];
  const missing = Array.isArray(body.missing) ? body.missing.filter((m): m is string => typeof m === "string").map((m) => m.slice(0, 120)) : [];
  const everything = words([input.question, input.page.title, input.page.text, ...input.said, ...input.facts.map((f) => `${f.name} ${f.value}`)].join(" "));

  const kept: DraftSentence[] = [];
  const dropped: VerifiedDraft["dropped"] = [];
  const flagged = new Set<string>();

  for (const item of list as Record<string, unknown>[]) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    const supports: Support[] = [];
    for (const s of Array.isArray(item?.supports) ? (item.supports as Record<string, unknown>[]) : []) {
      const source = typeof s?.source === "string" && SOURCES.has(s.source) ? (s.source as Support["source"]) : null;
      const ref = typeof s?.ref === "number" && Number.isInteger(s.ref) ? s.ref : source === "page" ? 0 : -1;
      const quote = typeof s?.quote === "string" ? s.quote.trim() : "";
      if (!source || ref < 0 || !quote) continue;
      const from = sourceText(input, { source, ref, quote });
      if (from === null || !checkEvidence(from, quote).ok) continue;
      supports.push({ source, ref, quote });
    }

    const theirs = supports.filter((s) => s.source !== "page");
    if (theirs.length === 0) {
      dropped.push({ text, why: supports.length > 0 ? "only the page says this, not them" : "none of their words behind it" });
      continue;
    }
    const cited = flat(supports.map((s) => sourceText(input, s) ?? "").join(" "));
    const citedText = supports.map((s) => sourceText(input, s) ?? "").join(" ");
    const unbacked = [
      ...(text.match(EXACT) ?? []).filter((token) => !cited.includes(flat(token).replace(/[.,]+$/, ""))),
      ...unbackedNumberWords(text, citedText),
    ];
    if (unbacked.length > 0) {
      dropped.push({ text, why: `"${unbacked[0]}" is not in what they said` });
      continue;
    }
    // "I", "I've": the first person, capitalised by rule, is nobody's name.
    for (const name of text.match(NAME) ?? []) if (!/^I(['’]|$)/.test(name) && !everything.includes(words(name).trim())) flagged.add(name);
    kept.push({ text, supports });
  }

  // Within the form's limit, by whole sentences from the end.
  let answer = kept;
  if (input.maxChars) {
    while (answer.length > 0 && answer.map((s) => s.text).join(" ").length > input.maxChars) {
      const last = answer[answer.length - 1]!;
      dropped.push({ text: last.text, why: "over the form's length limit" });
      answer = answer.slice(0, -1);
    }
  }
  return { text: answer.map((s) => s.text).join(" "), sentences: answer, dropped, flagged: [...flagged], missing };
}

/**
 * How closely what the agent read out matches the draft, 0 to 1: the share of the draft's words it
 * said, in order (longest common subsequence). Below `READ_BACK_MIN` it paraphrased — and the person
 * approved words they never heard.
 */
export const READ_BACK_MIN = 0.85;

export function readBack(draft: string, spoken: string): number {
  const a = words(draft).split(" ").filter(Boolean);
  const b = words(spoken).split(" ").filter(Boolean);
  if (a.length === 0) return 1;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    prev = row;
  }
  return prev[b.length]! / a.length;
}
