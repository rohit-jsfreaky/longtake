/**
 * Cutting one answer's few seconds out of a long take.
 *
 * Live complaint: "I say my name, my job, where I'm from in one go — then I click my name and it
 * plays everything I said." The Voice Agent API gives no word timings, so the running transcript
 * is the clock: a word was spoken after the last delta that lacked it and before the first that
 * had it. These build that timeline by hand and check the cut lands on the right words.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const RATE = 24000;
const at = (seconds: number) => Math.round(seconds * RATE);

/** One long take, as its deltas arrived: name by ~2s, city by ~5s, email by ~8s. */
const LONG_TAKE = [
  { text: "my name", sample: at(0.8) },
  { text: "my name is Rohit", sample: at(1.4) },
  { text: "my name is Rohit Kashyap", sample: at(2.0) },
  { text: "my name is Rohit Kashyap and I live", sample: at(3.2) },
  { text: "my name is Rohit Kashyap and I live in Kolkata", sample: at(4.6) },
  { text: "my name is Rohit Kashyap and I live in Kolkata and my email", sample: at(6.4) },
  { text: "my name is Rohit Kashyap and I live in Kolkata and my email is rohit at example dot com", sample: at(8.2) },
];
const TOTAL = at(9.5);

async function clip(page: Page, quote: string, timeline = LONG_TAKE, total = TOTAL) {
  await load(page, "<p>no form</p>");
  return page.evaluate(([q, t, n]) => window.__longtake.clipFor(q as string, t as never, n as number), [quote, timeline, total] as const);
}

const seconds = (samples: number) => samples / RATE;

test("the name's clip is the name — not the city, not the email", async ({ page }) => {
  const c = await clip(page, "my name is Rohit Kashyap");
  expect(c).not.toBeNull();
  expect(seconds(c!.start)).toBeLessThan(1.4);
  expect(seconds(c!.end)).toBeLessThan(3); // over well before "Kolkata" at 4.6s
});

/**
 * It may begin a little before "and I live" — transcription lags speech by up to ~0.6s, so the
 * honest lower bound is the delta before the word, minus that lag. It must not reach back to the
 * start of the name, and it must be over before the email begins.
 */
test("the city's clip starts after the name began and ends before the email", async ({ page }) => {
  const c = await clip(page, "I live in Kolkata");
  expect(c).not.toBeNull();
  expect(seconds(c!.start)).toBeGreaterThan(1.2);
  expect(seconds(c!.end)).toBeLessThan(6.4);
});

test("the email's clip is at the end of the take", async ({ page }) => {
  const c = await clip(page, "my email is rohit at example dot com");
  expect(c).not.toBeNull();
  expect(seconds(c!.start)).toBeGreaterThan(3.5); // after the city, allowing for the lag
  expect(c!.end).toBeLessThanOrEqual(TOTAL);
});

test("a clip is always far shorter than the whole take", async ({ page }) => {
  for (const quote of ["my name is Rohit Kashyap", "I live in Kolkata"]) {
    const c = await clip(page, quote);
    expect(seconds(c!.end - c!.start), quote).toBeLessThan(4);
  }
});

test("words that were never said cannot be placed", async ({ page }) => {
  expect(await clip(page, "I work at Glean")).toBeNull();
});

test("a one-word answer like 'yes' is placed by the word itself", async ({ page }) => {
  const c = await clip(page, "yes", [
    { text: "yes", sample: at(0.9) },
    { text: "yes that one", sample: at(1.6) },
  ], at(2.2));
  expect(c).not.toBeNull();
});

test("a clip never runs past the recording or before its start", async ({ page }) => {
  const c = await clip(page, "Rohit", [{ text: "Rohit", sample: at(0.2) }], at(0.9));
  expect(c!.start).toBeGreaterThanOrEqual(0);
  expect(c!.end).toBeLessThanOrEqual(at(0.9));
});
