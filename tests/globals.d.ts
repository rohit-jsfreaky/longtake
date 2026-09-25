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
  accessibleName,
  accessibleDescription,
  fallbackMeanings,
  validateMeanings,
  applyMeaningHints,
  Overlay,
  reviewList,
  badgesFor,
} from "@longtake/core";
import type { FakeVoice } from "../tools/replay/fake-voice";
import type { runScript } from "../tools/replay/run-script";
import type { fakeUnderstanding } from "../tools/replay/fake-understand";

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
      Conductor: typeof Conductor;
      accessibleName: typeof accessibleName;
      accessibleDescription: typeof accessibleDescription;
      fallbackMeanings: typeof fallbackMeanings;
      validateMeanings: typeof validateMeanings;
      applyMeaningHints: typeof applyMeaningHints;
      Overlay: typeof Overlay;
      reviewList: typeof reviewList;
      badgesFor: typeof badgesFor;
      FakeVoice: typeof FakeVoice;
      runScript: typeof runScript;
      inspect: () => unknown;
      inspectDeep: () => Promise<unknown>;
      last?: ReturnType<typeof readForm>;
    };
  }
}
