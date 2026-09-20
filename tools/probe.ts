/**
 * The Phase 1 test harness: `core/` in a single file, injectable into any live page.
 *
 * Bundled to `web/public/probe.js` and pulled into a real third-party form with a script tag,
 * so `reader.ts` and `writer.ts` are exercised against a page we do not own and cannot change —
 * which is the only test of them that means anything.
 */
import {
  readForm,
  writeValues,
  harvestOptions,
  whenSettled,
  waitForForm,
  CORE_VERSION,
} from "@longtake/core";

declare global {
  interface Window {
    __longtake: {
      version: string;
      readForm: typeof readForm;
      writeValues: typeof writeValues;
      harvestOptions: typeof harvestOptions;
      whenSettled: typeof whenSettled;
      waitForForm: typeof waitForForm;
      /** Read, then open every dropdown to learn its real choices. */
      inspectDeep: () => Promise<unknown>;
      /** The live read, kept so a fill can reuse the same element handles. */
      last?: ReturnType<typeof readForm>;
      /** Read the page and return just the specs, JSON-safe, for printing. */
      inspect: () => unknown;
    };
  }
}

window.__longtake = {
  version: CORE_VERSION,
  readForm,
  writeValues,
  harvestOptions,
  whenSettled,
  inspect: () => {
    const read = readForm();
    window.__longtake.last = read;
    return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
  },
  inspectDeep: async () => {
    // Wait for a React form to finish drawing before reading it, then learn every dropdown.
    await waitForForm();
    const read = await harvestOptions(readForm());
    window.__longtake.last = read;
    return { url: read.url, count: read.specs.length, specs: read.specs, skipped: read.skipped };
  },
};

console.log(`[Longtake] probe ${CORE_VERSION} ready — window.__longtake`);
