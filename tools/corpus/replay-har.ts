/**
 * Serve a page from its recording, and nothing from the network — ever.
 *
 * Exact matches go through Playwright's own HAR replay, which also carries a navigation through a
 * recorded redirect. Two gaps are closed around it, both found on real forms:
 *
 * - **Requests that are never exactly the same twice.** Microsoft Forms loads its scripts with
 *   `?cache-bust=<now>`; analytics and bot checks carry fresh tokens. With no exact match they
 *   were refused and the app drew no form. They are answered from the recording of the same
 *   method on the same origin and path, the closest by query and body.
 * - **Prefetches recorded empty.** Chrome never hands over a prefetch's body, so a page that
 *   prefetches its scripts leaves an empty recording beside the full one of the same file, and the
 *   replay could serve the empty one ("ChunkLoadError"). `cleanRecording` drops those at capture.
 *
 * ⚠️ Never answer with a redirect here. A request that follows a redirect answered by
 * `route.fulfill` is not routed again — it goes to the real network. That is how a replay of
 * IRCC's form once reached the live server and came back "Your session has expired". A redirect
 * in the recording is followed inside the recording instead, and its end is served.
 */

import type { BrowserContext, Page, Route } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { REPLAYED } from "./types";

type HarEntry = {
  request: { method: string; url: string; postData?: { text?: string } };
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { size?: number; text?: string; encoding?: string; _file?: string };
  };
};

export type Recorded = { rest: string; full: boolean; entry: HarEntry };

/** Headers the stored body no longer matches: it is kept decoded, at its own length. */
const DROPPED = new Set(["content-encoding", "content-length", "transfer-encoding"]);

const hasBody = (entry: HarEntry) => (entry.response.content.size ?? 0) > 0;

/**
 * The browser a replay runs in gets a proxy that does not exist. Every request the recording
 * answers never reaches it; a request that slips past — like a redirect answered by `fulfill` —
 * fails loudly instead of quietly fetching the live site.
 */
export const OFFLINE = { server: "http://127.0.0.1:9" };

function indexOf(harPath: string): Map<string, Recorded[]> {
  const har = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: HarEntry[] } };
  const index = new Map<string, Recorded[]>();
  for (const entry of har.log.entries) {
    const url = new URL(entry.request.url);
    const key = `${entry.request.method} ${url.origin}${url.pathname}`;
    const list = index.get(key) ?? [];
    list.push({ rest: `${url.search} ${entry.request.postData?.text ?? ""}`, full: hasBody(entry), entry });
    index.set(key, list);
  }
  return index;
}

/** How much of two strings agrees from the start — an exact match agrees entirely. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? Number.MAX_SAFE_INTEGER : i;
}

/** The recording to answer with: closest query and body first, a real body over an empty one next. */
export function closest(candidates: Recorded[], rest: string): Recorded {
  let best = candidates[0]!;
  let bestScore = sharedPrefix(best.rest, rest);
  for (const candidate of candidates.slice(1)) {
    const score = sharedPrefix(candidate.rest, rest);
    if (score > bestScore || (score === bestScore && candidate.full && !best.full)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function bodyOf(entry: HarEntry, harDir: string): Buffer {
  const { text, encoding, _file } = entry.response.content;
  if (_file) return readFileSync(join(harDir, _file));
  if (text === undefined) return Buffer.alloc(0);
  return encoding === "base64" ? Buffer.from(text, "base64") : Buffer.from(text, "utf8");
}

/**
 * Drop the empty recordings a prefetch leaves beside a full recording of the same request. Run
 * on every capture; safe to run again. Returns how many it dropped.
 */
export function cleanRecording(harPath: string): number {
  const har = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: HarEntry[] } };
  const key = (entry: HarEntry) => `${entry.request.method} ${entry.request.url} ${entry.request.postData?.text ?? ""}`;
  const full = new Set(har.log.entries.filter(hasBody).map(key));
  const before = har.log.entries.length;
  har.log.entries = har.log.entries.filter(
    (entry) => hasBody(entry) || entry.response.status !== 200 || !full.has(key(entry)),
  );
  const dropped = before - har.log.entries.length;
  if (dropped > 0) writeFileSync(harPath, JSON.stringify(har));
  return dropped;
}

/** Replay `harPath` into a page or a context, offline. */
export async function replayFromHar(target: Page | BrowserContext, harPath: string): Promise<void> {
  const index = indexOf(harPath);
  const harDir = dirname(harPath);
  const lookup = (url: URL, method: string, body: string) => {
    const candidates = index.get(`${method} ${url.origin}${url.pathname}`);
    return candidates && candidates.length > 0 ? closest(candidates, `${url.search} ${body}`).entry : null;
  };

  // Registered first, so it runs last: Playwright's exact match below is tried before this.
  await target.route(REPLAYED, async (route: Route) => {
    const request = route.request();
    let url = new URL(request.url());
    let entry = lookup(url, request.method(), request.postData() ?? "");
    // Follow a recorded redirect inside the recording — never hand the browser a redirect.
    for (let hops = 0; entry && entry.response.status >= 300 && entry.response.status < 400 && hops < 5; hops++) {
      const location = entry.response.headers.find((h) => h.name.toLowerCase() === "location")?.value;
      if (!location) break;
      url = new URL(location, url);
      entry = lookup(url, "GET", "");
    }
    if (!entry || (entry.response.status >= 300 && entry.response.status < 400)) return route.abort();
    const headers = Object.fromEntries(
      entry.response.headers.filter((h) => !DROPPED.has(h.name.toLowerCase())).map((h) => [h.name, h.value]),
    );
    await route.fulfill({ status: entry.response.status, headers, body: bodyOf(entry, harDir) });
  });
  await target.routeFromHAR(harPath, { notFound: "fallback", url: REPLAYED });
}
