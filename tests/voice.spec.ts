/**
 * The call survives its line dropping, and says plainly why it could not start.
 *
 * `core/src/voice.ts` runs here for real — its sockets, audio graph and tool queue — against a
 * fake server: a stand-in `WebSocket` the test drives frame by frame, a silent microphone, and a
 * token counter. What is asserted is what goes over the wire: a drop inside 30 seconds sends
 * `session.resume` on a new token; a resume the server refuses, or a session the server ended,
 * starts a new session briefed from the form; nothing is retried after `stop()`.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, PROBE } from "./helpers";

/** Installed in the page before a call starts. Everything the test drives is on `window.__fake`. */
const FAKES = `
  window.__fake = { sockets: [], tokens: 0, events: [], micError: null, tokenError: null };
  class FakeSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.sent = [];
      window.__fake.sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 0);
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.drop(1000); }
    // Test controls
    serve(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
    drop(code = 1006) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const e = new Event('close'); e.code = code; this.dispatchEvent(e);
    }
  }
  window.WebSocket = FakeSocket;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__fake.micError) { const e = new Error('denied'); e.name = window.__fake.micError; throw e; }
    const ctx = new AudioContext();
    return ctx.createMediaStreamDestination().stream;
  };
  window.__fake.worklet = URL.createObjectURL(new Blob([
    "registerProcessor('pcm-processor', class extends AudioWorkletProcessor { process() { return true; } });"
  ], { type: 'text/javascript' }));
  window.__fake.getToken = async () => {
    if (window.__fake.tokenError) throw new Error(window.__fake.tokenError);
    return 'token-' + (++window.__fake.tokens);
  };
`;

type Fake = {
  sockets: { url: string; sent: { type: string; [k: string]: unknown }[]; serve: (m: unknown) => void; drop: (c?: number) => void }[];
  tokens: number;
  events: string[];
  micError: string | null;
  tokenError: string | null;
  worklet: string;
  getToken: () => Promise<string>;
};
type Win = Window & { __fake: Fake; __call: { stop: () => Promise<void> }; __error: unknown };

/**
 * A page on localhost, not `setContent`'s about:blank: browsers only give `mediaDevices` to a
 * secure context, and about:blank is not one — exactly like a real page served over plain http.
 */
async function setup(page: Page) {
  await page.route("http://localhost/call", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><p>call</p></body></html>" }),
  );
  await page.goto("http://localhost/call");
  await page.addScriptTag({ path: PROBE });
  await page.addScriptTag({ content: FAKES });
}

/** Start a call with a fresh-start config that names the moment it was asked for. */
async function call(page: Page, { fresh = true }: { fresh?: boolean } = {}) {
  await page.evaluate(async (withFresh) => {
    const w = window as unknown as Win;
    const L = window.__longtake;
    let asked = 0;
    w.__call = await L.startVoiceSession({
      systemPrompt: "PROMPT v1",
      greeting: "Hello",
      tools: [{ type: "function", name: "fill_fields" }],
      getToken: w.__fake.getToken,
      workletUrl: w.__fake.worklet,
      ...(withFresh
        ? { freshStart: () => ({ systemPrompt: `PROMPT fresh ${++asked}`, greeting: "Sorry, lost the line. 3 of 9 are in.", tools: [] }) }
        : {}),
      onReady: (id) => w.__fake.events.push(`ready:${id}`),
      onReconnecting: (n) => w.__fake.events.push(`reconnecting:${n}`),
      onReconnected: (how) => w.__fake.events.push(`reconnected:${how}`),
      onError: (m) => w.__fake.events.push(`error:${m}`),
      onClosed: () => w.__fake.events.push("closed"),
      onToolCall: async () => ({ ok: true }),
    });
  }, fresh);
}

const fake = (page: Page) => page.evaluate(() => {
  const f = (window as unknown as Win).__fake;
  return { urls: f.sockets.map((s) => s.url), sent: f.sockets.map((s) => s.sent.map((m) => m.type)), events: f.events, all: f.sockets.map((s) => s.sent) };
});

async function serve(page: Page, socket: number, message: unknown) {
  await page.evaluate(([i, m]) => (window as unknown as Win).__fake.sockets[i as number]!.serve(m), [socket, message] as const);
}
async function drop(page: Page, socket: number, code = 1006) {
  await page.evaluate(([i, c]) => (window as unknown as Win).__fake.sockets[i as number]!.drop(c as number), [socket, code] as const);
}
async function until(page: Page, test: (f: Awaited<ReturnType<typeof fake>>) => boolean, timeout = 5000) {
  await expect.poll(async () => test(await fake(page)), { timeout }).toBe(true);
}

test.describe("when the line drops", () => {
  test("inside 30 seconds it resumes the same session, on a new token", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.includes("session.update") ?? false);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await drop(page, 0);

    await until(page, (f) => f.urls.length === 2 && (f.sent[1]?.length ?? 0) > 0);
    let f = await fake(page);
    expect(f.urls[1]).toContain("token=token-2");
    expect(f.all[1]![0]).toEqual({ type: "session.resume", session_id: "sess_1" });

    await serve(page, 1, { type: "session.ready", session_id: "sess_1" });
    f = await fake(page);
    expect(f.events).toEqual(["ready:sess_1", "reconnecting:1", "reconnected:resumed"]);
    // Caught up with the form as it is now, since anything sent while the line was down was lost.
    expect(f.all[1]).toContainEqual({ type: "session.update", session: { system_prompt: "PROMPT fresh 1", tools: [] } });
  });

  test("a resume the server refuses starts a new session, briefed from the form", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.length === 1);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await drop(page, 0);
    await until(page, (f) => (f.sent[1]?.length ?? 0) > 0);

    await serve(page, 1, { type: "session.error", code: "session_not_found", message: "gone" });
    await drop(page, 1, 1008);
    await until(page, (f) => (f.sent[2]?.length ?? 0) > 0);

    const f = await fake(page);
    const fresh = f.all[2]![0] as { type: string; session: { system_prompt: string; greeting: string } };
    expect(fresh.type).toBe("session.update");
    expect(fresh.session.greeting).toBe("Sorry, lost the line. 3 of 9 are in.");
    expect(fresh.session.system_prompt).toMatch(/^PROMPT fresh/);
    // Not shown to the person as an error: it is the expected path after 30 seconds.
    expect(f.events.some((e) => e.startsWith("error:"))).toBe(false);

    await serve(page, 2, { type: "session.ready", session_id: "sess_2" });
    expect((await fake(page)).events).toContain("reconnected:fresh");
  });

  test("a session the server ended is not resumed — a new one starts", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.length === 1);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await serve(page, 0, { type: "session.ended" });
    await drop(page, 0, 1000);
    await until(page, (f) => (f.sent[1]?.length ?? 0) > 0);
    expect((await fake(page)).sent[1]![0]).toBe("session.update");
  });

  test("a tool result from before the drop is delivered once the session is back", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.length === 1);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await serve(page, 0, { type: "reply.started" });
    await serve(page, 0, { type: "tool.call", call_id: "call_7", name: "fill_fields", arguments: {} });
    await drop(page, 0);
    await until(page, (f) => (f.sent[1]?.length ?? 0) > 0);
    await serve(page, 1, { type: "session.ready", session_id: "sess_1" });

    // Straight away — not after the queue's 2.5-second deadline for a reply that will never finish.
    await until(page, (f) => f.all[1]!.some((m) => m.type === "tool.result"), 1000);
    const result = (await fake(page)).all[1]!.find((m) => m.type === "tool.result");
    expect(result).toMatchObject({ call_id: "call_7" });
  });

  test("a first connect that was refused is reported, not retried", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.length === 1);
    await drop(page, 0, 1008);
    await page.waitForTimeout(300);
    const f = await fake(page);
    expect(f.urls).toHaveLength(1);
    expect(f.events.join(" ")).toContain("Unauthorized");
  });

  test("stopping ends the session cleanly and never reconnects", async ({ page }) => {
    await setup(page);
    await call(page);
    await until(page, (f) => f.sent[0]?.length === 1);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await page.evaluate(() => {
      const w = window as unknown as Win;
      // The fake server answers session.end by closing, as the real one does.
      const socket = w.__fake.sockets[0]!;
      const send = (socket as unknown as { send: (d: string) => void }).send.bind(socket);
      (socket as unknown as { send: (d: string) => void }).send = (d: string) => {
        send(d);
        if (JSON.parse(d).type === "session.end") setTimeout(() => socket.drop(1000), 0);
      };
      return w.__call.stop();
    });
    await page.waitForTimeout(300);
    const f = await fake(page);
    expect(f.sent[0]).toContain("session.end");
    expect(f.urls).toHaveLength(1);
    expect(f.events).not.toContain("reconnecting:1");
  });

  test("without a way to start fresh, a drop past resuming ends the call with a reason", async ({ page }) => {
    await setup(page);
    await call(page, { fresh: false });
    await until(page, (f) => f.sent[0]?.length === 1);
    await serve(page, 0, { type: "session.ready", session_id: "sess_1" });
    await serve(page, 0, { type: "session.ended" });
    await drop(page, 0, 1000);
    await page.waitForTimeout(300);
    const f = await fake(page);
    expect(f.urls).toHaveLength(1);
    expect(f.events).toContain("closed");
  });
});

test.describe("deciding how to reconnect", () => {
  test("resume inside the window, fresh after it, give up after five tries", async ({ page }) => {
    await load(page, "<p>x</p>");
    const steps = await page.evaluate(() => {
      const { nextReconnect } = window.__longtake;
      const base = { sessionId: "s", droppedAt: 0, attempts: 0, ended: false };
      return [
        nextReconnect(base, 1000),
        nextReconnect({ ...base, attempts: 2 }, 20_000), // 20 s + 2 s back-off: still inside
        nextReconnect({ ...base, attempts: 2 }, 24_000), // 24 s + 2 s: past it
        nextReconnect(base, 26_000),
        nextReconnect({ ...base, ended: true }, 1000),
        nextReconnect({ ...base, sessionId: null }, 1000),
        nextReconnect({ ...base, attempts: 5 }, 1000),
      ].map((s) => s.action);
    });
    expect(steps).toEqual(["resume", "resume", "fresh", "fresh", "fresh", "fresh", "give-up"]);
  });
});

test.describe("when the call cannot start", () => {
  const cases: [string, string, RegExp][] = [
    ["NotAllowedError", "mic-denied", /allow the microphone/],
    ["NotFoundError", "no-mic", /No microphone/],
    ["NotReadableError", "mic-busy", /Another app/],
  ];
  for (const [name, problem, words] of cases) {
    test(`${name} is told as ${problem}, with what to do`, async ({ page }) => {
      await setup(page);
      const r = await page.evaluate(async (errorName) => {
        const w = window as unknown as Win;
        w.__fake.micError = errorName;
        try {
          await window.__longtake.startVoiceSession({
            systemPrompt: "p",
            greeting: "g",
            getToken: w.__fake.getToken,
            workletUrl: w.__fake.worklet,
          });
          return null;
        } catch (cause) {
          const e = cause as { problem?: string; message: string };
          return { problem: e.problem, message: e.message, sockets: w.__fake.sockets.length };
        }
      }, name);
      expect(r).toMatchObject({ problem, sockets: 0 });
      expect(r!.message).toMatch(words);
    });
  }

  test("a token that fails is its own problem, and opens no socket", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async () => {
      const w = window as unknown as Win;
      w.__fake.tokenError = "ASSEMBLYAI_API_KEY is not set.";
      try {
        await window.__longtake.startVoiceSession({ systemPrompt: "p", greeting: "g", getToken: w.__fake.getToken, workletUrl: w.__fake.worklet });
        return null;
      } catch (cause) {
        const e = cause as { problem?: string; message: string };
        return { problem: e.problem, message: e.message, sockets: w.__fake.sockets.length };
      }
    });
    expect(r).toMatchObject({ problem: "token", sockets: 0 });
    expect(r!.message).toContain("ASSEMBLYAI_API_KEY");
  });

  test("an insecure page is told so rather than 'permission denied'", async ({ page }) => {
    await load(page, "<p>x</p>");
    const r = await page.evaluate(() => {
      const e = window.__longtake.explainMicFailure({ name: "NotAllowedError" }, false);
      return { problem: e.problem, message: e.message };
    });
    expect(r.problem).toBe("insecure");
    expect(r.message).toContain("https");
  });
});

test.describe("picking up after a drop", () => {
  test("the new session's first words say where things stand and ask the next thing", async ({ page }) => {
    await load(
      page,
      `<label for="a">First Name</label><input id="a" required value="Rohit">
       <label for="b">Email</label><input id="b" type="email" required>`,
    );
    const line = await page.evaluate(async () => {
      const L = window.__longtake;
      let mem = {} as never;
      const s = new L.LongtakeSession({ root: () => document, ignore: "", memory: { load: () => mem, save: (m) => { mem = m as never; } } });
      await s.open();
      return s.resumeGreeting();
    });
    expect(line).toBe("Sorry, lost the line for a second. 1 of 2 are in. Next up: Email.");
  });
});
