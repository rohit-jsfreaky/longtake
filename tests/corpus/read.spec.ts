/**
 * Reading, scored: `core/` reads each real form exactly the way the product does — wait for it to
 * settle, read, open every dropdown — and is compared, field by field, with the verified truth.
 *
 * Only two things fail a test here, because they are never acceptable: a honeypot that became
 * something the model can fill, and anything leaving the page. Everything else is a number; the
 * report compares it with the baseline and fails the run if any of them got worse.
 */

import { expect, test } from "@playwright/test";

import { locatorsOf, scoreRead } from "../../tools/corpus/score";
import { corpusForms, joinTruth, openForm, readLikeTheProduct, saveResult, sentSoFar } from "./load";

const forms = corpusForms().filter((form) => form.truth?.verified);

for (const form of forms) {
  test(`${form.id} — reading`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — read from its snapshot instead");
    const sent = await openForm(page, form);
    const specs = await readLikeTheProduct(page);
    const fields = form.truth!.pages[0]!.fields;
    const join = await joinTruth(
      page,
      fields.map((field) => locatorsOf(field, form.ax)),
    );
    expect(fields.filter((_, i) => !join.found[i]).map((f) => f.key), "truth fields whose element is gone").toEqual([]);

    const result = scoreRead(fields, specs, join);
    saveResult("read", form.id, result);

    expect(result.counts.honeypotLeaks, "a honeypot became something the model can fill").toBe(0);
    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
