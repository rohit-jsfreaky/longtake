/**
 * Pictures for the README: a real form, replayed offline, after its scored conversation has played
 * through the product — the same run `conversation.spec.ts` scores, photographed at the end, badges
 * and all. Nothing here is scored.
 *
 *   CORPUS_SHOTS=1 npx playwright test --project corpus --no-deps tests/corpus/shots.spec.ts
 *
 * `--no-deps` keeps the corpus setup from clearing the last scored run and the report from being
 * rewritten from this one.
 */

import { mkdirSync } from "node:fs";

import { test } from "@playwright/test";

import { locatorsOf } from "../../tools/corpus/score";
import { corpusForms, joinTruth, openForm, startConductor, talk } from "./load";

const SHOTS = ["glean-greenhouse", "edukraine-gform-p1", "jotform-patient-intake", "ircc-come-to-canada"];
const OUT = "docs/screens";

const forms = corpusForms().filter((form) => SHOTS.includes(form.id) && form.truth?.verified && form.talk);

test.skip(process.env.CORPUS_SHOTS !== "1", "pictures only when asked for");

for (const form of forms) {
  test(`${form.id} — picture`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openForm(page, form);
    await startConductor(page);

    const fields = form.truth!.pages[0]!.fields;
    const join = await joinTruth(page, fields.map((field) => locatorsOf(field, form.ax)));
    const ids: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (join.best[i]) ids[field.key] = join.best[i]!;
    });
    await talk(page, form.talk!, ids);
    await page.waitForTimeout(800);

    // Just the form: from a little above its first control, at most a screen and a half down.
    const box = await page.evaluate(() => {
      const controls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, [role=combobox], [role=radio], [role=checkbox]")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const top = Math.min(...controls.map((r) => r.top)) + window.scrollY;
      const bottom = Math.max(...controls.map((r) => r.bottom)) + window.scrollY;
      return { top: Math.max(0, top - 120), height: Math.min(bottom - top + 200, 1500) };
    });
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/filled-${form.id}.png`, fullPage: true, clip: { x: 0, y: box.top, width: 1280, height: box.height } });
  });
}
