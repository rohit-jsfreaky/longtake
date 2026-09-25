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
  .box {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    width: 340px; max-height: min(70vh, 560px); display: flex; flex-direction: column;
    font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fafafa; background: #08090a; border: 1px solid rgba(255,255,255,.1); border-radius: 20px;
    box-shadow: 0 24px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4);
    overflow: hidden;
    animation: rise 220ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
  @media (prefers-reduced-motion: reduce) { .box { animation: none; } }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 16px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .title { font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: #9a9aa2; font-size: 12px; }
  .grow { flex: 1; min-width: 0; }
  .x {
    all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center;
    border-radius: 10px; color: #6e6e77; font-size: 18px; line-height: 1;
  }
  .x:hover { color: #fafafa; background: #161718; }
  .body { padding: 14px 16px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .lead { font-size: 15px; letter-spacing: -0.01em; }
  .muted { color: #9a9aa2; }
  .faint { color: #6e6e77; font-size: 12px; }
  .go {
    all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
    height: 44px; border-radius: 12px; background: #43c39b; color: #04120d; font-weight: 600;
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 160ms ease;
  }
  .go:hover { background: #56d3ab; }
  .go:active { transform: scale(0.97); }
  .go:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; }
  .quiet {
    all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center;
    height: 36px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); color: #fafafa; font-size: 13px;
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), border-color 160ms ease;
  }
  .quiet:hover { border-color: rgba(255,255,255,.3); }
  .quiet:active { transform: scale(0.97); }
  .status { display: flex; align-items: center; gap: 8px; color: #9a9aa2; }
  .dot { position: relative; width: 8px; height: 8px; flex: none; }
  .dot i { position: absolute; inset: 0; border-radius: 50%; background: #6e6e77; }
  .dot.live i { background: #43c39b; }
  .dot.live i + i { animation: ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: .6; }
  .dot.warn i { background: #e0b060; }
  @keyframes ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
  .you { color: #fafafa; }
  .agent { color: #43c39b; }
  .who { color: #6e6e77; }
  .note { padding: 8px 10px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: #161718; color: #9a9aa2; font-size: 12.5px; }
  .note b { color: #fafafa; font-weight: 500; }
  .warn { color: #e0b060; }
  footer { display: flex; gap: 14px; padding: 10px 16px 12px; border-top: 1px solid rgba(255,255,255,.08); }
  .link { all: unset; cursor: pointer; font-size: 12px; color: #9a9aa2; }
  .link:hover { color: #fafafa; }
  .link:focus-visible { outline: 2px solid #43c39b; outline-offset: 2px; border-radius: 4px; }
  .note.miss { border-color: rgba(224,176,96,.35); }
  .review { border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: #161718; font-size: 12.5px; max-height: 220px; overflow: auto; }
  .review summary { cursor: pointer; padding: 8px 10px; color: #fafafa; }
  .review .rg { padding: 0 10px 8px; }
  .review .rt { color: #9a9aa2; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin: 4px 0; }
  .review .ri { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 4px 6px; border-radius: 8px; color: #9a9aa2; cursor: default; }
  .review button.ri { cursor: pointer; }
  .review button.ri:hover, .review button.ri:focus-visible { background: rgba(255,255,255,.06); }
  .review .ri b { color: #fafafa; font-weight: 500; }
  kbd { font: 11px ui-monospace, monospace; padding: 1px 5px; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; color: #9a9aa2; }
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
          <div class="status">${state.kind === "live" ? `${dot("live")}${view.hearing ? "Hearing you…" : "Listening"}` : `${dot("warn")}<span class="warn">Line dropped — getting it back. Keep talking.</span>`}</div>
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
