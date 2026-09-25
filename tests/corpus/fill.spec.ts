/**
 * Filling, scored: each verified fill plan runs through the product's own path — a real session,
 * the agent's `fill_fields` call, the quote check, the gate, the writer — on the offline form.
 *
 * Hard gates, failing the test itself: an answer that changed a field nobody answered, and
 * anything leaving the page. Everything else is a number the report holds to the baseline.
 * `CORPUS_UNVERIFIED=1` also runs plans nobody has checked yet — to draft them, never to score.
 */

import { expect, test } from "@playwright/test";

import { scoreFill, shown, type FillRun } from "../../tools/corpus/fill-score";
import { locatorsOf } from "../../tools/corpus/score";
import { answer, corpusForms, freshen, joinTruth, openForm, saveResult, sentSoFar, startSession } from "./load";

const drafting = process.env.CORPUS_UNVERIFIED === "1";
const forms = corpusForms().filter((form) => form.truth?.verified && form.fill && form.fill.cases.length > 0 && (form.fill.verified || drafting));

for (const form of forms) {
  test(`${form.id} — filling`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — it cannot be filled offline");
    const sent = await openForm(page, form);
    await startSession(page);

    const fields = form.truth!.pages[0]!.fields;
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const specFor = async (key: string) => {
      const field = byKey.get(key);
      if (!field) throw new Error(`fill plan names ${key}, which is not in the truth`);
      await freshen(page);
      return (await joinTruth(page, [locatorsOf(field, form.ax)])).best[0] ?? null;
    };

    const runs: FillRun[] = [];
    for (const plan of form.fill!.cases) {
      const specId = await specFor(plan.field);
      if (!specId) {
        runs.push({ outcome: "not read", shows: null, touched: [] });
        continue;
      }
      const also = (await Promise.all((plan.expect.also ?? []).map(specFor))).filter((id): id is string => Boolean(id));
      const done = await answer(page, { specId, also, value: plan.value, evidence: plan.evidence, hiddenCss: plan.expect.hidden?.css });
      runs.push({ outcome: done.outcome, shows: done.shows === null ? null : shown(done.shows), touched: done.touched, hidden: done.hidden, call: done.call });
    }

    const result = scoreFill(form.fill!.cases, runs, (key) => byKey.get(key)?.question ?? key);
    if (form.fill!.verified) saveResult("fill", form.id, { ...result, checkedBy: [form.truth!.verified!.by, form.fill!.verified.by, ...(form.truth!.corrected ?? []).map((c) => c.by)] });
    else test.info().annotations.push({ type: "unverified plan", description: JSON.stringify(result.rows.filter((r) => r.problems.length)) });

    expect(result.counts.collateral, "an answer changed a field nobody answered").toBe(0);
    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
