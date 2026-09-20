/**
 * Mints a short-lived Voice Agent token so the API key never reaches the browser.
 *
 * Docs: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
 *   - `expires_in_seconds` is the redemption window (1–600). It only governs how long the
 *     client has to OPEN the socket, not how long the call runs.
 *   - `max_session_duration_seconds` caps the call itself (60–10800).
 *   - Tokens are SINGLE-USE. Fetch a fresh one immediately before every connect, including
 *     reconnects via `session.resume`.
 */

const TOKEN_URL = "https://agents.assemblyai.com/v1/token";

// Single-use tokens must never be served from a cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "ASSEMBLYAI_API_KEY is not set. Copy web/.env.example to web/.env.local, paste the key, and restart `npm run dev`.",
      },
      { status: 500 },
    );
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", "120");
  url.searchParams.set("max_session_duration_seconds", "900");

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch (cause) {
    return Response.json(
      { error: "Could not reach AssemblyAI to mint a token.", detail: String(cause) },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // Pass the upstream body through — it names the real problem (bad key, quota, bad params).
    return Response.json(
      {
        error: "AssemblyAI refused the token request.",
        status: upstream.status,
        detail: await upstream.text(),
      },
      { status: upstream.status },
    );
  }

  const { token } = (await upstream.json()) as { token: string };
  return Response.json({ token });
}
