/**
 * Planner v2, in whole conversations through the one `Conductor`: the agent says HOW it heard each
 * answer, and code acts on that instead of lists of hedging and yes-words; a returning person is
 * asked only what is new.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, saidBefore } from "./helpers";
import type { Script } from "../tools/replay/run-script";

/** A conductor on this page with a FakeVoice, the stand-in model, and what they said before. */
async function play(page: Page, script: Script, before: unknown[] = []) {
  return page.evaluate(
    async ([s, changes]) => {
      const L = window.__longtake;
      const fake = new L.FakeVoice();
      const store = L.memoryProfileStore(L.applyChanges(L.emptyProfile(), changes as never).profile);
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        profile: store,
        services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start, understand: L.fakeUnderstanding() },
      });
      await conductor.start();
      await new Promise((r) => setTimeout(r, 20));
      const report = await L.runScript(conductor, fake, s);
      return { report, greeting: fake.opening?.greeting ?? "", prompt: fake.opening?.systemPrompt ?? "" };
    },
    [script, before] as const,
  );
}

test("a hedge waits, and a plain answer settles it — the agent heard both, no word list did", async ({ page }) => {
  await load(page, `<label for="n">Full name*</label><input id="n" required><label for="y">Years of experience*</label><input id="y" required>`);
  const { report } = await play(page, {
    name: "hedge",
    steps: [
      { user: "I'm Rohit Kashyap, maybe 2 or 3 years" },
      {
        tool: "fill_fields",
        args: {
          full_name: { value: "Rohit Kashyap", evidence: "I'm Rohit Kashyap", how: "named" },
          years_of_experience: { value: "3", evidence: "maybe 2 or 3 years", how: "unsure" },
        },
      },
      { expectResult: { justFilled: ["full_name"], waiting: ["years_of_experience"], doNextHas: "weren't sure" } },
      { user: "three" },
      { tool: "fill_fields", args: { years_of_experience: { value: "3", evidence: "three", how: "named" } } },
      { expectResult: { justFilled: ["years_of_experience"] } },
      { expectFinal: { values: { full_name: "Rohit Kashyap", years_of_experience: "3" } } },
    ],
  });
  expect(report.failures).toEqual([]);
});

test("an answer worked out rather than said waits for a yes; their yes puts it in", async ({ page }) => {
  await load(page, `<label for="p">Phone*</label><input id="p" type="tel" required><label for="w">WhatsApp number</label><input id="w" type="tel">`);
  const { report } = await play(page, {
    name: "inferred",
    steps: [
      { user: "my phone is 98765 43210, WhatsApp bhi wahi hai" },
      {
        tool: "fill_fields",
        args: {
          phone: { value: "98765 43210", evidence: "my phone is 98765 43210", how: "named" },
          whatsapp_number: { value: "98765 43210", evidence: "WhatsApp bhi wahi hai", how: "inferred" },
        },
      },
      { expectResult: { justFilled: ["phone"], waiting: ["whatsapp_number"], doNextHas: "You worked out" } },
      { user: "haan, wahi" },
      { tool: "confirm_answer", args: { field: "whatsapp_number", agreed: true, evidence: "haan, wahi" } },
      { expectResult: { justFilled: ["whatsapp_number"] } },
      { expectFinal: { values: { whatsapp_number: "98765 43210" } } },
    ],
  });
  expect(report.failures).toEqual([]);
});

test("a returning person hears what is done, is not read it, and is asked only what is new", async ({ page }) => {
  await load(
    page,
    `<h1>Apply</h1>
     <label for="f">First Name*</label><input id="f" required>
     <label for="l">Last Name*</label><input id="l" required>
     <label for="e">Email*</label><input id="e" type="email" required>
     <label for="c">Current city*</label><input id="c" required>
     <label for="s">Expected salary*</label><input id="s" required>`,
  );
  const known = saidBefore({
    "identity.first_name": ["Rohit", "mera naam Rohit Kashyap hai"],
    "identity.last_name": ["Kashyap", "mera naam Rohit Kashyap hai"],
    "contact.email": ["rohit@example.com", "rohit at example dot com"],
    "address.city": ["Kolkata", "Kolkata mein"],
  });
  const { greeting, prompt } = await play(page, { name: "returning", steps: [] }, known);
  expect(greeting).toMatch(/I've filled 4 from last time — your name, email and where you're based; 1 is new\. Want to hear them, or do the new ones\?$/);
  const doNext = prompt.slice(prompt.indexOf("DO NEXT:"));
  expect(doNext).toContain("Expected salary");
  for (const known of ["First Name", "Email", "Current city"]) expect(doNext).not.toContain(known);
  expect(prompt).toContain("Never read them out unless they ask");
});
