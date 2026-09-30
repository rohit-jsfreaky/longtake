/**
 * Why an answer did not go in, in words a person can act on.
 *
 * Said aloud too, but a spoken sentence is gone the moment it ends. Live, "why do you want to work
 * at Discord?" was answered, the agent said "got it", and nothing on screen showed that it had not
 * gone in. So every reason a tool result gives (`summarise` in conversation.ts) has a line here, and
 * the line stays on screen until the field has something in it.
 */

import type { NotFilledReason } from "./conversation";

export const WHY: Record<Exclude<NotFilledReason, "gone">, string> = {
  not_an_option: "that isn't one of its choices",
  quote_not_found: "Longtake couldn't match it to what you said",
  page_refused: "the page didn't keep it",
  page_refused_twice: "the page won't take it — type it yourself",
  needs_the_person: "only you can do this one",
  // The agent sent it without any of the person's words — not a hearing problem.
  not_heard: "Longtake had none of your words for it",
  incomplete: "only part of it was heard, say the whole number",
};

export type Missed = { fieldId: string; question: string; why: string };

/** The not-filled items of one tool result, as notices. `gone` is not one: that field left the form. */
export function missesIn(result: unknown): Missed[] {
  const notFilled = (result as { not_filled?: { field: string; question: string; why: string }[] } | null)?.not_filled;
  if (!Array.isArray(notFilled)) return [];
  return notFilled
    .filter((item) => item.why !== "gone")
    .map((item) => ({
      fieldId: item.field,
      question: item.question,
      why: WHY[item.why as keyof typeof WHY] ?? item.why.replace(/_/g, " "),
    }));
}
