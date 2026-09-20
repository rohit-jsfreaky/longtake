import { expect, test } from "@playwright/test";
import { load, only, read } from "./helpers";

/**
 * What kind of control is this, and is it a component or a form element?
 *
 * `kind` decides the JSON-Schema type the binder emits. `custom` decides whether `writer.ts`
 * assigns a value or opens the thing and presses an option — and getting that wrong produces a
 * form that looks filled and submits nothing.
 */

test.describe("native input types", () => {
  const cases: [type: string, kind: string][] = [
    ["text", "text"],
    ["email", "email"],
    ["tel", "tel"],
    ["url", "url"],
    ["number", "number"],
    ["date", "date"],
    ["datetime-local", "date"],
    ["month", "date"],
    ["week", "date"],
    ["time", "text"],
    ["search", "text"],
    ["range", "number"],
    ["color", "text"],
  ];

  for (const [type, kind] of cases) {
    test(`input[type=${type}] reads as ${kind}`, async ({ page }) => {
      await load(page, `<label for="f">Field</label><input id="f" type="${type}">`);
      expect(only(await read(page)).kind).toBe(kind);
    });

    test(`input[type=${type}] is not a component`, async ({ page }) => {
      await load(page, `<label for="f">Field</label><input id="f" type="${type}">`);
      expect(only(await read(page)).custom).toBeUndefined();
    });
  }

  test("an input with no type at all is text", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f">`);
    expect(only(await read(page)).kind).toBe("text");
  });

  test("an unknown type falls back to text rather than being dropped", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" type="quantum">`);
    expect(only(await read(page)).kind).toBe("text");
  });
});

test.describe("input types that are not answers", () => {
  for (const type of ["submit", "button", "reset", "image", "hidden"]) {
    test(`input[type=${type}] is not a field at all`, async ({ page }) => {
      await load(page, `<input type="${type}" name="x" value="Go">`);
      expect((await read(page)).specs).toHaveLength(0);
    });
  }

  test("a password box is never read, spoken or stored", async ({ page }) => {
    await load(page, `<label for="p">Password</label><input id="p" type="password">`);
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("a file input is kept out of the schema and explained in skipped", async ({ page }) => {
    await load(page, `<label for="f">Resume</label><input id="f" type="file">`);
    const result = await read(page);
    expect(result.specs).toHaveLength(0);
    expect(result.skipped.some((s) => /file cannot be attached/i.test(s.reason))).toBe(true);
  });
});

test.describe("controls that cannot receive an answer", () => {
  test("a disabled input is not a field", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" disabled>`);
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("a readonly input is not a field", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" readonly>`);
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("a disabled select is not a field", async ({ page }) => {
    await load(page, `<label for="f">Field</label><select id="f" disabled><option>A</option></select>`);
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("a disabled textarea is not a field", async ({ page }) => {
    await load(page, `<label for="f">Field</label><textarea id="f" disabled></textarea>`);
    expect((await read(page)).specs).toHaveLength(0);
  });
});

test.describe("native non-input controls", () => {
  test("textarea is a textarea", async ({ page }) => {
    await load(page, `<label for="f">Cover letter</label><textarea id="f"></textarea>`);
    expect(only(await read(page)).kind).toBe("textarea");
  });

  test("textarea is always long-form", async ({ page }) => {
    await load(page, `<label for="f">Notes</label><textarea id="f"></textarea>`);
    expect(only(await read(page)).longForm).toBe(true);
  });

  test("select is a select", async ({ page }) => {
    await load(page, `<label for="f">Country</label><select id="f"><option>India</option></select>`);
    expect(only(await read(page)).kind).toBe("select");
  });

  test("a real select is NOT a component — its value can be assigned", async ({ page }) => {
    await load(page, `<label for="f">Country</label><select id="f"><option>India</option></select>`);
    expect(only(await read(page)).custom).toBeUndefined();
  });

  test("select[multiple] is a multiselect", async ({ page }) => {
    await load(
      page,
      `<label for="f">Languages</label><select id="f" multiple><option>Hindi</option></select>`,
    );
    expect(only(await read(page)).kind).toBe("multiselect");
  });
});

test.describe("controls built out of divs", () => {
  test("contenteditable reads as a textarea", async ({ page }) => {
    await load(page, `<div contenteditable="true" aria-label="Bio"></div>`);
    expect(only(await read(page)).kind).toBe("textarea");
  });

  test("contenteditable with an empty attribute also counts", async ({ page }) => {
    await load(page, `<div contenteditable="" aria-label="Bio"></div>`);
    expect(only(await read(page)).kind).toBe("textarea");
  });

  test("contenteditable is a component, not a form element", async ({ page }) => {
    await load(page, `<div contenteditable="true" aria-label="Bio"></div>`);
    expect(only(await read(page)).custom).toBe(true);
  });

  test("role=textbox reads as a textarea", async ({ page }) => {
    // Given a size on purpose: an empty div really is zero-height, and a zero-height control is
    // correctly treated as invisible. That rule is tested in reader.visibility.spec.ts.
    await load(page, `<div role="textbox" aria-label="Summary" style="width:200px;height:24px"></div>`);
    expect(only(await read(page)).kind).toBe("textarea");
  });

  test("role=searchbox is a field", async ({ page }) => {
    await load(page, `<div role="searchbox" aria-label="Find" style="width:80px;height:20px"></div>`);
    expect(only(await read(page)).kind).toBe("textarea");
  });

  test("role=spinbutton reads as a number", async ({ page }) => {
    await load(page, `<div role="spinbutton" aria-label="Years" style="width:80px;height:20px"></div>`);
    expect(only(await read(page)).kind).toBe("number");
  });

  test("role=checkbox reads as a checkbox", async ({ page }) => {
    await load(
      page,
      `<div role="checkbox" aria-checked="false" aria-label="I agree" style="width:20px;height:20px"></div>`,
    );
    expect(only(await read(page)).kind).toBe("checkbox");
  });

  test("role=switch reads as a checkbox", async ({ page }) => {
    await load(
      page,
      `<div role="switch" aria-checked="false" aria-label="Remote only" style="width:40px;height:20px"></div>`,
    );
    expect(only(await read(page)).kind).toBe("checkbox");
  });

  test("role=radiogroup reads as a radio", async ({ page }) => {
    await load(
      page,
      `<div role="radiogroup" aria-label="Notice period">
         <div role="radio" aria-checked="false">Immediate</div>
         <div role="radio" aria-checked="false">30 days</div>
       </div>`,
    );
    expect(only(await read(page)).kind).toBe("radio");
  });

  test("an ARIA radio group is a component", async ({ page }) => {
    await load(
      page,
      `<div role="radiogroup" aria-label="Notice period">
         <div role="radio" aria-checked="false">Immediate</div>
       </div>`,
    );
    expect(only(await read(page)).custom).toBe(true);
  });
});

test.describe("dropdowns that are not <select>", () => {
  test("role=combobox on an input reads as a select", async ({ page }) => {
    await load(page, `<input role="combobox" aria-label="Country">`);
    expect(only(await read(page)).kind).toBe("select");
  });

  test("a combobox input IS a component even though it is a real <input>", async ({ page }) => {
    await load(page, `<input role="combobox" aria-label="Country">`);
    expect(only(await read(page)).custom).toBe(true);
  });

  test("aria-haspopup=listbox on a button is found and read as a select", async ({ page }) => {
    await load(page, `<button aria-haspopup="listbox" aria-label="Country">Choose</button>`);
    const spec = only(await read(page));
    expect(spec.kind).toBe("select");
    expect(spec.custom).toBe(true);
  });

  test("aria-haspopup=menu on a div is found too", async ({ page }) => {
    await load(
      page,
      `<div role="button" aria-haspopup="menu" aria-label="Seniority" style="width:120px;height:30px">Pick</div>`,
    );
    const spec = only(await read(page));
    expect(spec.kind).toBe("select");
    expect(spec.custom).toBe(true);
  });

  test("role is read BEFORE tag, so a combobox input is never mistaken for text", async ({ page }) => {
    await load(page, `<input type="text" role="combobox" aria-label="City">`);
    expect(only(await read(page)).kind).not.toBe("text");
  });
});

test.describe("required", () => {
  test("the required attribute is reported", async ({ page }) => {
    await load(page, `<label for="f">Email</label><input id="f" required>`);
    expect(only(await read(page)).required).toBe(true);
  });

  test("aria-required=true is reported", async ({ page }) => {
    await load(page, `<label for="f">Email</label><input id="f" aria-required="true">`);
    expect(only(await read(page)).required).toBe(true);
  });

  test("aria-required=false is not required", async ({ page }) => {
    await load(page, `<label for="f">Email</label><input id="f" aria-required="false">`);
    expect(only(await read(page)).required).toBe(false);
  });

  test("an ordinary field is not required", async ({ page }) => {
    await load(page, `<label for="f">Email</label><input id="f">`);
    expect(only(await read(page)).required).toBe(false);
  });
});

test.describe("constraints carried through to the binder", () => {
  test("maxlength is reported", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f" maxlength="6">`);
    expect(only(await read(page)).maxLength).toBe(6);
  });

  test("no maxlength means the property is absent, not zero", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f">`);
    expect(only(await read(page)).maxLength).toBeUndefined();
  });

  test("pattern is reported", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f" pattern="[0-9]{6}">`);
    expect(only(await read(page)).pattern).toBe("[0-9]{6}");
  });

  test("placeholder is reported separately from the label", async ({ page }) => {
    await load(page, `<label for="f">Phone</label><input id="f" placeholder="+91…">`);
    const spec = only(await read(page));
    expect(spec.label).toBe("Phone");
    expect(spec.placeholder).toBe("+91…");
  });
});

test.describe("which fields deserve a Dictation pass of their own", () => {
  test("a short text input is not long-form", async ({ page }) => {
    await load(page, `<label for="f">First name</label><input id="f">`);
    expect(only(await read(page)).longForm).toBeUndefined();
  });

  test("a few hundred characters of maxlength does NOT make it an essay", async ({ page }) => {
    // Greenhouse sets exactly this on First Name and Email. The old threshold of 200 marked
    // every one of them long-form.
    await load(page, `<label for="f">First name</label><input id="f" maxlength="255">`);
    expect(only(await read(page)).longForm).toBeUndefined();
  });

  test("a genuinely huge maxlength does", async ({ page }) => {
    await load(page, `<label for="f">Statement</label><input id="f" maxlength="4000">`);
    expect(only(await read(page)).longForm).toBe(true);
  });

  const essayLabels = [
    "Cover letter",
    "Why do you want to work here?",
    "Tell us about a time you shipped something",
    "Describe your proudest project",
    "What excites you most about this role?",
    "In your own words, what do you do?",
    "Summarise your experience",
  ];

  for (const label of essayLabels) {
    test(`"${label}" is treated as a long answer`, async ({ page }) => {
      await load(page, `<label for="f">${label}</label><input id="f">`);
      expect(only(await read(page)).longForm).toBe(true);
    });
  }

  test("an ordinary question is not", async ({ page }) => {
    await load(page, `<label for="f">Notice period in days</label><input id="f">`);
    expect(only(await read(page)).longForm).toBeUndefined();
  });
});
