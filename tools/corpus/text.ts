/**
 * How a question is compared, so the seed and the scorers agree on it. Only the page's own
 * required markers are stripped — the asterisk, "(required)", Google Forms' "Required question" —
 * never the words of the question itself.
 */

/** "Email*", "Email Required question", "Email (required)" are all the question "Email". */
export function cleanQuestion(raw: string): string {
  return raw
    .replace(/\s*\((required|optional)\)\s*$/i, "")
    .replace(/\s*required question\s*$/i, "")
    .replace(/[\s*✱]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The form a label is compared in: cleaned, case-folded, trailing colon gone. */
export function comparable(raw: string): string {
  return cleanQuestion(raw.normalize("NFKC")).replace(/[\s:]+$/, "").toLowerCase();
}

export function words(raw: string): string[] {
  return comparable(raw).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Token F1 between two labels: 1 when they say the same words, 0 when they share none. */
export function tokenF1(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const word of right) pool.set(word, (pool.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of left) {
    const count = pool.get(word) ?? 0;
    if (count > 0) {
      shared++;
      pool.set(word, count - 1);
    }
  }
  if (shared === 0) return 0;
  const precision = shared / left.length;
  const recall = shared / right.length;
  return (2 * precision * recall) / (precision + recall);
}

/** Set F1 between two lists of choices, compared as labels. */
export function setF1(found: string[], truth: string[]): number {
  const a = new Set(found.map(comparable));
  const b = new Set(truth.map(comparable));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const label of a) if (b.has(label)) shared++;
  if (shared === 0) return 0;
  const precision = shared / a.size;
  const recall = shared / b.size;
  return (2 * precision * recall) / (precision + recall);
}
