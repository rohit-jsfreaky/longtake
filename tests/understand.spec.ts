/**
 * Field meaning, off the page: the gateway call (against a fake upstream — never the network), who
 * may call the server routes, and the rules a model's answer is held to. Pure; no browser.
 */

import { expect, test } from "@playwright/test";

import { applyMeaningHints, fallbackMeanings, validateMeanings } from "../core/src/understand";
import type { FieldSpec } from "../core/src/types";
import { chatJSON } from "../web/src/lib/gateway";
import { guard } from "../web/src/lib/guard";

type Call = { url: string; init: RequestInit };

/** A fake gateway: one scripted response per call, and every call remembered. */
function fakeUpstream(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses scripted");
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const answer = (content: string, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers });
const status = (code: number, headers: Record<string, string> = {}) => () => new Response("{}", { status: code, headers });

const ASK = { system: "s", user: "u", models: ["model-a", "model-b"] };

test.describe("the gateway call", () => {
  test.beforeEach(() => {
    process.env.ASSEMBLYAI_API_KEY = "test-key";
  });

  test("sends the raw key, no Bearer, asks for JSON repair, and returns the parsed answer", async () => {
    const { impl, calls } = fakeUpstream([answer('{"fields":[]}')]);
    const result = await chatJSON(ASK, impl);
    expect(result).toMatchObject({ ok: true, json: { fields: [] }, model: "model-a" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("test-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.post_processing_steps).toEqual([{ type: "json-repair" }]);
    expect(body.temperature).toBe(0);
  });

  test("an answer inside a ```json fence is still read", async () => {
    const { impl } = fakeUpstream([answer('Here you go:\n```json\n{"fields":[{"id":"a"}]}\n```')]);
    expect(await chatJSON(ASK, impl)).toMatchObject({ ok: true, json: { fields: [{ id: "a" }] } });
  });

  test("a rate-limited model is skipped for the next one — the limit is per model", async () => {
    const { impl, calls } = fakeUpstream([status(429, { "x-ratelimit-reset": "12" }), answer('{"fields":[]}')]);
    const result = await chatJSON(ASK, impl);
    expect(result).toMatchObject({ ok: true, model: "model-b" });
    expect(JSON.parse(String(calls[1]!.init.body)).model).toBe("model-b");
  });

  test("every model rate-limited says so, with when to try again", async () => {
    const { impl } = fakeUpstream([status(429, { "x-ratelimit-reset": "30" }), status(429, { "x-ratelimit-reset": "30" })]);
    expect(await chatJSON(ASK, impl)).toEqual({ ok: false, reason: "rate-limited", status: 429, resetSeconds: 30 });
  });

  test("a model this account cannot use, or one that is down, falls through to the next", async () => {
    const first = await chatJSON(ASK, fakeUpstream([status(400), answer('{"fields":[]}')]).impl);
    expect(first).toMatchObject({ ok: true, model: "model-b" });
    const down = await chatJSON(ASK, fakeUpstream([status(503), status(502)]).impl);
    expect(down).toMatchObject({ ok: false, reason: "upstream" });
  });

  test("an answer that is not JSON even after repair is reported, never guessed at", async () => {
    const { impl } = fakeUpstream([answer("I think the first field is a name."), answer("still prose")]);
    expect(await chatJSON(ASK, impl)).toMatchObject({ ok: false, reason: "not-json" });
  });

  test("no key, no call", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const { impl, calls } = fakeUpstream([]);
    expect(await chatJSON(ASK, impl)).toEqual({ ok: false, reason: "no-key" });
    expect(calls).toHaveLength(0);
  });
});

test.describe("who may call the server", () => {
  const request = (headers: Record<string, string>) => new Request("https://longtake.example/api/understand", { method: "POST", headers });

  test("the site itself and the extension may", () => {
    expect(guard(request({ origin: "https://longtake.example" }))).toBeNull();
    expect(guard(request({ origin: "chrome-extension://abcdef" }))).toBeNull();
    expect(guard(request({ "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  test("another website may not", () => {
    expect(guard(request({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(guard(request({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });

  test("the switch turns every language-model route off at once", () => {
    process.env.LONGTAKE_LLM_OFF = "1";
    try {
      expect(guard(request({ origin: "https://longtake.example" }), { llm: true })?.status).toBe(503);
      expect(guard(request({ origin: "https://longtake.example" }))).toBeNull();
    } finally {
      delete process.env.LONGTAKE_LLM_OFF;
    }
  });
});

test.describe("a model's answer, held to the rules", () => {
  const spec = (id: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ id, label, kind: "text", required: false, ...extra });
  const specs = [spec("phone", "Phone"), spec("ec_phone", "Phone", { section: "Emergency contact" }), spec("race", "Race"), spec("why", "Why us?")];

  test("unknown fields are dropped; unknown concepts become other; no confidence is low", () => {
    const meanings = validateMeanings(
      { fields: [{ id: "nope", concept: "contact.phone" }, { id: "why", concept: "text.made_up", subject: "self", scope: "this_form" }] },
      specs,
    );
    expect(Object.keys(meanings)).toEqual(["why"]);
    expect(meanings.why).toMatchObject({ concept: "other", confidence: "low", source: "model" });
  });

  test("a scope can be narrowed, never widened — a sensitive concept is never remembered", () => {
    const meanings = validateMeanings({ fields: [{ id: "race", concept: "eeo.race_ethnicity", subject: "self", scope: "remember", confidence: "high" }] }, specs);
    expect(meanings.race!.scope).toBe("sensitive");
  });

  test("someone else's answer is never kept for the person's next form", () => {
    const meanings = validateMeanings({ fields: [{ id: "ec_phone", concept: "contact.phone", subject: "other_person", scope: "remember", confidence: "high" }] }, specs);
    expect(meanings.ec_phone).toMatchObject({ concept: "contact.phone", subject: "other_person", scope: "this_form" });
  });

  test("an organisation's own details are the organisation's, whatever the model said", () => {
    const meanings = validateMeanings({ fields: [{ id: "why", concept: "organization.name", subject: "self", confidence: "high" }] }, specs);
    expect(meanings.why).toMatchObject({ subject: "organization", scope: "this_form" });
  });

  // A patient's first name and their emergency contact's, both "theirs": code cannot tell which is
  // which, so neither is trusted enough to fill without asking.
  test("one answer claimed as theirs twice is trusted in neither box", () => {
    const two = [spec("first", "First Name"), spec("first_2", "First Name"), spec("dob_d", "Date of birth", { part: "Day" }), spec("dob_m", "Date of birth", { part: "Month" })];
    const meanings = validateMeanings(
      {
        fields: [
          { id: "first", concept: "identity.first_name", subject: "self", confidence: "high" },
          { id: "first_2", concept: "identity.first_name", subject: "self", confidence: "high" },
          { id: "dob_d", concept: "identity.date_of_birth", subject: "self", confidence: "high" },
          { id: "dob_m", concept: "identity.date_of_birth", subject: "self", confidence: "high" },
        ],
      },
      two,
    );
    expect([meanings.first!.confidence, meanings.first_2!.confidence]).toEqual(["medium", "medium"]);
    // Two pieces of one answer are not the same answer twice.
    expect([meanings.dob_d!.confidence, meanings.dob_m!.confidence]).toEqual(["high", "high"]);
  });

  test("without the model, the old keys still read what they can — at low confidence", () => {
    const meanings = fallbackMeanings([spec("phone", "Phone"), spec("why", "Why us?")]);
    expect(meanings.phone).toMatchObject({ concept: "contact.phone", confidence: "low", source: "fallback" });
    expect(meanings.why!.concept).toBe("other");
  });
});

test.describe("what the model's meanings add to the fields", () => {
  const specs = (): FieldSpec[] => [
    { id: "dob", label: "Date of Birth", kind: "text", required: false },
    { id: "m", label: "Matriculation Year", kind: "text", required: false },
    { id: "d", label: "Date of birth", part: "Day", kind: "text", required: true },
  ];
  const answer = {
    fields: [
      { id: "dob", concept: "identity.date_of_birth", subject: "self", confidence: "high" },
      { id: "m", concept: "education.start_date", subject: "self", confidence: "high" },
      { id: "d", concept: "identity.date_of_birth", subject: "self", confidence: "high", part: "day" },
    ],
  };

  test("a box whose question is a calendar day is a date; a year, a month-and-year or a day's own box is not", () => {
    const fields = specs();
    expect(applyMeaningHints(fields, validateMeanings(answer, fields))).toBe(true);
    expect(fields.map((f) => f.kind)).toEqual(["date", "text", "text"]);
  });

  test("each field carries what it means, for the asking order and the opening line", () => {
    const fields = specs();
    applyMeaningHints(fields, validateMeanings(answer, fields));
    expect(fields[0]!.understood).toEqual({ concept: "identity.date_of_birth", subject: "self", confidence: "high" });
  });

  test("the offline reading adds nothing", () => {
    const fields = specs();
    expect(applyMeaningHints(fields, fallbackMeanings(fields))).toBe(false);
    expect(fields[0]!.kind).toBe("text");
    expect(fields[0]!.understood).toBeUndefined();
  });
});
