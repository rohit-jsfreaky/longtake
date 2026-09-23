import { expect, test as teardown } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { report } from "../../tools/corpus/report";
import { CORPUS, RESULTS } from "./load";

/**
 * After every corpus run, whatever passed or failed: the numbers, next to the baseline. Fails when
 * any form got worse. `CORPUS_UPDATE_BASELINE=1` moves the baseline to this run instead.
 */
teardown("report", () => {
  const { markdown, failures } = report({ results: RESULTS, corpus: CORPUS, update: process.env.CORPUS_UPDATE_BASELINE === "1" });
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "report.md"), markdown + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  console.log(`\n${markdown}\n`);
  expect(failures, "the corpus got worse").toEqual([]);
});
