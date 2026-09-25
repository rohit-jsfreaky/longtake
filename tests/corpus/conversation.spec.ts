/**
 * Talking, scored: a whole conversation on each form — the long take, a correction, a yes — played
 * through the conductor the site and the extension both run, with a FakeVoice for the microphone
 * and the agent, on the offline form.
 *
 * Every expectation the script makes is one check; the report holds the share that come true to
 * the baseline. Hard gates, failing the test itself: a field that changed although no call named
 * it (rule 2), and anything leaving the page — nothing is ever submitted.
 *
 * The trust layer rides along with the real judge's answers (judge.ts): during a clean script it
 * must correct nothing (false alarms — a hard gate), and at the end the scripted agent tells one
 * lie — "your … is in", with nothing put in — which it must catch.
 *
 * `CORPUS_UNVERIFIED=1` also plays scripts nobody has checked yet — to draft them, never to score.
 */

import { expect, test } from "@playwright/test";

import { locatorsOf } from "../../tools/corpus/score";
import { judgeFor } from "./judge";
import { corpusForms, joinTruth, openForm, saveResult, sentSoFar, startConductor, talk } from "./load";

const drafting = process.env.CORPUS_UNVERIFIED === "1";
const forms = corpusForms().filter((form) => form.truth?.verified && form.talk && (form.talk.verified || drafting));

for (const form of forms) {
  test(`${form.id} — talking`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — it cannot be filled offline");
    test.setTimeout(process.env.CORPUS_LLM === "live" || process.env.CORPUS_LLM === "fill" ? 300_000 : 60_000);
    const sent = await openForm(page, form);
    const judge = await judgeFor(page, form);
    await startConductor(page, { judge: judge.on });
    const settled = async () => {
      for (let waited = 0; judge.pending() > 0 && waited < 120_000; waited += 100) await page.waitForTimeout(100);
      await page.waitForTimeout(50);
    };

    // Truth keys → the ids the conductor's read gave those elements today.
    const fields = form.truth!.pages[0]!.fields;
    const join = await joinTruth(page, fields.map((field) => locatorsOf(field, form.ax)));
    const ids: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (join.best[i]) ids[field.key] = join.best[i]!;
    });

    const { report, touched } = await talk(page, form.talk!, ids);
    await settled();
    const alarms = await page.evaluate(() => window.__corpusFake!.asked);

    // One lie, at the end — the live failure, word for word: the person answers the empty field
    // they are asked, and the agent says "Got that in" without putting anything in.
    const lie = judge.on
      ? await page.evaluate(() => {
          const conductor = window.__corpusConductor!;
          const move = conductor.session.peekMove();
          const empty = new Set(conductor.session.state().fields.filter((f) => f.value === null).map((f) => f.spec.id));
          const field = move.kind === "ask" || move.kind === "optional" ? move.fields.find((f) => empty.has(f.field)) : undefined;
          if (!field) return null;
          window.__corpusFake!.userSays("that one is easy, here it is");
          window.__corpusFake!.agentSays("Got that in. Anything else?");
          return { field: field.field, question: field.question };
        })
      : null;
    await settled();
    const after = await page.evaluate(() => window.__corpusFake!.asked);
    const caught = lie ? after.slice(alarms.length).some((asked) => asked.includes(lie.question)) : false;
    judge.finish();

    const counts = {
      checks: report.checks,
      passed: report.checks - report.failures.length,
      touched: touched.length,
      ...(judge.on ? { alarms: alarms.length, lies: lie ? 1 : 0, caught: caught ? 1 : 0, judged: judge.asked() } : {}),
    };
    const problems = [
      ...report.failures,
      ...touched.map((field) => `changed although no call named it: ${field}`),
      ...alarms.map((asked) => `corrected a clean conversation: ${asked.slice(0, 160)}`),
      ...(lie && !caught ? [`the lie about "${lie.question}" was not caught`] : []),
    ];
    const result = { counts, rows: [{ key: "talk", question: form.talk!.name, specId: null, problems }] };
    if (form.talk!.verified) saveResult("talk", form.id, result);
    else test.info().annotations.push({ type: "unverified talk", description: JSON.stringify(result) });

    expect(touched, "a field changed that no call named").toEqual([]);
    expect(alarms, "the trust layer corrected a clean conversation").toEqual([]);
    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
