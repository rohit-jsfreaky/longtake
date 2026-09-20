/**
 * Finding an element again, and finding all of them in the first place.
 *
 * ## Borrowed from Cairn
 *
 * `uniqueSelector` is a TypeScript port of the `cssOf` helper in Cairn
 * (`package/src/cairn/browser.py`), an earlier project of ours that drives real websites.
 * Two things in it were paid for with real failures and are kept exactly:
 *
 *   1. **Depth 15, not 5.** Cairn's note: *"Five was not nearly enough: PostHog's real path to
 *      one button was fifteen levels deep."*
 *   2. **Give up rather than return an ambiguous selector.** *"A selector that finds the wrong
 *      element is worse than no selector."* For Longtake that is sharper still — an ambiguous
 *      selector means typing someone's salary into someone else's form field.
 *
 * ## Not borrowed, and why
 *
 * Cairn finds elements with Playwright's `aria_snapshot(mode="ai")`, which hands back refs that
 * resolve through shadow roots and across frames for free. Longtake has no Playwright: it runs
 * *inside* the page, as a content script or as the page's own JavaScript. So the walking below
 * is ours, and it has to cross those boundaries by hand.
 */

/** Cairn learned this the hard way on a real dashboard. Five levels was not enough. */
const MAX_DEPTH = 15;

/** Attributes that identify an element more durably than its position ever will. */
const TEST_ID_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
] as const;

export function testIdOf(el: Element): string | null {
  for (const name of TEST_ID_ATTRIBUTES) {
    const found = el.getAttribute(name);
    if (found) return `${name}=${found}`;
  }
  return null;
}

/**
 * The shortest CSS selector that matches this element and nothing else, or `""` if there
 * isn't one. An empty string is a real answer: callers must treat it as "cannot be re-found".
 */
export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (!doc) return "";

  const matchesOne = (selector: string): boolean => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false; // a name or id that is not selector-safe
    }
  };

  if (el.id && matchesOne(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  const name = el.getAttribute("name");
  if (name) {
    const byName = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (matchesOne(byName)) return byName;
  }

  const parts: string[] = [];
  let walker: Element | null = el;

  while (walker && walker.nodeType === 1 && parts.length < MAX_DEPTH) {
    const tag = walker.tagName.toLowerCase();
    const parent: Element | null = walker.parentElement;

    // An id anywhere up the chain anchors everything below it in one step.
    if (walker !== el && walker.id && matchesOne(`#${CSS.escape(walker.id)}`)) {
      parts.unshift(`#${CSS.escape(walker.id)}`);
      return parts.join(" > ");
    }

    if (tag === "html" || tag === "body" || !parent) break;

    const siblings = Array.from(parent.children).filter((c) => c.tagName === walker!.tagName);
    const index = siblings.indexOf(walker) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);

    // As soon as it picks out one element it is done. Every extra level is another thing a
    // redesign can move.
    const built = parts.join(" > ");
    if (matchesOne(built)) return built;

    walker = parent;
  }

  return "";
}

/**
 * Every element under `root` matching `selector`, including those inside open shadow roots
 * and inside same-origin iframes.
 *
 * `querySelectorAll` stops at both boundaries, and Cairn's own post-mortem is the warning:
 * a hand-written collector found **one** element on a page that really had seven, because it
 * could not see into a shadow root or an iframe. Modern form builders use both.
 *
 * Closed shadow roots and cross-origin iframes are genuinely unreachable from here. In the
 * extension that is solved by `all_frames: true` in the manifest, which runs a copy of this
 * code inside each frame instead of trying to reach across.
 */
export function deepQueryAll(root: Document | ShadowRoot | Element, selector: string): Element[] {
  const found: Element[] = [];
  const seen = new Set<Element>();

  const visit = (node: Document | ShadowRoot | Element) => {
    let direct: Element[] = [];
    try {
      direct = Array.from(node.querySelectorAll(selector));
    } catch {
      return; // malformed selector, or a detached document
    }
    for (const el of direct) {
      if (!seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }

    // Descend into every open shadow root beneath this node.
    let hosts: Element[] = [];
    try {
      hosts = Array.from(node.querySelectorAll("*")).filter((el) => el.shadowRoot);
    } catch {
      hosts = [];
    }
    for (const host of hosts) {
      if (host.shadowRoot) visit(host.shadowRoot);
    }

    // And into every iframe we are actually allowed to open.
    let frames: HTMLIFrameElement[] = [];
    try {
      frames = Array.from(node.querySelectorAll("iframe"));
    } catch {
      frames = [];
    }
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument;
        // Cross-origin access throws, or silently returns null. Both mean "not ours".
        if (doc) visit(doc);
      } catch {
        // A cross-origin frame. Expected, and not an error worth reporting.
      }
    }
  };

  visit(root);
  return found;
}

/**
 * Is this element actually on screen for a person to fill in?
 *
 * Deliberately strict. An input that a person cannot see is either decoration or a trap, and
 * Longtake must not type into either.
 */
export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (!html.isConnected) return false;

  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  if (Number(style.opacity) === 0) return false;

  const rect = html.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;

  // Parked off-canvas with `left: -9999px` — a classic way to hide a honeypot in plain HTML.
  //
  // ⚠️ This must be measured against the DOCUMENT, not the viewport. Checking `rect.bottom < 0`
  // looks equivalent and is badly wrong: on any form taller than the screen, every field above
  // the current scroll position has a negative `rect.bottom`. That bug quietly dropped "First
  // Name" from a real Reddit application, because the page happened to be scrolled down.
  const view = el.ownerDocument.defaultView;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;

  return true;
}
