/**
 * The profile, as a content script or the settings page reaches it: read from `chrome.storage`,
 * changed only through the background worker, which applies every change in order to what is
 * stored at that moment. See background.ts, job 4.
 *
 * Every surface listens to the one storage key, so a settings edit reaches a call on another tab
 * the moment it is saved — and a call's new answers reach the settings page the same way.
 */

import { trimMeanings, type Applied, type Meanings, type Profile, type ProfileChange, type ProfileStore } from "@longtake/core";

export const PROFILE_KEY = "longtake.profile.v2";
/** The first memory, moved over and removed the first time the background reads the profile. */
export const V1_KEY = "longtake.memory.v1";
const MEANINGS_KEY = "longtake.meanings.v1";

type Reply<T> = T & { error?: string };

async function ask<T>(message: Record<string, unknown>): Promise<T> {
  const reply = (await chrome.runtime.sendMessage({ type: "longtake:profile", ...message })) as Reply<T> | undefined;
  if (!reply || reply.error) throw new Error(reply?.error ?? "The Longtake worker did not answer.");
  return reply;
}

export const profileClient: ProfileStore = {
  load: async () => (await ask<{ profile: Profile }>({ op: "load" })).profile,
  apply: (changes: ProfileChange[]) => ask<Applied>({ op: "apply", changes }),
  subscribe: (listener) => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const next = changes[PROFILE_KEY]?.newValue as Profile | undefined;
      if (area === "local" && next) listener(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  },
  // A cache of what forms mean, by structure. Written straight to storage: losing an entry to a
  // race between two tabs costs one request, nothing more.
  meanings: {
    get: async (key) => {
      const stored = (await chrome.storage.local.get(MEANINGS_KEY)) as Record<string, Record<string, { at: number; meanings: Meanings }>>;
      return stored[MEANINGS_KEY]?.[key]?.meanings ?? null;
    },
    put: async (key, meanings) => {
      const stored = (await chrome.storage.local.get(MEANINGS_KEY)) as Record<string, Record<string, { at: number; meanings: Meanings }>>;
      const cache = { ...(stored[MEANINGS_KEY] ?? {}), [key]: { at: Date.now(), meanings } };
      await chrome.storage.local.set({ [MEANINGS_KEY]: trimMeanings(cache) });
    },
  },
};
