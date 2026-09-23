import { expect, test as teardown } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { report } from "../../tools/corpus/report";
import { CORPUS, RESULTS } from "./load";

/**
 * After every corpus run, whatever passed or failed: the numbers, next to the baseline. Fails when
 * any form got worse. `CORPUS_UPDATE_BASELINE=1` moves the baseline to this run if nothing got worse
 * (`=accept-worse` when a truth correction lowers a number on purpose);
 * `CORPUS_REPORT_DETAILS=off` leaves out the field-by-field list.
 */
teardown("report", () => {
  const { markdown, failures } = report({
    results: RESULTS,
    corpus: CORPUS,
    update: { "1": "better" as const, "accept-worse": "accept-worse" as const }[process.env.CORPUS_UPDATE_BASELINE ?? ""] ?? false,
    // CI logs of a public repo are public: numbers and form ids only, never a page's own words.
    details: process.env.CORPUS_REPORT_DETAILS !== "off",
  });
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "report.md"), markdown + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  console.log(`\n${markdown}\n`);
  expect(failures, "the corpus got worse").toEqual([]);
});
