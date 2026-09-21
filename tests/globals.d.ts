/** What `tools/probe.ts` puts on the page. Declared here so the specs type-check. */
import type {
  readForm,
  writeValues,
  harvestOptions,
  whenSettled,
  waitForForm,
  buildFillTool,
  validateTool,
  describeForm,
  stillMissing,
  checkEvidence,
  keepOnlyWhatWasSaid,
  configForField,
  instructionForField,
  keytermsFrom,
  fieldsWorthShaping,
  shapeResult,
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
      buildFillTool: typeof buildFillTool;
      validateTool: typeof validateTool;
      describeForm: typeof describeForm;
      stillMissing: typeof stillMissing;
      checkEvidence: typeof checkEvidence;
      keepOnlyWhatWasSaid: typeof keepOnlyWhatWasSaid;
      configForField: typeof configForField;
      instructionForField: typeof instructionForField;
      keytermsFrom: typeof keytermsFrom;
      fieldsWorthShaping: typeof fieldsWorthShaping;
      shapeResult: typeof shapeResult;
      inspect: () => unknown;
      inspectDeep: () => Promise<unknown>;
      last?: ReturnType<typeof readForm>;
    };
  }
}
