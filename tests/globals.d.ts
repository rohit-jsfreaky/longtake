/** What `tools/probe.ts` puts on the page. Declared here so the specs type-check. */
import type { readForm, writeValues, harvestOptions, whenSettled } from "@longtake/core";

declare global {
  interface Window {
    __longtake: {
      version: string;
      readForm: typeof readForm;
      writeValues: typeof writeValues;
      harvestOptions: typeof harvestOptions;
      whenSettled: typeof whenSettled;
      inspect: () => unknown;
      inspectDeep: () => Promise<unknown>;
      last?: ReturnType<typeof readForm>;
    };
  }
}
