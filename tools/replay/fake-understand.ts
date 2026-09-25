/**
 * A stand-in for the model that says what each field means — for tests of what happens once the
 * meanings are known: answers from last time, learning, "update it for next time?".
 *
 * It reads each question the offline way (`canonicalKey`, the first memory's keys) and is certain
 * of every answer, which the real model is not. Never used to score meaning itself: that is
 * `tests/corpus/meaning.spec.ts`, against the real model's recorded answers.
 */

// Relative imports, not the package: the extension tests run this in Node, outside any bundle.
import { LEGACY_KEY_TO_CONCEPT } from "../../core/src/concepts";
import { canonicalKey } from "../../core/src/memory";
import type { FieldKind } from "../../core/src/types";
import type { FormSnapshot } from "../../core/src/understand";

type Say = { concept?: string; subject?: string; confidence?: string; part?: string };

export function fakeUnderstanding(overrides: Record<string, Say> = {}) {
  const calls: FormSnapshot[] = [];
  const understand = async (snapshot: FormSnapshot) => {
    calls.push(snapshot);
    return {
      fields: snapshot.fields.map((field) => {
        const key = canonicalKey({
          id: field.id,
          label: field.question,
          kind: field.kind as FieldKind,
          required: field.required,
          ...(field.section ? { section: field.section } : {}),
        });
        const concept = (key && LEGACY_KEY_TO_CONCEPT[key]) || "other";
        return { id: field.id, concept, subject: "self", gist: field.question, confidence: "high", ...overrides[field.id] };
      }),
    };
  };
  return Object.assign(understand, { calls });
}
