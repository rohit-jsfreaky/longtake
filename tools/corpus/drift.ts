/**
 * Has the real site changed its form since we captured it?
 *
 * Opens each form's live URL and reads it exactly as the capture did — and does nothing else: it
 * never types, and never presses anything but the clicks saved in `meta.json` to reveal a
 * conditional form's fields. A job that closed, a question reworded, a list that grew: each is a
 * reason to recapture, so the corpus keeps testing the web as it is, not as it was.
 */

import { chromium } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { compareAx, readPageAgain } from "./check";
import type { AxCapture, Meta } from "./types";

export type Drift = { id: string; status: "same" | "changed" | "unreachable"; problems: string[] };

export async function corpusIds(dir = "corpus"): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(join(dir, entry.name, "meta.json"));
      ids.push(entry.name);
    } catch {
      // not a form
    }
  }
  return ids.sort();
}

export async function driftOf(ids: string[], dir = "corpus"): Promise<Drift[]> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const out: Drift[] = [];
  try {
    for (const id of ids) {
      const meta = JSON.parse(await readFile(join(dir, id, "meta.json"), "utf8")) as Meta;
      const captured = JSON.parse(await readFile(join(dir, id, "ax.json"), "utf8")) as AxCapture;
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      try {
        const problems = compareAx(captured, await readPageAgain(context, meta.url, meta.before));
        out.push({ id, status: problems.length === 0 ? "same" : "changed", problems });
      } catch (cause) {
        out.push({ id, status: "unreachable", problems: [String(cause).split("\n")[0]!.slice(0, 200)] });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** The drift as Markdown. `details: false` for public logs: counts only, no text from the pages. */
export function driftMarkdown(drift: Drift[], details: boolean): string {
  const lines = [`### Corpus · live drift — ${drift.filter((d) => d.status === "same").length} of ${drift.length} unchanged`, ""];
  lines.push("| Form | Live page | Differences |", "|---|---|---:|");
  for (const d of drift) lines.push(`| ${d.id} | ${d.status} | ${d.status === "same" ? "" : d.problems.length} |`);
  if (details) {
    for (const d of drift.filter((x) => x.problems.length > 0)) {
      lines.push("", `**${d.id}**`, ...d.problems.slice(0, 30).map((p) => `- ${p}`));
    }
  }
  return lines.join("\n");
}
