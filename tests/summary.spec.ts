/**
 * What the agent is told after every call.
 *
 * The first version handed the model lines to say — `say_this`, and an `ask` string for every
 * field — and it recited them, so the whole call sounded like a form reading itself aloud. These
 * pin the replacement: facts only. What went in and with what value, what did not and why, how far
 * along the form is, what is left, and the optional fields once — and only once — the required
 * ones are done.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, type TestFieldSpec } from "./helpers";

const f = (id: string, label: string, kind = "text", extra: Partial<TestFieldSpec> = {}) =>
  ({ id, label, kind, required: false, ...extra }) as TestFieldSpec;
const req = (id: string, label: string, kind = "text", extra: Partial<TestFieldSpec> = {}) =>
  f(id, label, kind, { required: true, ...extra });
const options = (...labels: string[]) => labels.map((label) => ({ value: label, label }));

type Outcome =
  | { fieldId: string; status: "written"; wrote: string }
  | { fieldId: string; status: "refused"; reason: string; choices?: string[] }
  | { fieldId: string; status: "rejected-by-page"; wrote: string; found: string; retried?: boolean };

type Summary = {
  just_filled: { field: string; question: string; value: string }[];
  not_filled: { field: string; question: string; why: string; choices?: string[] }[];
  progress: { filled: number; total: number; required_left: number; optional_left: number };
  next_required: Record<string, unknown>[];
  optional?: Record<string, unknown>[];
  form_changed?: Record<string, unknown>;
  submitted: false;
};

async function summarise(
  page: Page,
  input: {
    specs: TestFieldSpec[];
    filled: string[];
    outcomes: Outcome[];
    claimed?: { fieldId: string; value: unknown; evidence: string }[];
  },
): Promise<Summary> {
  await load(page, "<p>no form needed</p>");
  return page.evaluate(
    (i) => window.__longtake.summarise(i as never) as unknown,
    input,
  ) as Promise<Summary>;
}

/** Glean-shaped: four required, a few optional, one long dropdown. */
const FORM: TestFieldSpec[] = [
  req("first_name", "First Name"),
  req("last_name", "Last Name"),
  req("email", "Email", "email"),
  f("phone", "Phone", "tel"),
  f("website", "Website"),
  req(
    "heard",
    "How did you hear about Glean? *",
    "select",
    { custom: true, options: options(...Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`)) },
  ),
  f("gender", "Gender", "select", { options: options("Male", "Female", "Decline To Self Identify") }),
];

test.describe("what went in", () => {
  test("carries the value, so the agent can acknowledge it naturally", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: ["first_name"],
      outcomes: [{ fieldId: "first_name", status: "written", wrote: "Rohit" }],
    });
    expect(s.just_filled).toEqual([{ field: "first_name", question: "First Name", value: "Rohit" }]);
  });

  test("a long answer is shortened, never read back whole", async ({ page }) => {
    const long = "I use Claude Code and Codex daily for coding, testing and browser automation work";
    const s = await summarise(page, {
      specs: [req("tools", "What AI tools?", "textarea", { longForm: true })],
      filled: ["tools"],
      outcomes: [{ fieldId: "tools", status: "written", wrote: long }],
    });
    expect(s.just_filled[0]!.value.length).toBeLessThanOrEqual(61);
    expect(s.just_filled[0]!.value.endsWith("…")).toBe(true);
  });
});

test.describe("what did not go in, and why", () => {
  test("an answer the form does not offer carries the choices", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [{ fieldId: "gender", status: "refused", reason: "x", choices: ["Male", "Female"] }],
    });
    expect(s.not_filled).toEqual([
      { field: "gender", question: "Gender", why: "not_an_option", choices: ["Male", "Female"] },
    ]);
  });

  /**
   * Live run: the agent put "Kolkata" into Country, was refused, and said "India is not an option".
   * Showing it what it sent is what lets it see the mistake was its own.
   */
  test("a refusal shows what the agent tried", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [{ fieldId: "gender", status: "refused", reason: "x", choices: ["Male", "Female"] }],
      claimed: [{ fieldId: "gender", value: "Kolkata", evidence: "I'm based Kolkata" }],
    });
    expect(s.not_filled[0]).toMatchObject({ why: "not_an_option", tried: "Kolkata" });
  });

  /**
   * The difference that matters: a person who said nothing about a field should not be told
   * about it; a person who DID say it but was misquoted should not be asked again.
   */
  test("nothing said and misquoted are told apart", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [
        { fieldId: "phone", status: "refused", reason: "Nothing was spoken about this field" },
        { fieldId: "website", status: "refused", reason: "Those words were not in what was said" },
      ],
      claimed: [
        { fieldId: "phone", value: "123", evidence: "" },
        { fieldId: "website", value: "rohit.dev", evidence: "my site is rohit dot dev" },
      ],
    });
    expect(s.not_filled.map((n) => n.why)).toEqual(["not_heard", "quote_not_found"]);
  });

  test("a page that refused twice is handed back to the person", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [
        { fieldId: "email", status: "rejected-by-page", wrote: "a@b.c", found: "", retried: true },
        { fieldId: "phone", status: "rejected-by-page", wrote: "1", found: "" },
      ],
    });
    expect(s.not_filled.map((n) => n.why)).toEqual(["page_refused_twice", "page_refused"]);
  });

  test("a field that has left the page is 'gone'", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [{ fieldId: "vanished", status: "refused", reason: "That field is no longer on the page." }],
    });
    expect(s.not_filled[0]!.why).toBe("gone");
  });
});

test.describe("where the form is up to", () => {
  test("counts filled, total, required left and optional left", async ({ page }) => {
    const s = await summarise(page, { specs: FORM, filled: ["first_name", "phone"], outcomes: [] });
    expect(s.progress).toEqual({ filled: 2, total: 7, required_left: 3, optional_left: 2 });
  });

  test("required ones come next, easy ones first", async ({ page }) => {
    const s = await summarise(page, { specs: FORM, filled: [], outcomes: [] });
    expect(s.next_required.map((facts) => facts.field)).toEqual([
      "first_name",
      "last_name",
      "email",
      "heard",
    ]);
  });

  /** Offering optional fields while required ones are open makes a short form feel long. */
  test("optional fields are not mentioned while required ones are still open", async ({ page }) => {
    const s = await summarise(page, { specs: FORM, filled: ["first_name"], outcomes: [] });
    expect(s.optional).toBeUndefined();
  });

  /** The checkpoint: "the required ones are all in — want the optional ones?" */
  test("once the required ones are in, the optional ones are offered", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: ["first_name", "last_name", "email", "heard"],
      outcomes: [],
    });
    expect(s.progress.required_left).toBe(0);
    expect(s.optional!.map((facts) => facts.field)).toEqual(["phone", "website", "gender"]);
  });

  test("nothing optional left means nothing offered", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: FORM.map((spec) => spec.id),
      outcomes: [],
    });
    expect(s.optional).toBeUndefined();
    expect(s.progress).toMatchObject({ required_left: 0, optional_left: 0 });
  });
});

test.describe("the facts about each field", () => {
  test("a short list of choices is given; a long one is only counted", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: ["first_name", "last_name", "email", "heard"],
      outcomes: [],
    });
    const gender = s.optional!.find((facts) => facts.field === "gender")!;
    expect(gender.choices).toEqual(["Male", "Female", "Decline To Self Identify"]);

    const all = await summarise(page, { specs: FORM, filled: [], outcomes: [] });
    const heard = all.next_required.find((facts) => facts.field === "heard")!;
    expect(heard.choices).toBeUndefined();
    expect(heard.choice_count).toBe(11);
  });

  test("the required marker is not part of the question", async ({ page }) => {
    const s = await summarise(page, { specs: FORM, filled: [], outcomes: [] });
    expect(s.next_required.find((facts) => facts.field === "heard")!.question).toBe(
      "How did you hear about Glean?",
    );
  });

  test("answer types say how the field is answered", async ({ page }) => {
    const s = await summarise(page, {
      specs: [
        req("a", "Agree", "checkbox"),
        req("b", "Industry", "multiselect", { options: options("X", "Y") }),
        req("c", "Pick", "radio", { options: options("X", "Y") }),
        req("d", "Why?", "textarea", { longForm: true }),
        req("e", "Name"),
      ],
      filled: [],
      outcomes: [],
    });
    expect(Object.fromEntries(s.next_required.map((facts) => [facts.field, facts.answer_type]))).toEqual({
      a: "yes or no",
      b: "pick any",
      c: "pick one",
      d: "long answer",
      e: "text",
    });
  });

  /** Five boxes on the page, one question to a person. */
  test("the parts of an address are one group", async ({ page }) => {
    const section = "Independent Information";
    const s = await summarise(page, {
      specs: [
        req("street_address", "Street Address", "text", { section }),
        f("street_address_line_2", "Street Address Line 2", "text", { section }),
        f("city", "City", "text", { section }),
        f("postal_zip_code", "Postal / Zip Code", "text", { section }),
      ],
      filled: ["street_address"],
      outcomes: [],
    });
    expect(s.optional!.every((facts) => facts.group === "address")).toBe(true);
  });

  test("a lone country dropdown is not an address group", async ({ page }) => {
    const s = await summarise(page, {
      specs: [req("country", "Country", "select", { options: options("India", "Canada") })],
      filled: [],
      outcomes: [],
    });
    expect(s.next_required[0]!.group).toBeUndefined();
  });
});

test.describe("what is never in it", () => {
  /**
   * No lines to recite — that is the whole change. And the submission flag stays, because it is
   * read at the exact moment the model once announced "I have submitted your application".
   */
  test("no scripts, and submitted is always false", async ({ page }) => {
    const s = await summarise(page, {
      specs: FORM,
      filled: [],
      outcomes: [{ fieldId: "gender", status: "refused", reason: "x", choices: ["Male"] }],
    });
    const text = JSON.stringify(s);
    expect(text).not.toContain("say_this");
    expect(text).not.toContain("you_must");
    expect(text).not.toContain('"ask"');
    expect(s.submitted).toBe(false);
  });
});

test.describe("the opening line, when answers are already there", () => {
  async function opening(page: Page, filled: string[], remembered: boolean): Promise<string> {
    await load(page, "<p>no form needed</p>");
    return page.evaluate(
      ([specs, f, r]) =>
        window.__longtake.openingLine(specs as never, "the Glean application", {
          filled: f as string[],
          remembered: r as boolean,
        }),
      [FORM, filled, remembered] as const,
    );
  }

  test("answers from last time are named, and the rest are asked for", async ({ page }) => {
    const line = await opening(page, ["first_name", "last_name", "email"], true);
    expect(line).toContain("I've already put in your name and email from last time");
    expect(line).toContain("Easy ones first: phone number and website.");
  });

  test("answers typed before the call are not claimed as memory", async ({ page }) => {
    const line = await opening(page, ["email"], false);
    expect(line).toContain("I've already put in email — give it a quick look.");
    expect(line).not.toContain("last time");
  });

  test("when every easy answer is in, it hands straight over", async ({ page }) => {
    const line = await opening(page, ["first_name", "last_name", "email", "phone", "website"], true);
    expect(line).toContain("The rest needs you — ready when you are.");
  });
});

test.describe("optional fields", () => {
  test("stillOptional lists empty optional fields, never traps or uploads", async ({ page }) => {
    await load(page, "<p>no form needed</p>");
    const ids = await page.evaluate(
      (specs) => window.__longtake.stillOptional(specs as never, ["phone"]).map((spec) => spec.id),
      [
        req("name", "Name"),
        f("phone", "Phone"),
        f("site", "Website"),
        f("trap", "Leave blank", "text", { suspectedHoneypot: true }),
        f("cv", "Resume", "file"),
      ],
    );
    expect(ids).toEqual(["site"]);
  });
});

test.describe("fields the person cleared on purpose", () => {
  /** "Remove the gender" must not be followed by "what's your gender?". */
  test("are not asked for again, required or optional", async ({ page }) => {
    await load(page, "<p>no form needed</p>");
    const s = (await page.evaluate(
      (specs) =>
        window.__longtake.summarise({
          specs: specs as never,
          filled: ["first_name", "last_name", "email", "heard"],
          outcomes: [],
          declined: ["gender", "email"],
        }) as unknown,
      FORM,
    )) as Summary;
    expect(s.optional!.map((f) => f.field)).not.toContain("gender");
    expect(s.progress.optional_left).toBe(2);
  });
});
