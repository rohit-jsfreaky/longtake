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

      // The page reloads; the next one offers to carry on, and one Enter starts its own call,
      // told about the new page's questions.
      await page.waitForURL(/\/page2/, { timeout: 10_000 });
      await expect(page.locator("longtake-panel")).toHaveCount(1, { timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => agent.received[before + 1]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      const next = agent.received[before + 1]![0] as unknown as { session: { tools: { name: string; parameters: { properties: object } }[] } };
      const fill = next.session.tools.find((t) => t.name === "fill_fields")!;
      expect(Object.keys(fill.parameters.properties)).toEqual(["city"]);
      await expect(page.locator("longtake-panel")).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("the settings page shows saved answers, edits and removes them, and the chosen voice is used", async () => {
    const before = agent.sockets.length;
    const { context, worker } = await launch();
    try {
      const id = new URL(worker.url()).host;
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
      await expect(settings.getByLabel("Email")).toHaveValue("rohit@example.com");

      // Edit one, remove the other.
      await settings.getByLabel("Email").fill("rohit.k@example.com");
      await settings.locator(".row", { has: settings.getByLabel("Email") }).getByRole("button", { name: "Save" }).click();
      await settings.locator(".row", { has: settings.getByLabel("City") }).getByRole("button", { name: "Remove" }).click();
      await expect(settings.locator(".row")).toHaveCount(1);
      const stored = (await worker.evaluate(async () => (await chrome.storage.local.get("longtake.memory.v1"))["longtake.memory.v1"])) as {
        memory: Record<string, { value: string }>;
      };
      expect(Object.keys(stored.memory)).toEqual(["email"]);
      expect(stored.memory.email.value).toBe("rohit.k@example.com");

      // Choose a voice; every voice has a sample to play.
      await settings.getByRole("tab", { name: "Voice" }).click();
      await expect(settings.locator(".voice")).toHaveCount(11);
      await settings.locator(".voice", { hasText: "vera" }).click();
      await expect(settings.locator(".voice[aria-checked=true]")).toContainText("vera");
      const sample = await settings.evaluate(async () => (await fetch("voices/vera.wav")).headers.get("content-type"));
      expect(sample).toContain("audio");

      // The next call speaks in it, and prefills the edited answer.
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
});
