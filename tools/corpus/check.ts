/**
 * Does the offline replay reproduce the page? If it does not, every fill score on it is a lie.
 *
 * Loads the form from its HAR with nothing allowed through to the network, reads Chrome's
 * accessibility tree again, and compares every control captured live — same place, same role,
 * same name, same options when opened. A form that fails is marked `fillable: false`: it is then
 * scored for reading only, off its MHTML snapshot.
 */

import { chromium, type BrowserContext } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readAx, recordOptions } from "./capture";
import { runSteps } from "./steps";
import { HAR, REPLAYED, type AxCapture, type Meta, type Step } from "./types";

export type Fidelity = { id: string; ok: boolean; captured: number; replayed: number; problems: string[] };

/** Open the page, do what reveals its fields, and read it the way the capture did. */
export async function readPageAgain(context: BrowserContext, url: string, steps: Step[] = []): Promise<AxCapture> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await runSteps(page, steps);
  const ax = await readAx(page, await context.newCDPSession(page));
  await recordOptions(page, ax.controls);
  return ax;
}

/** Every control of the capture, looked for again: missing, changed, or with other choices. */
export function compareAx(captured: AxCapture, now: AxCapture): string[] {
  const problems: string[] = [];
  const where = (c: { locator: { frames: string[]; path: string[] } }) => [...c.locator.frames, ...c.locator.path].join(" | ");
  const again = new Map(now.controls.map((c) => [where(c), c]));
  for (const control of captured.controls) {
    const other = again.get(where(control));
    if (!other) problems.push(`missing: ${control.role} "${control.name}" at ${where(control)}`);
    else if (other.role !== control.role || other.name !== control.name) {
      problems.push(`changed: ${control.role} "${control.name}" → ${other.role} "${other.name}"`);
    } else if ((control.options ?? []).join("\n") !== (other.options ?? []).join("\n")) {
      problems.push(`options differ: "${control.name}" had ${control.options?.length ?? 0}, now ${other.options?.length ?? 0}`);
    }
  }
  return problems;
}

export async function checkReplay(id: string, dir = "corpus"): Promise<Fidelity> {
  const base = join(dir, id);
  const meta = JSON.parse(await readFile(join(base, "meta.json"), "utf8")) as Meta;
  const captured = JSON.parse(await readFile(join(base, "ax.json"), "utf8")) as AxCapture;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.routeFromHAR(join(base, HAR), { notFound: "abort", url: REPLAYED });
  let problems: string[];
  let replayed: AxCapture | null = null;
  try {
    replayed = await readPageAgain(context, meta.url, meta.before);
    problems = compareAx(captured, replayed);
  } catch (cause) {
    problems = [`replay failed: ${String(cause).slice(0, 200)}`];
  } finally {
    await browser.close();
  }

  const ok = problems.length === 0;
  if (meta.fillable !== ok) {
    meta.fillable = ok;
    await writeFile(join(base, "meta.json"), JSON.stringify(meta, null, 2));
  }
  return { id, ok, captured: captured.controls.length, replayed: replayed?.controls.length ?? 0, problems };
}
