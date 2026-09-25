/**
 * Meaning, scored: what each field means — concept, whose answer, how long it may be kept — as the
 * product would understand it, against the verified truth.
 *
 * `CORPUS_LLM` says where the meanings come from:
 *   - unset: the model's recorded answer where the form has one, else the offline reading — so a
 *     form is always measured from the same source, locally and in CI alike;
 *   - `off`: the offline reading (`fallbackMeanings`) everywhere — the floor the model must beat;
 *   - `replay`: the model's recorded answer (`corpus/<id>/understand.cassette.json`), checked by
 *     `validateMeanings` exactly as a live answer is. A form with no cassette is skipped;
 *   - `live`: the LLM Gateway itself, through the site's own `chatJSON` and prompt — and the answer
 *     is recorded as the form's cassette. Needs the key (web/.env.local); never runs in public CI.
 * Hard gate: someone else's field read as the person's own, with high confidence.
 */

import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { snapshotOf, understandPrompt, validateMeanings } from "../../core/src/understand";
import type { FieldSpec } from "../../core/src/types";
import { chatJSON, modelsFor } from "../../web/src/lib/gateway";

import { scoreMeaning, type ReadMeaning } from "../../tools/corpus/meaning-score";
import { locatorsOf } from "../../tools/corpus/score";
import { corpusForms, joinTruth, openForm, readLikeTheProduct, saveResult } from "./load";

const asked = process.env.CORPUS_LLM ?? "auto";

// The key, for a live run only — read from where the site keeps it, never printed.
if (asked === "live" && !process.env.ASSEMBLYAI_API_KEY && existsSync("web/.env.local")) {
  const line = readFileSync("web/.env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
  if (line) process.env.ASSEMBLYAI_API_KEY = line.slice("ASSEMBLYAI_API_KEY=".length).trim();
}
const forms = corpusForms().filter((form) => form.truth?.verified);

/** A recorded model answer: its fields keyed by truth key, so it survives a change of spec ids. */
type Cassette = { model: string; at: string; fields: (Record<string, unknown> & { key: string })[] };

for (const form of forms) {
  test(`${form.id} — meaning`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page");
    const cassettePath = join(form.dir, "understand.cassette.json");
    const source = asked === "auto" ? (existsSync(cassettePath) ? "replay" : "off") : asked === "live" || asked === "replay" ? asked : "off";
    if (source === "live") test.setTimeout(600_000); // waits out the gateway's rate limit
    test.skip(source === "replay" && !existsSync(cassettePath), "no recorded model answer for this form");

    await openForm(page, form);
    const { specs } = await readLikeTheProduct(page);
    const fields = form.truth!.pages[0]!.fields;
    const join_ = await joinTruth(page, fields.map((field) => locatorsOf(field, form.ax)));

    let meanings: Record<string, ReadMeaning>;
    if (source === "replay") {
      const cassette = JSON.parse(readFileSync(cassettePath, "utf8")) as Cassette;
      // Truth key → today's spec id, then checked as any live answer is.
      const idOf = new Map(fields.map((field, i) => [field.key, join_.best[i]]));
      const raw = { fields: cassette.fields.map(({ key, ...rest }) => ({ ...rest, id: idOf.get(key) ?? `unread_${key}` })) };
      meanings = await page.evaluate(([raw, specs]) => window.__longtake.validateMeanings(raw, specs as never) as unknown, [raw, specs] as const) as Record<string, ReadMeaning>;
    } else if (source === "live") {
      const title = await page.title();
      const snapshot = snapshotOf(specs as unknown as FieldSpec[], { host: new URL(form.meta.url).host, title });
      const { system, user } = understandPrompt(snapshot);
      // The account's rate limit is per minute: wait out what the gateway says, a few times over.
      let answer = await chatJSON({ system, user, models: modelsFor("understand"), timeoutMs: 60_000 });
      for (let tries = 0; !answer.ok && answer.reason === "rate-limited" && tries < 4; tries++) {
        await new Promise((wait) => setTimeout(wait, ((answer.ok ? 0 : answer.resetSeconds) ?? 20) * 1000 + 1000));
        answer = await chatJSON({ system, user, models: modelsFor("understand"), timeoutMs: 60_000 });
      }
      expect(answer.ok, `the gateway answered (${answer.ok ? "" : answer.reason})`).toBe(true);
      if (!answer.ok) return;
      meanings = validateMeanings(answer.json, specs as unknown as FieldSpec[]) as Record<string, ReadMeaning>;
      // Recorded by truth key, so a replay survives a change of spec ids.
      const keyOf = new Map(fields.map((field, i) => [join_.best[i], field.key]));
      const raw = ((answer.json as { fields?: unknown[] }).fields ?? []) as Record<string, unknown>[];
      const cassette: Cassette = {
        model: answer.model,
        at: new Date().toISOString(),
        fields: raw.flatMap(({ id, ...rest }) => (keyOf.get(String(id)) ? [{ key: keyOf.get(String(id))!, ...rest }] : [])),
      };
      writeFileSync(cassettePath, JSON.stringify(cassette, null, 2) + "\n");
      test.info().annotations.push({ type: "model", description: `${answer.model}, ${answer.ms} ms` });
    } else {
      meanings = (await page.evaluate(() => window.__longtake.fallbackMeanings(window.__longtake.last!.specs) as unknown)) as Record<string, ReadMeaning>;
    }

    const result = scoreMeaning(fields, join_.best, meanings);
    saveResult("meaning", form.id, { ...result, source });
    expect(result.counts.dangerous, "someone else's field read as the person's own, with high confidence").toBe(0);
  });
}
