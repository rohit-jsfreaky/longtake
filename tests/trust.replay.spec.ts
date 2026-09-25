/**
 * The live failure the trust layer exists for, replayed through the one `Conductor`: the agent said
 * "Got that in" for an answer it never put in. The judge (a stand-in that answers as a correct one
 * would) says what was claimed; the product corrects it at once — the agent is asked to put it in
 * with the person's words or say plainly it is not in, the brief says so, and the person sees it.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const FORM = `
  <label for="n">Full name*</label><input id="n" required>
  <label for="w">Why do you want to work at Discord?*</label><textarea id="w" required></textarea>`;

async function start(page: Page, claims: unknown[]) {
  await load(page, FORM);
  await page.evaluate(async (judged) => {
    const L = window.__longtake;
    const fake = new L.FakeVoice();
    const asked: unknown[] = [];
    const conductor = new L.Conductor({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      services: {
        getToken: async () => "t",
        workletUrl: "",
        startVoice: fake.start,
        check: async (input) => {
          asked.push(input);
          return { claims: judged };
        },
      },
    });
    await conductor.start();
    await new Promise((r) => setTimeout(r, 20));
    Object.assign(window, { __c: conductor, __fake: fake, __asked: asked });
  }, claims);
}

type Win = {
  __c: InstanceType<typeof window.__longtake.Conductor>;
  __fake: InstanceType<typeof window.__longtake.FakeVoice>;
  __asked: { said: string; asking: string[] }[];
};

test("'Got that in' with nothing put in is caught and put right at once", async ({ page }) => {
  await start(page, [{ field: "why_do_you_want_to_work_at_discord", claim: "put_in", quote: "Got that in" }]);
  const out = await page.evaluate(async () => {
    const w = window as unknown as Win;
    // The agent was asking the long answer; the person answered; the agent never called a tool.
    w.__c.session.state();
    w.__fake.userSays("I want to help keep Discord safe for the people I play with");
    w.__fake.agentSays("Got that in. What's your full name?");
    await new Promise((r) => setTimeout(r, 50));
    return {
      judged: w.__asked,
      asked: w.__fake.asked,
      missed: w.__c.view().missed.map((m) => `${m.fieldId}: ${m.why}`),
      prompt: w.__fake.prompt,
      value: (document.getElementById("w") as HTMLTextAreaElement).value,
    };
  });
  expect(out.judged).toHaveLength(1);
  expect(out.judged[0]!.said).toBe("Got that in. What's your full name?");
  expect(out.asked).toHaveLength(1);
  expect(out.asked[0]).toContain('You told them "Why do you want to work at Discord?" went in, but it did not');
  expect(out.missed).toEqual(["why_do_you_want_to_work_at_discord: the agent said it went in, but it did not — it's being put right"]);
  expect(out.prompt).toContain('You told them "Why do you want to work at Discord?" went in ("Got that in"); it did not.');
  expect(out.value).toBe(""); // nothing is written on the judge's say-so: the agent must put it in, with their words
});

test("when the answer is then put in with their words, the notice and the brief line go", async ({ page }) => {
  await start(page, [{ field: "why_do_you_want_to_work_at_discord", claim: "put_in", quote: "Got that in" }]);
  const out = await page.evaluate(async () => {
    const w = window as unknown as Win;
    const said = "I want to help keep Discord safe for the people I play with";
    w.__fake.userSays(said);
    w.__fake.agentSays("Got that in. What's your full name?");
    await new Promise((r) => setTimeout(r, 50));
    await w.__fake.toolCall("fill_fields", { why_do_you_want_to_work_at_discord: { value: said, evidence: said, how: "named" } });
    return { missed: w.__c.view().missed.length, prompt: w.__c.session.prompt() };
  });
  expect(out.missed).toBe(0);
  expect(out.prompt).not.toContain("You told them");
});

test("a reply after everything went in is never checked — no judge, no false alarm", async ({ page }) => {
  await start(page, [{ field: "full_name", claim: "put_in", quote: "Got it" }]);
  const out = await page.evaluate(async () => {
    const w = window as unknown as Win;
    w.__fake.userSays("I'm Rohit Kashyap");
    await w.__fake.toolCall("fill_fields", { full_name: { value: "Rohit Kashyap", evidence: "I'm Rohit Kashyap", how: "named" } });
    w.__fake.agentSays("Got it, Rohit. Why Discord?");
    await new Promise((r) => setTimeout(r, 50));
    return { judged: w.__asked.length, asked: w.__fake.asked.length, missed: w.__c.view().missed.length };
  });
  expect(out).toEqual({ judged: 0, asked: 0, missed: 0 });
});

test("a judge that claims what is true — the answer is on the form — corrects nothing", async ({ page }) => {
  await start(page, [{ field: "full_name", claim: "put_in", quote: "your name's in" }]);
  const out = await page.evaluate(async () => {
    const w = window as unknown as Win;
    (document.getElementById("n") as HTMLInputElement).value = "Rohit Kashyap"; // typed by hand
    w.__fake.userSays("I typed my name myself");
    w.__fake.agentSays("Right, your name's in. Why Discord?");
    await new Promise((r) => setTimeout(r, 50));
    return { judged: w.__asked.length, asked: w.__fake.asked.length };
  });
  expect(out.asked).toBe(0);
});
