/**
 * The site's profile store — `localStorage`, one owner per page, changes only — without a browser:
 * a stand-in `window` whose storage behaves like the real one, including another tab's writes.
 */

import { expect, test } from "@playwright/test";

import { siteProfileStore } from "../web/src/lib/profile-store";
import type { Profile, ProfileChange } from "../core/src/profile";

type Listener = (event: { key: string | null }) => void;

/** A window with a localStorage, and a way to be another tab writing to it. */
function fakeWindow({ blocked = false } = {}) {
  const data = new Map<string, string>();
  const listeners = new Set<Listener>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  const win = {
    get localStorage() {
      if (blocked) throw new Error("SecurityError: storage is blocked");
      return localStorage;
    },
    addEventListener: (_: string, listener: Listener) => void listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => void listeners.delete(listener),
  };
  (globalThis as { window?: unknown }).window = win;
  return {
    data,
    /** Another tab of the site wrote this. */
    otherTabWrites: (key: string, value: string) => {
      data.set(key, value);
      for (const listener of listeners) listener({ key });
    },
  };
}

const spoken = (concept: string, value: string, evidence: string): ProfileChange => ({
  type: "observe",
  key: { concept },
  gist: concept,
  value,
  from: { value, evidence, source: "spoken", host: "a.example", url: "https://a.example", askedAs: concept, formTitle: "", at: 1 },
});

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("the first memory is moved over once, and its key removed", async () => {
  const { data } = fakeWindow();
  data.set(
    "longtake.memory.v1",
    JSON.stringify({ version: 1, memory: { email: { key: "email", value: "rohit@example.com", evidence: "rohit at example", askedAs: "Email", savedAt: 5, sourceUrl: "https://a.example/x" } } }),
  );
  const profile = await siteProfileStore().load();
  expect(profile.facts["contact.email"]).toMatchObject({ value: "rohit@example.com" });
  expect(data.has("longtake.memory.v1")).toBe(false);
  expect(JSON.parse(data.get("longtake.profile.v2")!).facts["contact.email"].value).toBe("rohit@example.com");
});

test("changes are applied to what is stored, and another tab's change reaches this page", async () => {
  const { data, otherTabWrites } = fakeWindow();
  const store = siteProfileStore();
  const seen: Profile[] = [];
  store.subscribe!((profile) => seen.push(profile));

  await store.apply([spoken("contact.email", "rohit@example.com", "rohit at example")]);
  expect(seen.at(-1)!.facts["contact.email"]).toBeDefined();

  // The other tab adds a city; this page's next change is applied on top of it, not over it.
  const theirs = JSON.parse(data.get("longtake.profile.v2")!) as Profile;
  theirs.facts["address.city"] = { ...theirs.facts["contact.email"]!, id: "address.city", concept: "address.city", value: "Kolkata" };
  otherTabWrites("longtake.profile.v2", JSON.stringify(theirs));
  expect(seen.at(-1)!.facts["address.city"]).toBeDefined();

  const applied = await store.apply([spoken("links.github", "rohitk", "github rohitk")]);
  expect(Object.keys(applied.profile.facts).sort()).toEqual(["address.city", "contact.email", "links.github"]);
});

test("a profile a newer version wrote is never read with these rules", async () => {
  const { data } = fakeWindow();
  data.set("longtake.profile.v2", JSON.stringify({ version: 3, facts: { x: {} } }));
  expect((await siteProfileStore().load()).facts).toEqual({});
});

test("blocked storage still fills the form — nothing is kept, nothing fails", async () => {
  fakeWindow({ blocked: true });
  const store = siteProfileStore();
  const applied = await store.apply([spoken("contact.email", "rohit@example.com", "rohit at example")]);
  expect(applied.profile.facts["contact.email"]).toBeDefined();
});

test("what forms mean is cached by structure", async () => {
  fakeWindow();
  const store = siteProfileStore();
  await store.meanings!.put("jobs.example#abc", { f: { concept: "contact.email", subject: "self", scope: "remember", gist: "email", confidence: "high", source: "model" } });
  expect(await store.meanings!.get("jobs.example#abc")).toMatchObject({ f: { concept: "contact.email" } });
  expect(await store.meanings!.get("jobs.example#other")).toBeNull();
});
