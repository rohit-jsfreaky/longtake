/**
 * Where remembered answers actually live: this browser, and nowhere else.
 *
 * `core/src/memory.ts` is pure and holds nothing. This is the one file that touches storage, and
 * it is deliberately the dullest possible implementation — `localStorage`, one key, no account,
 * no sync, no request to anywhere. The extension will have its own version of this file using
 * `chrome.storage`; the logic above it does not change.
 *
 * That is not modesty about a missing feature. A list of somebody's name, address, salary and
 * immigration status is not something to put on a server because it would be convenient.
 */

import { MEMORY_VERSION, type Memory } from "@longtake/core";

const STORAGE_KEY = "longtake.memory.v1";

type Stored = { version: number; memory: Memory };

/**
 * Read what is known.
 *
 * Every failure returns an empty memory rather than throwing. Storage is unavailable in a
 * private window, blocked by settings, and full of whatever a previous version wrote — none of
 * which is a reason to stop a person filling in a form.
 */
export function loadMemory(): Memory {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Stored;
    // A newer version wrote this. Reading it with old rules would be worse than starting over.
    if (parsed.version !== MEMORY_VERSION) return {};
    return parsed.memory ?? {};
  } catch {
    return {};
  }
}

/** Write what is known. Silent on failure, for the same reasons. */
export function saveMemory(memory: Memory): void {
  if (typeof window === "undefined") return;

  try {
    const stored: Stored = { version: MEMORY_VERSION, memory };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private window, blocked storage, or quota. The form still works; it just will not be
    // remembered, which is the correct thing to degrade to.
  }
}

/** Remove the lot, properly — the key itself, not an empty object left behind. */
export function clearMemory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
