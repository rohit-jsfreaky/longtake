/**
 * Badges on the page: beside each field, where its answer came from — Spoken, From last time,
 * Typed, Already there — or what it still needs — Waiting for your yes, Not in, Another look?
 * Clicking one says why ("You said: …").
 *
 * ## Why an overlay, and not a ring on their input
 *
 * The site used to mark a field by setting `box-shadow` on the page's own input. That is writing to
 * somebody else's form: it can trip the page's own observers, and ours — a style change on a field
 * looks exactly like a page re-rendering, and the form was re-read for it. So nothing here touches
 * their elements. One host element is added once (`<longtake-badges data-longtake-ignore>`), its
 * contents live in a closed shadow root that the page's scripts and our reader cannot see into, and
 * the host itself is never re-styled after it is added. Badges are placed in a fixed layer by each
 * field's `getBoundingClientRect` — plus the frame's own offset for a field in a same-origin iframe —
 * and follow scrolling and resizing.
 *
 * ## Only where the field can be seen
 *
 * A fixed layer draws over everything, so a field scrolled out of a box that scrolls on its own — a
 * modal, a side panel, the demo's browser frame on our own site — still had a rectangle, and its
 * badge floated over whatever was there: "Spoken" across a headline. So each field is held to every
 * box around it that clips (any `overflow` but visible), and to each frame's window: the badge sits
 * on the part of the field that shows, and a field that does not show has none.
 */

import type { FieldHandles } from "./types";

export type BadgeState = "spoken" | "memory" | "drafted" | "typed" | "page" | "waiting" | "not_in" | "look";

export type Badge = { fieldId: string; state: BadgeState; detail: string };

const LABEL: Record<BadgeState, string> = {
  spoken: "Spoken",
  memory: "From last time",
  typed: "Typed",
  page: "Already there",
  waiting: "Waiting for your yes",
  drafted: "Drafted",
  not_in: "Not in",
  look: "Another look?",
};

/** No red, anywhere: amber carries "needs you". */
const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.badge {
  position: fixed; pointer-events: auto; cursor: pointer; transform: translate(-100%, -55%);
  font: 600 10.5px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 3px 7px; border-radius: 999px; white-space: nowrap;
  background: #0e0f10; color: #fafafa; border: 1px solid rgba(255,255,255,.18);
  box-shadow: 0 1px 4px rgba(0,0,0,.25);
  transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease;
}
.badge:active { transform: translate(-100%, -55%) scale(0.97); }
.badge::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: currentColor; }
.spoken, .drafted { color: #43c39b; } .memory { color: #6aa8ff; } .typed, .page { color: #b8b8c0; }
.waiting, .look { color: #e0b060; } .not_in { color: #1a1206; background: #e0b060; border-color: #e0b060; }
.not_in::before { background: #1a1206; }
.flash { animation: flash 900ms ease-out 1; }
@keyframes flash { 0%, 60% { box-shadow: 0 0 0 4px rgba(224,176,96,.55); } 100% { box-shadow: 0 1px 4px rgba(0,0,0,.25); } }
.detail {
  position: fixed; pointer-events: auto; max-width: 280px; z-index: 1;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0e0f10; color: #fafafa; border: 1px solid rgba(255,255,255,.14); border-radius: 12px;
  padding: 8px 10px; box-shadow: 0 6px 20px rgba(0,0,0,.35);
}
.detail[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .badge, .flash { transition: none; animation: none; } }
`;

type Box = { left: number; top: number; right: number; bottom: number };

/** One step out from a field: a box that clips it, or the frame it sits in. */
type Step = { clip: Element; x: boolean; y: boolean } | { frame: HTMLElement };

/** The parent in the flat tree: out of a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * Everything between a field and the top page that can hide part of it, in order. A fixed element
 * escapes the boxes around it, so the walk skips to its frame.
 */
function clipChain(el: Element, top: Document): Step[] {
  const steps: Step[] = [];
  let at: Element | null = el;
  let doc = el.ownerDocument;
  while (at) {
    const style: CSSStyleDeclaration | undefined = doc.defaultView?.getComputedStyle(at);
    const next: Element | null = style?.position === "fixed" ? null : parentOf(at);
    if (next && next !== doc.documentElement && next !== doc.body) {
      const own = doc.defaultView?.getComputedStyle(next);
      const x = !!own && own.overflowX !== "visible";
      const y = !!own && own.overflowY !== "visible";
      if (x || y) steps.push({ clip: next, x, y });
    }
    at = next;
    if (!at || at === doc.documentElement) {
      if (doc === top) break;
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      if (!frame) break;
      steps.push({ frame });
      at = frame;
      doc = frame.ownerDocument;
    }
  }
  return steps;
}

/**
 * The part of a field that can be seen, in the top page's viewport, and the field's whole box
 * there — or null when none of it shows.
 */
function seen(el: Element, chain: Step[]): { whole: Box; shown: Box } | null {
  const r = el.getBoundingClientRect();
  let whole: Box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const view = el.ownerDocument.defaultView;
  let shown: Box = { left: 0, top: 0, right: view?.innerWidth ?? Infinity, bottom: view?.innerHeight ?? Infinity };
  shown = cut(shown, whole, true, true);
  for (const step of chain) {
    if ("clip" in step) {
      const b = step.clip.getBoundingClientRect();
      const inner = step.clip as HTMLElement;
      const left = b.left + inner.clientLeft;
      const top_ = b.top + inner.clientTop;
      shown = cut(shown, { left, top: top_, right: left + inner.clientWidth, bottom: top_ + inner.clientHeight }, step.x, step.y);
    } else {
      const b = step.frame.getBoundingClientRect();
      const dx = b.left + step.frame.clientLeft;
      const dy = b.top + step.frame.clientTop;
      whole = move(whole, dx, dy);
      shown = move(shown, dx, dy);
      shown = cut(shown, { left: dx, top: dy, right: dx + step.frame.clientWidth, bottom: dy + step.frame.clientHeight }, true, true);
      const outer = step.frame.ownerDocument.defaultView;
      shown = cut(shown, { left: 0, top: 0, right: outer?.innerWidth ?? Infinity, bottom: outer?.innerHeight ?? Infinity }, true, true);
    }
    if (shown.right - shown.left < 1 || shown.bottom - shown.top < 1) return null;
  }
  return shown.right - shown.left < 1 || shown.bottom - shown.top < 1 ? null : { whole, shown };
}

function cut(a: Box, b: Box, x: boolean, y: boolean): Box {
  return {
    left: x ? Math.max(a.left, b.left) : a.left,
    right: x ? Math.min(a.right, b.right) : a.right,
    top: y ? Math.max(a.top, b.top) : a.top,
    bottom: y ? Math.min(a.bottom, b.bottom) : a.bottom,
  };
}

function move(a: Box, dx: number, dy: number): Box {
  return { left: a.left + dx, right: a.right + dx, top: a.top + dy, bottom: a.bottom + dy };
}

/** How far below the top of what shows a badge's middle sits, when the field's own top is hidden. */
const BADGE_HALF = 10;

export class Overlay {
  private readonly host: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly detailBox: HTMLElement;
  private badges = new Map<string, { el: HTMLElement; badge: Badge }>();
  /** Each field's clipping boxes, found once per `show` — a scroll moves boxes, it does not add them. */
  private chains = new WeakMap<Element, Step[]>();
  private frame = 0;
  private readonly place = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.placeNow());
  };

  constructor(
    private readonly doc: Document,
    private readonly handles: () => FieldHandles,
  ) {
    this.host = doc.createElement("longtake-badges");
    this.host.setAttribute("data-longtake-ignore", "");
    const root = this.host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    this.layer = doc.createElement("div");
    this.layer.className = "layer";
    this.detailBox = doc.createElement("div");
    this.detailBox.className = "detail";
    this.detailBox.hidden = true;
    this.layer.append(this.detailBox);
    root.append(style, this.layer);
    (doc.body ?? doc.documentElement).append(this.host);

    const view = doc.defaultView;
    view?.addEventListener("scroll", this.place, { capture: true, passive: true });
    view?.addEventListener("resize", this.place, { passive: true });
    this.layer.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest(".badge") as HTMLElement | null;
      if (target) this.explain(target.dataset.field ?? "");
      else this.detailBox.hidden = true;
    });
  }

  /** Show exactly these badges. */
  show(badges: Badge[]): void {
    this.chains = new WeakMap();
    const wanted = new Map(badges.map((badge) => [badge.fieldId, badge]));
    for (const [id, shown] of this.badges) {
      if (!wanted.has(id)) {
        shown.el.remove();
        this.badges.delete(id);
      }
    }
    for (const badge of badges) {
      let shown = this.badges.get(badge.fieldId);
      if (!shown) {
        const el = this.doc.createElement("button");
        el.type = "button";
        el.dataset.field = badge.fieldId;
        this.layer.append(el);
        shown = { el, badge };
        this.badges.set(badge.fieldId, shown);
      }
      shown.badge = badge;
      shown.el.className = `badge ${badge.state}`;
      shown.el.textContent = LABEL[badge.state];
      shown.el.setAttribute("aria-label", `${LABEL[badge.state]}: ${badge.detail}`);
    }
    this.placeNow();
  }

  /** Bring a field into view and make its badge flash — from the review list. */
  focus(fieldId: string): void {
    const el = this.handles().get(fieldId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const shown = this.badges.get(fieldId);
    if (!shown) return;
    shown.el.classList.remove("flash");
    void shown.el.offsetWidth; // restart the animation
    shown.el.classList.add("flash");
    setTimeout(() => this.placeNow(), 400);
  }

  /** Where each badge sits now, in the viewport — for tests of placement. */
  positions(): Record<string, { x: number; y: number; shown: boolean }> {
    const out: Record<string, { x: number; y: number; shown: boolean }> = {};
    for (const [id, { el }] of this.badges) out[id] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), shown: el.style.display !== "none" };
    return out;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    const view = this.doc.defaultView;
    view?.removeEventListener("scroll", this.place, { capture: true });
    view?.removeEventListener("resize", this.place);
    this.host.remove();
  }

  private placeNow(): void {
    const handles = this.handles();
    for (const [id, { el }] of this.badges) {
      const field = handles.get(id);
      let chain = field && this.chains.get(field);
      if (field?.isConnected && !chain) this.chains.set(field, (chain = clipChain(field, this.doc)));
      const where = field?.isConnected && chain ? seen(field, chain) : null;
      el.style.display = where ? "" : "none";
      if (!where) continue;
      // The badge's right edge on the field's right edge, straddling its top border — or, when the
      // top is hidden, just inside the top of what shows.
      const { whole, shown } = where;
      el.style.left = `${Math.min(whole.right, shown.right)}px`;
      el.style.top = `${whole.top >= shown.top ? whole.top : Math.min(shown.top + BADGE_HALF, shown.bottom)}px`;
    }
  }

  private explain(fieldId: string): void {
    const shown = this.badges.get(fieldId);
    if (!shown) return;
    this.detailBox.textContent = shown.badge.detail;
    const at = shown.el.getBoundingClientRect();
    this.detailBox.style.left = `${Math.max(8, at.left - 200)}px`;
    this.detailBox.style.top = `${at.bottom + 6}px`;
    this.detailBox.hidden = false;
  }
}
