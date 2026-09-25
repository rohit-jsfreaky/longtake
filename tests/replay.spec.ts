/**
 * Whole conversations, scripted, through the one `Conductor` both the site and the extension run.
 *
 * A live failure is written down once as a script — what the person said, what the agent called,
 * what should have come back — and replayed on every change from then on. The same script through
 * the site's services and through the extension's must give the same results, or the two surfaces
 * have drifted apart again.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";
import type { Script } from "../tools/replay/run-script";

const FORM = `
  <h1>Volunteer application</h1>
  <label for="n">Full name*</label><input id="n" required>
  <label for="e">Email*</label><input id="e" type="email" required>
  <label for="h">How did you hear about us?</label>
  <select id="h"><option value="">Select…</option><option>Conference</option><option>LinkedIn</option><option>Social Media</option></select>
  <label for="w">Why do you want to volunteer?*</label><textarea id="w" required></textarea>`;

/** Written down from the second live run: Twitter is not on the list; "do it" is their yes. */
const TWITTER_THEN_YES: Script = {
  name: "twitter-then-yes",
  steps: [
    { user: "I'm Rohit Kashyap, rohit@example.com, I heard from Twitter" },
    {
      tool: "fill_fields",
      args: {
        full_name: { value: "Rohit Kashyap", evidence: "I'm Rohit Kashyap" },
        email: { value: "rohit@example.com", evidence: "rohit@example.com" },
        how_did_you_hear_about_us: { value: "Social Media", evidence: "I heard from Twitter" },
      },
    },
    { expectResult: { justFilled: ["full_name", "email"], waiting: ["how_did_you_hear_about_us"], doNextHas: "confirm_answer" } },
    { agentSays: "Got both. Twitter's not on their list — Social Media's closest. That one?" },
    { user: "do it" },
    { tool: "confirm_answer", args: { field: "how_did_you_hear_about_us", agreed: true, evidence: "do it" } },
    { expectResult: { justFilled: ["how_did_you_hear_about_us"] } },
    {
      expectFinal: {
        values: { full_name: "Rohit Kashyap", how_did_you_hear_about_us: "Social Media" },
        empty: ["why_do_you_want_to_volunteer"],
        promptHas: ["Why do you want to volunteer?"],
      },
    },
  ],
};

type Surface = "site" | "extension";

/** A conductor on this page with a FakeVoice, set up the way one of the two surfaces sets it up. */
async function run(page: Page, surface: Surface, script: Script) {
  return page.evaluate(
    async ([which, s]) => {
      const L = window.__longtake;
      const fake = new L.FakeVoice();
      const dictations: string[] = [];
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        logFrames: which === "site",
        services: {
          getToken: async () => "token",
          workletUrl: "",
          startVoice: fake.start,
          // Only the site reaches Dictation today.
          ...(which === "site"
            ? { dictate: async () => { dictations.push("called"); return { transcript: "", llm_response: null, llm_error: null } as never; } }
            : {}),
        },
      });
      await conductor.start();
      await new Promise((r) => setTimeout(r, 20)); // session.ready arrives on the next tick
      const report = await L.runScript(conductor, fake, s);
      return {
        report,
        status: conductor.view().status,
        sent: fake.sent.map((x) => x.kind),
        greeting: fake.opening?.greeting ?? "",
        log: conductor.copyLog(),
      };
    },
    [surface, script] as const,
  );
}

test.describe("a live failure, replayed as a script", () => {
  test("Twitter waits for a yes, and 'do it' — judged by the agent — puts it in", async ({ page }) => {
    await load(page, FORM);
    const out = await run(page, "site", TWITTER_THEN_YES);
    expect(out.report.failures).toEqual([]);
    expect(out.status).toBe("live");
  });

  test("the site and the extension give the same results for the same script", async ({ page }) => {
    await load(page, FORM);
    const site = await run(page, "site", TWITTER_THEN_YES);
    await load(page, FORM);
    const extension = await run(page, "extension", TWITTER_THEN_YES);
    expect(site.report.ok).toBe(true);
    expect(extension.report.ok).toBe(true);
    expect(JSON.stringify(extension.report.results)).toBe(JSON.stringify(site.report.results));
    expect(extension.greeting).toBe(site.greeting);
  });

  test("a failing expectation is reported, not swallowed", async ({ page }) => {
    await load(page, FORM);
    const out = await run(page, "extension", {
      name: "wrong-expectation",
      steps: [
        { user: "I'm Rohit" },
        { tool: "fill_fields", args: { full_name: { value: "Rohit", evidence: "I'm Rohit" } } },
        { expectResult: { justFilled: ["email"] } },
      ],
    });
    expect(out.report.ok).toBe(false);
    expect(out.report.failures[0]).toContain("just_filled");
  });
});

test.describe("what the conductor does around the tools", () => {
  test("the first answers switch the call to conversation timing, once", async ({ page }) => {
    await load(page, FORM);
    const out = await run(page, "extension", {
      name: "timing",
      steps: [
        { user: "I'm Rohit Kashyap" },
        { tool: "fill_fields", args: { full_name: { value: "Rohit Kashyap", evidence: "I'm Rohit Kashyap" } } },
        { user: "rohit@example.com" },
        { tool: "fill_fields", args: { email: { value: "rohit@example.com", evidence: "rohit@example.com" } } },
      ],
    });
    expect(out.sent.filter((k) => k === "transcriptionMode")).toHaveLength(1);
  });

  test("an answer that did not go in stays on screen until the field has something in it", async ({ page }) => {
    await load(page, FORM);
    const views = await page.evaluate(async () => {
      const L = window.__longtake;
      const fake = new L.FakeVoice();
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start },
      });
      await conductor.start();
      fake.userSays("my name is Rohit");
      // The agent sends it without any of their words: nothing goes in, and it says so.
      await fake.toolCall("fill_fields", { email: { value: "rohit@example.com", evidence: "" } });
      const before = conductor.view().missed.map((m) => `${m.question}: ${m.why}`);
      fake.userSays("rohit@example.com");
      await fake.toolCall("fill_fields", { email: { value: "rohit@example.com", evidence: "rohit@example.com" } });
      return { before, after: conductor.view().missed };
    });
    expect(views.before).toEqual(["Email: Longtake had none of your words for it"]);
    expect(views.after).toEqual([]);
  });

  test("typing by hand reaches the agent once they pause, and only if the form changed", async ({ page }) => {
    await load(page, FORM);
    await page.evaluate(async () => {
      const L = window.__longtake;
      const fake = new L.FakeVoice();
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start },
      });
      await conductor.start();
      Object.assign(window, { __fake: fake });
    });
    await page.fill("#n", "Rohit Kashyap");
    await page.waitForTimeout(1600);
    const prompts = await page.evaluate(
      () => (window as unknown as { __fake: { sent: { kind: string; value?: unknown }[] } }).__fake.sent.filter((s) => s.kind === "systemPrompt").map((s) => String(s.value)),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Full name: Rohit Kashyap (they typed it)");
  });

  test("the log holds every tool call and result in full", async ({ page }) => {
    await load(page, FORM);
    const out = await run(page, "extension", TWITTER_THEN_YES);
    const log = JSON.parse(out.log) as { log: { kind: string; text: string }[] };
    const tools = log.log.filter((l) => l.kind === "tool").map((l) => l.text);
    expect(tools.some((t) => t.startsWith("call fill_fields"))).toBe(true);
    expect(tools.some((t) => t.startsWith("result confirm_answer") && t.includes("Social Media"))).toBe(true);
  });
});
