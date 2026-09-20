/**
 * `core/` is plain TypeScript with no framework and no dependencies, so that the exact same
 * files run in two places: the Next.js page on Vercel (the submission) and the Chrome
 * extension content script (the real product). Anything that needs React, Next or a bundler
 * belongs in `web/`, not here.
 */

export * from "./types";

/** Bumped when the shape of a `FieldSpec` changes, so stored answers can be migrated. */
export const CORE_VERSION = "0.1.0";
