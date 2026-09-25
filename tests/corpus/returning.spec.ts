/**
 * A returning person, scored: one real form filled by talking, then a second real form opened with
 * what the first one taught — through the conductor the site and the extension both run, with the
 * model's recorded meanings for each form.
 *
 * Judged against the verified truth of the SECOND form, never against our own meanings:
 *   - known: a field whose truth is the person's own answer to something they said on the first
 *     form (same truth concept), of a kind that may be remembered;
 *   - put in: known, and filled before anyone spoke, with what they said;
 *   - waiting: known, and held for their yes — offered, not asked from scratch;
 *   - asked again: known, and neither — the person would have to say it twice (hard gate);
 *   - wrong: anything put in from last time that is not their own answer to that question (hard gate).
 */

import { expect, test } from "@playwright/test";

import { locatorsOf } from "../../tools/corpus/score";
import type { CorpusForm } from "./load";
import { corpusForms, joinTruth, openForm, recordedMeanings, saveResult, startConductor, talk } from "./load";

/** First form → second form. Same platform, and across platforms. */
const PAIRS: [string, string][] = [
  ["glean-greenhouse", "reddit-greenhouse"],
  ["reddit-greenhouse", "discord-greenhouse"],
  ["glean-greenhouse", "palantir-lever"],
  ["reddit-greenhouse", "notion-ashby"],
  ["glean-greenhouse", "blueground-workable"],
];

const forms = new Map(corpusForms().map((form) => [form.id, form]));

/** The same answer, once formatting goes: "+91 98765 43210" and "98765 43210" by their digits' end. */
function same(a: unknown, b: unknown): boolean {
  const flat = (v: unknown) => (Array.isArray(v) ? v.join(" ") : String(v)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = flat(a);
  const y = flat(b);
  return x === y || (x.length >= 4 && y.length >= 4 && (x.endsWith(y) || y.endsWith(x) || x.startsWith(y) || y.startsWith(x)));
}

const KEPT = new Set(["remember"]);

/** A phone number box and a whole phone box ask for the same answer; only the formatting differs. */
const family = (concept: string) => (concept === "contact.phone.number" ? "contact.phone" : concept);

async function ids(page: Parameters<typeof joinTruth>[0], form: CorpusForm): Promise<(string | null)[]> {
  const fields = form.truth!.pages[0]!.fields;
  return (await joinTruth(page, fields.map((field) => locatorsOf(field, form.ax)))).best;
}

for (const [firstId, secondId] of PAIRS) {
  test(`${firstId} → ${secondId} — returning`, async ({ page }) => {
    const first = forms.get(firstId);
    const second = forms.get(secondId);
    test.skip(!first?.truth?.verified || !second?.truth?.verified || !first.talk?.verified, "both forms need verified truth, the first a verified conversation");
    test.skip(!first!.meta.fillable || !second!.meta.fillable, "replay does not reproduce one of these pages");
    test.setTimeout(120_000);

    // ── The first form: the conversation, with the model's recorded meanings ──
    const firstFields = first!.truth!.pages[0]!.fields;
    await openForm(page, first!);
    const understoodFirst = await recordedMeanings(page, first!, firstFields.map((field) => locatorsOf(field, first!.ax)));
    test.skip(!understoodFirst, "the first form has no recorded model answer");
    await startConductor(page, { understood: understoodFirst });
    const firstIds = await ids(page, first!);
    const map: Record<string, string> = {};
    firstFields.forEach((field, i) => {
      if (firstIds[i]) map[field.key] = firstIds[i]!;
    });
    await talk(page, first!.talk!, map);
    await page.waitForTimeout(300);

    // What they said there, by the truth's own concepts: the answers a second form may be given.
    const firstState = await page.evaluate(() =>
      Object.fromEntries(window.__corpusConductor!.session.state().fields.map((f) => [f.spec.id, { value: f.value, source: f.source }])),
    );
    const said = new Map<string, unknown>();
    firstFields.forEach((field, i) => {
      const state = firstIds[i] ? firstState[firstIds[i]!] : undefined;
      if (field.subject === "self" && field.concept && KEPT.has(field.scope ?? "") && state?.source === "spoken") said.set(family(field.concept), state.value);
    });
    const profile = await page.evaluate(() => window.__corpusProfile!.current());

    // ── The second form, opened with what the first one taught ──
    const secondFields = second!.truth!.pages[0]!.fields;
    await openForm(page, second!);
    const understoodSecond = await recordedMeanings(page, second!, secondFields.map((field) => locatorsOf(field, second!.ax)));
    test.skip(!understoodSecond, "the second form has no recorded model answer");
    await startConductor(page, { profile, understood: understoodSecond });
    const secondIds = await ids(page, second!);
    const state = await page.evaluate(() => {
      const session = window.__corpusConductor!.session;
      return Object.fromEntries(
        session.state().fields.map((f) => {
          const m = session.meaningOf(f.spec.id);
          return [f.spec.id, { value: f.value, source: f.source, waiting: f.pending?.reason === "from_last_time", fact: session.ledger.entry(f.spec.id)?.factId ?? null, read: m ? `${m.concept}/${m.subject}/${m.confidence}/${m.source}` : "none" }];
        }),
      );
    });

    const counts = { known: 0, putIn: 0, waiting: 0, askedAgain: 0, wrong: 0 };
    const rows: { key: string; question: string; specId: string | null; problems: string[] }[] = [];
    secondFields.forEach((field, i) => {
      if (field.honeypot) return;
      const id = secondIds[i];
      const now = id ? state[id] : undefined;
      const problems: string[] = [];
      const concept = family(field.concept ?? "");
      const theirs = field.subject === "self" && field.concept && said.has(concept);
      const keepable = KEPT.has(field.scope ?? "");

      if (now?.source === "memory") {
        // Put in from last time: it must be their own answer to this very question.
        if (!theirs || !same(now.value, said.get(concept))) {
          counts.wrong++;
          problems.push(`put in from last time but not their answer to it: ${JSON.stringify(now.value)} (${now.fact})`);
        }
      }
      if (theirs && keepable) {
        counts.known++;
        if (now?.source === "memory") counts.putIn++;
        else if (now?.waiting) counts.waiting++;
        else {
          counts.askedAgain++;
          problems.push(`they said it on ${firstId} (${JSON.stringify(said.get(concept))}) and would be asked again — read as ${now?.read ?? "nothing"}; known: ${Object.keys(profile.facts).join(", ")}`);
        }
      }
      if (problems.length > 0) rows.push({ key: field.key, question: field.question, specId: id ?? null, problems });
    });

    saveResult("returning", `${firstId}__${secondId}`, { counts, rows });
    test.info().annotations.push({ type: "returning", description: JSON.stringify(counts) });
    expect(rows.filter((r) => r.problems.some((p) => p.startsWith("put in"))), "put in from last time, but not their answer").toEqual([]);
    expect(counts.askedAgain, JSON.stringify(rows)).toBe(0);
  });
}
