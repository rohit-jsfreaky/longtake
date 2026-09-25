/**
 * What the agent is given on each real form, measured: the whole system prompt (who it is, the form
 * as it is, what to do next), every tool's description, and the opening line it speaks verbatim.
 * The largest form in the corpus sets the bar — a prompt that grows with the form must not grow
 * past what the agent reads well.
 */

import { expect, test } from "@playwright/test";

import { locatorsOf } from "../../tools/corpus/score";
import { corpusForms, openForm, recordedMeanings, saveResult, startConductor } from "./load";

/** The whole prompt on the largest form in the corpus stays under this. Measured, with room. */
const PROMPT_CAP = 16_000;
const TOOL_DESCRIPTION_CAP = 600;
const GREETING_WORDS = 30;

const forms = corpusForms().filter((form) => form.truth?.verified);

for (const form of forms) {
  test(`${form.id} — what the agent is given`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page");
    await openForm(page, form);
    const fields = form.truth!.pages[0]!.fields;
    const understood = await recordedMeanings(page, form, fields.map((field) => locatorsOf(field, form.ax)));
    await startConductor(page, understood ? { understood } : {});
    const given = await page.evaluate(() => {
      const session = window.__corpusConductor!.session;
      return {
        prompt: session.prompt().length,
        greeting: session.greeting(),
        name: window.__longtake.titleOf(session.read!),
        fields: session.state().fields.length,
        tools: session.tools().map((tool) => ({ name: tool.name, description: tool.description.length })),
      };
    });
    const words = given.greeting.replace(given.name, "").split(/\s+/).filter((word) => /\w/.test(word)).length;
    test.info().annotations.push({ type: "given", description: JSON.stringify({ prompt: given.prompt, fields: given.fields, words }) });
    saveResult("prompt", form.id, { counts: { prompt: given.prompt, fields: given.fields, words }, rows: [] });

    expect(given.prompt, `the whole prompt on ${given.fields} fields`).toBeLessThanOrEqual(PROMPT_CAP);
    for (const tool of given.tools) expect(tool.description, tool.name).toBeLessThanOrEqual(TOOL_DESCRIPTION_CAP);
    expect(words, given.greeting).toBeLessThanOrEqual(GREETING_WORDS);
  });
}
