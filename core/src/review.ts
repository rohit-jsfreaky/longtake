/**
 * The review list: everything on the form a person should look at before they send it, grouped the
 * way they would work through it — and the badges that mark the same things on the page. One reading
 * of the form (`FormState`) and of what the call noticed (answers that did not go in, answers worth
 * another look) makes both, so the list and the page can never disagree.
 *
 * Pure.
 */

import type { FormState } from "./form-state";
import type { Hesitation } from "./hesitation";
import type { Missed } from "./notices";
import type { Badge } from "./overlay";
import { fieldName } from "./types";

export type ReviewKind = "waiting" | "not_in" | "memory" | "drafted" | "spoken" | "typed" | "theirs";

export type ReviewItem = { fieldId?: string; question: string; detail: string };
export type ReviewGroup = { kind: ReviewKind; title: string; items: ReviewItem[] };

const TITLES: Record<ReviewKind, string> = {
  waiting: "Waiting for your yes",
  not_in: "Said, but not in",
  memory: "From your last form",
  drafted: "Drafted from your words",
  spoken: "Spoken",
  typed: "Typed by you",
  theirs: "Yours to do",
};

const quote = (text: string, max = 70) => (text.length > max ? `“${text.slice(0, max)}…”` : `“${text}”`);

/**
 * Where an answer from their last form came from, in words. Not their quote: an answer they said
 * yes to carries "<the saved answer> — <their yes>" as its evidence, and shown as "you said …" that
 * read as nonsense ("you said “63997883500 — the all the other things are right”").
 */
const fromLastTime = (field: FormState["fields"][number]) =>
  field.recalled && !field.recalled.sure ? "from your last form — you said yes" : "from your last form";

/** The groups, in the order a person should work through them. Empty groups are left out. */
export function reviewList(form: FormState, missed: Missed[] = []): ReviewGroup[] {
  const groups: Record<ReviewKind, ReviewItem[]> = { waiting: [], not_in: [], memory: [], drafted: [], spoken: [], typed: [], theirs: [] };
  const missing = new Map(missed.map((m) => [m.fieldId, m]));

  for (const field of form.fields) {
    const question = fieldName(field.spec);
    const fieldId = field.spec.id;
    if (field.pending?.reason === "draft") {
      groups.waiting.push({ fieldId, question, detail: `a draft from your words: ${quote(field.pending.suggestion)}` });
    } else if (field.pending) {
      groups.waiting.push({ fieldId, question, detail: `${field.pending.suggestion} — you said ${quote(field.pending.heard)}` });
    } else if (field.value === null && (missing.has(fieldId) || field.claimedIn)) {
      groups.not_in.push({ fieldId, question, detail: missing.get(fieldId)?.why ?? "the agent said it went in, but it did not" });
    } else if (field.source === "memory") {
      groups.memory.push({ fieldId, question, detail: fromLastTime(field) });
    } else if (field.source === "drafted") {
      groups.drafted.push({ fieldId, question, detail: "written from what you said — read it once more before you send" });
    } else if (field.source === "spoken") {
      groups.spoken.push({ fieldId, question, detail: field.evidence ? `you said ${quote(field.evidence)}` : "" });
    } else if (field.source === "typed") {
      groups.typed.push({ fieldId, question, detail: "typed by you" });
    }
  }
  for (const item of form.theirs) groups.theirs.push({ question: item, detail: "a file or a signature — only you can add it" });

  return (Object.keys(groups) as ReviewKind[])
    .filter((kind) => groups[kind].length > 0)
    .map((kind) => ({ kind, title: TITLES[kind], items: groups[kind] }));
}

/** A badge for every field that has something to say — the same reading as the list. */
export function badgesFor(form: FormState, missed: Missed[] = [], hesitations: Record<string, Hesitation> = {}): Badge[] {
  const missing = new Map(missed.map((m) => [m.fieldId, m]));
  const badges: Badge[] = [];
  for (const field of form.fields) {
    const fieldId = field.spec.id;
    if (field.pending?.reason === "draft") {
      badges.push({ fieldId, state: "waiting", detail: "A draft from your words is waiting for your yes." });
    } else if (field.pending) {
      badges.push({ fieldId, state: "waiting", detail: `${field.pending.suggestion}? You said ${quote(field.pending.heard)}.` });
    } else if (field.value === null && (missing.has(fieldId) || field.claimedIn)) {
      badges.push({ fieldId, state: "not_in", detail: `Not in: ${missing.get(fieldId)?.why ?? "the agent said it went in, but it did not"}.` });
    } else if (hesitations[fieldId]?.worthAnotherLook && field.value !== null) {
      badges.push({ fieldId, state: "look", detail: "Want another look at this one?" });
    } else if (field.source === "drafted") {
      badges.push({ fieldId, state: "drafted", detail: "Drafted from what you said, and you said yes." });
    } else if (field.source === "spoken") {
      badges.push({ fieldId, state: "spoken", detail: field.evidence ? `You said ${quote(field.evidence, 120)}.` : "You said it." });
    } else if (field.source === "memory") {
      const where = fromLastTime(field);
      badges.push({ fieldId, state: "memory", detail: `${where.charAt(0).toUpperCase()}${where.slice(1)}.` });
    } else if (field.source === "typed") {
      badges.push({ fieldId, state: "typed", detail: "Typed by you." });
    } else if (field.source === "page") {
      badges.push({ fieldId, state: "page", detail: "Already on the form when you started." });
    }
  }
  return badges;
}
