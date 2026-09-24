/**
 * The corpus scorers and the report, on made-up numbers — so they are trusted before they judge
 * anything, and run everywhere, with or without the private corpus.
 */

import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { report } from "../tools/corpus/report";
import { scoreRead, type ReadSpec } from "../tools/corpus/score";
import { closest } from "../tools/corpus/replay-har";
import { tokenF1 } from "../tools/corpus/text";
import type { TruthField } from "../tools/corpus/types";

const truth = (key: string, question: string, extra: Partial<TruthField> = {}): TruthField => ({
  key,
  locator: { frames: [], path: [`#${key}`] },
  question,
  axName: question,
  axRole: "textbox",
  kind: "text",
  required: false,
  concept: "",
  subject: "self",
  scope: "remember",
  longForm: false,
  honeypot: false,
  ...extra,
});
const spec = (id: string, label: string, extra: Partial<ReadSpec> = {}): ReadSpec => ({ id, label, kind: "text", required: false, ...extra });

test.describe("reading, scored", () => {
  test("a field read twice is counted as asked twice, not as a second field", () => {
    const fields = [truth("f01", "Gender", { kind: "radio", options: { labels: ["Male", "Female"], complete: true, searchable: false, multi: false } })];
    const specs = [spec("gender", "Gender", { kind: "radio" }), spec("q40", "q40", { kind: "radio", options: [{ label: "Male" }, { label: "Female" }] })];
    const { counts, extras } = scoreRead(fields, specs, { best: ["gender"], touches: { gender: [0], q40: [0] } });
    expect(counts.duplicates).toBe(1);
    expect(counts.extras).toBe(0);
    expect(extras).toEqual([{ id: "q40", label: "q40", duplicateOf: "gender" }]);
    // The reading that won has no choices: the agent is left with nothing to pick from.
    expect(counts.optionsF1).toBe(0);
  });

  test("a spec that touches no truth field is not a field", () => {
    const { counts } = scoreRead([truth("f01", "Name")], [spec("name", "Name"), spec("help", "help and feedback")], {
      best: ["name"],
      touches: { name: [0], help: [] },
    });
    expect(counts.extras).toBe(1);
    expect(counts.duplicates).toBe(0);
  });

  test("a honeypot that became a spec is a leak, and does not count as a field", () => {
    const { counts } = scoreRead([truth("f01", "Name"), truth("f02", "Website", { honeypot: true })], [spec("name", "Name"), spec("website", "Website")], {
      best: ["name", "website"],
      touches: { name: [0], website: [1] },
    });
    expect(counts.honeypotLeaks).toBe(1);
    expect(counts.fields).toBe(1);
  });

  test("a required group read as optional is a missed requirement", () => {
    const fields = [truth("f01", "Industry", { kind: "multiselect", required: true })];
    const { counts, rows } = scoreRead(fields, [spec("industry", "Industry", { kind: "multiselect" })], {
      best: ["industry"],
      touches: { industry: [0] },
    });
    expect(counts.requiredFN).toBe(1);
    expect(rows[0]!.problems).toContain("required, read as optional");
  });

  test("labels compare without the page's required markers", () => {
    const { counts } = scoreRead([truth("f01", "Email")], [spec("email", "Email*")], { best: ["email"], touches: { email: [0] } });
    expect(counts.labelExact).toBe(1);
    // email · example · example · com against email: 1 of 4 words right, all of the truth found.
    expect(tokenF1("Email* example@example.com", "Email")).toBeCloseTo(0.4);
  });

  test("a long list core answers by typing is right when it also read every choice", () => {
    const options = { labels: ["India +91", "Nepal +977"], complete: true, searchable: false, multi: false };
    const read = spec("country", "Country", { kind: "select", searchable: true, options: [{ label: "India +91" }, { label: "Nepal +977" }] });
    const { counts } = scoreRead([truth("f01", "Country", { kind: "select", options })], [read], { best: ["country"], touches: { country: [0] } });
    expect(counts.searchableRight).toBe(1);
  });
});

test.describe("the report", () => {
  const counts = { fields: 10, found: 10, specs: 10, duplicates: 0, extras: 0, honeypotLeaks: 0, labelExact: 9, labelF1: 9.5, kindRight: 10, requiredTP: 4, requiredFP: 0, requiredFN: 0, choiceFields: 2, optionsF1: 2, searchableRight: 2, ambiguous: 0 };

  function run(forms: Record<string, Partial<typeof counts>>, update: boolean | "accept-worse" = false, baselineDir?: string, checkedBy: Record<string, string[]> = {}) {
    const results = mkdtempSync(join(tmpdir(), "longtake-results-"));
    const corpus = baselineDir ?? mkdtempSync(join(tmpdir(), "longtake-corpus-"));
    mkdirSync(join(results, "read"), { recursive: true });
    for (const [id, changes] of Object.entries(forms)) {
      writeFileSync(join(results, "read", `${id}.json`), JSON.stringify({ id, at: "", counts: { ...counts, ...changes }, rows: [], extras: [], checkedBy: checkedBy[id] }));
    }
    return { ...report({ results, corpus, update: update === true ? "better" : update }), corpus };
  }

  test("a form whose answer key no person checked is marked, and the mark is explained once", () => {
    const { markdown } = run({ a: {}, b: {}, c: {} }, false, undefined, {
      a: ["claude (for rohit-jsfreaky)"],
      b: ["rohit-jsfreaky"],
      c: ["claude (for rohit-jsfreaky)"],
    });
    expect(markdown).toContain("| a † |");
    expect(markdown).toContain("| b |");
    expect(markdown.split("checked by Claude, not by a person")).toHaveLength(2);
  });

  test("with no baseline, nothing can have got worse", () => {
    expect(run({ a: {} }).failures).toEqual([]);
  });

  test("a form that got worse fails, and says which number and by how much", () => {
    const { corpus } = run({ a: {} }, true);
    const { failures, markdown } = run({ a: { found: 9 } }, false, corpus);
    expect(failures).toEqual(["a: Found got worse — 90.0% ▼-10.0"]);
    expect(markdown).toContain("90.0% ▼-10.0");
  });

  test("a form that got better passes, and shows it", () => {
    const { corpus } = run({ a: { labelExact: 8 } }, true);
    const { failures, markdown } = run({ a: { labelExact: 9 } }, false, corpus);
    expect(failures).toEqual([]);
    expect(markdown).toContain("90.0% ▲+10.0");
  });

  test("a form in the baseline with no result this run fails", () => {
    const { corpus } = run({ a: {}, b: {} }, true);
    expect(run({ a: {} }, false, corpus).failures).toEqual(["b: in the reading baseline, but no result this run"]);
  });

  test("a honeypot leak fails even when the baseline already had it", () => {
    const { corpus } = run({ a: { honeypotLeaks: 1 } }, true);
    expect(run({ a: { honeypotLeaks: 1 } }, false, corpus).failures).toEqual(["a: Honeypot leaks is 1, must be 0"]);
  });

  test("a run that got worse cannot move the baseline — not even where it looks better", () => {
    // Losing a whole group loses its mistakes too: fewer duplicates, fewer found.
    const { corpus } = run({ a: { duplicates: 3 } }, true);
    const { failures, markdown } = run({ a: { duplicates: 0, found: 8 } }, true, corpus);
    expect(failures).toEqual(["a: Found got worse — 80.0% ▼-20.0"]);
    expect(markdown).toContain("Baseline NOT moved");
    expect(markdown).not.toContain("Lock them in");
    expect(JSON.parse(readFileSync(join(corpus, "baseline.json"), "utf8")).read.a.found).toBe(1);
  });

  test("accept-worse moves it anyway, for a corrected truth", () => {
    const { corpus } = run({ a: {} }, true);
    const { failures } = run({ a: { found: 8 } }, "accept-worse", corpus);
    expect(failures).toEqual([]);
    expect(JSON.parse(readFileSync(join(corpus, "baseline.json"), "utf8")).read.a.found).toBe(0.8);
  });

  test("updating writes the baseline per form and in total", () => {
    const { corpus } = run({ a: {}, b: { found: 5 } }, true);
    const baseline = JSON.parse(readFileSync(join(corpus, "baseline.json"), "utf8"));
    expect(baseline.read.a.found).toBe(1);
    expect(baseline.read.b.found).toBe(0.5);
    expect(baseline.read.__total__.found).toBe(0.75);
  });
});

test.describe("replaying a recording", () => {
  const recorded = (rest: string, size: number) =>
    ({ rest, full: size > 0, entry: { request: { method: "GET", url: "" }, response: { status: 200, headers: [], content: { size } } } }) as Parameters<typeof closest>[0][number];

  test("an exact match is served", () => {
    const pick = closest([recorded("?v=1 ", 10), recorded("?v=2 ", 10)], "?v=2 ");
    expect(pick.rest).toBe("?v=2 ");
  });

  test("a prefetch's empty recording loses to the full one of the same URL", () => {
    // Chrome never hands over a prefetch's body: Workable left 26 empty copies beside the real ones.
    const pick = closest([recorded(" ", 0), recorded(" ", 23214)], " ");
    expect(pick.full).toBe(true);
  });

  test("a fresh cache-buster is answered by the closest recording", () => {
    const pick = closest([recorded("?other=1 ", 5), recorded("?cache-bust=1790266202361 ", 487907)], "?cache-bust=1790266308243 ");
    expect(pick.rest).toBe("?cache-bust=1790266202361 ");
  });

  test("an empty recording is still served when it is the only one", () => {
    expect(closest([recorded(" ", 0)], " ").full).toBe(false);
  });
});
