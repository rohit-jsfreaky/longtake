/**
 * Talking, scored: a whole conversation on each form — the long take, a correction, a yes — played
 * through the conductor the site and the extension both run, with a FakeVoice for the microphone
 * and the agent, on the offline form.
 *
 * Every expectation the script makes is one check; the report holds the share that come true to
 * the baseline. Hard gates, failing the test itself: a field that changed although no call named
 * it (rule 2), and anything leaving the page — nothing is ever submitted.
 * `CORPUS_UNVERIFIED=1` also plays scripts nobody has checked yet — to draft them, never to score.
 */

import { expect, test } from "@playwright/test";

import { locatorsOf } from "../../tools/corpus/score";
import { corpusForms, joinTruth, openForm, saveResult, sentSoFar, startConductor, talk } from "./load";

const drafting = process.env.CORPUS_UNVERIFIED === "1";
const forms = corpusForms().filter((form) => form.truth?.verified && form.talk && (form.talk.verified || drafting));

for (const form of forms) {
  test(`${form.id} — talking`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — it cannot be filled offline");
    const sent = await openForm(page, form);
    await startConductor(page);

    // Truth keys → the ids the conductor's read gave those elements today.
    const fields = form.truth!.pages[0]!.fields;
    const join = await joinTruth(page, fields.map((field) => locatorsOf(field, form.ax)));
    const ids: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (join.best[i]) ids[field.key] = join.best[i]!;
    });

    const { report, touched } = await talk(page, form.talk!, ids);
    const counts = { checks: report.checks, passed: report.checks - report.failures.length, touched: touched.length };
    const problems = [...report.failures, ...touched.map((field) => `changed although no call named it: ${field}`)];
    const result = { counts, rows: [{ key: "talk", question: form.talk!.name, specId: null, problems }] };
    if (form.talk!.verified) saveResult("talk", form.id, result);
    else test.info().annotations.push({ type: "unverified talk", description: JSON.stringify(result) });

    expect(touched, "a field changed that no call named").toEqual([]);
    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
