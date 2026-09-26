/**
 * The extension, loaded unpacked into a real Chromium, filling a form on a page it does not own.
 *
 * A fake Voice Agent server stands in for AssemblyAI — the token route and the WebSocket — so the
 * whole path runs: hotkey → the frame with the form → the same `LongtakeSession` → token from the
 * background worker → voice socket from the content script → a `tool.call` → the page's inputs.
 *
 * The form page is served from a different origin than the fake server, with a Content Security
 * Policy of `connect-src 'self'` — the shape of a locked-down careers site. If a page's CSP applied
 * to the extension's socket, the call would never connect there.
 *
 * Needs Playwright's own Chromium: branded Chrome stopped loading unpacked extensions from the
 * command line in version 137.
 */

/// <reference types="chrome" />
import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";
import { resolve } from "node:path";

import { readFileSync } from "node:fs";

import { applyChanges, emptyProfile, parseProfile, type ProfileChange } from "../core/src/profile";
import { startFakeAgentServer, type FakeAgentServer } from "./support/fake-agent-server";

const EXTENSION = resolve(process.cwd(), "extension");

const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>Apply</title></head><body>
  <h1>Senior Engineer — Apply</h1>
  <form onsubmit="event.preventDefault(); document.getElementById('sent').textContent = 'SENT'">
    <label for="first">First Name</label><input id="first" required>
    <label for="last">Last Name</label><input id="last" required>
    <label for="email">Email</label><input id="email" type="email" required>
    <button type="submit">Submit application</button>
  </form>
  <div id="sent">not sent</div>
</body></html>`;

let agent: FakeAgentServer;
let port: number;

test.beforeAll(async () => {
  agent = await startFakeAgentServer({
    // A form that loads each page afresh, the way Google Forms posts every page.
    "/page1": {
      html: `<!doctype html><html><body><h1>Volunteer sign-up</h1>
        <form action="/page2" method="get"><label for="n">Full name</label><input id="n" name="n" required>
        <button type="submit">Next</button></form></body></html>`,
    },
    "/page2": {
      html: `<!doctype html><html><body><h1>Volunteer sign-up</h1>
        <form action="/done" method="get"><label for="c">City</label><input id="c" name="c" required>
        <button type="submit">Submit</button></form></body></html>`,
    },
    "/form": { html: FORM, headers: { "content-security-policy": "connect-src 'self'" } },
  });
  port = agent.port;
});

test.afterAll(async () => {
  await agent.close();
});

async function launch(): Promise<{ context: BrowserContext; worker: Worker }> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Point the extension at the fake server: token from it, voice socket to it.
  await worker.evaluate(
    (p) => chrome.storage.local.set({ site: `http://127.0.0.1:${p}`, wsUrl: `ws://127.0.0.1:${p}/v1/ws` }),
    port,
  );
  return { context, worker };
}

const serve = (i: number, message: unknown) => agent.serve(i, message);

test.describe("the extension on someone else's page", () => {
  test.setTimeout(60_000);

  test("the hotkey starts a call, a tool call fills their form, and Submit is left alone", async () => {
    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      // localhost, not 127.0.0.1: a different origin from the server the socket goes to.
      await page.goto(`http://localhost:${port}/form`);
      await page.waitForTimeout(500);

      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: "http://localhost/*" });
        // A second copy of the script, as the background injects into a tab opened before the
        // extension was: it must not answer twice or open two panels.
        await chrome.scripting.executeScript({ target: { tabId: tab!.id!, allFrames: true }, files: ["dist/content.js"] });
        await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
      });
      // The hotkey only opens the panel; nothing listens until the person presses Start.
      await page.waitForTimeout(300);
      await expect(page.locator("longtake-panel")).toHaveCount(1);
      await page.waitForTimeout(300);
      expect(agent.sockets.length).toBe(0);
      await page.keyboard.press("Enter"); // Start has the focus

      // The call opens despite the page's CSP, with a token from the background worker.
      await expect.poll(() => agent.received[0]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      const opening = agent.received[0]![0] as unknown as { session: { greeting: string; system_prompt: string; tools: { name: string; parameters: unknown }[] } };
      expect(opening.session.greeting).toContain("3 questions");
      const fill = opening.session.tools.find((t) => t.name === "fill_fields")!;
      expect(Object.keys((fill.parameters as { properties: object }).properties)).toEqual(["first_name", "last_name", "email"]);
      // Our own panel is on the page and not in the tool: nothing called "Stop".
      expect(JSON.stringify(opening.session.tools)).not.toMatch(/stop/i);
      await expect(page.locator("longtake-panel")).toHaveCount(1);

      serve(0, { type: "session.ready", session_id: "sess_x" });
      serve(0, { type: "transcript.user", text: "I'm Rohit Kashyap, rohit at example dot com" });
      serve(0, {
        type: "tool.call",
        call_id: "c1",
        name: "fill_fields",
        arguments: {
          first_name: { value: "Rohit", evidence: "Rohit Kashyap" },
          last_name: { value: "Kashyap", evidence: "Rohit Kashyap" },
          email: { value: "rohit@example.com", evidence: "rohit at example dot com" },
        },
      });

      await expect(page.locator("#first")).toHaveValue("Rohit");
      await expect(page.locator("#last")).toHaveValue("Kashyap");
      await expect(page.locator("#email")).toHaveValue("rohit@example.com");

      await expect.poll(() => agent.received[0]!.some((m) => m.type === "tool.result"), { timeout: 10_000 }).toBe(true);
      const result = JSON.parse(String(agent.received[0]!.find((m) => m.type === "tool.result")!.result));
      expect(result.submitted).toBe(false);
      expect(String(result.do_next)).toContain("Submit application");
      await expect(page.locator("#sent")).toHaveText("not sent");

      // The line drops: the extension resumes the same session on a new token.
      agent.sockets[0]!.terminate();
      await expect.poll(() => agent.received[1]?.[0] ?? null, { timeout: 10_000 }).toEqual({
        type: "session.resume",
        session_id: "sess_x",
      });
    } finally {
      await context.close();
    }
  });

  test("the hotkey again stops the call and ends the session cleanly", async () => {
    const before = agent.sockets.length;
    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/form`);
      await page.waitForTimeout(500);
      const press = () =>
        worker.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ url: "http://localhost/*" });
          await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
        });

      await press();
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => agent.received[before]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      serve(before, { type: "session.ready", session_id: "sess_y" });
      await page.waitForTimeout(300);

      await press();
      await expect.poll(() => agent.received[before]!.some((m) => m.type === "session.end"), { timeout: 10_000 }).toBe(true);
      await page.waitForTimeout(1500);
      expect(agent.sockets.length).toBe(before + 1); // no reconnect after a stop
    } finally {
      await context.close();
    }
  });

  test("a Next that loads a new page carries the call on to it", async () => {
    const before = agent.sockets.length;
    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/page1`);
      await page.waitForTimeout(500);
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: "http://localhost/*" });
        await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
      });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => agent.received[before]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      serve(before, { type: "session.ready", session_id: "sess_p1" });
      serve(before, { type: "transcript.user", text: "Rohit Kashyap. Haan, next page" });
      serve(before, {
        type: "tool.call",
        call_id: "c1",
        name: "fill_fields",
        arguments: { full_name: { value: "Rohit Kashyap", evidence: "Rohit Kashyap" } },
      });
      await expect(page.locator("#n")).toHaveValue("Rohit Kashyap");
      serve(before, { type: "tool.call", call_id: "c2", name: "press_form_button", arguments: { action: "next_next", evidence: "next page" } });

      // The page reloads, and the call carries on by itself — no click: the same session resumed,
      // so the agent keeps the conversation (live, a Google Form's Next closed the call and it had
      // to be started again).
      await page.waitForURL(/\/page2/, { timeout: 10_000 });
      await expect(page.locator("longtake-panel")).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(() => agent.received[before + 1]?.[0] ?? null, { timeout: 20_000 }).toEqual({ type: "session.resume", session_id: "sess_p1" });
      serve(before + 1, { type: "session.ready", session_id: "sess_p1" });

      // Caught up with the new page's form, and the Next it pressed answered from this page.
      await expect.poll(() => agent.received[before + 1]!.some((m) => m.type === "tool.result" && m.call_id === "c2"), { timeout: 10_000 }).toBe(true);
      const update = agent.received[before + 1]!.find((m) => m.type === "session.update") as unknown as { session: { tools: { name: string; parameters: { properties: object } }[] } };
      const fill = update.session.tools.find((t) => t.name === "fill_fields")!;
      expect(Object.keys(fill.parameters.properties)).toEqual(["city"]);
      // The Next it pressed, answered from this page. (The fill before it may be answered too: its
      // result, if it had not been sent, travels with the page.)
      const answered = agent.received[before + 1]!.find((m) => m.type === "tool.result" && m.call_id === "c2")!;
      expect(JSON.parse(String(answered.result))).toMatchObject({ pressed: true, form_changed: { new_page: true, new_questions: ["City"] }, submitted: false });
      await expect(page.locator("longtake-panel")).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("the settings page moves the first memory over, shows where each answer came from, edits, removes and imports — and the chosen voice is used", async () => {
    const before = agent.sockets.length;
    const { context, worker } = await launch();
    try {
      const id = new URL(worker.url()).host;
      // Saved by the first version of the memory: moved over the first time anything reads it.
      await worker.evaluate(() =>
        chrome.storage.local.set({
          "longtake.memory.v1": {
            version: 1,
            memory: {
              email: { key: "email", value: "rohit@example.com", evidence: "rohit at example dot com", askedAs: "Email", savedAt: 1, sourceUrl: "https://job-boards.greenhouse.io/x" },
              city: { key: "city", value: "Kolkata", evidence: "Kolkata mein", askedAs: "City", savedAt: 1, sourceUrl: "https://job-boards.greenhouse.io/x" },
            },
          },
        }),
      );
      const settings = await context.newPage();
      await settings.goto(`chrome-extension://${id}/options.html`);
      await expect(settings.locator(".row")).toHaveCount(2);
      await expect(settings.getByRole("heading", { name: "Contact" })).toBeVisible();
      await expect(settings.getByRole("heading", { name: "Address" })).toBeVisible();
      await expect(settings.getByLabel("email", { exact: true })).toHaveValue("rohit@example.com");
      await expect(settings.locator(".row", { has: settings.getByLabel("email", { exact: true }) })).toContainText("job-boards.greenhouse.io");
      const moved = (await worker.evaluate(async () => chrome.storage.local.get(null))) as Record<string, unknown>;
      expect(moved["longtake.memory.v1"]).toBeUndefined();

      // Edit one: it keeps its history. Remove the other.
      await settings.getByLabel("email", { exact: true }).fill("rohit.k@example.com");
      await settings.locator(".row", { has: settings.getByLabel("email", { exact: true }) }).getByRole("button", { name: "Save" }).click();
      await expect(settings.locator(".row", { has: settings.getByLabel("email", { exact: true }) })).toContainText("Edited by you");
      await expect(settings.getByText("History (2)")).toBeVisible();
      await settings.locator(".row", { has: settings.getByLabel("city", { exact: true }) }).getByRole("button", { name: "Remove" }).click();
      await expect(settings.locator(".row")).toHaveCount(1);
      const stored = (await worker.evaluate(async () => (await chrome.storage.local.get("longtake.profile.v2"))["longtake.profile.v2"])) as {
        facts: Record<string, { value: string; history: { source: string }[] }>;
      };
      expect(Object.keys(stored.facts)).toEqual(["contact.email"]);
      expect(stored.facts["contact.email"]!.value).toBe("rohit.k@example.com");
      expect(stored.facts["contact.email"]!.history.map((h) => h.source)).toEqual(["migrated", "edited"]);

      // A file of answers: previewed first, then brought in.
      const file = JSON.stringify({
        longtake: "profile",
        version: 2,
        facts: { "links.github": { concept: "links.github", value: "github.com/rohitk", updatedAt: 5, history: [] } },
        answers: {},
      });
      await settings.locator("#import-file").setInputFiles({ name: "profile.json", mimeType: "application/json", buffer: Buffer.from(file) });
      await expect(settings.locator("#import-preview")).toContainText("1 answer in this file · 1 new");
      await settings.getByRole("button", { name: "Bring them in" }).click();
      await expect(settings.locator(".row")).toHaveCount(2);
      await expect(settings.getByLabel("GitHub", { exact: false })).toHaveValue("github.com/rohitk");

      // Choose a voice; every voice has a sample to play.
      await settings.getByRole("tab", { name: "Voice" }).click();
      await expect(settings.locator(".voice")).toHaveCount(11);
      await settings.locator(".voice", { hasText: "vera" }).click();
      await expect(settings.locator(".voice[aria-checked=true]")).toContainText("vera");
      const sample = await settings.evaluate(async () => (await fetch("voices/vera.wav")).headers.get("content-type"));
      expect(sample).toContain("audio");

      // The next call speaks in it, and puts the edited answer in — their own edit goes in unasked.
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/form`);
      await page.waitForTimeout(500);
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: "http://localhost/*" });
        await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
      });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => agent.received[before]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      const opening = agent.received[before]![0] as unknown as { session: { output: { voice: string } } };
      expect(opening.session.output.voice).toBe("vera");
      await expect(page.locator("#email")).toHaveValue("rohit.k@example.com");
    } finally {
      await context.close();
    }
  });

  test("the settings page exports what it knows, forgets everything, and the file brings back exactly the same answers", async () => {
    const { context, worker } = await launch();
    try {
      const id = new URL(worker.url()).host;
      const said = (concept: string, value: string, evidence: string): ProfileChange => ({
        type: "observe",
        key: { concept },
        gist: concept,
        value,
        from: { value, evidence, source: "spoken", host: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/x", askedAs: concept, formTitle: "", at: 1_790_000_000_000 },
      });
      const known = applyChanges(emptyProfile(), [
        said("identity.first_name", "Asha", "mera naam Asha Verma hai"),
        said("contact.email", "asha.verma@example.com", "email hai asha.verma@example.com"),
        said("contact.phone", "+91 98765 43210", "phone number +91 98765 43210"),
      ]).profile;
      await worker.evaluate((profile) => chrome.storage.local.set({ "longtake.profile.v2": profile }), known);

      const settings = await context.newPage();
      await settings.goto(`chrome-extension://${id}/options.html`);
      await expect(settings.locator(".row")).toHaveCount(3);

      // Export: a file of it.
      const [download] = await Promise.all([settings.waitForEvent("download"), settings.getByRole("button", { name: "Export" }).click()]);
      const file = readFileSync(await download.path(), "utf8");
      const exported = parseProfile(file)!;
      expect(Object.keys(exported.facts).sort()).toEqual(Object.keys(known.facts).sort());

      // Forget everything: asked first, then really everything.
      settings.once("dialog", (dialog) => void dialog.accept());
      await settings.getByRole("button", { name: "Forget everything" }).click();
      await expect(settings.locator(".row")).toHaveCount(0);
      const emptied = (await worker.evaluate(async () => (await chrome.storage.local.get("longtake.profile.v2"))["longtake.profile.v2"])) as { facts: object };
      expect(emptied.facts).toEqual({});

      // The file brings back the same answers, with the words they came from.
      await settings.locator("#import-file").setInputFiles({ name: "profile.json", mimeType: "application/json", buffer: Buffer.from(file) });
      await expect(settings.locator("#import-preview")).toContainText("3 answers in this file · 3 new");
      await settings.getByRole("button", { name: "Bring them in" }).click();
      await expect(settings.locator(".row")).toHaveCount(3);
      const back = (await worker.evaluate(async () => (await chrome.storage.local.get("longtake.profile.v2"))["longtake.profile.v2"])) as typeof known;
      for (const [factId, fact] of Object.entries(known.facts)) {
        expect(back.facts[factId]!.value).toEqual(fact.value);
        expect(back.facts[factId]!.history.map((h) => h.evidence)).toEqual(fact.history.map((h) => h.evidence));
      }
    } finally {
      await context.close();
    }
  });

  // The settings race, fixed at its root: an edit on the settings page while a call on another tab
  // saves new answers. Both were whole-map writes once, and the slower one undid the other.
  test("an edit on the settings page during a call survives the call's own new answers", async () => {
    const before = agent.sockets.length;
    const { context, worker } = await launch();
    try {
      const id = new URL(worker.url()).host;
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/form`);
      await page.waitForTimeout(500);
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: "http://localhost/*" });
        await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
      });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => agent.received[before]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      serve(before, { type: "session.ready", session_id: "sess_race" });

      // First answer: the email, kept for next time.
      serve(before, { type: "transcript.user", text: "my email is rohit at example dot com" });
      serve(before, { type: "tool.call", call_id: "r1", name: "fill_fields", arguments: { email: { value: "rohit@example.com", evidence: "rohit at example dot com" } } });
      await expect(page.locator("#email")).toHaveValue("rohit@example.com");
      const settings = await context.newPage();
      await settings.goto(`chrome-extension://${id}/options.html`);
      await expect(settings.getByLabel("email", { exact: true })).toHaveValue("rohit@example.com");

      // The person corrects it in settings, mid-call…
      await settings.getByLabel("email", { exact: true }).fill("work@example.com");
      await settings.locator(".row", { has: settings.getByLabel("email", { exact: true }) }).getByRole("button", { name: "Save" }).click();
      // …while the call saves their name.
      serve(before, { type: "transcript.user", text: "and I'm Rohit Kashyap" });
      serve(before, {
        type: "tool.call",
        call_id: "r2",
        name: "fill_fields",
        arguments: { first_name: { value: "Rohit", evidence: "Rohit Kashyap" }, last_name: { value: "Kashyap", evidence: "Rohit Kashyap" } },
      });
      await expect(page.locator("#last")).toHaveValue("Kashyap");
      await expect(settings.locator(".row")).toHaveCount(3); // the call's answers appear here as they are said

      const facts = (await worker.evaluate(async () => (await chrome.storage.local.get("longtake.profile.v2"))["longtake.profile.v2"])) as {
        facts: Record<string, { value: string }>;
      };
      expect(facts.facts["contact.email"]!.value).toBe("work@example.com");
      expect(facts.facts["identity.first_name"]!.value).toBe("Rohit");
      expect(facts.facts["identity.last_name"]!.value).toBe("Kashyap");
      expect(agent.understood()).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
