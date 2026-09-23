/**
 * The little window Longtake puts on somebody else's page while it listens.
 *
 * Inside a closed shadow root, so the page's CSS cannot reach it and its CSS cannot leak out, and
 * marked `data-longtake-ignore` on the host, so the reader never mistakes our own Stop button for
 * a question on their form — the same reason the landing page's panel carries that attribute.
 *
 * It shows only what a person may need to act on: whether it is listening, what it last heard and
 * said, and anything they have to do by hand. The page itself is the rest of the display.
 */

export type PanelView = {
  status: "reading" | "connecting" | "live" | "reconnecting" | "error" | "stopped";
  heard?: string;
  said?: string;
  progress?: string;
  notices: string[];
  error?: string;
};

const STATUS_WORDS: Record<PanelView["status"], string> = {
  reading: "Reading the form…",
  connecting: "Connecting — talk anyway, nothing is lost",
  live: "Listening",
  reconnecting: "Line dropped — getting it back. Keep talking.",
  error: "Stopped",
  stopped: "Stopped",
};

const CSS = `
  :host { all: initial; }
  .box {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 320px; max-height: 60vh; overflow: auto;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #e8e6e1; background: #151719; border: 1px solid #2a2d31; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45); padding: 12px 14px;
  }
  .top { display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7075; flex: none; }
  .dot.live { background: #5fd0a8; }
  .dot.warn { background: #e0b060; }
  .status { flex: 1; color: #bfc3c7; }
  .name { font-weight: 600; color: #fff; }
  button {
    all: unset; cursor: pointer; padding: 3px 10px; border: 1px solid #3a3e43; border-radius: 8px;
    color: #e8e6e1; font-size: 12px;
  }
  button:hover { border-color: #6b7075; }
  button:active { transform: scale(0.97); }
  .line { margin-top: 8px; }
  .muted { color: #8a8f94; }
  .said { color: #5fd0a8; }
  .note { margin-top: 8px; padding: 6px 8px; border: 1px solid #2a2d31; border-radius: 8px; color: #bfc3c7; }
  .err { margin-top: 8px; color: #e0b060; }
  .foot { margin-top: 8px; font-size: 11.5px; color: #6b7075; }
`;

export class Panel {
  private host: HTMLElement;
  private root: ShadowRoot;
  private box: HTMLDivElement;

  constructor(onStop: () => void) {
    this.host = document.createElement("longtake-panel");
    this.host.setAttribute("data-longtake-ignore", "");
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    this.box = document.createElement("div");
    this.box.className = "box";
    this.box.setAttribute("role", "status");
    this.root.append(style, this.box);
    this.box.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).dataset.stop !== undefined) onStop();
    });
    document.documentElement.appendChild(this.host);
  }

  render(view: PanelView): void {
    const dot = view.status === "live" ? "live" : view.status === "reconnecting" || view.status === "error" ? "warn" : "";
    const text = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    this.box.innerHTML = `
      <div class="top">
        <span class="dot ${dot}"></span>
        <span class="status"><span class="name">Longtake</span> · ${text(STATUS_WORDS[view.status])}</span>
        ${view.status === "stopped" || view.status === "error" ? "" : `<button data-stop>Stop</button>`}
      </div>
      ${view.progress ? `<div class="line muted">${text(view.progress)}</div>` : ""}
      ${view.heard ? `<div class="line">${text(view.heard)}</div>` : ""}
      ${view.said ? `<div class="line said">${text(view.said)}</div>` : ""}
      ${view.notices.map((n) => `<div class="note">${text(n)}</div>`).join("")}
      ${view.error ? `<div class="err">${text(view.error)}</div>` : ""}
      <div class="foot">Nothing is ever submitted. You read it and send it yourself.</div>
    `;
  }

  remove(): void {
    this.host.remove();
  }
}
