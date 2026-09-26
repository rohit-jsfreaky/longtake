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
  readHesitation,
  describeMarks,
  canonicalKey,
  applyChanges,
  recallFor,
  factKeys,
  emptyProfile,
  memoryProfileStore,
  migrateV1,
  parseProfile,
  exportProfile,
  knownFacts,
  groupFacts,
  ToolResultQueue,
  openingLine,
  howToAsk,
  inAskingOrder,
  FieldRegistry,
  titleOf,
  isFilled,
  summarise,
  stillOptional,
  systemPrompt,
  factsOf,
  BANNED_PHRASES,
  clearValues,
  buildClearTool,
  readValue,
  Ledger,
  snapshot,
  gate,
  nextMove,
  brief,
  doNext,
  LongtakeSession,
  clipFor,
  readError,
  classify,
  readActions,
  pressAction,
  buildPressTool,
  startVoiceSession,
  explainMicFailure,
  VoiceStartError,
  nextReconnect,
  resumeLine,
  matchOption,
  Conductor,
  CORE_VERSION,
  accessibleName,
  accessibleDescription,
  fallbackMeanings,
  validateMeanings,
  applyMeaningHints,
  Overlay,
  reviewList,
  badgesFor,
  pageContext,
  verifyDraft,
} from "@longtake/core";
import { FakeVoice } from "./replay/fake-voice";
import { runScript } from "./replay/run-script";
import { fakeUnderstanding } from "./replay/fake-understand";

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
      readHesitation: typeof readHesitation;
      describeMarks: typeof describeMarks;
      canonicalKey: typeof canonicalKey;
      applyChanges: typeof applyChanges;
      recallFor: typeof recallFor;
      factKeys: typeof factKeys;
      emptyProfile: typeof emptyProfile;
      memoryProfileStore: typeof memoryProfileStore;
      migrateV1: typeof migrateV1;
      parseProfile: typeof parseProfile;
      exportProfile: typeof exportProfile;
      knownFacts: typeof knownFacts;
      groupFacts: typeof groupFacts;
      fakeUnderstanding: typeof fakeUnderstanding;
      ToolResultQueue: typeof ToolResultQueue;
      openingLine: typeof openingLine;
      howToAsk: typeof howToAsk;
      inAskingOrder: typeof inAskingOrder;
      FieldRegistry: typeof FieldRegistry;
      titleOf: typeof titleOf;
      isFilled: typeof isFilled;
      summarise: typeof summarise;
      stillOptional: typeof stillOptional;
      systemPrompt: typeof systemPrompt;
      factsOf: typeof factsOf;
      BANNED_PHRASES: typeof BANNED_PHRASES;
      clearValues: typeof clearValues;
      buildClearTool: typeof buildClearTool;
      readValue: typeof readValue;
      Ledger: typeof Ledger;
      snapshot: typeof snapshot;
      gate: typeof gate;
      nextMove: typeof nextMove;
      brief: typeof brief;
      doNext: typeof doNext;
      LongtakeSession: typeof LongtakeSession;
      clipFor: typeof clipFor;
      readError: typeof readError;
      classify: typeof classify;
      readActions: typeof readActions;
      pressAction: typeof pressAction;
      buildPressTool: typeof buildPressTool;
      startVoiceSession: typeof startVoiceSession;
      explainMicFailure: typeof explainMicFailure;
      VoiceStartError: typeof VoiceStartError;
      nextReconnect: typeof nextReconnect;
      resumeLine: typeof resumeLine;
      matchOption: typeof matchOption;
      accessibleName: typeof accessibleName;
      accessibleDescription: typeof accessibleDescription;
      fallbackMeanings: typeof fallbackMeanings;
      validateMeanings: typeof validateMeanings;
      applyMeaningHints: typeof applyMeaningHints;
      Overlay: typeof Overlay;
      reviewList: typeof reviewList;
      badgesFor: typeof badgesFor;
      pageContext: typeof pageContext;
      verifyDraft: typeof verifyDraft;
      Conductor: typeof Conductor;
      FakeVoice: typeof FakeVoice;
      runScript: typeof runScript;
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
  readHesitation,
  describeMarks,
  canonicalKey,
  applyChanges,
  recallFor,
  factKeys,
  emptyProfile,
  memoryProfileStore,
  migrateV1,
  parseProfile,
  exportProfile,
  knownFacts,
  groupFacts,
  ToolResultQueue,
  openingLine,
  howToAsk,
  inAskingOrder,
  FieldRegistry,
  titleOf,
  isFilled,
  summarise,
  stillOptional,
  systemPrompt,
  factsOf,
  BANNED_PHRASES,
  clearValues,
  buildClearTool,
  readValue,
  Ledger,
  snapshot,
  gate,
  nextMove,
  brief,
  doNext,
  LongtakeSession,
  clipFor,
  readError,
  classify,
  readActions,
  pressAction,
  buildPressTool,
  startVoiceSession,
  explainMicFailure,
  VoiceStartError,
  nextReconnect,
  resumeLine,
  matchOption,
  accessibleName,
  accessibleDescription,
  fallbackMeanings,
  validateMeanings,
  applyMeaningHints,
  Overlay,
  reviewList,
  badgesFor,
  pageContext,
  verifyDraft,
  Conductor,
  FakeVoice,
  runScript,
  fakeUnderstanding,
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
