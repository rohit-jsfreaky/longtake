/**
 * A long answer, drafted from the person's own words (`draftPrompt` / `verifyDraft` in core). Asked
 * of the LLM Gateway from the server, so the key never reaches a browser.
 *
 * The model's answer is held to their words here, and once more by the caller: a sentence that does
 * not stand on what they said is dropped. When any is, the model is asked once more — told which
 * sentences fell and why — and the better of the two answers is returned. Never more than twice:
 * a person is waiting to hear it.
 */

import { draftPrompt, verifyDraft, type DraftInput, type VerifiedDraft } from "@longtake/core";

import { chatJSON, modelsFor } from "@/lib/gateway";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const str = (value: unknown, cap: number) => (typeof value === "string" ? value.slice(0, cap) : "");

/** The request, re-built from what was sent: only the known keys, every string capped. */
function cleanInput(raw: unknown): DraftInput | null {
  const body = (raw ?? {}) as Record<string, unknown>;
  const said = Array.isArray(body.said) ? body.said.slice(0, 12).map((s) => str(s, 2000)).filter(Boolean) : [];
  if (typeof body.question !== "string" || !body.question.trim() || said.length === 0) return null;
  const page = (body.page ?? {}) as Record<string, unknown>;
  const facts = Array.isArray(body.facts) ? body.facts.slice(0, 20) : [];
  const maxChars = typeof body.maxChars === "number" && body.maxChars > 0 ? Math.min(body.maxChars, 20_000) : undefined;
  return {
    question: str(body.question, 600),
    page: { title: str(page.title, 200), text: str(page.text, 4000) },
    said,
    facts: facts.map((f) => {
      const fact = (f ?? {}) as Record<string, unknown>;
      return { name: str(fact.name, 80), value: str(fact.value, 300) };
    }),
    ...(maxChars ? { maxChars } : {}),
    ...(typeof body.prior === "string" && body.prior.trim() ? { prior: str(body.prior, 4000) } : {}),
    ...(typeof body.change === "string" && body.change.trim() ? { change: str(body.change, 1000) } : {}),
  };
}

const better = (a: VerifiedDraft, b: VerifiedDraft) => (b.sentences.length > a.sentences.length || (b.sentences.length === a.sentences.length && b.dropped.length < a.dropped.length) ? b : a);

export async function POST(request: Request) {
  const refused = guard(request, { llm: true });
  if (refused) return refused;

  let input: DraftInput | null;
  try {
    input = cleanInput(await request.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!input) return Response.json({ error: "Send the question and what they said." }, { status: 400 });

  const { system, user } = draftPrompt(input);
  const first = await chatJSON({ system, user, models: modelsFor("draft"), timeoutMs: 9_000, maxTokens: 900 });
  if (!first.ok) {
    const status = first.reason === "no-key" ? 500 : first.reason === "rate-limited" ? 429 : first.reason === "timeout" ? 504 : 502;
    return Response.json({ error: `The draft could not be written (${first.reason}).`, reason: first.reason }, { status });
  }
  let draft = verifyDraft(first.json, input);
  let model = first.model;

  if (draft.dropped.length > 0) {
    const feedback = JSON.stringify({
      ...JSON.parse(user),
      your_last_draft_failed: draft.dropped.map((d) => ({ sentence: d.text, why: d.why })),
      instruction: "Write it again. Every sentence must cite their exact words; leave out anything they did not say.",
    });
    const second = await chatJSON({ system, user: feedback, models: modelsFor("draft"), timeoutMs: 9_000, maxTokens: 900 });
    if (second.ok) {
      const retried = verifyDraft(second.json, input);
      if (better(draft, retried) === retried) {
        draft = retried;
        model = second.model;
      }
    }
  }
  return Response.json({ ...draft, model });
}
