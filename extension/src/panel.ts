/**
 * Longtake's own window on somebody else's page.
 *
 * Opened by the toolbar icon or the hotkey. It does not start listening by itself: it says what it
 * found and offers a Start button. That click is the person's own, inside the page — which is what
 * the browser needs before it lets a page's audio start. A hotkey or a toolbar click is not a
 * gesture the page ever sees, and a call started from one alone can sit at "Connecting" for ever
 * with its audio suspended.
 *
 * Inside a closed shadow root, so the page's CSS cannot reach it, its CSS cannot leak out, and the
 * page's scripts cannot read what the person said. The host carries `data-longtake-ignore`, so the
 * reader never mistakes our Start button for a question on their form.
 *
 * Styled after the site: near-black panel, hairline borders, one mint accent, the same mark.
 */

import { cue } from "./sound";

export type PanelState =
  | { kind: "ready"; questions: number; carrying?: boolean }
  | { kind: "empty" }
  | { kind: "reading" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "reconnecting" }
  | { kind: "stopped" }
  | { kind: "error"; message: string };

export type PanelView = {
  state: PanelState;
  /** "8 of 24 in · 3 required left" */
  progress?: string;
  heard?: string;
  /** They are talking right now, as the microphone hears it — said before their words come back. */
  hearing?: boolean;
  /** They finished and the agent has not answered yet: said, so the call never looks dead. */
  thinking?: boolean;
  said?: string;
  notices: string[];
  /** What to look at before sending, grouped; an item with a field jumps to it on the page. */
  review?: { title: string; items: { fieldId?: string; question: string; detail: string }[] }[];
};

export type PanelActions = {
  start: () => void;
  stop: () => void;
  close: () => void;
  /** Open the settings page: saved answers, or the voice. */
  settings: (tab: "memory" | "voice") => void;
  /** Copy what happened this call — every tool call and result — for a bug report. */
  copyLog: () => void;
  /** Bring a field into view and flash its badge. */
  focus: (fieldId: string) => void;
};


const MARK = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
  <path d="M2 16 C2 6.2 6.2 2 16 2 C25.8 2 30 6.2 30 16 C30 25.8 25.8 30 16 30 C6.2 30 2 25.8 2 16 Z" fill="#FAFAFA"/>
  <rect x="8.5" y="13" width="2" height="6" rx="1" fill="#0A0A0B"/><rect x="12" y="9.5" width="2" height="13" rx="1" fill="#0A0A0B"/>
  <rect x="15.5" y="11.5" width="2" height="9" rx="1" fill="#0A0A0B"/><rect x="19" y="8.5" width="2" height="15" rx="1" fill="#0A0A0B"/>
  <rect x="22.5" y="12.5" width="2" height="7" rx="1" fill="#0A0A0B"/>
</svg>`;

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* A small utility window, drawn the way macOS draws one: a crisp dark edge, a soft stack of shadow
     under it, and inside, a one-pixel highlight along the top — the light catching its rim. */
  .box {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    width: 340px; max-height: min(70vh, 560px); display: flex; flex-direction: column;
    font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fafafa;
    background: linear-gradient(180deg, rgba(26,27,30,.94) 0%, rgba(11,12,14,.97) 100%);
    -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
    border-radius: 18px;
    box-shadow:
      0 0 0 .5px rgba(0,0,0,.9),
      0 1px 1px rgba(0,0,0,.2),
      0 4px 8px -2px rgba(0,0,0,.25),
      0 16px 32px -8px rgba(0,0,0,.4),
      0 40px 80px -16px rgba(0,0,0,.55),
      inset 0 1px 0 rgba(255,255,255,.09),
      inset 0 0 0 1px rgba(255,255,255,.045);
    overflow: hidden;
    animation: rise 220ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
  @media (prefers-reduced-motion: reduce) { .box { animation: none; } }

  /* Title bar and bottom bar, each parted from the body by a groove: a dark line with a faint light
     one beside it. */
  header {
    display: flex; align-items: center; gap: 10px; padding: 14px 12px 12px 16px;
    border-bottom: 1px solid rgba(0,0,0,.5); box-shadow: 0 1px 0 rgba(255,255,255,.035);
  }
  header svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
  .title { font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: #9a9aa2; font-size: 12px; }
  .grow { flex: 1; min-width: 0; }
  .x {
    all: unset; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center;
    border-radius: 999px; color: #8a8a93; font-size: 16px; line-height: 1;
    background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
    transition: color 160ms ease, background-color 160ms ease, transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .x:hover { color: #fafafa; background: rgba(255,255,255,.08); }
  .x:active { transform: scale(0.92); }
  .x:focus-visible { outline: 2px solid rgba(250,250,250,.5); outline-offset: 2px; }

  .body { padding: 14px 16px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .lead { font-size: 15px; letter-spacing: -0.01em; }
  .muted { color: #9a9aa2; }
  .faint { color: #6e6e77; font-size: 12px; }

  /* The one button that matters: raised, lit from above, a little glow of its own colour beneath. */
  .go {
    all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
    height: 44px; border-radius: 12px; color: #03140e; font-weight: 600; letter-spacing: -0.01em;
    background: linear-gradient(180deg, #62ddb7 0%, #45c59d 55%, #39b38d 100%);
    text-shadow: 0 1px 0 rgba(255,255,255,.25);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.45),
      inset 0 -1px 0 rgba(0,0,0,.18),
      0 0 0 1px rgba(16,84,63,.7),
      0 1px 2px rgba(0,0,0,.35),
      0 6px 16px -4px rgba(67,195,155,.45);
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms ease, filter 160ms ease;
  }
  .go:hover { filter: brightness(1.06); }
  .go:active {
    transform: scale(0.97);
    box-shadow: inset 0 2px 4px rgba(0,0,0,.22), inset 0 -1px 0 rgba(255,255,255,.15), 0 0 0 1px rgba(16,84,63,.7), 0 1px 1px rgba(0,0,0,.3);
  }
  .go:focus-visible { outline: 2px solid rgba(250,250,250,.55); outline-offset: 3px; }

  /* Everything else pressable: a raised dark key that sinks when pressed. */
  .quiet {
    all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center;
    height: 36px; border-radius: 11px; color: #e8e8ea; font-size: 13px; font-weight: 500;
    background: linear-gradient(180deg, #25262a 0%, #1b1c1f 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 0 0 1px rgba(0,0,0,.65), 0 1px 2px rgba(0,0,0,.45);
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms ease, background 160ms ease;
  }
  .quiet:hover { background: linear-gradient(180deg, #2b2c30 0%, #202124 100%); }
  .quiet:active { transform: scale(0.97); box-shadow: inset 0 1px 3px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.65); }
  .quiet:focus-visible { outline: 2px solid rgba(250,250,250,.45); outline-offset: 2px; }

  .status { display: flex; align-items: center; gap: 8px; color: #9a9aa2; }
  .dot { position: relative; width: 8px; height: 8px; flex: none; }
  .dot i { position: absolute; inset: 0; border-radius: 50%; background: #6e6e77; }
  .dot.live i { background: #43c39b; box-shadow: 0 0 8px rgba(67,195,155,.65); }
  .dot.live i + i { animation: ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: .6; box-shadow: none; }
  .dot.warn i { background: #e0b060; box-shadow: 0 0 8px rgba(224,176,96,.5); }
  @keyframes ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
  .you { color: #fafafa; }
  .agent { color: #43c39b; }
  .who { color: #6e6e77; }

  /* Notes and the review list sit in wells: pressed into the window, shaded along their top edge,
     lit along their bottom one. */
  .note, .review {
    border-radius: 12px; background: rgba(0,0,0,.28);
    box-shadow: inset 0 1px 2px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.035);
  }
  .note { padding: 8px 10px; color: #9a9aa2; font-size: 12.5px; }
  .note b { color: #fafafa; font-weight: 500; }
  .note.miss { box-shadow: inset 0 1px 2px rgba(0,0,0,.55), inset 0 0 0 1px rgba(224,176,96,.35), 0 1px 0 rgba(255,255,255,.035); }
  .warn { color: #e0b060; }

  footer {
    display: flex; gap: 14px; padding: 10px 16px 12px; background: rgba(0,0,0,.18);
    border-top: 1px solid rgba(0,0,0,.5); box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
  }
  .link { all: unset; cursor: pointer; font-size: 12px; color: #9a9aa2; transition: color 160ms ease; }
  .link:hover { color: #fafafa; }
  .link:active { color: #c9c9ce; }
  .link:focus-visible { outline: 2px solid #43c39b; outline-offset: 2px; border-radius: 4px; }

  .review { font-size: 12.5px; max-height: 220px; overflow: auto; }
  .review summary {
    cursor: pointer; padding: 9px 10px; color: #fafafa; list-style: none; display: flex; align-items: center; gap: 8px;
    border-radius: 12px; transition: background-color 160ms ease;
  }
  .review summary::-webkit-details-marker { display: none; }
  .review summary::before {
    content: ""; width: 6px; height: 6px; flex: none; margin: 0 2px 0 1px;
    border-right: 1.5px solid #9a9aa2; border-bottom: 1.5px solid #9a9aa2;
    transform: rotate(-45deg); transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .review[open] summary::before { transform: rotate(45deg); }
  .review summary:hover { background: rgba(255,255,255,.035); }
  .review summary:focus-visible { outline: 2px solid rgba(67,195,155,.7); outline-offset: -2px; }
  .review .rg { padding: 0 10px 8px; }
  .review .rt { color: #8a8a93; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; margin: 6px 0 4px; }
  .review .ri { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 5px 7px; border-radius: 8px; color: #9a9aa2; cursor: default; }
  .review button.ri { cursor: pointer; transition: background-color 120ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
  .review button.ri:hover, .review button.ri:focus-visible { background: rgba(255,255,255,.06); }
  .review button.ri:active { transform: scale(0.99); background: rgba(255,255,255,.04); }
  .review .ri b { color: #fafafa; font-weight: 500; }

  /* A key, the way a Mac draws one. */
  kbd {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 6px; border-radius: 6px; color: #c9c9ce;
    background: linear-gradient(180deg, #2a2b2e, #1e1f22);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.08), inset 0 -1px 0 rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.55);
  }

  /* Scrollbars that belong to the window: thin, rounded, no arrows, brighter under the pointer. */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
  ::-webkit-scrollbar-thumb {
    min-height: 28px; border-radius: 999px; border: 3px solid transparent; background-clip: padding-box;
    background-color: rgba(255,255,255,.14);
  }
  ::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,.28); }
  ::-webkit-scrollbar-thumb:active { background-color: rgba(255,255,255,.36); }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class Panel {
  private host: HTMLElement;
  private root: ShadowRoot;
  private box: HTMLDivElement;
  private shown = "";

  constructor(private readonly actions: PanelActions) {
    this.host = document.createElement("longtake-panel");
    this.host.setAttribute("data-longtake-ignore", "");
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    this.box = document.createElement("div");
    this.box.className = "box";
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-label", "Longtake");
    this.root.append(style, this.box);
    // A sound under the pointer only (sound.ts): a press for the buttons that do something, a tick
    // for the small links and the review items, a click-clack for the list opening or closing.
    this.box.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("button, summary");
      if (!target) return;
      if (target.localName === "summary") cue("toggle", 0.3);
      else if (target.classList.contains("go") || target.classList.contains("quiet")) cue("press");
      else cue("tick", 0.25);
    });
    this.box.addEventListener("click", (event) => {
      const act = (event.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "start") this.actions.start();
      if (act === "stop") this.actions.stop();
      if (act === "close") this.actions.close();
      if (act === "memory") this.actions.settings("memory");
      if (act === "voice") this.actions.settings("voice");
      if (act === "focus") {
        const field = (event.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset.field;
        if (field) this.actions.focus(field);
      }
      if (act === "log") {
        this.actions.copyLog();
        const link = (event.target as HTMLElement).closest<HTMLElement>("[data-act='log']");
        if (link) {
          link.textContent = "Copied";
          setTimeout(() => (link.textContent = "Copy log"), 1500);
        }
      }
    });
    document.documentElement.appendChild(this.host);
  }

  render(view: PanelView): void {
    const html = this.html(view);
    if (html === this.shown) return;
    const hadFocus = this.root.activeElement === null ? null : (this.root.activeElement as HTMLElement).dataset.act;
    this.shown = html;
    this.box.innerHTML = html;
    // The Start button takes the focus, so the hotkey then Enter starts a call without the mouse.
    const start = this.box.querySelector<HTMLElement>("[data-act='start']");
    if (start && (hadFocus === "start" || view.state.kind === "ready" || view.state.kind === "stopped" || view.state.kind === "error")) {
      start.focus({ preventScroll: true });
    }
  }

  remove(): void {
    this.host.remove();
  }

  private html(view: PanelView): string {
    const { state } = view;
    const header = `
      <header>
        ${MARK}
        <div class="grow"><div class="title">Longtake</div><div class="sub">The whole form, in one take</div></div>
        <button class="x" data-act="close" aria-label="Close Longtake">×</button>
      </header>`;
    const start = (label: string) => `<button class="go" data-act="start">${label}</button>`;
    const safety = `<div class="faint">Nothing is ever submitted. You read it and send it yourself.</div>`;
    const dot = (kind: "live" | "warn" | "") => `<span class="dot ${kind}"><i></i><i></i></span>`;

    let body = "";
    switch (state.kind) {
      case "ready":
        body = state.carrying
          ? `<div class="lead">Next page — ${state.questions} ${state.questions === 1 ? "question" : "questions"} here.</div>
             <div class="muted">Carry on where you left off.</div>
             ${start("Continue talking")}`
          : `<div class="lead">${state.questions} ${state.questions === 1 ? "question" : "questions"} on this page.</div>
             <div class="muted">Say everything you know in one go, like telling a friend. I'll fill what you say and ask for the rest.</div>
             ${start("Start talking")}
             <div class="faint">Or press <kbd>Enter</kbd> now. Your browser will ask for the microphone once.</div>`;
        body += safety;
        break;
      case "empty":
        body = `<div class="lead">No form here I can fill.</div>
          <div class="muted">Open the page with the form on it — the application itself, not the job description — and try again.</div>`;
        break;
      case "reading":
        body = `<div class="status">${dot("")}Reading the form…</div>`;
        break;
      case "connecting":
        body = `<div class="status">${dot("warn")}Connecting — talk anyway, nothing is lost.</div>`;
        break;
      case "live":
      case "reconnecting":
        body = `
          <div class="status">${state.kind === "live" ? `${dot("live")}${view.hearing ? "Hearing you…" : view.thinking ? "Thinking… putting it in" : "Listening"}` : `${dot("warn")}<span class="warn">Line dropped — getting it back. Keep talking.</span>`}</div>
          ${view.progress ? `<div class="muted">${esc(view.progress)}</div>` : ""}
          ${view.heard ? `<div class="you"><span class="who">You · </span>${esc(view.heard)}</div>` : ""}
          ${view.said ? `<div class="agent"><span class="who">Longtake · </span>${esc(view.said)}</div>` : ""}
          ${view.notices.map((n) => `<div class="note${n.startsWith('<span class="miss-mark">') ? " miss" : ""}">${n}</div>`).join("")}
          ${review(view.review, false)}
          <button class="quiet" data-act="stop">Stop</button>`;
        break;
      case "stopped":
        body = `<div class="muted">Stopped.${view.progress ? ` ${esc(view.progress)}.` : ""}</div>
          ${view.notices.map((n) => `<div class="note">${n}</div>`).join("")}
          ${review(view.review, true)}
          ${start("Start again")}${safety}`;
        break;
      case "error":
        body = `<div class="warn">${esc(state.message)}</div>${start("Try again")}`;
        break;
    }
    const footer = `<footer>
        <button class="link" data-act="memory">Saved answers</button>
        <button class="link" data-act="voice">Voice</button>
        <button class="link" data-act="log">Copy log</button>
      </footer>`;
    return `${header}<div class="body">${body}</div>${footer}`;
  }
}

/**
 * The review list — before they send it: waiting for a yes, said but not in, from last time, and the
 * rest. Folded while the call runs, open once it stops. An item with a field jumps to it.
 */
function review(groups: PanelView["review"], open: boolean): string {
  if (!groups || groups.length === 0) return "";
  const count = groups.reduce((n, group) => n + group.items.length, 0);
  const items = groups
    .map(
      (group) => `<div class="rg"><div class="rt">${esc(group.title)}</div>${group.items
        .map((item) =>
          item.fieldId
            ? `<button class="ri" data-act="focus" data-field="${esc(item.fieldId)}"><b>${esc(item.question)}</b> ${esc(item.detail)}</button>`
            : `<div class="ri"><b>${esc(item.question)}</b> ${esc(item.detail)}</div>`,
        )
        .join("")}</div>`,
    )
    .join("");
  return `<details class="review"${open ? " open" : ""}><summary>Look it over before you send (${count})</summary>${items}</details>`;
}

/** A notice with its lead words emphasised. Everything else escaped. */
export function notice(lead: string, rest: string): string {
  return `<b>${esc(lead)}</b> ${esc(rest)}`;
}

/** Something that did not go in, marked apart from the ordinary notices. */
export function miss(lead: string, rest: string): string {
  return `<span class="miss-mark"></span><b>${esc(lead)}</b> ${esc(rest)}`;
}
