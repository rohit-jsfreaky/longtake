/**
 * What the agent says first, and how it asks for each field.
 *
 * The first version opened every session with "Go ahead, tell me about yourself" — on a form the
 * person had not read. They said their name and stopped, and the agent spent the rest of the call
 * pulling answers out one box at a time. These pin the replacement: say what the form is, name the
 * easy answers, and ask every choice WITH its choices.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, type TestFieldSpec } from "./helpers";

async function opening(page: Page, specs: TestFieldSpec[], title = ""): Promise<string> {
  await load(page, "<p>no form needed</p>");
  return page.evaluate(
    ([s, t]) => window.__longtake.openingLine(s as never, t as string),
    [specs, title] as const,
  );
}

async function ask(page: Page, spec: TestFieldSpec): Promise<string> {
  await load(page, "<p>no form needed</p>");
  return page.evaluate((s) => window.__longtake.howToAsk(s as never), spec);
}

const f = (id: string, label: string, kind = "text", extra: Partial<TestFieldSpec> = {}) =>
  ({ id, label, kind, required: false, ...extra }) as TestFieldSpec;

const options = (...labels: string[]) => labels.map((label) => ({ value: label, label }));

/** Shaped like the Glean application on the landing page. */
const JOB_FORM: TestFieldSpec[] = [
  f("first_name", "First Name"),
  f("last_name", "Last Name"),
  f("email", "Email", "email"),
  f("phone", "Phone", "tel"),
  f("country", "Country", "select", { custom: true, options: options("India", "Canada") }),
  f("linkedin", "LinkedIn Profile"),
  f("ai_tools", "What AI tools are you using?", "textarea", { longForm: true }),
];

test.describe("the opening line", () => {
  test("says what the form is, how big it is, and names the easy answers", async ({ page }) => {
    const line = await opening(page, JOB_FORM, "Software Engineer, Backend");
    expect(line).toBe(
      "Right, this is Software Engineer, Backend — 7 questions. Easy ones first: your name, email, phone number, where you're based and LinkedIn. Say them all at once if you like.",
    );
  });

  test("without a title it says 'this form', never an invented name", async ({ page }) => {
    const line = await opening(page, JOB_FORM);
    expect(line.startsWith("Right — this form has 7 questions.")).toBe(true);
  });

  test("first and last name are one easy answer, not two", async ({ page }) => {
    const line = await opening(page, JOB_FORM, "X");
    expect(line.match(/name/g)).toHaveLength(1);
  });

  test("only names easy answers this form actually asks", async ({ page }) => {
    const line = await opening(page, [f("email", "Email", "email"), f("why", "Why us?", "textarea")]);
    expect(line).toContain("email");
    expect(line).not.toContain("phone");
    expect(line).not.toContain("LinkedIn");
  });

  test("a form with no easy answers invites them to start anywhere", async ({ page }) => {
    const line = await opening(page, [f("why", "Why us?", "textarea"), f("salary", "Salary")]);
    expect(line).toBe(
      "Right — this form has 2 questions. Tell me whatever you know and I'll put it in the right places.",
    );
  });

  test("trap fields and file uploads are not counted as questions", async ({ page }) => {
    const line = await opening(page, [
      f("email", "Email", "email"),
      f("website_url", "Leave blank", "text", { suspectedHoneypot: true }),
      f("resume", "Resume", "file"),
    ]);
    expect(line).toContain("1 question.");
  });

  test("an empty page says so instead of greeting nothing", async ({ page }) => {
    expect(await opening(page, [])).toBe("I can't find anything to fill in on this page yet.");
  });

  /**
   * The Jotform membership application loads with exactly one question. "This form, 1 question"
   * would be true and useless — twenty more are coming. So the gate is asked, with its choices.
   */
  test("a form that opens with one choice asks that choice first", async ({ page }) => {
    const line = await opening(
      page,
      [
        f("applying_as", "Are you applying as an Independent Representative, or a Representative of your Organization?", "radio", {
          required: true,
          options: options("Independent Representative", "Organization Representative"),
        }),
      ],
      "Society Membership Application",
    );
    expect(line).toContain("Right, this is Society Membership Application. It opens with one question:");
    expect(line).toContain("Independent Representative or Organization Representative?");
    expect(line).toContain("The rest appears once you answer.");
  });

  /**
   * The hazard this guards: "Emergency contact phone" is not the person's phone, and naming
   * "phone number" as an easy answer because of it would invite the wrong one.
   */
  test("somebody else's details are never offered as easy answers", async ({ page }) => {
    const line = await opening(page, [
      f("emergency_phone", "Emergency contact phone", "tel"),
      f("why", "Why us?", "textarea"),
    ]);
    expect(line).not.toContain("phone");
  });
});

test.describe("how each field is asked", () => {
  test("a few choices are read out with the question", async ({ page }) => {
    const said = await ask(
      page,
      f("heard", "How did you hear about us?", "select", {
        options: [{ value: "", label: "Select…" }, ...options("Conference", "Podcast", "LinkedIn")],
      }),
    );
    expect(said).toBe("How did you hear about us? — Conference, Podcast or LinkedIn?");
  });

  test("the placeholder is never read out as a choice", async ({ page }) => {
    const said = await ask(
      page,
      f("heard", "Heard from", "select", { options: [{ value: "", label: "Select…" }, ...options("A", "B")] }),
    );
    expect(said).not.toContain("Select");
  });

  test("six is still few enough to say", async ({ page }) => {
    const said = await ask(page, f("x", "Pick", "select", { options: options("a", "b", "c", "d", "e", "f") }));
    expect(said).toBe("Pick — a, b, c, d, e or f?");
  });

  /**
   * Glean's "How did you hear" has eleven. Reading eleven out loud is not help — pointing at the
   * screen is, and saying how many there are tells the person it is worth a look.
   */
  test("many choices point at the screen instead of being recited", async ({ page }) => {
    const eleven = options(...Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`));
    const said = await ask(page, f("heard", "How did you hear about Glean?", "select", { options: eleven }));
    expect(said).toBe(
      "How did you hear about Glean? — there are 11 options, so ask them to look at the list on screen before they answer.",
    );
    expect(said).not.toContain("Option 1");
  });

  test("a group of checkboxes says any of them may be picked", async ({ page }) => {
    const said = await ask(
      page,
      f("industry", "Industry", "multiselect", { options: options("Performing Arts", "Motion Picture") }),
    );
    expect(said).toBe("Industry — any of: Performing Arts and Motion Picture.");
  });

  test("a lone checkbox is a yes or no", async ({ page }) => {
    expect(await ask(page, f("agree", "I agree to the terms", "checkbox"))).toBe(
      "I agree to the terms — a yes or no.",
    );
  });

  test("a long answer is flagged as one", async ({ page }) => {
    const said = await ask(page, f("why", "Why do you want this job?", "textarea", { longForm: true }));
    expect(said).toContain("a few sentences is fine");
  });

  test("the required marker is not read out", async ({ page }) => {
    expect(await ask(page, f("name", "Organization Name *"))).toBe("Organization Name");
  });

  /** On a form that asks "First Name" twice, the heading is the only thing that says whose. */
  test("the section rides along with the question", async ({ page }) => {
    expect(
      await ask(page, f("x", "First Name", "text", { section: "Alternate Designated Representative" })),
    ).toBe('First Name (under "Alternate Designated Representative")');
  });
});

test.describe("the order questions are asked in", () => {
  test("easy ones first, then the rest in the form's own order", async ({ page }) => {
    await load(page, "<p>no form needed</p>");
    const order = await page.evaluate(
      (specs) => window.__longtake.inAskingOrder(specs as never).map((spec) => spec.id),
      [
        f("why", "Why us?", "textarea"),
        f("email", "Email", "email"),
        f("salary", "Expected salary"),
        f("first_name", "First Name"),
      ],
    );
    expect(order).toEqual(["email", "first_name", "why", "salary"]);
  });
});

// Once the model has said what each field means, the conversation goes by that, not by English
// keys: a German form's "Vorname" is an easy question, and an emergency contact's phone never is.
test.describe("what the model understood decides the easy questions", () => {
  const understood = (concept: string, subject = "self") => ({ understood: { concept, subject, confidence: "high" } });

  test("a first name in another language is asked first; somebody else's phone is not an easy one", async ({ page }) => {
    await load(page, "<p>no form needed</p>");
    const [order, line] = await page.evaluate((specs) => {
      const L = window.__longtake;
      return [L.inAskingOrder(specs as never).map((spec) => spec.id), L.openingLine(specs as never, "Bewerbung")];
    }, [
      { ...f("warum", "Warum wir?", "textarea") },
      { ...f("notfall", "Telefon", "tel"), section: "Notfallkontakt", ...understood("contact.phone", "other_person") },
      { ...f("vorname", "Vorname"), ...understood("identity.first_name") },
      { ...f("mail", "E-Mail-Adresse", "email"), ...understood("contact.email") },
    ]);
    expect(order).toEqual(["vorname", "mail", "warum", "notfall"]);
    expect(line).toContain("Easy ones first: your name and email");
  });
});
