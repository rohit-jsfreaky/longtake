/**
 * What a person does before the fields in question exist — answer the first radio of a conditional
 * form, say. Saved in `meta.json`, so the capture, the fidelity check and every scorer see the same
 * page. Always by role and accessible name, never by CSS: that is how a person finds it too.
 */

import type { Page } from "@playwright/test";

import type { Step } from "./types";

export async function runSteps(page: Page, steps: Step[] = []): Promise<void> {
  for (const step of steps) {
    const target = page.getByRole(step.click.role as Parameters<Page["getByRole"]>[0], { name: step.click.name, exact: true }).first();
    await target.scrollIntoViewIfNeeded();
    // A real click where it shows, landing on whatever a person would hit there — Jotform lays
    // each radio's label over the input, and the label is what takes the click.
    const box = await target.boundingBox();
    if (!box) throw new Error(`step ${step.click.role} "${step.click.name}": not on screen`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
  }
}

/** `radio:Organization Representative` → a click on that radio. */
export function parseStep(text: string): Step {
  const colon = text.indexOf(":");
  if (colon <= 0) throw new Error(`a step is role:name, got "${text}"`);
  return { click: { role: text.slice(0, colon).trim(), name: text.slice(colon + 1).trim() } };
}
