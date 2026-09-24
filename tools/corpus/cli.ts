/**
 * `npm run corpus:<command> -- <args>`
 *
 *   capture <id> <url> --category job --platform greenhouse [--cdp] [--query "<css>=a|b|c"]
 *                      [--click "radio:Organization Representative"]   repeatable, done before reading
 *   seed    <id>        writes an unverified truth.json from ax.json (never over a verified one)
 *   check   <id>        does the offline replay reproduce the page?
 *   review  <id> [--port 4477] [--by "name"]   a local page to correct the truth and mark it verified
 *   drift   [<id>…]     has the live site changed its form? Reads only; every form when no id
 *
 * Every command works on `corpus/<id>/` — the private corpus repo, cloned into `corpus/`.
 */

import { appendFile, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

import { capture } from "./capture";
import { checkReplay } from "./check";
import { corpusIds, driftMarkdown, driftOf } from "./drift";
import { review } from "./review";
import { parseStep } from "./steps";
import { seedTruth } from "./seed";
import type { AxCapture, Category, Truth } from "./types";

const DIR = process.env.CORPUS_DIR ?? "corpus";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const [command, id, ...rest] = process.argv.slice(2);

  if (command === "drift") {
    const ids = id ? [id, ...rest.filter((arg) => !arg.startsWith("--"))] : await corpusIds(DIR);
    const drift = await driftOf(ids, DIR);
    // Public CI logs get counts only — no text from somebody else's page.
    const markdown = driftMarkdown(drift, process.env.CORPUS_REPORT_DETAILS !== "off");
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
    if (drift.some((d) => d.status !== "same")) process.exitCode = 1;
    return;
  }

  if (!command || !id) throw new Error("usage: corpus <capture|seed|check|review> <id> [...] | corpus drift [<id>…]");

  if (command === "capture") {
    const url = rest[0];
    if (!url) throw new Error("capture needs a URL");
    const queries: Record<string, string[]> = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== "--query") continue;
      const [css, list] = (rest[i + 1] ?? "").split("=");
      if (css && list) queries[css] = list.split("|");
    }
    const result = await capture(url, id, {
      dir: DIR,
      category: (flag(rest, "category") ?? "other") as Category,
      platform: flag(rest, "platform") ?? "unknown",
      cdp: rest.includes("--cdp"),
      queries,
      before: rest.flatMap((arg, i) => (arg === "--click" && rest[i + 1] ? [parseStep(rest[i + 1]!)] : [])),
      ...(flag(rest, "notes") ? { notes: flag(rest, "notes") } : {}),
    });
    console.log(`captured ${id}: ${result.controls} controls → ${result.dir}`);
    return;
  }

  if (command === "seed") {
    const target = join(DIR, id, "truth.json");
    if (await exists(target)) {
      const current = JSON.parse(await readFile(target, "utf8")) as Truth;
      if (current.verified) throw new Error(`${id}: truth.json is verified — edit it by review, never reseed`);
    }
    const ax = JSON.parse(await readFile(join(DIR, id, "ax.json"), "utf8")) as AxCapture;
    const truth = seedTruth(id, ax);
    await writeFile(target, JSON.stringify(truth, null, 2));
    const fields = truth.pages[0]!.fields;
    console.log(`seeded ${id}: ${fields.length} fields (${fields.filter((f) => f.honeypot).length} suspected honeypots), unverified`);
    for (const f of fields) {
      console.log(`  ${f.key} ${f.kind.padEnd(11)} ${f.required ? "*" : " "} ${f.question}${f.options ? `  [${f.options.labels.length} options]` : ""}${f.honeypot ? "  (hidden)" : ""}`);
    }
    return;
  }

  if (command === "check") {
    const result = await checkReplay(id, DIR);
    console.log(`${id}: replay ${result.ok ? "OK" : "BROKEN"} — ${result.captured} controls captured, ${result.replayed} on replay`);
    for (const problem of result.problems.slice(0, 20)) console.log(`  ${problem}`);
    return;
  }

  if (command === "review") {
    await review(id, DIR, Number(flag(rest, "port") ?? 4477), flag(rest, "by"));
    return;
  }

  throw new Error(`unknown command ${command}`);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
