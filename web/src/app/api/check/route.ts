/**
 * The trust layer's judge: what the agent claimed about the form in one reply — which fields it
 * said went in, did not, or asked for — quoting its own words (`checkPrompt` in core). Asked of the
 * LLM Gateway from the server, so the key never reaches a browser.
 *
 * The answer comes back as the model gave it; the caller holds it to the form with
 * `validateClaims` (every quote must be in what the agent said) and compares each "put in" with
 * the form itself. Anything that goes wrong here is an error the caller answers by judging nothing:
 * the trust layer never guesses.
 */

import { checkPrompt, type CheckInput } from "@longtake/core";

import { chatJSON, modelsFor } from "@/lib/gateway";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const MOST_FIELDS = 200;
const str = (value: unknown, cap: number) => (typeof value === "string" ? value.slice(0, cap) : "");

/** The request, re-built from what was sent: only the known keys, every string capped. */
function cleanInput(raw: unknown): CheckInput | null {
  const body = raw as { said?: unknown; heard?: unknown; asking?: unknown; fields?: unknown };
  if (!body || typeof body.said !== "string" || !body.said.trim() || !Array.isArray(body.fields) || body.fields.length > MOST_FIELDS) return null;
  return {
    said: str(body.said, 1200),
    heard: str(body.heard, 2000),
    asking: Array.isArray(body.asking) ? body.asking.slice(0, 20).map((id) => str(id, 120)) : [],
    fields: body.fields.map((item) => {
      const f = (item ?? {}) as Record<string, unknown>;
      return { id: str(f.id, 120), question: str(f.question, 240) };
    }),
  };
}

export async function POST(request: Request) {
  const refused = guard(request, { llm: true });
  if (refused) return refused;

  let input: CheckInput | null;
  try {
    input = cleanInput(await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!input) return Response.json({ error: "Send what the agent said and the form's fields." }, { status: 400 });

  const { system, user } = checkPrompt(input);
  const answer = await chatJSON({ system, user, models: modelsFor("check"), timeoutMs: 8_000 });
  if (!answer.ok) {
    const status = answer.reason === "no-key" ? 500 : answer.reason === "rate-limited" ? 429 : answer.reason === "timeout" ? 504 : 502;
    return Response.json({ error: `The check could not answer (${answer.reason}).`, reason: answer.reason }, { status });
  }
  const claims = (answer.json as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) return Response.json({ error: "The check answered without claims.", reason: "not-json" }, { status: 502 });
  return Response.json({ claims, model: answer.model });
}
