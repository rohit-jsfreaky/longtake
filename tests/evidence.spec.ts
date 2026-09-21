import { expect, test } from "@playwright/test";
import { load } from "./helpers";

/**
 * The check that turns "every answer keeps your voice attached to it" from a slogan into
 * something the code can prove.
 *
 * The case that forced it, from the first live agent run:
 *
 *   said:      मेरा नाम रोहित कृष्णप्प है, मैं कोलकाता से हूँ, इंडिया।
 *   tool call: first_name = "Arjun"   evidence: "My name is Arjun"
 *
 * Both invented. Every layer we had would have written it, because every layer was checking that
 * evidence was present rather than true.
 */

type Check = { ok: boolean; reason?: string };

async function check(page: import("@playwright/test").Page, transcript: string, evidence: string) {
  await load(page, `<p>nothing</p>`);
  return page.evaluate(
    ([t, e]) => window.__longtake.checkEvidence(t as string, e as string) as unknown,
    [transcript, evidence],
  ) as Promise<Check>;
}

const SAID_HINDI = "मेरा नाम रोहित कृष्णप्प है, मैं कोलकाता से हूँ, इंडिया।";
const SAID_ENGLISH = "My name is Rohit Kashyap, I am from Kolkata, and I need thirty days notice.";

test.describe("the fabrication that forced this file", () => {
  test("an invented quote is rejected", async ({ page }) => {
    const result = await check(page, SAID_HINDI, "My name is Arjun");
    expect(result.ok).toBe(false);
  });

  test("the rejection tells the agent what to do instead", async ({ page }) => {
    const result = await check(page, SAID_HINDI, "My name is Arjun");
    expect(result.reason!.toLowerCase()).toContain("quote the person exactly");
  });

  test("the real quote from the same sentence is accepted", async ({ page }) => {
    expect((await check(page, SAID_HINDI, "मेरा नाम रोहित कृष्णप्प है")).ok).toBe(true);
  });

  test("a Devanagari transcript is not silently erased by normalisation", async ({ page }) => {
    // The option-matching normaliser strips everything outside [a-z0-9], which would reduce this
    // transcript to an empty string and make every quote "match". That would be worse than no
    // check at all, because it would look like one.
    expect((await check(page, SAID_HINDI, "कुछ और ही")).ok).toBe(false);
  });
});

test.describe("quotes that are genuinely there", () => {
  const good = [
    "My name is Rohit Kashyap",
    "my name is rohit kashyap",
    "MY NAME IS ROHIT KASHYAP",
    "I am from Kolkata",
    "thirty days notice",
    "Rohit Kashyap",
    "Kolkata",
  ];

  for (const quote of good) {
    test(`"${quote}" is accepted`, async ({ page }) => {
      expect((await check(page, SAID_ENGLISH, quote)).ok).toBe(true);
    });
  }

  test("punctuation differences do not matter", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "Rohit Kashyap, I am from Kolkata")).ok).toBe(true);
  });

  test("extra whitespace does not matter", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "  I   am  from   Kolkata ")).ok).toBe(true);
  });

  test("a quote spanning two turns of a transcript is accepted", async ({ page }) => {
    const both = `${SAID_ENGLISH}\nAnd my email is rohit at example dot com.`;
    expect((await check(page, both, "my email is rohit at example dot com")).ok).toBe(true);
  });

  test("a mostly-right quote with one word dropped is accepted", async ({ page }) => {
    // Speech-to-text shifts between partial and final results, and a model quoting from memory
    // of a long turn drops the odd word. Demanding a perfect substring refuses honest answers.
    expect((await check(page, SAID_ENGLISH, "name is Rohit Kashyap from Kolkata")).ok).toBe(true);
  });
});

test.describe("quotes that are not", () => {
  const bad = [
    ["a different name entirely", "My name is Priya Sharma"],
    ["a job they never mentioned", "I work at Google as a designer"],
    ["a salary nobody said", "I want thirty lakh rupees"],
    ["a plausible-sounding invention", "I have five years of experience"],
    ["an answer to a question never asked", "Yes I need visa sponsorship"],
  ];

  for (const [name, quote] of bad) {
    test(`${name} is rejected`, async ({ page }) => {
      expect((await check(page, SAID_ENGLISH, quote!)).ok).toBe(false);
    });
  }

  test("an empty quote is rejected", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "")).ok).toBe(false);
  });

  test("a whitespace-only quote is rejected", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "   ")).ok).toBe(false);
  });

  test("a one-character quote is too small to verify, so it is rejected", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "K")).ok).toBe(false);
  });

  test("punctuation on its own is rejected", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "...")).ok).toBe(false);
  });

  test("nothing can be verified before anything has been said", async ({ page }) => {
    const result = await check(page, "", "My name is Rohit");
    expect(result.ok).toBe(false);
    expect(result.reason!.toLowerCase()).toContain("nothing has been said");
  });

  test("half a quote being real is not enough", async ({ page }) => {
    expect((await check(page, SAID_ENGLISH, "I am from Kolkata and I earn forty lakhs a year")).ok)
      .toBe(false);
  });
});

test.describe("splitting a tool call into what was and was not said", () => {
  async function split(
    page: import("@playwright/test").Page,
    transcript: string,
    values: { fieldId: string; value: unknown; evidence: string }[],
  ) {
    await load(page, `<p>nothing</p>`);
    return page.evaluate(
      ([t, v]) => window.__longtake.keepOnlyWhatWasSaid(t as string, v as never) as unknown,
      [transcript, values],
    ) as Promise<{ spoken: { fieldId: string }[]; unsupported: { fieldId: string; reason: string }[] }>;
  }

  test("the real answers pass through", async ({ page }) => {
    const result = await split(page, SAID_ENGLISH, [
      { fieldId: "first_name", value: "Rohit", evidence: "My name is Rohit Kashyap" },
      { fieldId: "current_city", value: "Kolkata", evidence: "I am from Kolkata" },
    ]);
    expect(result.spoken.map((s) => s.fieldId)).toEqual(["first_name", "current_city"]);
    expect(result.unsupported).toEqual([]);
  });

  test("the invented one is held back, by name", async ({ page }) => {
    const result = await split(page, SAID_ENGLISH, [
      { fieldId: "first_name", value: "Rohit", evidence: "My name is Rohit Kashyap" },
      { fieldId: "current_employer", value: "Google", evidence: "I work at Google" },
    ]);
    expect(result.spoken.map((s) => s.fieldId)).toEqual(["first_name"]);
    expect(result.unsupported.map((u) => u.fieldId)).toEqual(["current_employer"]);
  });

  test("one invention does not sink the honest answers beside it", async ({ page }) => {
    const result = await split(page, SAID_ENGLISH, [
      { fieldId: "a", value: "x", evidence: "I am from Kolkata" },
      { fieldId: "b", value: "y", evidence: "completely made up" },
      { fieldId: "c", value: "z", evidence: "thirty days notice" },
    ]);
    expect(result.spoken.map((s) => s.fieldId)).toEqual(["a", "c"]);
    expect(result.unsupported).toHaveLength(1);
  });

  test("every rejection carries a reason the agent can act on", async ({ page }) => {
    const result = await split(page, SAID_ENGLISH, [
      { fieldId: "a", value: "x", evidence: "made up entirely" },
      { fieldId: "b", value: "y", evidence: "" },
    ]);
    for (const item of result.unsupported) expect(item.reason.length).toBeGreaterThan(10);
  });

  test("the whole call being invented leaves nothing to write", async ({ page }) => {
    const result = await split(page, SAID_HINDI, [
      { fieldId: "first_name", value: "Arjun", evidence: "My name is Arjun" },
      { fieldId: "email", value: "arjun@example.com", evidence: "my email is arjun at example" },
    ]);
    expect(result.spoken).toEqual([]);
    expect(result.unsupported).toHaveLength(2);
  });

  test("an empty call is not an error", async ({ page }) => {
    const result = await split(page, SAID_ENGLISH, []);
    expect(result.spoken).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });
});
