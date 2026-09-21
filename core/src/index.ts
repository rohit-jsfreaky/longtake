/**
 * `core/` is plain TypeScript with no framework and no dependencies, so that the exact same
 * files run in two places: the Next.js page on Vercel (the submission) and the Chrome
 * extension content script (the real product). Anything that needs React, Next or a bundler
 * belongs in `web/`, not here.
 */

export * from "./types";
export * from "./dom-path";
export * from "./reader";
export * from "./writer";
export * from "./binder";
export * from "./evidence";

/** Bumped when the shape of a `FieldSpec` changes, so stored answers can be migrated. */
export const CORE_VERSION = "0.4.0";
