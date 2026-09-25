/**
 * The trust layer's judge, for the corpus: the site's own prompt (`checkPrompt`) through the site's
 * own gateway call (`chatJSON`), recorded per form so a run can be replayed exactly.
 *
 * `CORPUS_LLM`: unset — the recording where the form has one, else no judge (nothing is judged, as
 * the product does offline); `replay` — the recording only; `live` — the gateway itself, and the
 * answers recorded (`corpus/<id>/check.cassette.json`); `fill` — the recording, and the gateway
 * only for what it does not hold yet. Needs the key (web/.env.local); never in public CI.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { checkPrompt, type CheckInput } from "../../core/src/trust";
import { chatJSON, modelsFor } from "../../web/src/lib/gateway";
import type { CorpusForm } from "./load";

const mode = process.env.CORPUS_LLM ?? "auto";

if ((mode === "live" || mode === "fill") && !process.env.ASSEMBLYAI_API_KEY && existsSync("web/.env.local")) {
  const line = readFileSync("web/.env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
  if (line) process.env.ASSEMBLYAI_API_KEY = line.slice("ASSEMBLYAI_API_KEY=".length).trim();
}

/** One question to the judge, by what it was asked: the same words on the same form, the same key. */
const keyOf = (input: CheckInput) => createHash("sha256").update(JSON.stringify([input.said, input.heard, input.asking, input.fields.map((f) => f.id)])).digest("hex").slice(0, 20);

/**
 * Give the page a judge (`window.__corpusCheck`) for this form, or none. Returns what it did, for
 * the report, and saves the recording on `finish()` when live.
 */
export async function judgeFor(page: Page, form: CorpusForm): Promise<{ on: boolean; asked: () => number; pending: () => number; finish: () => void }> {
  const path = join(form.dir, "check.cassette.json");
  const recorded: Record<string, unknown> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const source = mode === "auto" ? (existsSync(path) ? "replay" : "off") : mode;
  let asked = 0;
  let pending = 0;
  if (source === "off") return { on: false, asked: () => 0, pending: () => 0, finish: () => {} };

  const judge = async (input: CheckInput) => {
    asked++;
    const key = keyOf(input);
    if (source === "fill" && recorded[key]) return recorded[key];
    if (source !== "live" && source !== "fill") return recorded[key] ?? { claims: [] };
    const { system, user } = checkPrompt(input);
    let answer = await chatJSON({ system, user, models: modelsFor("check"), timeoutMs: 30_000 });
    // The account's rate limit is per minute: wait out what the gateway says, a few times over.
    for (let tries = 0; !answer.ok && answer.reason === "rate-limited" && tries < 4; tries++) {
      await new Promise((wait) => setTimeout(wait, ((answer.ok ? 0 : answer.resetSeconds) ?? 20) * 1000 + 1000));
      answer = await chatJSON({ system, user, models: modelsFor("check"), timeoutMs: 30_000 });
    }
    const body = answer.ok ? answer.json : { claims: [] };
    recorded[key] = body;
    return body;
  };
  await page.exposeFunction("__corpusCheck", async (input: CheckInput) => {
    pending++;
    try {
      return await judge(input);
    } finally {
      pending--;
    }
  });
  return {
    on: true,
    asked: () => asked,
    pending: () => pending,
    finish: () => {
      if (source === "live" || source === "fill") writeFileSync(path, JSON.stringify(recorded, null, 2) + "\n");
    },
  };
}
