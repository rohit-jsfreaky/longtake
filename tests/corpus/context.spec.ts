/**
 * What the page says around the form (core/src/page-context.ts), on every real form: whether any of
 * the form's own questions leaked into it, and — where it is named — whether the phrase that says
 * who is asking made it in.
 *
 * A leaked question is a hard gate: the page's context is what the company wrote, and a question of
 * the form read as the company's words would put their question into the person's answer.
 *
 * The phrases live in `corpus/<id>/context.json`, beside the truth rather than in it, with who
 * checked them against the captured page.
 */

import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { corpusForms, openForm, readLikeTheProduct, saveResult } from "./load";

type Named = { mustContain: string[]; by: string; at: string };

const forms = corpusForms().filter((form) => form.truth?.verified);

for (const form of forms) {
  test(`${form.id} — the page around the form`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page");
    await openForm(page, form);
    await readLikeTheProduct(page);
    const context = await page.evaluate(() => {
      const core = window.__longtake;
      return core.pageContext(document, core.last ?? null, "[data-longtake-ignore]");
    });
    const text = context.text.toLowerCase();
    // A question long enough to be the form's own words, not a common phrase ("Email", "Name").
    const questions = form.truth!.pages[0]!.fields.map((field) => field.question.trim()).filter((q) => q.length >= 24);
    const leaked = questions.filter((q) => text.includes(q.toLowerCase()));
    const namedPath = join(form.dir, "context.json");
    const named = existsSync(namedPath) ? (JSON.parse(readFileSync(namedPath, "utf8")) as Named) : null;
    const must = named?.mustContain ?? [];
    const flat = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
    const found = must.filter((phrase) => flat(context.text).includes(flat(phrase)));
    saveResult("context", form.id, {
      counts: { pages: 1, withText: context.text.length > 0 ? 1 : 0, leaked: leaked.length, named: must.length, found: found.length },
      checkedBy: named ? [named.by] : [form.truth!.verified!.by],
    });
    expect(leaked, "the form's own questions read as the page's words").toEqual([]);
  });
}
