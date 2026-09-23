/**
 * Runs inside somebody else's page. This is where `core/` gets pointed at a live form.
 *
 * Nothing here knows anything about forms. The reading, writing, gating, planning and the voice
 * call are the same `LongtakeSession` and `startVoiceSession` the landing page runs — which is the
 * only reason a demo on the landing page proves anything about this. What is particular to an
 * extension is only plumbing: where the token comes from (the background worker, which may reach
 * the site), where the audio worklet is (inside the extension), where remembered answers live
 * (`chrome.storage`, so they follow the person from one site to the next), and a small panel.
 *
 * Built by `npm run build:extension` into `extension/dist/content.js`.
 */

import {
  CLEAR_TOOL_NAME,
  CONVERSATION_TURN_DETECTION,
  FILL_TOOL_NAME,
  LongtakeSession,
  MEMORY_VERSION,
  PRESS_TOOL_NAME,
  readForm,
  startVoiceSession,
  type Memory,
  type VoiceSession,
} from "@longtake/core";

import { Panel, type PanelView } from "./panel";

/** Our own panel, and nothing else, is never part of their form. */
const IGNORE = "[data-longtake-ignore]";
const MEMORY_KEY = "longtake.memory.v1";

// ── Remembered answers: chrome.storage, read once, then kept in step ─────────────────────

let memoryCache: Memory = {};
const memoryReady = chrome.storage.local
  .get(MEMORY_KEY)
  .then((stored) => {
    const saved = stored[MEMORY_KEY] as { version: number; memory: Memory } | undefined;
    if (saved?.version === MEMORY_VERSION) memoryCache = saved.memory ?? {};
  })
  .catch(() => undefined);

const memory = {
  load: () => memoryCache,
  save: (next: Memory) => {
    memoryCache = next;
    void chrome.storage.local.set({ [MEMORY_KEY]: { version: MEMORY_VERSION, memory: next } }).catch(() => undefined);
  },
};

// ── One call at a time, in this frame ────────────────────────────────────────────────────

type Call = { stop: () => Promise<void> };
let current: Call | null = null;

async function begin(): Promise<void> {
  if (current) return;
  await memoryReady;

  let voice: VoiceSession | null = null;
  let stopped = false;
  let transcript = "";
  let partial = "";
  let switched = false;
  let sentPrompt = "";
  const view: PanelView = { status: "reading", notices: [] };

  const panel = new Panel(() => void call.stop());
  const draw = () => panel.render(view);
  draw();

  /** Redraw the panel from the form as it is. */
  const refresh = () => {
    const state = session.state();
    view.progress = `${state.progress.filled} of ${state.progress.total} in · ${state.progress.requiredLeft} required left`;
    const waiting = state.fields.filter((f) => f.pending).map((f) => `Waiting for your yes: ${f.spec.label} → ${f.pending!.suggestion}`);
    const theirs = state.theirs.map((t) => `Yours to do by hand: ${t}`);
    view.notices = [...waiting, ...theirs];
    draw();
  };

  const session: LongtakeSession = new LongtakeSession({
    root: () => document,
    ignore: IGNORE,
    memory,
    onChange: () => refresh(),
    onReshape: () => {
      if (session.toolProblems().length > 0) return;
      voice?.setTools(session.tools());
      sentPrompt = session.prompt();
      voice?.setSystemPrompt(sentPrompt);
    },
  });

  /** Everything said so far, the turn still being spoken included. */
  const heard = () => `${transcript}\n${partial}`.trim();

  const runTool = async (name: string, args: Record<string, unknown>) => {
    if (name === FILL_TOOL_NAME) {
      const done = await session.fill(args, heard());
      if (!switched && done.outcomes.some((o) => o.status === "written")) {
        switched = true;
        voice?.setTurnDetection(CONVERSATION_TURN_DETECTION);
      }
      return done.result;
    }
    if (name === CLEAR_TOOL_NAME) return (await session.clear(args, heard())).result;
    if (name === PRESS_TOOL_NAME) {
      const result = (await session.press(args, heard())).result;
      // A Next that is a real page load (Google Forms posts each page) ends this script. The
      // background remembers the tab was live, and the next page picks the call up again.
      return result;
    }
    return { error: `Unknown tool "${name}".` };
  };

  /** The person typed or picked something themselves: bring the agent up to date once they pause. */
  const syncPrompt = () => {
    if (!voice || session.isWriting) return;
    const prompt = session.prompt();
    if (prompt === sentPrompt) return;
    sentPrompt = prompt;
    voice.setSystemPrompt(prompt);
  };
  let shapeTimer: ReturnType<typeof setTimeout> | undefined;
  let typeTimer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((records) => {
    if (records.every((r) => (r.target as Element).closest?.(IGNORE) || r.target === panelHost())) return;
    if (session.isWriting) {
      session.noteMoveDuringWrite();
      return;
    }
    clearTimeout(shapeTimer);
    shapeTimer = setTimeout(() => void session.pageChanged().then(syncPrompt), 500);
  });
  const onInput = (event: Event) => {
    if ((event.target as Element | null)?.closest?.(IGNORE) || session.isWriting) return;
    refresh();
    clearTimeout(typeTimer);
    typeTimer = setTimeout(syncPrompt, 1200);
  };

  const call: Call = {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      current = null;
      observer.disconnect();
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      clearTimeout(shapeTimer);
      clearTimeout(typeTimer);
      await voice?.stop();
      void chrome.runtime.sendMessage({ type: "longtake:active", active: false }).catch(() => undefined);
      view.status = "stopped";
      draw();
      setTimeout(() => panel.remove(), 2500);
    },
  };
  current = call;
  const stillLive = () => void chrome.runtime.sendMessage({ type: "longtake:active", active: true }).catch(() => undefined);
  stillLive();
  // A page that unloads mid-call (a form that posts each page) marks the moment, so the next page
  // carries on however long the call had been running.
  window.addEventListener("pagehide", () => {
    if (!stopped) stillLive();
  });

  try {
    await session.prefill();
    await session.open();
    refresh();
    const problems = session.toolProblems();
    if (problems.length > 0) throw new Error(`This form produced a tool the voice service would reject: ${problems[0]}`);

    view.status = "connecting";
    draw();
    const settings = (await chrome.storage.local.get("wsUrl")) as { wsUrl?: string };
    sentPrompt = session.prompt();
    voice = await startVoiceSession({
      voice: "charles",
      systemPrompt: sentPrompt,
      greeting: session.greeting(),
      tools: session.tools(),
      getToken: async () => {
        const reply = (await chrome.runtime.sendMessage({ type: "longtake:token" })) as { token?: string; error?: string };
        if (!reply?.token) throw new Error(reply?.error ?? "No token from the Longtake site.");
        return reply.token;
      },
      workletUrl: chrome.runtime.getURL("dist/pcm-processor.js"),
      ...(settings.wsUrl ? { wsUrl: settings.wsUrl } : {}),
      freshStart: () => {
        sentPrompt = session.prompt();
        return { systemPrompt: sentPrompt, greeting: session.resumeGreeting(), tools: session.tools() };
      },
      onToolCall: runTool,
      onResultsSent: () => {
        sentPrompt = session.prompt();
        voice?.setSystemPrompt(sentPrompt);
      },
      onReady: () => {
        view.status = "live";
        draw();
      },
      onReconnecting: () => {
        view.status = "reconnecting";
        draw();
      },
      onReconnected: () => {
        view.status = "live";
        draw();
      },
      onUserPartial: (text) => {
        partial = text;
        view.heard = text;
        draw();
      },
      onUserTranscript: (text) => {
        partial = "";
        transcript = `${transcript}\n${text}`.trim();
        view.heard = text;
        draw();
      },
      onAgentTranscript: (text) => {
        view.said = text;
        draw();
      },
      onError: (message) => {
        view.status = "error";
        view.error = message;
        draw();
      },
      onClosed: () => void call.stop(),
    });
    if (stopped) {
      await voice.stop();
      return;
    }

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-checked", "aria-selected"],
    });
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
  } catch (cause) {
    view.status = "error";
    view.error = cause instanceof Error ? cause.message : String(cause);
    draw();
    stopped = true;
    current = null;
    observer.disconnect();
    void chrome.runtime.sendMessage({ type: "longtake:active", active: false }).catch(() => undefined);
  }
}

function panelHost(): Element | null {
  return document.querySelector("longtake-panel");
}

// ── Messages from the background worker ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, reply) => {
  if (message?.type === "longtake:count") {
    // How much of a form this frame holds, so the background can pick the frame to run in: on a
    // careers page that embeds Greenhouse in an iframe, the form is in the frame, not the page.
    let fields = 0;
    try {
      fields = readForm(document, IGNORE).specs.filter((s) => !s.suspectedHoneypot).length;
    } catch {
      fields = 0;
    }
    reply({ fields, top: window === window.top });
    return;
  }
  if (message?.type === "longtake:toggle") {
    if (current) void current.stop();
    else void begin();
    reply({ ok: true });
    return;
  }
  if (message?.type === "longtake:resume") {
    // This tab was mid-call when the page changed under it — a form that loads each page afresh.
    if (!current) void begin();
    reply({ ok: true });
  }
});

// A page that loaded while this tab was live: ask whether to carry on.
void chrome.runtime
  .sendMessage({ type: "longtake:loaded", top: window === window.top })
  .catch(() => undefined);
