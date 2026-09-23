/**
 * Open a corpus form the way the scorers need it: offline, from its recording, with the real
 * `core/` bundle on top and spies on anything that would send it.
 *
 * Nothing reaches the network — a request the recording does not hold is aborted — and a submit is
 * stopped and counted. Truth is joined to what we read **by element**, never by label: a truth
 * field and a spec are the same field only when they sit on the same element, or one holds the
 * other (a radiogroup and its first radio, a combobox and its input).
 */

import type { Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { HAR, REPLAYED, type AxCapture, type Locator, type Meta, type Truth } from "../../tools/corpus/types";
import { runSteps } from "../../tools/corpus/steps";
import { PROBE } from "../helpers";

export const CORPUS = resolve(process.cwd(), process.env.CORPUS_DIR ?? "corpus");

export type CorpusForm = { id: string; dir: string; meta: Meta; ax: AxCapture; truth: Truth | null };

/** Every captured form, read synchronously so specs can be generated from it. Empty without a corpus. */
export function corpusForms(): CorpusForm[] {
  if (!existsSync(CORPUS)) return [];
  const forms: CorpusForm[] = [];
  for (const id of readdirSync(CORPUS).sort()) {
    const dir = join(CORPUS, id);
    if (!existsSync(join(dir, "meta.json")) || !existsSync(join(dir, "ax.json"))) continue;
    const json = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
    forms.push({
      id,
      dir,
      meta: json<Meta>("meta.json"),
      ax: json<AxCapture>("ax.json"),
      truth: existsSync(join(dir, "truth.json")) ? json<Truth>("truth.json") : null,
    });
  }
  return forms;
}

/** What the page tried to send while we worked on it. Every scorer asserts these stay empty. */
export type Sent = { submits: string[]; posts: string[] };

declare global {
  interface Window {
    __corpusSent?: string[];
  }
}

/** Load the form offline, inject `core/`, and start counting anything that tries to leave. */
export async function openForm(page: Page, form: CorpusForm): Promise<Sent> {
  const sent: Sent = { submits: [], posts: [] };
  await page.routeFromHAR(join(form.dir, HAR), { notFound: "abort", url: REPLAYED });
  page.on("request", (request) => {
    // Analytics beacons post on their own; a navigation that posts is a form being sent.
    if (request.method() === "POST" && request.isNavigationRequest()) sent.posts.push(request.url());
  });
  await page.addInitScript(() => {
    const seen: string[] = (window.__corpusSent = []);
    const describe = (form: HTMLFormElement | null) => form?.action || form?.id || "form";
    document.addEventListener(
      "submit",
      (event) => {
        seen.push(`submit event: ${describe(event.target as HTMLFormElement)}`);
        event.preventDefault();
      },
      true,
    );
    HTMLFormElement.prototype.submit = function () {
      seen.push(`form.submit(): ${describe(this)}`);
    };
  });
  await page.goto(form.meta.url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await runSteps(page, form.meta.before);
  await page.addScriptTag({ path: PROBE });
  await page.waitForFunction(() => Boolean(window.__longtake));
  return sent;
}

/** Collect what the page tried to send so far. */
export async function sentSoFar(page: Page, sent: Sent): Promise<Sent> {
  const submits = await page.evaluate(() => window.__corpusSent ?? []).catch(() => []);
  return { submits: [...sent.submits, ...submits], posts: [...sent.posts] };
}

/** One truth locator → our spec id, or why there is none. */
export type Joined = { at: string; specId: string | null; found: boolean };

/**
 * Read the page with `core/`, then find which of our specs sits on each locator's element.
 * `found: false` means the locator itself no longer resolves — a corpus problem, not a reader one.
 */
export async function joinByElement(page: Page, locators: Locator[]): Promise<{ joined: Joined[]; specs: unknown[] }> {
  return page.evaluate((locators) => {
    const read = window.__longtake.inspect() as { specs: { id: string }[] };
    const handles = window.__longtake.last!.handles;

    const inHops = (root: Document | ShadowRoot, hops: string[]): Element | null => {
      let scope: Document | ShadowRoot | null = root;
      let el: Element | null = null;
      for (const [i, css] of hops.entries()) {
        if (!scope) return null;
        el = scope.querySelector(css);
        if (!el) return null;
        if (i < hops.length - 1) scope = el.shadowRoot;
      }
      return el;
    };
    const resolveLocator = (locator: { frames: string[]; path: string[] }): Element | null => {
      let doc: Document | null = document;
      for (const frame of locator.frames) {
        const iframe: HTMLIFrameElement | null = doc ? (inHops(doc, frame.split(" >> ")) as HTMLIFrameElement | null) : null;
        try {
          doc = iframe?.contentDocument ?? null;
        } catch {
          doc = null; // another origin: not reachable from here
        }
      }
      return doc ? inHops(doc, locator.path) : null;
    };

    const joined = locators.map((locator) => {
      const at = [...locator.frames, ...locator.path].join(" | ");
      const el = resolveLocator(locator);
      if (!el) return { at, specId: null, found: false };
      let best: { id: string; rank: number } | null = null;
      for (const [id, handle] of handles) {
        // Same element beats one holding the other; among those, the tightest fit wins.
        const rank =
          handle === el ? 0 : el.contains(handle) ? el.querySelectorAll("*").length : handle.contains(el) ? 1e6 + handle.querySelectorAll("*").length : -1;
        if (rank >= 0 && (!best || rank < best.rank)) best = { id, rank };
      }
      return { at, specId: best?.id ?? null, found: true };
    });
    return { joined, specs: read.specs };
  }, locators);
}
