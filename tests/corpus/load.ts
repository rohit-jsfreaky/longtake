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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { HAR, type AxCapture, type Conversation, type FillPlan, type Locator, type Meta, type Truth } from "../../tools/corpus/types";
import { replayFromHar } from "../../tools/corpus/replay-har";
import { runSteps, settle } from "../../tools/corpus/steps";
import type { ReadJoin, ReadSpec } from "../../tools/corpus/score";
import { PROBE } from "../helpers";

export const CORPUS = resolve(process.cwd(), process.env.CORPUS_DIR ?? "corpus");
/** One JSON per form per scorer, read by the report. Cleared at the start of every run. */
export const RESULTS = resolve(process.cwd(), process.env.CORPUS_RESULTS ?? "corpus-results");

export type CorpusForm = { id: string; dir: string; meta: Meta; ax: AxCapture; truth: Truth | null; fill: FillPlan | null; talk: Conversation | null };

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
      fill: existsSync(join(dir, "fill.json")) ? json<FillPlan>("fill.json") : null,
      talk: existsSync(join(dir, "conversation.json")) ? json<Conversation>("conversation.json") : null,
    });
  }
  return forms;
}

/** What the page tried to send while we worked on it. Every scorer asserts these stay empty. */
export type Sent = { submits: string[]; posts: string[] };

type Located = Element | null | "elsewhere";

declare global {
  interface Window {
    __corpusSent?: string[];
    __corpusSession?: InstanceType<Window["__longtake"]["LongtakeSession"]>;
    __corpusFind?: (locator: Locator) => Located;
    __corpusConductor?: InstanceType<Window["__longtake"]["Conductor"]>;
    __corpusFake?: InstanceType<Window["__longtake"]["FakeVoice"]>;
  }
}

/**
 * Runs in the page: find a captured control again. By id first; by structure when the id is one the
 * framework made afresh on this load. "elsewhere" when it sits inside another origin's frame — there,
 * but not reachable from this page.
 */
function installFinder(): void {
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
  const follow = (locator: { frames: string[]; path: string[] }): Located => {
    let doc: Document | null = document;
    for (const frame of locator.frames) {
      const iframe: HTMLIFrameElement | null = doc ? (inHops(doc, frame.split(" >> ")) as HTMLIFrameElement | null) : null;
      if (!iframe) return null;
      try {
        doc = iframe.contentDocument;
      } catch {
        doc = null;
      }
      if (!doc) return "elsewhere";
    }
    return inHops(doc!, locator.path);
  };
  // Not `instanceof Element`: an element inside a frame is an instance of that frame's Element.
  const isElement = (found: Located): found is Element => found !== null && found !== "elsewhere";
  window.__corpusFind = (locator) => {
    const own = follow(locator);
    if (isElement(own) || !locator.plain) return own;
    const plain = follow(locator.plain);
    return isElement(plain) ? plain : own ?? plain;
  };
}

/** Load the form offline, inject `core/`, and start counting anything that tries to leave. */
export async function openForm(page: Page, form: CorpusForm): Promise<Sent> {
  const sent: Sent = { submits: [], posts: [] };
  await replayFromHar(page, join(form.dir, HAR));
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
  await page.addInitScript(installFinder);
  await page.goto(form.meta.url, { waitUntil: "load", timeout: 60_000 });
  await runSteps(page, form.meta.before);
  // The product reads again whenever its page changes; a scorer reads once, so it reads the page
  // that was captured — see `whenCaptured` — once that has stopped changing.
  await whenCaptured(page, form);
  await settle(page);
  await page.addScriptTag({ path: PROBE });
  await page.waitForFunction(() => Boolean(window.__longtake));
  return sent;
}

/**
 * Wait for the page to be the one that was captured: every control seen then, found again.
 *
 * Nothing the page does says a framework is finished. Under a full corpus run Reddit's app sat
 * for 2.5 s after its last script — network idle, DOM still, idle callbacks firing (React
 * hydrates in chunks and yields between them) — and only then loaded its captcha and drew the
 * phone picker and the consent box. 4 reads in 20 came before them. The capture knows what the
 * finished page holds, so that is what is waited for; a control still missing after `maxMs` is
 * really lost, and the load spec says so.
 */
async function whenCaptured(page: Page, form: CorpusForm, maxMs = 20_000): Promise<void> {
  await page
    .waitForFunction(
      (locators) => locators.every((locator) => window.__corpusFind!(locator) !== null),
      form.ax.controls.map((control) => control.locator),
      { timeout: maxMs, polling: 250 },
    )
    .catch(() => undefined);
}

/** Collect what the page tried to send so far. */
export async function sentSoFar(page: Page, sent: Sent): Promise<Sent> {
  const submits = await page.evaluate(() => window.__corpusSent ?? []).catch(() => []);
  return { submits: [...sent.submits, ...submits], posts: [...sent.posts] };
}

/** Read the page the way the product does: wait for it to settle, read, open every dropdown. */
export async function readLikeTheProduct(page: Page): Promise<{ specs: ReadSpec[]; readMs: number; harvestMs: number }> {
  return page.evaluate(async () => {
    const core = window.__longtake;
    await core.waitForForm();
    // Timed apart: the read is what a person waits for on every page change, the harvest once.
    const started = performance.now();
    const first = core.readForm();
    const readAt = performance.now();
    const read = await core.harvestOptions(first);
    core.last = read;
    return { specs: read.specs as unknown as ReadSpec[], readMs: readAt - started, harvestMs: performance.now() - readAt };
  });
}

/** Read without opening anything — enough to know which elements `core/` took as fields. */
export async function readAsIs(page: Page): Promise<ReadSpec[]> {
  return page.evaluate(() => (window.__longtake.inspect() as { specs: ReadSpec[] }).specs);
}

/**
 * Join truth to the last read **by element**. Each truth field comes as all of its elements (its
 * own first, then the other choices of its group); `found[i]` is false when its own no longer
 * resolves — a corpus problem, not a reader one.
 *
 * `stale` counts handles the page has since thrown away: a framework that re-renders after the
 * read replaces the very elements the read holds, and then nothing can join. The product re-reads
 * when its page changes (the conductor watches for it); so does the caller, on `stale > 0`.
 */
export async function joinTruth(page: Page, fields: Locator[][]): Promise<ReadJoin & { found: boolean[]; otherOrigin: boolean[]; stale: number }> {
  return page.evaluate((fields) => {
    const handles = window.__longtake.last!.handles;
    const stale = [...handles.values()].filter((handle) => !handle.isConnected).length;

    const located = fields.map((locators) => locators.map((locator) => window.__corpusFind!(locator)));
    const elements = located.map((all) => all.map((one) => (one === "elsewhere" ? null : one)));
    const size = (el: Element) => el.querySelectorAll("*").length;
    /** How closely a handle is this field: lower is closer, -1 is not at all. */
    const closeness = (handle: Element, els: (Element | null)[]) => {
      let best = -1;
      els.forEach((el, i) => {
        if (!el) return;
        const rank =
          handle === el ? i === 0 ? 0 : 1 : el.contains(handle) ? 2 + size(el) : handle.contains(el) ? 1e6 + size(handle) : -1;
        if (rank >= 0 && (best < 0 || rank < best)) best = rank;
      });
      return best;
    };

    const best = elements.map((els) => {
      let found: { id: string; rank: number } | null = null;
      for (const [id, handle] of handles) {
        const rank = closeness(handle, els);
        if (rank >= 0 && (!found || rank < found.rank)) found = { id, rank };
      }
      return found?.id ?? null;
    });
    const touches: Record<string, number[]> = {};
    for (const [id, handle] of handles) {
      touches[id] = elements.flatMap((els, i) => (closeness(handle, els) >= 0 ? [i] : []));
    }
    // Inside another origin's frame: there, but not reachable from this page.
    const otherOrigin = located.map((all) => all[0] === "elsewhere");
    return { best, touches, found: elements.map((els) => els[0] !== null), otherOrigin, stale };
  }, fields);
}

/** Keep one scorer's result for one form, for the report. */
export function saveResult(scorer: string, id: string, result: object): void {
  mkdirSync(join(RESULTS, scorer), { recursive: true });
  writeFileSync(join(RESULTS, scorer, `${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), ...result }, null, 1));
}

/**
 * Open the form the way a call does: a real `LongtakeSession`, nothing remembered, form read in
 * full. Its read becomes the one `joinTruth` joins against.
 */
export async function startSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const core = window.__longtake;
    const session = new core.LongtakeSession({ root: () => document, ignore: "", memory: { load: () => ({}), save: () => {} } });
    await session.open();
    window.__corpusSession = session;
    core.last = session.read!;
  });
}

/**
 * The whole product on the page — the conductor the site and the extension both run — with a
 * FakeVoice where the microphone and the agent would be. `core.last` is its read, for the join.
 */
export async function startConductor(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const core = window.__longtake;
    const fake = new core.FakeVoice();
    let memory = {} as never;
    const conductor = new core.Conductor({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      memory: { load: () => memory, save: (next) => { memory = next as never; } },
      logFrames: false,
      services: { getToken: async () => "token", workletUrl: "", startVoice: fake.start },
    });
    await conductor.start();
    await new Promise((ready) => setTimeout(ready, 20)); // session.ready arrives on the next tick
    window.__corpusConductor = conductor;
    window.__corpusFake = fake;
    core.last = conductor.session.read!;
  });
}

/**
 * Play a conversation through the conductor. `ids` maps truth keys to today's spec ids. Every
 * field is photographed before and after: one that changed although no call named it — nor
 * `also` — was touched unasked.
 */
export async function talk(page: Page, script: Conversation, ids: Record<string, string>) {
  return page.evaluate(async ({ script, ids }) => {
    const core = window.__longtake;
    const conductor = window.__corpusConductor!;
    const fake = window.__corpusFake!;
    const resolve = (ref: string) => {
      const key = ref.replace(/^\$/, "");
      return ids[key] ?? (ref.startsWith("$") ? `unread_${key}` : ref);
    };
    const photo = () => new Map(conductor.session.state().fields.map((f) => [f.spec.id, JSON.stringify(f.value)]));
    const before = photo();
    const report = await core.runScript(conductor, fake, { name: script.name, steps: script.steps }, resolve);
    await new Promise((settle) => setTimeout(settle, 300));
    const after = photo();

    const asked = new Set((script.also ?? []).map(resolve));
    for (const step of script.steps) {
      if (!("tool" in step)) continue;
      for (const [key, value] of Object.entries(step.args)) {
        if (key.startsWith("$")) asked.add(resolve(key));
        if (key === "field" && typeof value === "string") asked.add(resolve(value));
        if (key === "fields" && Array.isArray(value)) for (const one of value) asked.add(resolve(String(one)));
      }
    }
    const touched = [...after.keys()]
      .filter((id) => !asked.has(id) && before.has(id) && before.get(id) !== after.get(id))
      .map((id) => `${id} (${before.get(id)} → ${after.get(id)})`);
    return { report, touched };
  }, { script, ids });
}

export type Answer = { specId: string; also: string[]; value: string | string[] | boolean; evidence: string; hiddenCss?: string };

/**
 * One answer, exactly as the agent's `fill_fields` call carries it, with everything they said
 * being its evidence. Every field's value is photographed before and after, so an answer that
 * moved some other field — one nobody spoke to — is caught.
 */
export async function answer(page: Page, input: Answer) {
  return page.evaluate(async ({ specId, also, value, evidence, hiddenCss }) => {
    const core = window.__longtake;
    const session = window.__corpusSession!;
    const photo = () => new Map(session.state().fields.map((f) => [f.spec.id, JSON.stringify(f.value)]));
    const labels = new Map(session.state().fields.map((f) => [f.spec.id, f.spec.label || f.spec.id]));

    const before = photo();
    const done = await session.fill({ [specId]: { value, evidence } }, evidence);
    await new Promise((settle) => setTimeout(settle, 300));
    const after = photo();

    const result = done.result as { waiting_for_yes?: { field: string }[] };
    const outcome = done.outcomes.some((o) => o.fieldId === specId && o.status === "written")
      ? "written"
      : (result.waiting_for_yes ?? []).some((held) => held.field === specId)
        ? "held"
        : "refused";
    const touched = [...after.keys()]
      .filter((id) => id !== specId && !also.includes(id) && before.has(id) && before.get(id) !== after.get(id))
      .map((id) => `${labels.get(id) ?? id} (${before.get(id)} → ${after.get(id)})`);
    const shows = session.state().fields.find((f) => f.spec.id === specId)?.value ?? null;
    const hidden = hiddenCss ? ((document.querySelector(hiddenCss) as HTMLInputElement | null)?.value ?? null) : undefined;
    core.last = session.read!;
    // What the call itself reported, field by field — so a wrong answer explains itself.
    const call = done.outcomes.map((o) => {
      const { wrote, reason } = o as { wrote?: string; reason?: string };
      return `${labels.get(o.fieldId) ?? o.fieldId}: ${o.status}${wrote ? ` "${wrote}"` : ""}${reason ? ` (${reason})` : ""}`;
    });
    return { outcome: outcome as "written" | "held" | "refused", shows, touched, hidden, call };
  }, input);
}

/**
 * When the page has replaced elements the session holds, read it again — what the conductor does
 * the moment it sees the page change. True when it had to.
 */
export async function freshen(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const session = window.__corpusSession!;
    const read = session.read;
    if (!read || [...read.handles.values()].every((handle) => handle.isConnected)) return false;
    await session.pageChanged();
    window.__longtake.last = session.read!;
    return true;
  });
}
