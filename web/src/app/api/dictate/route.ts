/**
 * The Dictation call, made from the server so the API key never reaches a browser.
 *
 * Docs: https://www.assemblyai.com/docs/dictation
 *
 * ⚠️ **The auth header is not the same as the Voice Agent's.** The token endpoint wants
 * `Authorization: Bearer <key>`; this one wants the **raw key with no prefix**. Sending `Bearer`
 * here returns a 401 that reads exactly like a wrong key.
 *
 * The browser posts raw PCM16 at 24 kHz — the same audio it is already streaming to the agent —
 * and this repackages it as the multipart body the service wants. `config` must come first in
 * the body: the server begins transcribing as the audio arrives and cannot start without it.
 */

const DICTATION_URL = "https://dictation.assemblyai.com/v1/transcribe/live";

/** The docs ask for 90 seconds. Short clips come back in well under one. */
const REQUEST_TIMEOUT_MS = 90_000;

/** 429 and 503 are transient and carry `Retry-After`. Anything else is not worth retrying. */
const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

export const dynamic = "force-dynamic";

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  // A short backoff when the header is absent, as the docs suggest.
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 5000) : 500;
}

export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ASSEMBLYAI_API_KEY is not set. See web/.env.example." },
      { status: 500 },
    );
  }

  let body: { config?: unknown; audio?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (typeof body.audio !== "string" || body.audio.length === 0) {
    return Response.json({ error: "No audio was sent." }, { status: 400 });
  }

  const pcm = Buffer.from(body.audio, "base64");

  // 80 ms at 24 kHz, 16-bit mono is 3840 bytes. Below that the service returns `audio_too_short`,
  // so it is caught here instead — a round trip to be told the clip was too small is wasteful.
  if (pcm.byteLength < 3840) {
    return Response.json({ error: "That clip is too short to transcribe." }, { status: 400 });
  }

  const form = new FormData();
  // `config` first. An `audio` part that arrives before it is rejected with a 400.
  form.append(
    "config",
    new Blob([JSON.stringify(body.config ?? {})], { type: "application/json" }),
  );
  form.append("audio", new Blob([new Uint8Array(pcm)], { type: "audio/pcm" }), "turn.pcm");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let upstream: Response;
    try {
      upstream = await fetch(DICTATION_URL, {
        method: "POST",
        headers: { Authorization: apiKey }, // raw key, no Bearer — see the note above
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      return Response.json(
        { error: "Could not reach the Dictation service.", detail: String(cause) },
        { status: 502 },
      );
    }

    if (RETRYABLE.has(upstream.status) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(upstream)));
      continue;
    }

    if (!upstream.ok) {
      // Two error shapes exist and the docs say to read both: `{status, title, detail}` for auth,
      // config and rate-limit failures, and `{error, error_code}` for request-parsing failures.
      const detail = await upstream.text();
      return Response.json(
        { error: "The Dictation service refused the request.", status: upstream.status, detail },
        { status: upstream.status },
      );
    }

    // A 200 whose `llm_response` is null is a SUCCESS: the rewrite missed its five-second
    // deadline and the transcription is intact. Passing it straight through lets `shapeResult`
    // fall back to the verbatim, which is the whole point of keeping both.
    return Response.json(await upstream.json());
  }

  return Response.json(
    { error: "The Dictation service was busy. Please try again." },
    { status: 503 },
  );
}
