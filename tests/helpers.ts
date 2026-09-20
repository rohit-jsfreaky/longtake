/**
 * Shared scaffolding for the moat's test suite.
 *
 * Every test builds its own page with `setContent` and then injects the real bundled `core/`.
 * No fixture files and no server: the HTML under test sits next to the assertion about it, which
 * matters when there are hundreds of them and each one is about one specific shape of markup.
 */

import { expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * The bundled `core/`, built by `npm run build:probe` — which `npm test` runs first.
 *
 * Resolved from the working directory rather than from `import.meta.url`, because Playwright
 * compiles these specs to CommonJS and `import.meta` is a syntax error there.
 */
export const PROBE = resolve(process.cwd(), "web/public/probe.js");

export type TestFieldSpec = {
  id: string;
  selector?: string;
  label: string;
  kind: string;
  required: boolean;
  options?: { value: string; label: string }[];
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  longForm?: boolean;
  custom?: boolean;
  suspectedHoneypot?: boolean;
};

export type TestRead = {
  url: string;
  count: number;
  specs: TestFieldSpec[];
  skipped: { label: string; reason: string }[];
};

export type TestOutcome = {
  fieldId: string;
  status: "written" | "refused" | "rejected-by-page";
  wrote?: string;
  reason?: string;
  found?: string;
};

/** Put markup on the page and load the real `core/` bundle over it. */
export async function load(page: Page, body: string, head = ""): Promise<void> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`,
  );
  await page.addScriptTag({ path: PROBE });
}

/** Read the page synchronously — no dropdown opening. */
export async function read(page: Page): Promise<TestRead> {
  return page.evaluate(() => window.__longtake.inspect() as unknown) as Promise<TestRead>;
}

/** Read the page and open every dropdown to learn its real choices. */
export async function readDeep(page: Page): Promise<TestRead> {
  return page.evaluate(() => window.__longtake.inspectDeep() as unknown) as Promise<TestRead>;
}

/** One field by id, failing the test with a useful message rather than returning undefined. */
export function field(read: TestRead, id: string): TestFieldSpec {
  const found = read.specs.find((spec) => spec.id === id);
  expect(found, `no field "${id}" — found: ${read.specs.map((s) => s.id).join(", ")}`).toBeTruthy();
  return found!;
}

/** The one and only field on a single-field page. Fails loudly if there is not exactly one. */
export function only(read: TestRead): TestFieldSpec {
  expect(read.specs, `expected exactly one field, got ${read.specs.map((s) => s.id).join(", ")}`)
    .toHaveLength(1);
  return read.specs[0]!;
}

/** Find a field by the label a person would read, rather than by our generated id. */
export function byLabel(read: TestRead, label: string): TestFieldSpec {
  const found = read.specs.find((spec) => spec.label === label);
  expect(found, `no field labelled "${label}" — found: ${read.specs.map((s) => `"${s.label}"`).join(", ")}`)
    .toBeTruthy();
  return found!;
}

/** Write spoken values against the last read, and return one outcome per value. */
export async function write(
  page: Page,
  values: { fieldId: string; value: unknown; evidence: string }[],
): Promise<TestOutcome[]> {
  return page.evaluate(async (spoken) => {
    const last = window.__longtake.last!;
    return (await window.__longtake.writeValues(
      last.specs,
      last.handles,
      spoken as never,
    )) as unknown;
  }, values) as Promise<TestOutcome[]>;
}

/** Read, then write, in one step — the common shape of a writer test. */
export async function readThenWrite(
  page: Page,
  values: { fieldId: string; value: unknown; evidence: string }[],
): Promise<TestOutcome[]> {
  await read(page);
  return write(page, values);
}

/** What a control currently holds, asked of the live DOM rather than of our own bookkeeping. */
export async function valueOf(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return "__MISSING__";
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "checked" : "unchecked";
    if ("value" in el && typeof el.value === "string") return el.value;
    return (el.textContent ?? "").trim();
  }, selector);
}

/** What the page visibly shows around a control — how a component's selection is confirmed. */
export async function shownNear(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    let node = el?.parentElement ?? null;
    for (let hops = 0; node && hops < 5; hops++) {
      const text = (node.innerText ?? "").replace(/\s+/g, " ").trim();
      if (text) return text;
      node = node.parentElement;
    }
    return "";
  }, selector);
}
