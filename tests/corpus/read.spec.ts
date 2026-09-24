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

// `CORPUS_UNVERIFIED=1` also reads forms whose truth nobody has checked yet — to find mistakes in
// the draft, never to score: those results are not saved.
const drafting = process.env.CORPUS_UNVERIFIED === "1";
const forms = corpusForms().filter((form) => form.truth && (form.truth.verified || drafting));

for (const form of forms) {
  test(`${form.id} — reading`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — read from its snapshot instead");
    const sent = await openForm(page, form);
    let specs = await readLikeTheProduct(page);
    // A field inside another origin's frame is out of this page's reach — the extension reads it
    // from inside that frame. Counted in the report, not scored as missing.
    const every = form.truth!.pages[0]!.fields;
    const reach = await joinTruth(page, every.map((field) => [field.locator]));
    const fields = every.filter((_, i) => !reach.otherOrigin[i]);
    const elsewhere = every.length - fields.length;
    const locators = fields.map((field) => locatorsOf(field, form.ax));
    let join = await joinTruth(page, locators);
    // A framework that re-renders after the read replaces what the read holds; read again, as the
    // product does when its page changes.
    for (let again = 0; join.stale > 0 && again < 2; again++) {
      test.info().annotations.push({ type: "read again", description: `${join.stale} fields were replaced after the read` });
      specs = await readLikeTheProduct(page);
      join = await joinTruth(page, locators);
    }
    expect(join.stale, "the page keeps replacing its fields after every read").toBe(0);
    expect(fields.filter((_, i) => !join.found[i]).map((f) => f.key), "truth fields whose element is gone").toEqual([]);

    const result = scoreRead(fields, specs, join);
    if (!form.truth!.verified) {
      test.info().annotations.push({ type: "unverified read", description: JSON.stringify({ counts: result.counts, elsewhere }) });
    } else {
      saveResult("read", form.id, { ...result, elsewhere, checkedBy: [form.truth!.verified.by] });
    }
    // Per run, beside the saved file (which the next run overwrites) — so a flaky field shows up.
    const wrong = result.rows.filter((row) => row.problems.length > 0).map((row) => `${row.key}: ${row.problems.join("; ")}`);
    if (wrong.length > 0) test.info().annotations.push({ type: "read wrong", description: wrong.join(" | ") });
    // A field there on the page but not read: say what the reader set aside, and why, at the moment
    // it read — the only evidence of a field that was hidden then and shown by the time we joined.
    if (result.rows.some((row) => row.problems.includes("not read at all"))) {
      const skipped = await page.evaluate(() => window.__longtake.last?.skipped ?? []);
      test.info().annotations.push({ type: "skipped at read", description: JSON.stringify(skipped) });
    }

    expect(result.counts.honeypotLeaks, "a honeypot became something the model can fill").toBe(0);
    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
