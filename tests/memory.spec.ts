import { expect, test, type Page } from "@playwright/test";
import { load } from "./helpers";

/**
 * The offline reading of what a field means — `canonicalKey`, what `fallbackMeanings` uses when the
 * model cannot be reached — and the matching that could ruin it.
 *
 * Field ids mean nothing across sites, so a sloppy match writes a legal name into "Preferred name"
 * or a current employer into "Previous employer". The offline reading only ever offers an answer
 * for a yes (profile.spec.ts), but the easy-questions list in the opening line reads it too.
 *
 * Most of this file is therefore about what must NOT match. What is kept and offered back is in
 * profile.spec.ts.
 */

type Spec = Record<string, unknown>;

const field = (label: string, extra: Spec = {}): Spec => ({
  id: label.toLowerCase().replace(/\W+/g, "_"),
  label,
  kind: "text",
  required: false,
  ...extra,
});

async function keyFor(page: Page, label: string, extra: Spec = {}): Promise<string | null> {
  await load(page, `<p>nothing</p>`);
  return page.evaluate(
    (spec) => window.__longtake.canonicalKey(spec as never) as unknown,
    field(label, extra),
  ) as Promise<string | null>;
}

test.describe("what a question means", () => {
  const recognised: [label: string, key: string][] = [
    ["First name", "first_name"],
    ["First Name *", "first_name"],
    ["Given name", "first_name"],
    ["Last name", "last_name"],
    ["Surname", "last_name"],
    ["Family name", "last_name"],
    ["Email", "email"],
    ["E-mail address", "email"],
    ["Phone", "phone"],
    ["Mobile number", "phone"],
    ["Current city", "city"],
    ["Location (City)", "city"],
    ["Country", "country"],
    ["LinkedIn Profile", "linkedin"],
    ["GitHub", "github"],
    ["Notice period", "notice_period"],
    ["Years of experience", "years_experience"],
    ["Are you open to relocating?", "willing_to_relocate"],
    ["Are you currently authorized to work in the U.S.?", "work_authorization"],
    ["Do you now, or will you in the future, require immigration sponsorship?", "needs_sponsorship"],
    ["Expected salary", "expected_salary"],
    ["Tell us about yourself", "about_you"],
  ];

  for (const [label, key] of recognised) {
    test(`"${label}" → ${key}`, async ({ page }) => {
      expect(await keyFor(page, label)).toBe(key);
    });
  }
});

// Jotform splits a phone number into an area-code box and a number box, both under "Phone Number".
// A saved phone number written whole into either would be wrong however right the number.
test("a box that takes a piece of an answer is not that answer", async ({ page }) => {
  expect(await keyFor(page, "Phone Number")).toBe("phone");
  expect(await keyFor(page, "Phone Number", { part: "Area Code" })).toBeNull();
});

test.describe("the labels that look alike and are not", () => {
  /**
   * Every one of these would be a real, plausible mistake on a real job form, and each would put
   * a confidently wrong answer in front of somebody who is about to press submit.
   */
  const traps: [label: string, why: string][] = [
    ["Preferred first name", "a different answer from the legal one"],
    ["Maiden name", "not the current surname"],
    ["Previous employer", "a different job from the current one"],
    ["Former company", "same reason"],
    ["Emergency contact name", "somebody else entirely"],
    ["Emergency contact phone", "somebody else's number"],
    ["Parent or guardian email", "not the applicant's"],
    ["Referee email", "not the applicant's"],
    ["Confirm email", "a re-type box, not a question"],
    ["City of birth", "not where they live now"],
    ["Country of birth", "not where they live now"],
    ["Company website", "not their portfolio"],
    ["Current salary", "not the expected one"],
    ["Desired work location", "not where they live"],
  ];

  for (const [label, why] of traps) {
    test(`"${label}" is not treated as the obvious key — ${why}`, async ({ page }) => {
      const key = await keyFor(page, label);
      const wrong = [
        "first_name",
        "last_name",
        "full_name",
        "email",
        "phone",
        "city",
        "country",
        "current_employer",
        "portfolio",
        "expected_salary",
      ];
      // It may map to its own distinct key, or to nothing. It must not map to the one it mimics.
      if (key && wrong.includes(key)) {
        // Only acceptable when the label genuinely IS that thing.
        expect(`${label} wrongly matched ${key}`).toBe("no wrong match");
      }
    });
  }

  test("\"Preferred first name\" gets its own key rather than nothing", async ({ page }) => {
    expect(await keyFor(page, "Preferred first name")).toBe("preferred_name");
  });

  test("\"Current salary\" and \"Expected salary\" are different keys", async ({ page }) => {
    expect(await keyFor(page, "Current salary")).toBe("current_salary");
    expect(await keyFor(page, "Expected salary")).toBe("expected_salary");
  });

  test("a company's own question matches nothing", async ({ page }) => {
    expect(await keyFor(page, "What excites you most about working for AssemblyAI?")).toBeNull();
  });

  test("an unlabelled field matches nothing", async ({ page }) => {
    expect(await keyFor(page, "")).toBeNull();
  });

  test("a label claimed by two keys is treated as unknown rather than guessed", async ({ page }) => {
    // "Current company name" reads as both an employer and a plain name to a careless matcher.
    const key = await keyFor(page, "Current company name");
    expect(key === null || key === "current_employer").toBe(true);
    expect(key).not.toBe("full_name");
  });
});
