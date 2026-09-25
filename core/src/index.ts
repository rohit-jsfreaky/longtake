/**
 * `core/` is plain TypeScript with no framework — its one dependency is `dom-accessibility-api`,
 * the W3C accname algorithm, framework-free itself — so that the exact same
 * files run in two places: the Next.js page on Vercel (the submission) and the Chrome
 * extension content script (the real product). Anything that needs React, Next or a bundler
 * belongs in `web/`, not here.
 */

export * from "./types";
export * from "./dom-path";
export * from "./accname";
export * from "./reader";
export * from "./writer";
export * from "./binder";
export * from "./evidence";
export * from "./dictation";
export * from "./hesitation";
export * from "./memory";
export * from "./dispatch";
export * from "./conversation";
export * from "./reconcile";
export * from "./persona";
export * from "./ledger";
export * from "./form-state";
export * from "./gate";
export * from "./planner";
export * from "./session";
export * from "./clip";
export * from "./errors";
export * from "./actions";
export * from "./reconnect";
export * from "./voice";
export * from "./concepts";
export * from "./understand";
export * from "./profile";
export * from "./profile-store";
export * from "./trust";
export * from "./barge";
export * from "./overlay";
export * from "./review";
export * from "./notices";
export * from "./conductor";

/** Bumped when the shape of a `FieldSpec` changes, so stored answers can be migrated. */
export const CORE_VERSION = "0.9.0";
