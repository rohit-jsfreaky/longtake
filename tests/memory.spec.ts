import { expect, test, type Page } from "@playwright/test";
import { load } from "./helpers";

/**
 * Answer memory, and the matching that could ruin it.
 *
 * Storing answers is easy. The risk is the other end: field ids mean nothing across sites, so
 * answers are keyed by meaning — and a sloppy match writes a legal name into "Preferred name" or
 * a current employer into "Previous employer". A pre-filled form gets *skimmed*, not read, so a
 * wrong answer there is likelier to be submitted than a wrong answer on an empty one.
 *
 * Most of this file is therefore about what must NOT match.
 */

type Spec = Record<string, unknown>;
type Remembered = { key: string; value: unknown; evidence: string; askedAs: string };
type Recalled = { fieldId: string; key: string; value: unknown; evidence: string; previouslyAskedAs: string };

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

test.describe("what gets kept", () => {
  async function remember(page: Page, specs: Spec[], values: unknown[]): Promise<Record<string, Remembered>> {
    await load(page, `<p>nothing</p>`);
    return page.evaluate(
      ([s, v]) =>
        window.__longtake.remember({}, s as never, v as never, "https://example.com/apply") as unknown,
      [specs, values],
    ) as Promise<Record<string, Remembered>>;
  }

  const SPECS = [field("First name"), field("Email"), field("What excites you about us?")];

  test("a recognised answer is kept under its meaning, not its field id", async ({ page }) => {
    const memory = await remember(page, SPECS, [
      { fieldId: "first_name", value: "Rohit", evidence: "mera naam Rohit Kashyap hai" },
    ]);
    expect(memory.first_name?.value).toBe("Rohit");
  });

  test("the words they said are kept with it", async ({ page }) => {
    const memory = await remember(page, SPECS, [
      { fieldId: "first_name", value: "Rohit", evidence: "mera naam Rohit Kashyap hai" },
    ]);
    expect(memory.first_name?.evidence).toBe("mera naam Rohit Kashyap hai");
  });

  test("how the first form worded it is kept too", async ({ page }) => {
    const memory = await remember(page, SPECS, [
      { fieldId: "first_name", value: "Rohit", evidence: "said" },
    ]);
    expect(memory.first_name?.askedAs).toBe("First name");
  });

  test("an answer with no evidence is not kept", async ({ page }) => {
    const memory = await remember(page, SPECS, [
      { fieldId: "first_name", value: "Rohit", evidence: "" },
    ]);
    expect(memory.first_name).toBeUndefined();
  });

  test("a company's own question is not kept — it will never be asked again", async ({ page }) => {
    const memory = await remember(page, SPECS, [
      { fieldId: "what_excites_you_about_us", value: "The team", evidence: "the team" },
    ]);
    expect(Object.keys(memory)).toEqual([]);
  });

  test("a suspected trap is never remembered", async ({ page }) => {
    const specs = [field("Email", { suspectedHoneypot: true })];
    const memory = await remember(page, specs, [
      { fieldId: "email", value: "x@y.z", evidence: "said" },
    ]);
    expect(Object.keys(memory)).toEqual([]);
  });

  test("a later telling replaces an earlier one", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const memory = (await page.evaluate(
      ([specs]) => {
        const first = window.__longtake.remember(
          {},
          specs as never,
          [{ fieldId: "email", value: "old@example.com", evidence: "old" }] as never,
          "https://a.com",
          1000,
        );
        return window.__longtake.remember(
          first,
          specs as never,
          [{ fieldId: "email", value: "new@example.com", evidence: "new" }] as never,
          "https://b.com",
          2000,
        ) as unknown;
      },
      [SPECS],
    )) as Record<string, Remembered>;
    expect(memory.email?.value).toBe("new@example.com");
  });
});

test.describe("the second form", () => {
  async function recall(page: Page, memory: unknown, specs: Spec[]): Promise<Recalled[]> {
    await load(page, `<p>nothing</p>`);
    return page.evaluate(
      ([m, s]) => window.__longtake.recall(m as never, s as never) as unknown,
      [memory, specs],
    ) as Promise<Recalled[]>;
  }

  const MEMORY = {
    first_name: { key: "first_name", value: "Rohit", evidence: "mera naam Rohit Kashyap hai", askedAs: "First name", savedAt: 1, sourceUrl: "https://a.com" },
    email: { key: "email", value: "rohit@example.com", evidence: "email is rohit at example", askedAs: "Email", savedAt: 1, sourceUrl: "https://a.com" },
    city: { key: "city", value: "Kolkata", evidence: "I am from Kolkata", askedAs: "Current city", savedAt: 1, sourceUrl: "https://a.com" },
  };

  test("a differently-worded form still gets the answers", async ({ page }) => {
    // Nothing here shares a field id or a label with the form the answers came from.
    const recalled = await recall(page, MEMORY, [
      field("Given name"),
      field("E-mail address"),
      field("Location (City)"),
    ]);
    expect(recalled.map((r) => r.key).sort()).toEqual(["city", "email", "first_name"]);
  });

  test("the answers land on the NEW form's field ids", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("Given name")]);
    expect(recalled[0]!.fieldId).toBe("given_name");
  });

  test("the original words travel with the answer", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("Given name")]);
    expect(recalled[0]!.evidence).toBe("mera naam Rohit Kashyap hai");
  });

  test("so a recalled answer survives the writer's evidence rule", async ({ page }) => {
    await load(page, `<label for="a">Given name</label><input id="a">`);
    const outcome = (await page.evaluate(async (memory) => {
      const read = window.__longtake.readForm();
      const recalled = window.__longtake.recall(memory as never, read.specs);
      const values = window.__longtake.asSpokenValues(recalled);
      return (await window.__longtake.writeValues(read.specs, read.handles, values)) as unknown;
    }, MEMORY)) as { status: string }[];
    expect(outcome[0]?.status).toBe("written");
  });

  test("it says how the first form worded the question", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("Given name")]);
    expect(recalled[0]!.previouslyAskedAs).toBe("First name");
  });

  test("questions nobody has answered are left alone", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("What excites you about us?")]);
    expect(recalled).toEqual([]);
  });

  test("a trap on the new form is never filled from memory", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("Email", { suspectedHoneypot: true })]);
    expect(recalled).toEqual([]);
  });

  test("a file upload is never filled from memory", async ({ page }) => {
    const recalled = await recall(page, MEMORY, [field("Email", { kind: "file" })]);
    expect(recalled).toEqual([]);
  });

  test("an empty memory offers nothing rather than failing", async ({ page }) => {
    expect(await recall(page, {}, [field("Given name")])).toEqual([]);
  });

  test("a dropdown value that the new form does not offer is still refused by the writer", async ({ page }) => {
    // Memory hands over "Kolkata"; this form only offers cities it knows. The writer's own rule
    // applies unchanged — memory does not get to bypass anything.
    await load(
      page,
      `<label for="a">Current city</label>
       <select id="a"><option value="">Select…</option><option>Delhi</option><option>Mumbai</option></select>`,
    );
    const outcome = (await page.evaluate(async (memory) => {
      const read = window.__longtake.readForm();
      const recalled = window.__longtake.recall(memory as never, read.specs);
      const values = window.__longtake.asSpokenValues(recalled);
      return (await window.__longtake.writeValues(read.specs, read.handles, values)) as unknown;
    }, MEMORY)) as { status: string }[];
    expect(outcome[0]?.status).toBe("refused");
  });
});

test.describe("what a person can see and undo", () => {
  const MEMORY = {
    email: { key: "email", value: "a@b.c", evidence: "said", askedAs: "Email", savedAt: 2, sourceUrl: "" },
    city: { key: "city", value: "Kolkata", evidence: "said", askedAs: "City", savedAt: 1, sourceUrl: "" },
  };

  test("everything kept can be listed, newest first", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const list = (await page.evaluate(
      (m) => window.__longtake.listMemory(m as never) as unknown,
      MEMORY,
    )) as Remembered[];
    expect(list.map((r) => r.key)).toEqual(["email", "city"]);
  });

  test("one answer can be forgotten", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const left = (await page.evaluate(
      (m) => window.__longtake.forget(m as never, "email") as unknown,
      MEMORY,
    )) as Record<string, unknown>;
    expect(Object.keys(left)).toEqual(["city"]);
  });

  test("forgetting one does not disturb the rest", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const left = (await page.evaluate(
      (m) => window.__longtake.forget(m as never, "email") as unknown,
      MEMORY,
    )) as Record<string, Remembered>;
    expect(left.city?.value).toBe("Kolkata");
  });

  test("everything can be forgotten, and everything means everything", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const left = (await page.evaluate(() => window.__longtake.forgetAll() as unknown)) as Record<string, unknown>;
    expect(left).toEqual({});
  });

  test("forgetting does not mutate what it was given", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const stillThere = (await page.evaluate((m) => {
      const memory = m as never as Record<string, unknown>;
      window.__longtake.forget(memory as never, "email");
      return Object.keys(memory);
    }, MEMORY)) as string[];
    expect(stillThere).toContain("email");
  });
});
