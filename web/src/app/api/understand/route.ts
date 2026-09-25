/**
 * What each field of a form means — asked of the LLM Gateway from the server, so the key never
 * reaches a browser. The browser (or the extension, through its background) sends a snapshot of
 * the form: questions and their shape, never a value anyone typed (`snapshotOf` in core).
 *
 * The model's answer is returned as it came, after the gateway's JSON repair; the caller holds it
 * to the vocabulary with `validateMeanings`, which knows the form's real fields. Anything that goes
 * wrong here — no key, rate-limited, too slow, not JSON — is an error the caller answers with its
 * offline reading, so a form is never left waiting on this.
 *
 * Cached by the form's structure: the same form asked again, by anyone, costs nothing.
 */

import { structureKey, understandPrompt, type FormSnapshot } from "@longtake/core";

import { chatJSON, modelsFor } from "@/lib/gateway";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const MOST_FIELDS = 200;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: { fields: unknown[]; model: string } }>();

const str = (value: unknown, cap: number) => (typeof value === "string" ? value.slice(0, cap) : "");

/** The snapshot, re-built from what was sent: only the known keys, every string capped. */
function cleanSnapshot(raw: unknown): FormSnapshot | null {
  const body = raw as { host?: unknown; title?: unknown; fields?: unknown };
  if (!body || !Array.isArray(body.fields) || body.fields.length === 0 || body.fields.length > MOST_FIELDS) return null;
  const fields = body.fields.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    return {
      id: str(f.id, 120),
      question: str(f.question, 240),
      kind: str(f.kind, 20),
      required: f.required === true,
      ...(f.section ? { section: str(f.section, 120) } : {}),
      ...(f.description ? { description: str(f.description, 160) } : {}),
      ...(f.placeholder ? { placeholder: str(f.placeholder, 60) } : {}),
      ...(Array.isArray(f.options) ? { options: f.options.slice(0, 12).map((o) => str(o, 80)) } : {}),
    };
  });
  if (fields.some((f) => !f.id)) return null;
  return { host: str(body.host, 120), title: str(body.title, 120), fields };
}

export async function POST(request: Request) {
  const refused = guard(request, { llm: true });
  if (refused) return refused;

  let snapshot: FormSnapshot | null;
  try {
    snapshot = cleanSnapshot(await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!snapshot) return Response.json({ error: `Send a form snapshot with 1 to ${MOST_FIELDS} fields.` }, { status: 400 });

  const key = await structureKey(snapshot);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return Response.json({ ...cached.body, cached: true });

  const { system, user } = understandPrompt(snapshot);
  const answer = await chatJSON({ system, user, models: modelsFor("understand"), timeoutMs: 12_000 });
  if (!answer.ok) {
    const status = answer.reason === "no-key" ? 500 : answer.reason === "rate-limited" ? 429 : answer.reason === "timeout" ? 504 : 502;
    return Response.json({ error: `The meaning service could not answer (${answer.reason}).`, reason: answer.reason }, { status });
  }

  const fields = (answer.json as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return Response.json({ error: "The meaning service answered without fields.", reason: "not-json" }, { status: 502 });

  const body = { fields, model: answer.model };
  cache.set(key, { at: Date.now(), body });
  return Response.json(body);
}
