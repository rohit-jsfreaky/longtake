/**
 * Runs inside somebody else's page. This is where `core/` gets pointed at a live form.
 *
 * Nothing here knows anything about forms or calls. The whole call — reading, writing, gating,
 * planning, the voice, the tools, watching the page — is the same `Conductor` the landing page
 * runs, which is the only reason a demo or a replay on the site proves anything about this. What is
 * particular to an extension is only plumbing: where the token comes from (the background worker,
 * which may reach the site), where the audio worklet is (inside the extension), where what is
 * known about the person lives (the background worker owns it, so it follows them from one site to
 * the next), and the panel.
 *
 * The toolbar icon or the hotkey opens the panel; its Start button starts the call. See panel.ts
 * for why the call waits for that click.
 *
 * Built by `npm run build:extension` into `extension/dist/content.js`.
 */

import { Conductor, readForm, type ConductorView, type FormSnapshot } from "@longtake/core";

import { miss, notice, Panel, type PanelView } from "./panel";
import { profileClient } from "./profile-client";

/** Our own panel, and nothing else, is never part of their form. */
const IGNORE = "[data-longtake-ignore]";
/** What each field means, from the site's model route — reached through the background worker. */
async function understand(snapshot: FormSnapshot): Promise<unknown> {
  const reply = (await chrome.runtime.sendMessage({ type: "longtake:api", path: "/api/understand", body: snapshot })) as
    | { status?: number; body?: { error?: string }; error?: string }
    | undefined;
  if (!reply || reply.error || !reply.status || reply.status >= 400) {
    throw new Error(reply?.error ?? reply?.body?.error ?? "The Longtake site did not answer.");
  }
  return reply.body;
}

const tellBackground = (message: Record<string, unknown>) =>
  void chrome.runtime.sendMessage(message).catch(() => undefined);

/** How many questions this frame holds, without opening anything. */
function countQuestions(): number {
  try {
    return readForm(document, undefined, IGNORE).specs.filter((s) => !s.suspectedHoneypot && s.kind !== "file").length;
  } catch {
    return 0;
  }
}

// ── The panel, and at most one call, in this frame ───────────────────────────────────────

let panel: Panel | null = null;
let panelView: PanelView = { state: { kind: "ready", questions: 0 }, notices: [] };
let conductor: Conductor | null = null;
let unsubscribe: (() => void) | null = null;

const draw = () => panel?.render(panelView);

function openPanel(carrying = false): void {
  if (!panel) {
    panel = new Panel({
      start: () => void begin(),
      stop: () => void conductor?.stop(),
      close: () => closePanel(),
      settings: (tab) => tellBackground({ type: "longtake:settings", tab }),
      copyLog: () => void navigator.clipboard.writeText(conductor?.copyLog() ?? "{}").catch(() => undefined),
    });
  }
  const questions = countQuestions();
  panelView = { state: questions > 0 ? { kind: "ready", questions, carrying } : { kind: "empty" }, notices: [] };
  draw();
}

function closePanel(): void {
  void conductor?.stop();
  unsubscribe?.();
  unsubscribe = null;
  conductor = null;
  panel?.remove();
  panel = null;
  tellBackground({ type: "longtake:active", active: false });
}

/** The conductor's view, as the panel draws it. */
function toPanel(view: ConductorView): PanelView {
  const state: PanelView["state"] =
    view.status === "error"
      ? { kind: "error", message: view.error ?? "Something went wrong." }
      : view.status === "idle"
        ? panelView.state
        : { kind: view.status };
  const { form } = view;
  const lastSaid = [...view.turns].reverse().find((t) => t.who === "agent")?.text;
  const lastHeard = view.partial || [...view.turns].reverse().find((t) => t.who === "you")?.text;
  return {
    state,
    progress: `${form.progress.filled} of ${form.progress.total} in · ${form.progress.requiredLeft} required left`,
    ...(lastHeard ? { heard: lastHeard } : {}),
    ...(lastSaid ? { said: lastSaid } : {}),
    notices: [
      ...view.missed.map((m) => miss("Didn't go in:", `${m.question} — ${m.why}`)),
      ...form.fields.filter((f) => f.pending).map((f) => notice("Waiting for your yes:", `${f.spec.label} → ${f.pending!.suggestion}`)),
      ...form.fields.filter((f) => f.error && f.value !== null).map((f) => notice("The form says:", `${f.spec.label} — ${f.error}`)),
      ...form.theirs.map((t) => notice("Yours to do by hand:", t)),
    ],
  };
}

async function begin(): Promise<void> {
  if (conductor?.running) return;
  const settings = (await chrome.storage.local.get(["wsUrl", "voice"])) as { wsUrl?: string; voice?: string };

  conductor ??= new Conductor({
    root: () => document,
    ignore: IGNORE,
    profile: profileClient,
    services: {
      getToken: async () => {
        const reply = (await chrome.runtime.sendMessage({ type: "longtake:token" })) as { token?: string; error?: string };
        if (!reply?.token) throw new Error(reply?.error ?? "No token from the Longtake site.");
        return reply.token;
      },
      workletUrl: chrome.runtime.getURL("dist/pcm-processor.js"),
      ...(settings.wsUrl ? { wsUrl: settings.wsUrl } : {}),
      voice: settings.voice ?? "charles",
      understand,
    },
    onActive: (active) => tellBackground({ type: "longtake:active", active }),
  });
  unsubscribe ??= conductor.subscribe((view) => {
    panelView = toPanel(view);
    draw();
  });
  await conductor.start();
}

// A page that unloads mid-call (a form that posts each page) marks the moment, so the next page
// offers to carry on however long the call had been running.
window.addEventListener("pagehide", () => {
  if (conductor?.running) tellBackground({ type: "longtake:active", active: true });
});

// ── Messages from the background worker ─────────────────────────────────────────────────

/**
 * Loaded once per frame, whichever way it arrived. The manifest loads it into every page, and the
 * background also injects it into a tab that was open before the extension was — a second copy
 * would answer every message twice and open two panels.
 */
const loaded = globalThis as typeof globalThis & { __longtakeContent?: boolean };
if (!loaded.__longtakeContent) {
  loaded.__longtakeContent = true;
  listen();
}

function listen(): void {
  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, reply) => {
    if (message?.type === "longtake:count") {
      // How much of a form this frame holds, so the background can pick the frame to open in: on
      // a careers page that embeds Greenhouse in an iframe, the form is in the frame, not the page.
      reply({ fields: countQuestions(), top: window === window.top });
      return;
    }
    if (message?.type === "longtake:toggle") {
      // The icon or the hotkey: open the panel; stop a call that is running; close an idle panel.
      if (!panel) openPanel();
      else if (conductor?.running) void conductor.stop();
      else closePanel();
      reply({ ok: true });
      return;
    }
    if (message?.type === "longtake:resume") {
      // This tab was mid-call when the page changed under it. Offer to carry on — one click, since
      // the browser will not start a page's audio without one.
      if (!panel) openPanel(true);
      reply({ ok: true });
    }
  });

  // A page that loaded while this tab was live: ask whether to carry on.
  tellBackground({ type: "longtake:loaded", top: window === window.top });
}
