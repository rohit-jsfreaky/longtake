/**
 * Does the offline replay reproduce the page? If it does not, every fill score on it is a lie.
 *
 * Loads the form from its HAR with nothing allowed through to the network, reads Chrome's
 * accessibility tree again, and compares every control captured live — same place, same role,
 * same name, same options when opened. A form that fails is marked `fillable: false`: it is then
 * scored for reading only, off its MHTML snapshot.
 */

import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readAx, recordOptions } from "./capture";
import { runSteps } from "./steps";
import { HAR, REPLAYED, type AxCapture, type Meta } from "./types";

export type Fidelity = { id: string; ok: boolean; captured: number; replayed: number; problems: string[] };

export async function checkReplay(id: string, dir = "corpus"): Promise<Fidelity> {
  const base = join(dir, id);
  const meta = JSON.parse(await readFile(join(base, "meta.json"), "utf8")) as Meta;
  const captured = JSON.parse(await readFile(join(base, "ax.json"), "utf8")) as AxCapture;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.routeFromHAR(join(base, HAR), { notFound: "abort", url: REPLAYED });
  const page = await context.newPage();
  const problems: string[] = [];
  let replayed: AxCapture | null = null;
  try {
    await page.goto(meta.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2500);
    await runSteps(page, meta.before);
    replayed = await readAx(page, await context.newCDPSession(page));
    await recordOptions(page, replayed.controls);
  } catch (cause) {
    problems.push(`replay failed: ${String(cause).slice(0, 200)}`);
  } finally {
    await browser.close();
  }

  if (replayed) {
    const where = (c: { locator: { frames: string[]; path: string[] } }) => [...c.locator.frames, ...c.locator.path].join(" | ");
    const live = new Map(captured.controls.map((c) => [where(c), c]));
    const again = new Map(replayed.controls.map((c) => [where(c), c]));
    for (const [at, control] of live) {
      const other = again.get(at);
      if (!other) problems.push(`missing on replay: ${control.role} "${control.name}" at ${at}`);
      else if (other.role !== control.role || other.name !== control.name) {
        problems.push(`changed on replay: ${control.role} "${control.name}" → ${other.role} "${other.name}"`);
      } else if ((control.options ?? []).join("\n") !== (other.options ?? []).join("\n")) {
        problems.push(`options differ on replay: "${control.name}" had ${control.options?.length ?? 0}, now ${other.options?.length ?? 0}`);
      }
    }
  }

  const ok = problems.length === 0;
  if (meta.fillable !== ok) {
    meta.fillable = ok;
    await writeFile(join(base, "meta.json"), JSON.stringify(meta, null, 2));
  }
  return { id, ok, captured: captured.controls.length, replayed: replayed?.controls.length ?? 0, problems };
}
