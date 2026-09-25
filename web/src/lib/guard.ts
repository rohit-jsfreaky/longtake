/**
 * Who may spend this site's AssemblyAI credit: the site itself and the Longtake extension — not any
 * page on the internet that finds the URL. And never faster than a person could use it.
 *
 * - **Origin.** A browser sends `Origin` on every POST, and on a GET from another site. Allowed:
 *   this site's own origin; the extension (`chrome-extension://<LONGTAKE_EXTENSION_ID>`, or any
 *   extension while that id is unset, as in development); anything in `LONGTAKE_ALLOWED_ORIGINS`.
 *   A request with no Origin is a same-origin GET — the browser says so in `Sec-Fetch-Site` — or
 *   a tool, which has no such header and is allowed outside production only.
 * - **Rate.** Per IP, per minute, best effort: each server instance counts on its own.
 * - **Off switch.** `LONGTAKE_LLM_OFF=1` turns every language-model route off at once; the product
 *   falls back to its offline reading.
 */

const PER_MINUTE = 30;
const hits = new Map<string, number[]>();

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (site === "same-origin" || site === "none") return true;
    return !site && process.env.NODE_ENV !== "production";
  }
  if (origin === new URL(request.url).origin) return true;
  if (origin.startsWith("chrome-extension://")) {
    const id = process.env.LONGTAKE_EXTENSION_ID;
    return !id || origin === `chrome-extension://${id}`;
  }
  const allowed = (process.env.LONGTAKE_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function tooFast(request: Request, now = Date.now()): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_MINUTE;
}

/** A refusal to send back, or null when the request may go on. */
export function guard(request: Request, options: { llm?: boolean } = {}): Response | null {
  if (options.llm && process.env.LONGTAKE_LLM_OFF === "1") {
    return Response.json({ error: "Language-model features are switched off on this server.", off: true }, { status: 503 });
  }
  if (!originAllowed(request)) return Response.json({ error: "Not allowed from this origin." }, { status: 403 });
  if (tooFast(request)) return Response.json({ error: "Too many requests — slow down." }, { status: 429 });
  return null;
}
