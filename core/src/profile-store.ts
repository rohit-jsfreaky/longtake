/**
 * Where the profile lives, as far as a call is concerned: something that loads it, and applies
 * changes to it.
 *
 * ## Why changes, and one owner
 *
 * The first memory had two writers — the call and the settings page — and each saved the whole map
 * it last read. A name edited in settings during a call was undone the moment the call saved its
 * own copy. No amount of re-reading closes that; the fix is that nobody writes a whole profile.
 * Every writer sends `ProfileChange`s, and the one owner applies them, in order, to what is stored
 * at that moment (`applyChanges`). An edit and a new answer are then two changes to two facts, and
 * both survive.
 *
 * The owner is the extension's background worker (`extension/src/background.ts`), or the page on
 * the site (`web/src/lib/profile-store.ts`), or — in tests — `memoryProfileStore` below.
 */

import { applyChanges, emptyProfile, type Applied, type Profile, type ProfileChange } from "./profile";
import type { Meanings } from "./understand";

export type ProfileStore = {
  load(): Promise<Profile>;
  /** Apply changes to the profile as stored now. Returns the result and any questions it raised. */
  apply(changes: ProfileChange[]): Promise<Applied>;
  /** Called with the new profile whenever it changes, from anywhere — a settings edit mid-call. */
  subscribe?(listener: (profile: Profile) => void): () => void;
  /** Meanings already worked out for a form, by its structure (`structureKey`). A cache only. */
  meanings?: {
    get(key: string): Promise<Meanings | null>;
    put(key: string, meanings: Meanings): Promise<void>;
  };
};

/** How many forms' meanings are kept on the device. Oldest go first. */
export const MEANINGS_KEPT = 60;

/** A small cache of meanings by form structure, oldest dropped first. */
export function trimMeanings(cache: Record<string, { at: number; meanings: Meanings }>): Record<string, { at: number; meanings: Meanings }> {
  const entries = Object.entries(cache).sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(entries.slice(0, MEANINGS_KEPT));
}

/**
 * A profile held in memory: the tests' store, and the fallback when a browser offers no storage
 * (a private window). Applies changes in order, like every other owner.
 */
export function memoryProfileStore(initial: Profile = emptyProfile()): ProfileStore & { current(): Profile } {
  let profile = initial;
  const listeners = new Set<(profile: Profile) => void>();
  const cache = new Map<string, Meanings>();
  return {
    current: () => profile,
    load: async () => profile,
    apply: async (changes) => {
      const applied = applyChanges(profile, changes);
      if (applied.changed) {
        profile = applied.profile;
        for (const listener of listeners) listener(profile);
      }
      return applied;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    meanings: {
      get: async (key) => cache.get(key) ?? null,
      put: async (key, meanings) => void cache.set(key, meanings),
    },
  };
}
