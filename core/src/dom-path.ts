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

/**
 * The smallest a control can be and still be something a person fills in.
 *
 * See the note in `isVisible` for where the number comes from. It is measured, not chosen.
 */
const MIN_INTERACTIVE_PX = 10;

/**
 * Roles an author only writes when the thing really is a control a person operates.
 *
 * Used to decide whether a very small element deserves the benefit of the doubt. The reasoning
 * is in `isVisible`: a honeypot never declares one of these, because being announced to a
 * screen reader defeats the point of it.
 */
const SELF_DECLARED_ROLES = new Set([
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "listbox",
  "radiogroup",
  "checkbox",
  "switch",
]);

function declaresItselfInteractive(el: Element): boolean {
  const role = el.getAttribute("role");
  if (role && SELF_DECLARED_ROLES.has(role)) return true;
  return el.hasAttribute("aria-haspopup");
}

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
export function uniqueSelector(el: Element, within?: Document): string {
  const doc = el.ownerDocument;
  if (!doc) return "";

  // A selector for an element in another document is worse than no selector at all.
  //
  // An `<input id="a">` inside an iframe yields `#a`, which is perfectly unique *in that frame*
  // and means something entirely different when run against the parent — it either finds
  // nothing, or finds a different field and writes someone's answer into it. Cairn hit the same
  // thing and drew the same conclusion: a locator that does not name its frame cannot be
  // resolved later. In the extension this never arises, because `all_frames: true` runs a copy
  // of the reader inside each frame, where `document` is that frame's own.
  if (within && doc !== within) return "";

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
 * The radios or checkboxes that answer one question together with `el` — for the reader, which
 * turns them into one field, and the writer, which has to find every one of them again.
 *
 * HTML's rule is the name: one `name`, one question. Forms that post to PHP-style back ends add
 * one more: `industry[]` and `industry[other]` arrive on the server as the same array, and Jotform
 * gives every group's "Other" choice exactly such a name. Read by the name alone, "Other" became a
 * question of its own. Such names are joined — but only inside the same named group, so two
 * questions that happen to share an array prefix (`user[terms]`, `user[news]`) stay apart.
 *
 * Checkboxes the name does not join are joined by HTML's other rule: a `<fieldset>` (or an ARIA
 * group) is "a set of controls grouped together" — when it holds checkboxes and nothing else, they
 * answer one question. Ashby names each box after its choice ("LinkedIn", "Glassdoor"), Tally names
 * none; read box by box, every choice was a question.
 */
export function choiceGroup(el: Element): HTMLInputElement[] {
  const input = el as HTMLInputElement;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type !== "radio" && type !== "checkbox") return [input];
  const name = el.getAttribute("name");
  const root = el.getRootNode() as Document | ShadowRoot;

  let byName = [input];
  if (name) {
    const base = arrayBase(name);
    const group = base ? namedGroupOf(el) : null;
    byName = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((other) => {
      const otherName = other.getAttribute("name");
      if (otherName === name) return true;
      return group !== null && otherName !== null && arrayBase(otherName) === base && namedGroupOf(other) === group;
    });
  }
  if (type === "radio" || byName.length > 1) return byName;

  const set = el.parentElement?.closest("fieldset, [role='group']");
  if (!set) return byName;
  const controls = Array.from(set.querySelectorAll(ANSWERING));
  const onlyBoxes = controls.every((control) => control.localName === "input" && (control.getAttribute("type") ?? "").toLowerCase() === "checkbox");
  return onlyBoxes && controls.length > 1 ? (controls as HTMLInputElement[]) : byName;
}

/**
 * Toggle buttons side by side — `aria-pressed` on each — that answer one question together, one of
 * them pressed. Ashby asks every yes-or-no this way. Shared by the reader, which reads them as one
 * question, and the writer, which presses the named one. A lone toggle is an action (bold, mute),
 * never an answer: fewer than two is no group. Given a toggle, its siblings; given the element
 * that holds them — the field's own handle, as it holds the answer's state too — its children.
 */
export function toggleGroup(el: Element): HTMLElement[] {
  const holder = el.hasAttribute("aria-pressed") ? el.parentElement : el;
  const toggles = Array.from(holder?.children ?? []).filter(
    (node) => node.hasAttribute("aria-pressed") && (node.localName === "button" || node.getAttribute("role") === "button"),
  ) as HTMLElement[];
  return toggles.length >= 2 ? toggles : [];
}

/** Everything in a group that takes an answer — what a set of checkboxes must be alone in. */
export const ANSWERING =
  "input:not([type='hidden']), select, textarea, [role='checkbox'], [role='radio'], [role='switch'], [role='combobox'], [role='listbox'], [role='textbox'], [contenteditable='true']";

/**
 * Which box of its group this is — the one name reader and writer both use for it. HTML names a
 * box by the value it submits, but a box with no `value` submits "on", and when every box says
 * "on" the value names none of them: matched by value, picking LinkedIn ticked all seven. So the
 * value when the group's values tell its boxes apart; else the name (Ashby's are the choices);
 * else the id (Tally's boxes have nothing else); else the place in the group.
 */
export function choiceKey(box: Element, group: Element[] = choiceGroup(box)): string {
  const apart = (read: (member: Element) => string | null) => {
    const all = group.map(read);
    return all.every((one) => one !== null && one !== "") && new Set(all).size === all.length;
  };
  const value = (member: Element) => (member as HTMLInputElement).value;
  if (apart(value)) return value(box);
  if (apart((member) => member.getAttribute("name"))) return box.getAttribute("name")!;
  if (apart((member) => member.id || null)) return box.id;
  return String(group.indexOf(box));
}

/** `industry[]` and `industry[other]` → `industry`; a plain name has no array base. */
function arrayBase(name: string): string | null {
  const bracket = name.indexOf("[");
  return bracket > 0 ? name.slice(0, bracket) : null;
}

/** The nearest fieldset or ARIA group that says what it is — the question a set of choices answers. */
function namedGroupOf(el: Element): Element | null {
  for (let node = el.parentElement?.closest("fieldset, [role='radiogroup'], [role='group']"); node; node = node.parentElement?.closest("fieldset, [role='radiogroup'], [role='group']")) {
    if (node.hasAttribute("aria-labelledby") || node.hasAttribute("aria-label")) return node;
    if (node.localName === "fieldset" && node.querySelector(":scope > legend")) return node;
  }
  return null;
}

/**
 * Is this element actually on screen for a person to fill in?
 *
 * Deliberately strict. An input that a person cannot see is either decoration or a trap, and
 * Longtake must not type into either.
 *
 * One exception, and it is the standard accessible way to style a choice: the native checkbox or
 * radio is shrunk to a 1-pixel, transparent, clipped box, and its `<label>` is drawn as the box a
 * person sees and clicks. Jotform does this on every checkbox and radio. The control is on
 * screen — through its label — so it is visible when that label is. A honeypot's label is hidden
 * with it, or it has none. Only for checkables: a text box whose label shows still hides what you
 * type into it.
 *
 * And one for widgets: React-Select sets its input to `opacity: 0` the moment a choice is made,
 * and shows the choice in a sibling. Read as hidden, every Greenhouse dropdown vanished from the
 * form as soon as it was answered — the agent was told the question had gone. The same rule as
 * for its 3-pixel input below: a control that has announced what it is (`role="combobox"`,
 * `aria-haspopup`) is judged by the widget it sits in. A honeypot never announces itself.
 */
export function isVisible(el: Element): boolean {
  if (paintedOnScreen(el)) return true;
  if (declaresItselfInteractive(el) && ownOpacity(el) === 0) {
    const holder = sizedAncestor(el);
    return holder !== null && paintedOnScreen(holder);
  }
  const input = el as HTMLInputElement;
  if (el.localName !== "input" || (input.type !== "checkbox" && input.type !== "radio")) return false;
  return Array.from(input.labels ?? []).some((label) => paintedOnScreen(label));
}

/** The element's own opacity — not its ancestors': a transparent wrapper hides everything in it. */
function ownOpacity(el: Element): number {
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return style ? Number(style.opacity) : 1;
}

/** The first ancestor with a box at all, within three hops — `display: contents` wrappers skipped. */
function sizedAncestor(el: Element): Element | null {
  let ancestor = el.parentElement;
  for (let hops = 0; ancestor && hops < 3; hops++) {
    const box = ancestor.getBoundingClientRect();
    if (box.width > 0 || box.height > 0) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function paintedOnScreen(el: Element): boolean {
  const html = el as HTMLElement;
  if (!html.isConnected) return false;

  // The browser's own answer first. It covers cases that a hand-rolled style check misses
  // entirely: `content-visibility`, and a collapsed `<details>`, whose contents report a
  // perfectly ordinary 170×21 bounding box while being genuinely unrenderable.
  const check = (html as unknown as { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (typeof check === "function") {
    const visible = check.call(html, {
      checkOpacity: true,
      checkVisibilityCSS: true,
      contentVisibilityAuto: true,
    });
    if (!visible) return false;
  }

  // Kept as well as, not instead of — older Safari and Firefox have no `checkVisibility`.
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  if (Number(style.opacity) === 0) return false;

  const rect = html.getBoundingClientRect();

  // Measured in Chrome rather than guessed. An `<input style="width:0">` still reports **7.2px**
  // because of its default border and padding, and `height:0` reports **5.2px** — so a threshold
  // of one or two pixels catches none of the shrunk-to-nothing honeypots. A real checkbox is
  // **13×13**, which sets the ceiling. Ten is the only number that separates them.
  if (rect.width < MIN_INTERACTIVE_PX || rect.height < MIN_INTERACTIVE_PX) {
    // …except that some real controls genuinely are that small.
    //
    // React-Select's combobox is an autosize `<input>` measuring **3.5 × 20** when empty; the
    // 220-pixel box a person sees is its parent. A flat size rule removed every dropdown from a
    // live Greenhouse form — twenty fields became nine.
    //
    // What separates it from a honeypot is not its size but its declaration: it announces
    // `role="combobox"` to assistive technology. A honeypot never does, because being announced
    // to a screen reader is exactly what it is trying to avoid. So a tiny control is given the
    // benefit of the doubt only when it has said out loud what it is, and only if something it
    // sits inside is a real size.
    if (!declaresItselfInteractive(el)) return false;

    // The FIRST ancestor that has a real box decides, and its verdict is final either way.
    //
    // Walking on past a small ancestor in the hope of finding a large one always succeeds, since
    // `<body>` is large on every page — which would make this check meaningless. A control
    // sitting in a four-pixel box is in a four-pixel box, however big the document is.
    let ancestor = html.parentElement;
    for (let hops = 0; ancestor && hops < 3; hops++) {
      const box = ancestor.getBoundingClientRect();
      // Skip layout-less wrappers (`display: contents`, or an unstyled span) — they describe
      // nothing about whether the control is really on screen.
      if (box.width > 0 || box.height > 0) {
        return box.width >= MIN_INTERACTIVE_PX && box.height >= MIN_INTERACTIVE_PX;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  // Parked off-canvas with `left: -9999px` — a classic way to hide a honeypot in plain HTML.
  //
  // ⚠️ This must be measured against the DOCUMENT, not the viewport. Checking `rect.bottom < 0`
  // looks equivalent and is badly wrong: on any form taller than the screen, every field above
  // the current scroll position has a negative `rect.bottom`. That bug quietly dropped "First
  // Name" from a real Reddit application, because the page happened to be scrolled down.
  //
  // And the same inside any box that scrolls, not only the page. Luma's form scrolls inside its
  // popup: once the agent had filled the questions further down, Name, Email and Phone sat above
  // the popup's scroll position with negative boxes, and were dropped as hidden. Every scrolling
  // ancestor's offset counts — the page's own is the root element's (or, in quirks mode, body's).
  let scrollX = 0;
  let scrollY = 0;
  for (let node = html.parentElement; node; node = node.parentElement) {
    scrollX += node.scrollLeft;
    scrollY += node.scrollTop;
  }
  if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;

  return true;
}

/* ────────────────────────── custom widgets ──────────────────────────
 *
 * The modern web does not build dropdowns out of `<select>`. It builds them out of a trigger,
 * a portal, and a list of `role="option"` divs that do not exist until the trigger is pressed.
 * Setting `.value` on any of it does nothing at all: the component keeps its own state and
 * ignores the DOM. These three helpers are how Longtake operates such a thing the way a person
 * would — open it, look at what appeared, press one of them.
 */

/**
 * Open a custom widget.
 *
 * `pointerdown` comes first and it is not optional. Radix — and therefore shadcn/ui, and
 * therefore a large share of forms built in the last two years — registers `pointerdown` and
 * never registers `click`. A synthetic click leaves those menus shut.
 */
/**
 * Run a sequence of widget operations with the page to ourselves.
 *
 * ## The bug this exists for
 *
 * Opening a dropdown to read or pick from it is a sequence — press the trigger, wait, look at
 * what appeared, press again — and it only makes sense if nothing else touches the page's
 * widgets in the middle. Two things did. The hook reads the form at page load to bring back
 * remembered answers, and reads it again when the microphone is pressed. Pressed soon after load,
 * both loops ran at once. Traced on the landing page: `pointerdown gender` from one loop, then
 * `pointerdown country` from the other four milliseconds later. Country ended empty, and on a live
 * run it was refused with "pick from: Yes, No, Decline To Self Identify" — the Hispanic/Latino
 * question's options, attributed to Country because they were the ones open at the time.
 *
 * So every widget-touching sequence in `core/` — reading the options, writing answers — runs
 * through this queue, one after another. Not reentrant: nothing inside a queued sequence may
 * queue another, or it waits on itself.
 */
let widgetQueue: Promise<unknown> = Promise.resolve();

export function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const run = widgetQueue.then(work, work);
  widgetQueue = run.catch(() => undefined);
  return run;
}

/**
 * Do these options belong to this trigger?
 *
 * `true` or `false` when the page says — through `aria-controls`, `aria-owns`, or a shared
 * `aria-labelledby` — and `null` when it does not say at all, in which case only the order of
 * events can tell, and the caller has to rely on having opened it itself.
 */
export function ownsOptions(trigger: HTMLElement, option: HTMLElement): boolean | null {
  const list = option.closest("[role='listbox'],[role='menu'],[role='tree'],[role='grid']");
  const controls = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`
    .split(/\s+/)
    .filter(Boolean);
  const labelledBy = trigger.getAttribute("aria-labelledby");

  const listLabel = list?.getAttribute("aria-labelledby");

  if (list?.id && controls.includes(list.id)) return true;
  if (option.id && controls.includes(option.id)) return true;
  if (labelledBy && listLabel === labelledBy) return true;

  // "Not ours" only when the options declare a DIFFERENT owner. A menu that declares nothing —
  // Radix-style triggers render bare `role="option"` divs into a portal with no linkage at all —
  // is unknown, not foreign. Treating silence as "someone else's" refused a perfectly good pick.
  if (labelledBy && listLabel && listLabel !== labelledBy) return false;
  if (controls.length > 0 && list?.id && !controls.includes(list.id)) return false;
  return null;
}

export function openWidget(el: HTMLElement): void {
  // ⚠️ `nearest`, never `center`.
  //
  // `scrollIntoView` scrolls EVERY scrollable ancestor, the document included. With `center` it
  // always scrolls, even when the field is already in plain sight — so opening six dropdowns to
  // read their options yanked the whole page around six times while the person was mid-sentence,
  // which on the landing page looked exactly like the page scrolling itself back up.
  //
  // `nearest` does nothing when the element is already visible, and the minimum otherwise. The
  // element still has to be reachable — some libraries will not open an off-screen trigger — and
  // this is the version of that which does not fight the reader for control of the page.
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  // Already open? Then pressing it again is a toggle, and would SHUT the menu we are about to
  // read. Most triggers say so through `aria-expanded`; where one does not, it is pressed as before.
  if (el.getAttribute("aria-expanded") === "true") return;
  for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }),
    );
  }
}

/**
 * Put a widget away again without choosing anything.
 *
 * Escape alone is not enough. Plenty of menus never listen for it, and one left hanging open is
 * not a cosmetic problem: the next widget to be opened diffs against what is on screen, sees the
 * stale menu, and concludes that nothing opened. So an outside `pointerdown` is sent as well,
 * which is what most libraries actually use to dismiss.
 */
export function closeWidget(el: HTMLElement, shown?: Element[]): void {
  // Close only what is open, and nothing around it. Handed the options that were on show, it
  // does nothing once none of them is: the widget closed itself, and anything more would reach
  // only what holds it. (Not `aria-expanded`: plenty of widgets never update it.)
  const open = () => !shown || shown.some((option) => option.isConnected && isVisible(option));
  if (!open()) return;
  el.blur();

  // A click outside the widget but inside its form first: the widget's own "click outside" closes
  // it, and a popup holding the form sees a click inside itself. Luma's form sits in a popup that
  // closes on Escape and on a click outside it — an Escape that arrived as the list closed itself
  // closed the popup instead, with every answer in it.
  const dialog = el.closest("[role='dialog'], dialog, [aria-modal='true']");
  const outside = el.closest("form") ?? dialog ?? el.ownerDocument?.body;
  if (outside) {
    for (const type of ["pointerdown", "mousedown"]) {
      outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
    }
  }
  if (!open()) return;

  // Still open: the keyboard's way. Never inside a marked dialog, where an Escape that finds no
  // menu closes the dialog.
  if (!dialog) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, composed: true }));
  }
}

/**
 * Press one option inside an open widget.
 *
 * Options often live in a **React portal** — rendered as a child of `<body>`, nowhere near the
 * field they belong to — so they are never found by looking inside the trigger's container.
 * Everything here searches the whole document and works out ownership by what appeared.
 */
export function pressOption(option: HTMLElement): void {
  option.scrollIntoView({ block: "nearest" });
  for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    option.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }),
    );
  }
}

/** Every option-like node currently on screen, anywhere — portals and shadow roots included. */
export function optionNodes(root: Document | ShadowRoot = document): HTMLElement[] {
  return deepQueryAll(root, "[role='option'],[role='menuitem'],[role='menuitemradio']").filter(
    (el) => isVisible(el),
  ) as HTMLElement[];
}

/**
 * Wait until the page stops changing, then read it.
 *
 * A React form is blank until its data arrives. Cairn's own note on this: *"This is what modern
 * sites need most… a `look()` that happens too early sees an empty page."* A person who presses
 * the hotkey the moment a tab opens would otherwise be handed an empty form and told there is
 * nothing to fill.
 *
 * Resolves as soon as the DOM has been quiet for `quietMs`, or at `timeoutMs` regardless —
 * a page that polls in the background never goes quiet at all, so this can never be a hang.
 */
export function whenSettled(
  /** A document, or a single element to watch instead of the whole page. */
  root: Document | Element = document,
  quietMs = 350,
  timeoutMs = 5000,
  /**
   * An extra condition that must also hold before quiet counts as settled.
   *
   * ⚠️ Without this, waiting for quiet is worse than useless on the exact pages it exists for.
   * A React app that has not started rendering is perfectly quiet, so the wait returns
   * immediately and the form is read as empty — the failure it was written to prevent.
   * `waitForForm` in `reader.ts` passes "at least one field exists" here.
   */
  until?: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    // A document is watched through its body; an element watches itself. Either can be absent —
    // a detached document has no body — and there is nothing to wait for when it is.
    const target = "body" in root ? root.body : root;
    if (!target) {
      resolve();
      return;
    }

    let quiet: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(maybeFinish, quietMs);
    });

    const maybeFinish = () => {
      // Quiet, but nothing has arrived yet. Keep watching until the hard stop.
      if (until && !until()) return;
      finish();
    };

    const finish = () => {
      clearTimeout(quiet);
      clearTimeout(hardStop);
      observer.disconnect();
      resolve();
    };

    const hardStop = setTimeout(finish, timeoutMs);
    quiet = setTimeout(maybeFinish, quietMs);
    observer.observe(target, { childList: true, subtree: true, attributes: true });
  });
}
