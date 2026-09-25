/**
 * What each field means, scored against the verified truth: concept, subject, scope. Pure.
 *
 * One number is a hard gate: a field that is somebody else's — an emergency contact's phone, a
 * co-owner's email — read with high confidence as the person's own. That is the confusion that
 * puts a person's own answer in their stand-in's box, and no baseline makes it acceptable.
 */

import type { TruthField } from "./types";

export type ReadMeaning = { concept: string; subject: string; scope: string; confidence: string };

export type MeaningCounts = {
  fields: number;
  /** Fields a meaning was given for at all. */
  given: number;
  conceptRight: number;
  subjectRight: number;
  scopeRight: number;
  /** Someone else's (or an organisation's) field read as the person's own, at high confidence. */
  dangerous: number;
};

export type MeaningRow = { key: string; question: string; specId: string | null; problems: string[] };

/** `best[i]` is the spec id joined to `fields[i]` (see `joinTruth`); `meanings` is by spec id. */
export function scoreMeaning(fields: TruthField[], best: (string | null)[], meanings: Record<string, ReadMeaning>) {
  const counts: MeaningCounts = { fields: 0, given: 0, conceptRight: 0, subjectRight: 0, scopeRight: 0, dangerous: 0 };
  const rows: MeaningRow[] = [];
  fields.forEach((field, i) => {
    if (field.honeypot || !field.concept) return;
    counts.fields++;
    const specId = best[i] ?? null;
    const meaning = specId ? meanings[specId] : undefined;
    const problems: string[] = [];
    if (!meaning) {
      problems.push(specId ? "no meaning given" : "not read");
    } else {
      counts.given++;
      if (meaning.concept === field.concept) counts.conceptRight++;
      else problems.push(`concept ${meaning.concept}, is ${field.concept}`);
      if (meaning.subject === field.subject) counts.subjectRight++;
      else problems.push(`subject ${meaning.subject}, is ${field.subject}`);
      if (meaning.scope === field.scope) counts.scopeRight++;
      else problems.push(`scope ${meaning.scope}, is ${field.scope}`);
      if (field.subject !== "self" && field.subject !== "none" && meaning.subject === "self" && meaning.confidence === "high") {
        counts.dangerous++;
        problems.push("DANGEROUS: someone else's field read as theirs, with high confidence");
      }
    }
    rows.push({ key: field.key, question: field.question, specId, problems });
  });
  return { counts, rows };
}
