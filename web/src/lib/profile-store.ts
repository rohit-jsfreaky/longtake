/**
 * Where the site keeps what it knows about the person: this browser's `localStorage`, and nowhere
 * else. No account, no sync, no request to anywhere.
 *
 * The page is the profile's one owner here: every change goes through `applyChanges` against what
 * is stored at that moment, never a whole map saved from memory, so two tabs of the site cannot
 * undo each other's answers. Another tab's change arrives as a `storage` event, and is shown.
 *
 * The first memory (`longtake.memory.v1`) is moved over once, then removed.
 */

import {
  applyChanges,
  emptyProfile,
  memoryProfileStore,
  migrateV1,
  PROFILE_VERSION,
  trimMeanings,
  type Meanings,
  type Memory,
  type Profile,
  type ProfileStore,
} from "@longtake/core";

const PROFILE_KEY = "longtake.profile.v2";
const MEANINGS_KEY = "longtake.meanings.v1";
const V1_KEY = "longtake.memory.v1";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked storage
  }
}

/** Read the profile, moving the first memory over the first time. Never throws. */
function read(store: Storage): Profile {
  try {
    const raw = store.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Profile;
      // A newer version wrote this. Reading it with old rules would be worse than starting over.
      if (parsed?.version === PROFILE_VERSION) return parsed;
      return emptyProfile();
    }
    const old = store.getItem(V1_KEY);
    if (!old) return emptyProfile();
    const v1 = JSON.parse(old) as { version?: number; memory?: Memory };
    const moved = applyChanges(emptyProfile(), migrateV1(v1.memory ?? {})).profile;
    store.setItem(PROFILE_KEY, JSON.stringify(moved));
    store.removeItem(V1_KEY);
    return moved;
  } catch {
    return emptyProfile();
  }
}

/**
 * The site's profile store. Falls back to one held in memory for this page when the browser offers
 * no storage (a private window, blocked site data) — the form still fills, it just is not kept.
 */
export function siteProfileStore(): ProfileStore {
  const store = storage();
  if (!store) return memoryProfileStore();

  const listeners = new Set<(profile: Profile) => void>();
  const tell = (profile: Profile) => {
    for (const listener of listeners) listener(profile);
  };

  return {
    load: async () => read(store),
    apply: async (changes) => {
      const applied = applyChanges(read(store), changes);
      if (applied.changed) {
        try {
          store.setItem(PROFILE_KEY, JSON.stringify(applied.profile));
        } catch {
          // Full or blocked: this page keeps working with what it has.
        }
        tell(applied.profile);
      }
      return applied;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === PROFILE_KEY) listener(read(store));
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    meanings: {
      get: async (key) => {
        try {
          const cache = JSON.parse(store.getItem(MEANINGS_KEY) ?? "{}") as Record<string, { at: number; meanings: Meanings }>;
          return cache[key]?.meanings ?? null;
        } catch {
          return null;
        }
      },
      put: async (key, meanings) => {
        try {
          const cache = JSON.parse(store.getItem(MEANINGS_KEY) ?? "{}") as Record<string, { at: number; meanings: Meanings }>;
          cache[key] = { at: Date.now(), meanings };
          store.setItem(MEANINGS_KEY, JSON.stringify(trimMeanings(cache)));
        } catch {
          // a cache; losing it costs one request
        }
      },
    },
  };
}
