import { expect, test, type Page } from "@playwright/test";
import { load } from "./helpers";

/**
 * The per-field Dictation pass, and the verbatim it exists to keep.
 *
 * The case that justifies the whole file, from a live run: somebody said *"I, um, I think I just
 * want this role for my growth"*. The agent wrote a good tidy value — and tidied the quote too,
 * so the "um" and the restart were gone from everything we held. One Dictation call returns both
 * halves from one piece of audio, which is the only way to keep them both.
 */

type Spec = Record<string, unknown>;

async function run<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  await load(page, `<p>nothing</p>`);
  return page.evaluate(
    ([name, rest]) =>
      (window.__longtake as unknown as Record<string, (...a: unknown[]) => unknown>)[
        name as string
      ](...(rest as unknown[])) as unknown,
    [fn, args],
  ) as Promise<T>;
}

const LONG: Spec = {
  id: "why_do_you_want_this_role",
  label: "Why do you want this role?",
  kind: "textarea",
  required: true,
  longForm: true,
};

test.describe("what the transcriber is told before it decodes a word", () => {
  test("the situation names the actual question", async ({ page }) => {
    const config = await run<{ stt_prompt: string }>(page, "configForField", LONG);
    expect(config.stt_prompt).toContain("Why do you want this role?");
  });

  test("it describes the situation rather than instructing the model", async ({ page }) => {
    // The docs are specific about this: `stt_prompt` is context, not a command.
    const config = await run<{ stt_prompt: string }>(page, "configForField", LONG);
    expect(config.stt_prompt.toLowerCase()).toContain("speaking their answer");
  });

  test("it warns that they may pause, restart and code-switch", async ({ page }) => {
    const config = await run<{ stt_prompt: string }>(page, "configForField", LONG);
    expect(config.stt_prompt.toLowerCase()).toContain("hindi");
    expect(config.stt_prompt.toLowerCase()).toContain("restart");
  });

  test("raw PCM carries the sample rate and channel count it requires", async ({ page }) => {
    const config = await run<{ sample_rate: number; channels: number }>(page, "configForField", LONG);
    expect(config.sample_rate).toBe(24000);
    expect(config.channels).toBe(1);
  });

  test("both languages are named", async ({ page }) => {
    const config = await run<{ language_codes: string[] }>(page, "configForField", LONG);
    expect(config.language_codes).toEqual(["en", "hi"]);
  });

  test("the stt prompt stays inside the 6000-character limit", async ({ page }) => {
    const huge = { ...LONG, label: "Q".repeat(9000) };
    const config = await run<{ stt_prompt: string }>(page, "configForField", huge);
    expect(config.stt_prompt.length).toBeLessThanOrEqual(6000);
  });

  test("the instruction stays inside the 2048-character limit", async ({ page }) => {
    const huge = { ...LONG, label: "Q".repeat(9000) };
    const config = await run<{ llm_instruction: string }>(page, "configForField", huge);
    expect(config.llm_instruction.length).toBeLessThanOrEqual(2048);
  });

  test("no unknown field is ever sent — one would be a 400, not an ignored typo", async ({ page }) => {
    const config = await run<Record<string, unknown>>(page, "configForField", LONG);
    const allowed = new Set([
      "sample_rate",
      "channels",
      "language_codes",
      "stt_prompt",
      "keyterms_prompt",
      "llm_instruction",
    ]);
    for (const key of Object.keys(config)) expect(allowed.has(key)).toBe(true);
  });

  test("`prompt` is never sent alongside `stt_prompt` — sending both is a 400", async ({ page }) => {
    const config = await run<Record<string, unknown>>(page, "configForField", LONG);
    expect("prompt" in config).toBe(false);
  });

  test("`keyterms` and `word_boost` are never sent — only one of the three is allowed", async ({ page }) => {
    const config = await run<Record<string, unknown>>(page, "configForField", LONG, {
      known: { first_name: "Rohit" },
    });
    expect("keyterms" in config).toBe(false);
    expect("word_boost" in config).toBe(false);
  });
});

test.describe("what the rewrite is asked to do, and not do", () => {
  const forbidden = [
    ["add anything", "do not add anything they did not say"],
    ["answer for them", "do not answer the question for them"],
    ["make them sound better", "more certain, more formal or more impressive"],
  ];

  for (const [name, phrase] of forbidden) {
    test(`it is told not to ${name}`, async ({ page }) => {
      const text = await run<string>(page, "instructionForField", LONG);
      expect(text.toLowerCase()).toContain(phrase!.toLowerCase());
    });
  }

  test("hedges are explicitly protected", async ({ page }) => {
    // "I think" is not filler — it is the honest part of the sentence, and removing it puts
    // more certainty in somebody's mouth than they used.
    const text = await run<string>(page, "instructionForField", LONG);
    expect(text.toLowerCase()).toContain("keep hedges");
  });

  test("filler and false starts are named as things to remove", async ({ page }) => {
    const text = await run<string>(page, "instructionForField", LONG);
    expect(text.toLowerCase()).toContain("filler");
    expect(text.toLowerCase()).toContain("false starts");
  });

  test("the field's own question is quoted in the instruction", async ({ page }) => {
    const text = await run<string>(page, "instructionForField", LONG);
    expect(text).toContain("Why do you want this role?");
  });

  test("a length limit on the field becomes a limit on the rewrite", async ({ page }) => {
    const text = await run<string>(page, "instructionForField", { ...LONG, maxLength: 300 });
    expect(text).toContain("300 characters");
  });

  test("no limit means no sentence about one", async ({ page }) => {
    const text = await run<string>(page, "instructionForField", LONG);
    expect(text).not.toContain("characters");
  });

  test("it asks for the answer alone, with no preamble", async ({ page }) => {
    const text = await run<string>(page, "instructionForField", LONG);
    expect(text.toLowerCase()).toContain("no preamble");
  });
});

test.describe("keyterms come from the form itself", () => {
  test("answers already on the form are offered as terms", async ({ page }) => {
    const terms = await run<string[]>(page, "keytermsFrom", [], {
      first_name: "Rohit Kashyap",
      current_city: "Kolkata",
    });
    expect(terms).toContain("Rohit Kashyap");
    expect(terms).toContain("Kolkata");
  });

  test("capitalised words inside an answer are offered separately", async ({ page }) => {
    const terms = await run<string[]>(page, "keytermsFrom", [], { name: "Rohit Kashyap" });
    expect(terms).toContain("Rohit");
    expect(terms).toContain("Kashyap");
  });

  test("a dropdown's real wording is offered too", async ({ page }) => {
    const specs = [
      { id: "notice", label: "Notice", kind: "select", required: false, options: [{ value: "a", label: "Immediate" }] },
    ];
    const terms = await run<string[]>(page, "keytermsFrom", specs, {});
    expect(terms).toContain("Immediate");
  });

  test("duplicates are collapsed, case-insensitively", async ({ page }) => {
    const terms = await run<string[]>(page, "keytermsFrom", [], { a: "Kolkata", b: "kolkata" });
    expect(terms.filter((t) => t.toLowerCase() === "kolkata")).toHaveLength(1);
  });

  test("one-character values are not useful terms", async ({ page }) => {
    const terms = await run<string[]>(page, "keytermsFrom", [], { a: "X" });
    expect(terms).toEqual([]);
  });

  test("very long values are left out", async ({ page }) => {
    const terms = await run<string[]>(page, "keytermsFrom", [], { a: "x".repeat(200) });
    expect(terms).toEqual([]);
  });

  test("the 100-term limit is respected", async ({ page }) => {
    const known: Record<string, string> = {};
    for (let i = 0; i < 400; i++) known[`f${i}`] = `Term${i}`;
    const terms = await run<string[]>(page, "keytermsFrom", [], known);
    expect(terms.length).toBeLessThanOrEqual(100);
  });

  test("the 8000-character limit is respected", async ({ page }) => {
    const known: Record<string, string> = {};
    for (let i = 0; i < 300; i++) known[`f${i}`] = "y".repeat(55);
    const terms = await run<string[]>(page, "keytermsFrom", [], known);
    expect(terms.join("").length).toBeLessThanOrEqual(8000);
  });

  test("an empty form produces no terms rather than a broken request", async ({ page }) => {
    expect(await run<string[]>(page, "keytermsFrom", [], {})).toEqual([]);
  });

  test("keyterms are omitted entirely when there are none", async ({ page }) => {
    const config = await run<Record<string, unknown>>(page, "configForField", LONG, {});
    expect("keyterms_prompt" in config).toBe(false);
  });
});

test.describe("which answers are worth a second call", () => {
  const SHORT: Spec = { id: "first_name", label: "First name", kind: "text", required: true };
  const ANOTHER_LONG: Spec = { id: "about_you", label: "About you", kind: "textarea", required: false, longForm: true };

  test("a long answer that was filled is worth it", async ({ page }) => {
    const picked = await run<Spec[]>(page, "fieldsWorthShaping", [LONG], ["why_do_you_want_this_role"]);
    expect(picked.map((s) => s.id)).toEqual(["why_do_you_want_this_role"]);
  });

  test("a short answer never is — a name is already right", async ({ page }) => {
    const picked = await run<Spec[]>(page, "fieldsWorthShaping", [SHORT], ["first_name"]);
    expect(picked).toEqual([]);
  });

  test("a long answer nobody filled is not re-transcribed", async ({ page }) => {
    const picked = await run<Spec[]>(page, "fieldsWorthShaping", [LONG], []);
    expect(picked).toEqual([]);
  });

  test("a suspected trap is never sent anywhere", async ({ page }) => {
    const trap = { ...LONG, suspectedHoneypot: true };
    const picked = await run<Spec[]>(page, "fieldsWorthShaping", [trap], ["why_do_you_want_this_role"]);
    expect(picked).toEqual([]);
  });

  test("the call cap holds — this API has a 429 and one call per field is how you find it", async ({ page }) => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...LONG, id: `long_${i}` }));
    const picked = await run<Spec[]>(
      page,
      "fieldsWorthShaping",
      many,
      many.map((s) => s.id),
    );
    expect(picked.length).toBeLessThanOrEqual(3);
  });

  test("two long answers in one breath both get a pass", async ({ page }) => {
    const picked = await run<Spec[]>(
      page,
      "fieldsWorthShaping",
      [LONG, ANOTHER_LONG],
      ["why_do_you_want_this_role", "about_you"],
    );
    expect(picked).toHaveLength(2);
  });

  test("the cap can be lowered by the caller", async ({ page }) => {
    const picked = await run<Spec[]>(
      page,
      "fieldsWorthShaping",
      [LONG, ANOTHER_LONG],
      ["why_do_you_want_this_role", "about_you"],
      1,
    );
    expect(picked).toHaveLength(1);
  });
});

test.describe("both halves are kept", () => {
  const VERBATIM = "I, um, I think I just want this role for my growth.";
  const CLEAN = "I think I just want this role for my growth.";

  test("the tidy version goes in the box", async ({ page }) => {
    const shaped = await run<{ clean: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: CLEAN,
    });
    expect(shaped.clean).toBe(CLEAN);
  });

  test("the words as spoken are kept beside it", async ({ page }) => {
    const shaped = await run<{ verbatim: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: CLEAN,
    });
    expect(shaped.verbatim).toBe(VERBATIM);
  });

  test("the um survives in the verbatim — that is the entire point", async ({ page }) => {
    const shaped = await run<{ verbatim: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: CLEAN,
    });
    expect(shaped.verbatim).toContain("um");
  });

  test("a successful rewrite says so", async ({ page }) => {
    const shaped = await run<{ rewritten: boolean }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: CLEAN,
    });
    expect(shaped.rewritten).toBe(true);
  });

  test("the field id is carried through", async ({ page }) => {
    const shaped = await run<{ fieldId: string }>(page, "shapeResult", "cover_letter", {
      text: VERBATIM,
      llm_response: CLEAN,
    });
    expect(shaped.fieldId).toBe("cover_letter");
  });
});

test.describe("when the rewrite fails — which arrives as a 200", () => {
  /**
   * The rewrite has a five-second internal deadline. Missing it returns HTTP 200 with the
   * transcription intact and `llm_response: null`. Treating that as an error would throw away a
   * perfectly good transcript over a missing nicety.
   */
  const VERBATIM = "I, um, I think I just want this role.";

  test("a null rewrite falls back to the verbatim rather than emptying the field", async ({ page }) => {
    const shaped = await run<{ clean: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: null,
    });
    expect(shaped.clean).toBe(VERBATIM);
  });

  test("it is reported as not rewritten, not as a success", async ({ page }) => {
    const shaped = await run<{ rewritten: boolean }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: null,
    });
    expect(shaped.rewritten).toBe(false);
  });

  test("the reason is passed on in words a person can read", async ({ page }) => {
    const shaped = await run<{ note: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: null,
      llm_error: "timeout",
    });
    expect(shaped.note).toContain("timeout");
    expect(shaped.note.toLowerCase()).toContain("exactly what you said");
  });

  test("a timeout still keeps the verbatim", async ({ page }) => {
    const shaped = await run<{ verbatim: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: null,
      llm_error: "timeout",
    });
    expect(shaped.verbatim).toBe(VERBATIM);
  });

  test("an empty rewrite is treated as no rewrite", async ({ page }) => {
    const shaped = await run<{ clean: string; rewritten: boolean }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: "   ",
    });
    expect(shaped.rewritten).toBe(false);
    expect(shaped.clean).toBe(VERBATIM);
  });

  test("a missing llm_error still produces a readable note", async ({ page }) => {
    const shaped = await run<{ note: string }>(page, "shapeResult", "f", {
      text: VERBATIM,
      llm_response: null,
    });
    expect(shaped.note.length).toBeGreaterThan(10);
  });

  test("whitespace around either version is trimmed", async ({ page }) => {
    const shaped = await run<{ verbatim: string; clean: string }>(page, "shapeResult", "f", {
      text: `  ${VERBATIM}  `,
      llm_response: "  tidy  ",
    });
    expect(shaped.verbatim).toBe(VERBATIM);
    expect(shaped.clean).toBe("tidy");
  });
});
