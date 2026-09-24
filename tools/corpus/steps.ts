/**
 * What a person does before the fields in question exist — answer the first radio of a conditional
 * form, say. Saved in `meta.json`, so the capture, the fidelity check and every scorer see the same
 * page. Always by role and accessible name, never by CSS: that is how a person finds it too.
 */

import type { Page } from "@playwright/test";

import type { Step } from "./types";

/**
 * Wait until the page has really stopped: no request in flight, no DOM change for `quietMs`, and
 * the main thread idle. Each alone was fooled on a busy machine: a request answered late while the
 * DOM sat still (Reddit drew its consent box after it), and a framework bringing server-rendered
 * HTML to life keeps the CPU busy for seconds without touching the DOM or the network — Luma's
 * "Request to Join" was clicked while dead, and its form never opened.
 */
export async function settle(page: Page, quietMs = 1000, maxMs = 15_000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => undefined);
  await page
    .evaluate(
      ({ quietMs, maxMs }) =>
        new Promise<void>((done) => {
          let changed = false;
          const observer = new MutationObserver(() => (changed = true));
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
          const idle = () =>
            new Promise<void>((resolve) =>
              "requestIdleCallback" in window ? requestIdleCallback(() => resolve(), { timeout: 5000 }) : setTimeout(resolve, 50),
            );
          const started = performance.now();
          const round = async () => {
            changed = false;
            await new Promise((wait) => setTimeout(wait, quietMs));
            await idle();
            if (!changed || performance.now() - started > maxMs) {
              observer.disconnect();
              done();
            } else void round();
          };
          void round();
        }),
      { quietMs, maxMs },
    )
    .catch(() => undefined);
}

/** Each step waits for the page to settle first; the caller settles after the last one. */
export async function runSteps(page: Page, steps: Step[] = []): Promise<void> {
  for (const step of steps) {
    await settle(page);
    const target = page.getByRole(step.click.role as Parameters<Page["getByRole"]>[0], { name: step.click.name, exact: true }).first();
    // A click is only done when the page answers it. Pressed while a framework is still waking
    // up, a button does nothing — so a click that changed nothing is made again, once settled.
    for (let attempt = 0; attempt < 3; attempt++) {
      await target.scrollIntoViewIfNeeded();
      // A real click where it shows, landing on whatever a person would hit there — Jotform lays
      // each radio's label over the input, and the label is what takes the click.
      const box = await target.boundingBox();
      if (!box) throw new Error(`step ${step.click.role} "${step.click.name}": not on screen`);
      await page.evaluate(() => {
        const w = window as unknown as { __stepAnswered?: boolean };
        w.__stepAnswered = false;
        const observer = new MutationObserver(() => {
          w.__stepAnswered = true;
          observer.disconnect();
        });
        // Attributes too: a checkbox answers with a class, not a new node — and a click that went
        // unnoticed would be made again, unticking it.
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const answered = await page
        .waitForFunction(() => (window as unknown as { __stepAnswered?: boolean }).__stepAnswered === true, null, { timeout: 3000 })
        .then(() => true, () => false);
      if (answered) break;
      await settle(page);
    }
  }
}

/** `radio:Organization Representative` → a click on that radio. */
export function parseStep(text: string): Step {
  const colon = text.indexOf(":");
  if (colon <= 0) throw new Error(`a step is role:name, got "${text}"`);
  return { click: { role: text.slice(0, colon).trim(), name: text.slice(colon + 1).trim() } };
}
