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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

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

type Agent = { sockets: WebSocket[]; received: { type: string; [k: string]: unknown }[][] };

let server: Server;
let agent: Agent;
let port: number;

test.beforeAll(async () => {
  agent = { sockets: [], received: [] };
  let tokens = 0;
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/voice-token")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: `tok-${++tokens}` }));
      return;
    }
    // A form that loads each page afresh, the way Google Forms posts every page.
    if (req.url?.startsWith("/page1")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body><h1>Volunteer sign-up</h1>
        <form action="/page2" method="get"><label for="n">Full name</label><input id="n" name="n" required>
        <button type="submit">Next</button></form></body></html>`);
      return;
    }
    if (req.url?.startsWith("/page2")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body><h1>Volunteer sign-up</h1>
        <form action="/done" method="get"><label for="c">City</label><input id="c" name="c" required>
        <button type="submit">Submit</button></form></body></html>`);
      return;
    }
    if (req.url?.startsWith("/form")) {
      res.writeHead(200, { "content-type": "text/html", "content-security-policy": "connect-src 'self'" });
      res.end(FORM);
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, path: "/v1/ws" });
  wss.on("connection", (socket) => {
    const index = agent.sockets.push(socket) - 1;
    agent.received[index] = [];
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "input.audio") return;
      agent.received[index]!.push(message);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((done) => server.close(done));
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

const serve = (i: number, message: unknown) => agent.sockets[i]!.send(JSON.stringify(message));

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
        await (globalThis as unknown as { longtakeToggle: (id: number) => Promise<void> }).longtakeToggle(tab!.id!);
      });

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

      // The page reloads; the next one starts its own call, told about the new page's questions.
      await page.waitForURL(/\/page2/, { timeout: 10_000 });
      await expect.poll(() => agent.received[before + 1]?.[0]?.type ?? null, { timeout: 20_000 }).toBe("session.update");
      const next = agent.received[before + 1]![0] as unknown as { session: { tools: { name: string; parameters: { properties: object } }[] } };
      const fill = next.session.tools.find((t) => t.name === "fill_fields")!;
      expect(Object.keys(fill.parameters.properties)).toEqual(["city"]);
      await expect(page.locator("longtake-panel")).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
});
