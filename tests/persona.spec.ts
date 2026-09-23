/**
 * The persona prompt — the invariants only.
 *
 * Whether the agent sounds like a person can only be judged by listening to it. What CAN be
 * pinned is the part that must never drift: who it is comes first, the submission ban is there,
 * the bot phrases are banned by name and not modelled anywhere in its own examples, nothing in it
 * would be read aloud as markup, and it has not quietly grown — AssemblyAI's guide is blunt that
 * a long prompt drowns its best rules.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

async function prompt(page: Page): Promise<{ text: string; banned: string[] }> {
  await load(page, "<p>no form needed</p>");
  return page.evaluate(() => {
    const L = window.__longtake;
    const brief = [
      "FORM NOW — Apply at https://example.com/apply: 0 of 2 answered.",
      "Still empty:",
      "  First Name [required]",
      "",
      "DO NEXT: Ask for First Name.",
    ].join("\n");
    return { text: L.systemPrompt(brief), banned: [...L.BANNED_PHRASES] };
  });
}

/** Everything the persona says about itself, without the brief of the form that follows it. */
// The last one: the persona itself mentions FORM NOW when it tells the agent to trust it.
const persona = (text: string) => text.slice(0, text.lastIndexOf("\nFORM NOW"));

test("who it is comes first", async ({ page }) => {
  const { text } = await prompt(page);
  expect(text.split("\n")[0]).toMatch(/^You're Longtake/);
});

/** Rule 5b. The one sentence this product must never say. */
test("it is told it never submits, near the top", async ({ page }) => {
  const { text } = await prompt(page);
  const firstLines = text.split("\n").slice(0, 3).join(" ");
  expect(firstLines).toContain("You never submit anything");
  expect(firstLines).toContain("submitted");
});

test("the bot phrases are banned by name", async ({ page }) => {
  const { text, banned } = await prompt(page);
  const line = text.split("\n").find((l) => l.startsWith("Never say:"))!;
  for (const phrase of banned) expect(line).toContain(`"${phrase}"`);
});

/** A model copies its examples. An example using a banned phrase teaches the phrase. */
test("no banned phrase appears anywhere else in it", async ({ page }) => {
  const { text, banned } = await prompt(page);
  const rest = persona(text)
    .split("\n")
    .filter((l) => !l.startsWith("Never say:"))
    .join("\n")
    .toLowerCase();
  for (const phrase of banned) expect(rest, phrase).not.toContain(phrase.toLowerCase());
});

test("it never calls the person sir or ma'am — it is told not to", async ({ page }) => {
  const { text } = await prompt(page);
  expect(text).toContain("Never call them sir or ma'am");
});

/** Anything the model writes is spoken, and it writes the way its prompt is written. */
test("no markdown in it", async ({ page }) => {
  const { text } = await prompt(page);
  const own = persona(text);
  expect(own).not.toMatch(/\*\*|^#|^\s*[-*•] /m);
});

test("it tells the agent every reason an answer can fail", async ({ page }) => {
  const { text } = await prompt(page);
  for (const why of [
    "not_an_option",
    "quote_not_found",
    "page_refused",
    "page_refused_twice",
    "not_heard",
    "gone",
  ]) {
    expect(text, why).toContain(why);
  }
});

/**
 * The plan lives in code now (planner.ts), not in the prompt. The prompt's job is to make the agent
 * trust the brief over its own memory of the conversation — which is where it kept going wrong.
 */
test("it is told to trust FORM NOW over its memory, and to follow DO NEXT", async ({ page }) => {
  const { text } = await prompt(page);
  expect(persona(text)).toContain("Trust it over your memory of the conversation");
  expect(persona(text)).toContain("DO NEXT is what to do next");
});

test("the form it is looking at is described at the end", async ({ page }) => {
  const { text } = await prompt(page);
  expect(text).toContain("https://example.com/apply");
  expect(text).toContain("First Name");
});

/** The old prompt was about 3,700 characters. Room to be a person, not room to sprawl. */
test("it stays short", async ({ page }) => {
  const { text } = await prompt(page);
  expect(persona(text).length).toBeLessThan(4600);
});
