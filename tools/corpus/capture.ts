/**
 * Capture one real form into the corpus: its page and JavaScript (HAR, for offline replay), a
 * static snapshot (MHTML), a screenshot, and Chrome's own accessibility tree with a DOM path for
 * every control.
 *
 * Runs a headless Chrome of its own, or attaches to the separate-profile Chrome on port 9222 —
 * never the person's own browser. Always of an empty form: nothing is typed except the search
 * queries a fill plan will need, so their answers are in the recording.
 *
 * Chrome's tree is a seed, not the truth: it names `<p>Portfolio URL</p><input>` nothing, where a
 * person reads "Portfolio URL". `seed.ts` turns it into a draft answer key, and a human verifies it.
 */

import { chromium, type Browser, type CDPSession, type Frame, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSteps } from "./steps";
import { HAR, type Step, type AxCapture, type AxControl, type Category, type Meta } from "./types";

export type CaptureOptions = {
  dir?: string;
  category: Category;
  platform: string;
  /** Attach to the Chrome on :9222 instead of launching one. */
  cdp?: boolean;
  /** Search boxes to type into during capture, so the replay has their results: css → queries. */
  queries?: Record<string, string[]>;
  /** Clicks that reveal a conditional form's fields, done before anything is read. */
  before?: Step[];
  notes?: string;
};

/** Roles that take an answer. `radio` is kept so native radio groups can be grouped by name. */
const CONTROL_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "radiogroup",
  "radio",
  "checkbox",
  "switch",
  "spinbutton",
  "slider",
  // Native <input type=date|datetime-local|month|week|time|color> — Chrome's own role names.
  "Date",
  "DateTime",
  "InputTime",
  "ColorWell",
]);

type AxValue = { type: string; value?: unknown };
type AxProperty = { name: string; value: AxValue };
type AxNode = {
  nodeId: string;
  ignored: boolean;
  role?: AxValue;
  name?: AxValue & { sources?: { type: string; attribute?: string; value?: AxValue; superseded?: boolean }[] };
  description?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
  backendDOMNodeId?: number;
  frameId?: string;
};

/**
 * Runs in the page with `this` = the element: where it is (CSS path per shadow hop and per frame
 * hop) and what it is in the DOM. A path uses a unique id where there is one, else nth-of-type.
 */
const DESCRIBE = `function () {
  const cssPath = (node) => {
    const parts = [];
    let n = node;
    while (n && n.nodeType === 1) {
      const tag = n.tagName.toLowerCase();
      const root = n.getRootNode();
      if (n.id && /^[A-Za-z][\\w-]*$/.test(n.id) && root.querySelectorAll('#' + CSS.escape(n.id)).length === 1) {
        parts.unshift('#' + CSS.escape(n.id));
        break;
      }
      const parent = n.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(n) + 1) + ')' : tag);
      n = parent;
    }
    return parts.join(' > ');
  };
  const shadowPath = (el) => {
    const path = [];
    let node = el;
    for (;;) {
      path.unshift(cssPath(node));
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) node = root.host; else break;
    }
    return path;
  };
  const el = this;
  // Inside the browser's own shadow root — the Month/Day/Year parts of a native date input, its
  // "Show date picker" button. A page can attach a shadow root only to a custom element or to one
  // of these tags (DOM spec, attachShadow), so any other host means the root is the browser's.
  const ATTACHABLE = ['article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main', 'nav', 'p', 'section', 'span'];
  for (let root = el.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
    const host = root.host.localName;
    if (!host.includes('-') && !ATTACHABLE.includes(host)) return { internal: true };
  }
  const frames = [];
  try {
    let win = el.ownerDocument.defaultView;
    while (win && win.frameElement) {
      frames.unshift(shadowPath(win.frameElement).join(' >> '));
      win = win.frameElement.ownerDocument.defaultView;
    }
  } catch (e) {}
  const rect = el.getBoundingClientRect();
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  const tag = el.tagName.toLowerCase();
  // Where it is on the full-page screenshot: page coordinates of the top document.
  const box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  try {
    let win = el.ownerDocument.defaultView;
    while (win) {
      box.x += win.scrollX;
      box.y += win.scrollY;
      if (!win.frameElement) break;
      const frameRect = win.frameElement.getBoundingClientRect();
      box.x += frameRect.left - win.scrollX;
      box.y += frameRect.top - win.scrollY;
      win = win.frameElement.ownerDocument.defaultView;
    }
  } catch (e) {}
  // Document order across shadow roots and same-process frames: child indexes from the top.
  const order = [];
  for (let n = el; n; ) {
    const parent = n.parentNode;
    if (parent) { order.unshift(Array.prototype.indexOf.call(parent.childNodes, n)); n = parent; continue; }
    if (n.host) { order.unshift(-1); n = n.host; continue; }
    let frameElement = null;
    try { frameElement = n.defaultView && n.defaultView.frameElement; } catch (e) {}
    if (!frameElement) break;
    order.unshift(-1);
    n = frameElement;
  }
  return {
    order,
    box,
    locator: { frames, path: shadowPath(el) },
    dom: {
      tag,
      type: el.getAttribute('type') || undefined,
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      multiple: tag === 'select' ? el.multiple : undefined,
      visible,
    },
    selectOptions: tag === 'select' ? Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean) : undefined,
    group: groupOf(el),
  };
  // The question a radio or checkbox belongs to: its fieldset's legend, or its radiogroup's name.
  function groupOf(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role');
    if (!(type === 'radio' || type === 'checkbox' || role === 'radio')) return undefined;
    const text = (n) => (n ? (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const radiogroup = el.closest('[role=radiogroup]');
    if (radiogroup) {
      const ids = (radiogroup.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
      const label = ids.map((id) => text(el.ownerDocument.getElementById(id))).join(' ').trim() || radiogroup.getAttribute('aria-label') || '';
      return { key: 'rg:' + shadowPath(radiogroup).join(' >> '), label };
    }
    const fieldset = el.closest('fieldset');
    const name = el.getAttribute('name');
    return {
      key: name ? 'name:' + name : 'fs:' + (fieldset ? shadowPath(fieldset).join(' >> ') : shadowPath(el).join(' >> ')),
      label: fieldset ? text(fieldset.querySelector('legend')) : '',
    };
  }
}`;

/** Headers that carry a session. The recording keeps what the page is, never who loaded it. */
const PRIVATE_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization", "x-csrf-token", "x-xsrf-token"]);

type HarHeaders = { name: string; value: string }[];
type HarFile = {
  log: { entries: { request: { headers: HarHeaders; cookies?: unknown[] }; response: { headers: HarHeaders; cookies?: unknown[] } }[] };
};

async function stripSessions(path: string): Promise<void> {
  const har = JSON.parse(await readFile(path, "utf8")) as HarFile;
  const keep = (headers: HarHeaders) => headers.filter((h) => !PRIVATE_HEADERS.has(h.name.toLowerCase()));
  for (const { request, response } of har.log.entries) {
    request.headers = keep(request.headers);
    request.cookies = [];
    response.headers = keep(response.headers);
    response.cookies = [];
  }
  await writeFile(path, JSON.stringify(har));
}

const prop = (node: AxNode, name: string) => node.properties?.find((p) => p.name === name)?.value.value;

/** Chrome's accessibility tree for every frame of the page, controls joined to their DOM. */
export async function readAx(page: Page, cdp: CDPSession): Promise<AxCapture> {
  await cdp.send("Accessibility.enable");
  await cdp.send("DOM.enable");
  const { frameTree } = (await cdp.send("Page.getFrameTree")) as { frameTree: { frame: { id: string }; childFrames?: unknown[] } };
  const frameIds: string[] = [];
  const walk = (tree: { frame: { id: string }; childFrames?: unknown[] }) => {
    frameIds.push(tree.frame.id);
    for (const child of (tree.childFrames ?? []) as (typeof tree)[]) walk(child);
  };
  walk(frameTree);

  const nodes: AxNode[] = [];
  for (const frameId of frameIds) {
    try {
      const got = (await cdp.send("Accessibility.getFullAXTree", { frameId })) as { nodes: AxNode[] };
      nodes.push(...got.nodes);
    } catch {
      // A cross-origin frame lives in another process; its tree needs its own session (below).
    }
  }
  const oopif = await readOutOfProcessFrames(page);

  const controls: AxControl[] = [];
  const buttons: AxCapture["buttons"] = [];
  const describe = async (session: CDPSession, backendNodeId: number) => {
    const { object } = (await session.send("DOM.resolveNode", { backendNodeId })) as { object: { objectId?: string } };
    if (!object.objectId) return null;
    const { result } = (await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: DESCRIBE,
      returnByValue: true,
    })) as {
      result: {
        value:
          | { internal: true }
          | { order: number[]; box: AxControl["box"]; locator: AxControl["locator"]; dom: AxControl["dom"]; selectOptions?: string[]; group?: AxControl["group"] };
      };
    };
    // Part of a native control's insides: the control itself is its own node in the tree.
    return "internal" in result.value ? null : result.value;
  };

  // Chrome lists the tree in its own order; a person reads the page top to bottom.
  const byOrder = <T>(items: [number[], T][]) => {
    const compare = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return a.length - b.length;
    };
    return items.sort((a, b) => compare(a[0], b[0])).map(([, item]) => item);
  };

  const shift = (box: AxControl["box"], by: { x: number; y: number }) =>
    box && { x: Math.round(box.x + by.x), y: Math.round(box.y + by.y), w: Math.round(box.w), h: Math.round(box.h) };

  for (const [session, list, framePrefix, offset] of [[cdp, nodes, [], { x: 0, y: 0 }] as const, ...oopif]) {
    const theseControls: [number[], AxControl][] = [];
    const theseButtons: [number[], AxCapture["buttons"][number]][] = [];
    for (const node of list) {
      if (node.ignored || !node.backendDOMNodeId) continue;
      const role = String(node.role?.value ?? "");
      if (role === "button") {
        const name = String(node.name?.value ?? "").trim();
        if (!name) continue;
        const described = await describe(session, node.backendDOMNodeId).catch(() => null);
        if (described?.dom.visible) {
          theseButtons.push([
            described.order,
            { name, locator: { frames: [...framePrefix, ...described.locator.frames], path: described.locator.path } },
          ]);
        }
        continue;
      }
      if (!CONTROL_ROLES.has(role)) continue;
      const described = await describe(session, node.backendDOMNodeId).catch(() => null);
      if (!described) continue;
      const source = node.name?.sources?.find((s) => s.value && !s.superseded);
      const control: AxControl = {
        role,
        name: String(node.name?.value ?? "").trim(),
        ...(source ? { nameSource: source.attribute ?? source.type } : {}),
        ...(node.description?.value ? { description: String(node.description.value) } : {}),
        required: prop(node, "required") === true,
        ...(prop(node, "invalid") !== undefined ? { invalid: prop(node, "invalid") !== "false" } : {}),
        ...(prop(node, "expanded") !== undefined ? { expanded: prop(node, "expanded") === true } : {}),
        ...(prop(node, "checked") !== undefined ? { checked: String(prop(node, "checked")) } : {}),
        ...(node.value?.value !== undefined && node.value.value !== "" ? { value: String(node.value.value) } : {}),
        ...(described.selectOptions ? { options: described.selectOptions } : {}),
        ...(described.group ? { group: described.group } : {}),
        locator: { frames: [...framePrefix, ...described.locator.frames], path: described.locator.path },
        dom: described.dom,
        box: shift(described.box, offset),
      };
      theseControls.push([described.order, control]);
    }
    controls.push(...byOrder(theseControls));
    buttons.push(...byOrder(theseButtons));
  }
  return { url: page.url(), title: await page.title(), controls, buttons };
}

/** Frames in another process (cross-origin iframes) need a CDP session of their own. */
type OutOfProcess = [CDPSession, AxNode[], string[], { x: number; y: number }];

async function readOutOfProcessFrames(page: Page): Promise<OutOfProcess[]> {
  const out: OutOfProcess[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let session: CDPSession;
    try {
      session = await page.context().newCDPSession(frame);
    } catch {
      continue; // same-process frame: already read through the page's session
    }
    try {
      await session.send("Accessibility.enable");
      await session.send("DOM.enable");
      const got = (await session.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
      const selector = await frameSelector(frame);
      const at = await frame.frameElement().then((el) => el.boundingBox()).catch(() => null);
      const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      out.push([session, got.nodes, selector ? [selector] : [], at ? { x: at.x + scroll.x, y: at.y + scroll.y } : { x: 0, y: 0 }]);
    } catch {
      // unreadable frame — recorded as missing by the fidelity check
    }
  }
  return out;
}

async function frameSelector(frame: Frame): Promise<string | null> {
  const element = await frame.frameElement().catch(() => null);
  if (!element) return null;
  return element.evaluate((node) => {
    const el = node as Element;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const src = el.getAttribute("src");
    return src ? `iframe[src="${src.replace(/"/g, '\\"')}"]` : "iframe";
  });
}

/** A Playwright locator for a corpus locator: frame hops, then shadow hops (chained locators pierce). */
export function locate(page: Page, locator: AxControl["locator"]): Locator {
  let scope: Page | ReturnType<Page["frameLocator"]> = page;
  for (const frame of locator.frames) scope = scope.frameLocator(frame);
  let found = scope.locator(locator.path[0]!);
  for (const segment of locator.path.slice(1)) found = found.locator(segment);
  return found.first();
}

/** Open each combobox or listbox the way a person would and write down what it offered. */
export async function recordOptions(page: Page, controls: AxControl[]): Promise<void> {
  for (const control of controls) {
    if (control.role !== "combobox" || control.options) continue;
    if (!control.dom.visible) continue;
    const target = locate(page, control.locator);
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 2000 });
      await target.click({ timeout: 2000 });
      await page.waitForTimeout(600);
      const options = await page.evaluate(() => {
        const seen = new Set<string>();
        const deep = (root: Document | ShadowRoot, out: Element[]) => {
          out.push(...root.querySelectorAll("[role='option']"));
          for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deep(el.shadowRoot, out);
          return out;
        };
        return deep(document, [])
          .filter((o) => {
            const r = o.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((o) => (o.textContent ?? "").trim())
          .filter((t) => t && !seen.has(t) && (seen.add(t), true));
      });
      if (options.length > 0) control.options = options;
    } catch {
      // Could not open it headlessly — left for the human review.
    } finally {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.click(2, 2).catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }
}

export async function capture(url: string, id: string, options: CaptureOptions): Promise<{ dir: string; controls: number }> {
  const dir = join(options.dir ?? "corpus", id);
  await rm(join(dir, "har"), { recursive: true, force: true });
  await mkdir(join(dir, "shots"), { recursive: true });
  await mkdir(join(dir, "har"), { recursive: true });

  const browser: Browser = options.cdp
    ? await chromium.connectOverCDP("http://127.0.0.1:9222")
    : await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    recordHar: { path: join(dir, HAR), mode: "full", content: "attach" },
  });
  const page = await context.newPage();
  let controls = 0;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => page.waitForLoadState("load"));
    await page.waitForTimeout(1500);
    await runSteps(page, options.before);

    const cdp = await context.newCDPSession(page);
    const ax = await readAx(page, cdp);
    await recordOptions(page, ax.controls);

    for (const [css, queries] of Object.entries(options.queries ?? {})) {
      const box = page.locator(css).first();
      for (const query of queries) {
        await box.fill("").catch(() => undefined);
        await box.pressSequentially(query, { delay: 40 }).catch(() => undefined);
        await page.waitForTimeout(2200);
      }
      await box.fill("").catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }

    await page.screenshot({ path: join(dir, "shots", "page.png"), fullPage: true });
    const { data } = (await cdp.send("Page.captureSnapshot", { format: "mhtml" })) as { data: string };
    await writeFile(join(dir, "page.mhtml"), data);
    await writeFile(join(dir, "ax.json"), JSON.stringify(ax, null, 1));

    const meta: Meta = {
      id,
      url,
      category: options.category,
      platform: options.platform,
      ...(options.before?.length ? { before: options.before } : {}),
      capturedAt: new Date().toISOString(),
      reachableWithoutLogin: true,
      fillable: true,
      ...(options.notes ? { notes: options.notes } : {}),
    };
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    controls = ax.controls.length;
  } finally {
    await context.close(); // writes the HAR
    if (!options.cdp) await browser.close();
  }
  await stripSessions(join(dir, HAR));
  return { dir, controls };
}
