/**
 * The AssemblyAI LLM Gateway, called from the server only — the API key never reaches a browser.
 *
 * Docs: https://www.assemblyai.com/docs/llm-gateway (chat completions, post-processing, rate limits)
 *   - `POST https://llm-gateway.assemblyai.com/v1/chat/completions`, OpenAI-shaped.
 *   - ⚠️ `Authorization` is the **raw key**, no `Bearer` — the same as Dictation, not the Voice Agent.
 *   - `post_processing_steps: [{ type: "json-repair" }]` repairs malformed JSON server-side.
 *   - Rate limits are per model, per 60 s. A 429 carries `X-RateLimit-Reset`, so a limited model is
 *     skipped for the next one in the list rather than waited on.
 *
 * On this account only `qwen3.5-4b-32k-fast` answers, and it rejects `response_format` (RESEARCH.md
 * §9b): structured output is a JSON-only prompt, the gateway's repair, and validation by the caller.
 * Models come from the caller — ultimately the environment — never hard-coded here.
 *
 * Logged per call: model, status, time, request id. Never a prompt, never an answer.
 */

const GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";

export type ChatJSONRequest = {
  system: string;
  user: string;
  /** Tried in order: the next is used when one is rate-limited or not available to this account. */
  models: string[];
  maxTokens?: number;
  timeoutMs?: number;
};

export type ChatJSONResult =
  | { ok: true; json: unknown; model: string; ms: number }
  | { ok: false; reason: "no-key" | "rate-limited" | "unavailable" | "timeout" | "not-json" | "upstream"; status?: number; resetSeconds?: number };

/** A JSON object in a model's text — as is, or inside a ```json fence. */
function parseJSON(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  try {
    return JSON.parse((fenced ? fenced[1]! : text).trim());
  } catch {
    return undefined;
  }
}

export async function chatJSON(request: ChatJSONRequest, fetchImpl: typeof fetch = fetch): Promise<ChatJSONResult> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return { ok: false, reason: "no-key" };

  let last: ChatJSONResult = { ok: false, reason: "unavailable" };
  for (const model of request.models) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: key, "Content-Type": "application/json" }, // raw key — see above
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          max_tokens: request.maxTokens ?? 4000,
          temperature: 0,
          post_processing_steps: [{ type: "json-repair" }],
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? 10_000),
      });
    } catch {
      console.info(JSON.stringify({ gateway: model, status: "timeout", ms: Date.now() - started }));
      return { ok: false, reason: "timeout" };
    }
    const ms = Date.now() - started;
    console.info(JSON.stringify({ gateway: model, status: response.status, ms, request: response.headers.get("x-request-id") }));

    if (response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      last = { ok: false, reason: "rate-limited", status: 429, ...(Number.isFinite(reset) ? { resetSeconds: reset } : {}) };
      continue;
    }
    // A model this account cannot use answers 400; a model that is down answers 5xx. Either way,
    // the next model may answer.
    if (response.status === 400 || response.status === 403 || response.status >= 500) {
      last = { ok: false, reason: response.status >= 500 ? "upstream" : "unavailable", status: response.status };
      continue;
    }
    if (!response.ok) return { ok: false, reason: "upstream", status: response.status };

    const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    // Every choice, not just the first: the first parseable one is the answer.
    for (const choice of body?.choices ?? []) {
      const content = choice?.message?.content;
      const json = typeof content === "string" ? parseJSON(content) : undefined;
      if (json !== undefined && json !== null && typeof json === "object") return { ok: true, json, model, ms };
    }
    last = { ok: false, reason: "not-json", status: response.status };
  }
  return last;
}

/** The models to ask, in order, from the environment. */
export function modelsFor(task: "understand"): string[] {
  const configured = process.env[`LONGTAKE_${task.toUpperCase()}_MODELS`];
  const list = (configured ?? "qwen3.5-4b-32k-fast").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length > 0 ? list : ["qwen3.5-4b-32k-fast"];
}
