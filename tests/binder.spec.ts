import { expect, test, type Page } from "@playwright/test";
import { load, readDeep } from "./helpers";

/**
 * The tool built from whatever form happens to be on screen.
 *
 * Two properties are load-bearing and get the most attention here:
 *
 *   1. **An answer without evidence must be unrepresentable**, not merely discouraged. If the
 *      schema allows it, a model will eventually emit it.
 *   2. **The schema must be valid**, because the API accepts a broken one silently at
 *      `session.update` and then just never calls the tool — which is close to undebuggable.
 */

type Schema = {
  type: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
  description?: string;
  format?: string;
  maxLength?: number;
  examples?: string[];
};

type Tool = {
  type: string;
  name: string;
  description: string;
  parameters: Schema;
  execution_mode: string;
  timeout_seconds: number;
};

async function buildFrom(page: Page, html: string): Promise<{ tool: Tool; problems: string[] }> {
  await load(page, html);
  await readDeep(page);
  return page.evaluate(() => {
    const specs = window.__longtake.last!.specs;
    const tool = window.__longtake.buildFillTool(specs);
    return { tool, problems: window.__longtake.validateTool(tool) } as unknown;
  }) as Promise<{ tool: Tool; problems: string[] }>;
}

const field = (tool: Tool, id: string) => tool.parameters.properties![id]!;
const valueOf = (tool: Tool, id: string) => field(tool, id).properties!.value!;

test.describe("the shape of the tool", () => {
  const FORM = `<label for="a">First name</label><input id="a">`;

  test("it is a function tool", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.type).toBe("function");
  });

  test("it is called fill_fields", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.name).toBe("fill_fields");
  });

  test("parameters is an object schema — a missing type silently breaks tool calling", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.parameters.type).toBe("object");
  });

  test("it runs interactive, so the agent keeps talking while we fill", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.execution_mode).toBe("interactive");
  });

  test("the timeout is inside the API's permitted range", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.timeout_seconds).toBeGreaterThanOrEqual(1);
    expect(tool.timeout_seconds).toBeLessThanOrEqual(300);
  });

  test("the description tells the model when NOT to call it", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.description.toLowerCase()).toContain("only fields the person spoke about");
  });

  test("the description says leaving a field out is correct", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.description.toLowerCase()).toContain("leaving one out is always fine");
  });

  test("no field is required at the tool level", async ({ page }) => {
    // Marking the form's required fields as required here would make the agent interrogate the
    // person for them before it could call the tool — the exact behaviour Longtake removes.
    const { tool } = await buildFrom(
      page,
      `<label for="a">First name</label><input id="a" required>`,
    );
    expect(tool.parameters.required).toEqual([]);
  });

  test("a field that is not on the page cannot be named", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(tool.parameters.additionalProperties).toBe(false);
  });
});

test.describe("evidence is structural, not advisory", () => {
  const FORM = `<label for="a">Desired salary</label><input id="a">`;

  test("every field is an object of value, evidence, and how it was heard", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(Object.keys(field(tool, "desired_salary").properties!).sort()).toEqual(["evidence", "how", "value"]);
    expect((field(tool, "desired_salary").properties!.how as { enum: string[] }).enum).toEqual(["named", "inferred", "unsure"]);
  });

  test("all three are required, so a value without its source is unrepresentable", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(field(tool, "desired_salary").required!.sort()).toEqual(["evidence", "how", "value"]);
  });

  test("nothing else can be smuggled into a field", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(field(tool, "desired_salary").additionalProperties).toBe(false);
  });

  test("evidence asks for a quote, not a paraphrase", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    const evidence = field(tool, "desired_salary").properties!.evidence!;
    expect(evidence.description!.toLowerCase()).toContain("not a paraphrase");
  });

  test("evidence is a string", async ({ page }) => {
    const { tool } = await buildFrom(page, FORM);
    expect(field(tool, "desired_salary").properties!.evidence!.type).toBe("string");
  });
});

test.describe("each field carries its own constraints", () => {
  test("a checkbox becomes a boolean", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label><input type="checkbox" name="c"> I agree</label>`);
    expect(valueOf(tool, "i_agree").type).toBe("boolean");
  });

  test("a number field becomes a number", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Years</label><input id="a" type="number">`);
    expect(valueOf(tool, "years").type).toBe("number");
  });

  test("an email field carries the email format", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Email</label><input id="a" type="email">`);
    expect(valueOf(tool, "email").format).toBe("email");
  });

  test("a date field asks for ISO-8601, with an example", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Start date</label><input id="a" type="date">`);
    const value = valueOf(tool, "start_date");
    expect(value.format).toBe("date");
    expect(value.description).toContain("YYYY-MM-DD");
  });

  test("a url field carries an example a model can copy the shape of", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">LinkedIn</label><input id="a" type="url">`);
    expect(valueOf(tool, "linkedin").examples!.length).toBeGreaterThan(0);
  });

  test("the page's maxlength is carried into the schema", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Code</label><input id="a" maxlength="6">`);
    expect(valueOf(tool, "code").maxLength).toBe(6);
  });

  test("a required field says so, so the agent knows what to chase", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Email</label><input id="a" required>`);
    expect(field(tool, "email").description).toContain("required");
  });

  test("a long answer is announced as one", async ({ page }) => {
    const { tool } = await buildFrom(page, `<label for="a">Cover letter</label><textarea id="a"></textarea>`);
    expect(field(tool, "cover_letter").description).toContain("long answer");
  });

  test("the field description uses the page's own wording", async ({ page }) => {
    const { tool } = await buildFrom(
      page,
      `<label for="a">Are you currently authorized to work in the U.S.?</label><input id="a">`,
    );
    const only = Object.values(tool.parameters.properties!)[0]!;
    expect(only.description).toContain("Are you currently authorized to work in the U.S.?");
  });
});

test.describe("choices come from the page, never from the model", () => {
  const COUNTRY = `
    <label for="a">Country</label>
    <select id="a"><option value="">Select…</option><option value="in">India</option>
      <option value="us">United States</option></select>`;

  // "Select…" submits nothing: it is no answer, and the model must not be offered it as one.
  test("a select becomes an enum of the page's own labels", async ({ page }) => {
    const { tool } = await buildFrom(page, COUNTRY);
    expect(valueOf(tool, "country").enum).toEqual(["India", "United States"]);
  });

  // A near-miss is sent as inferred, so it is asked at once ("Social Media's closest — that one?");
  // the gate holds it for a yes. Only nothing close is left out.
  test("the enum sends the closest choice as inferred, and leaves out only nothing close", async ({ page }) => {
    const { tool } = await buildFrom(page, COUNTRY);
    const description = valueOf(tool, "country").description!.toLowerCase();
    expect(description).toContain("closest one with how inferred");
    expect(description).toContain("leave this field out only when nothing here is close");
  });

  test("a radio group becomes an enum", async ({ page }) => {
    const { tool } = await buildFrom(
      page,
      `<fieldset><legend>Work authorization</legend>
         <label><input type="radio" name="w" value="y"> Yes</label>
         <label><input type="radio" name="w" value="n"> No</label></fieldset>`,
    );
    expect(valueOf(tool, "work_authorization").enum).toEqual(["Yes", "No"]);
  });

  test("a checkbox group becomes an array with an enum on its items", async ({ page }) => {
    const { tool } = await buildFrom(
      page,
      `<fieldset><legend>Tools</legend>
         <label><input type="checkbox" name="t" value="a"> Claude</label>
         <label><input type="checkbox" name="t" value="b"> Cursor</label></fieldset>`,
    );
    const value = valueOf(tool, "tools");
    expect(value.type).toBe("array");
    expect(value.items!.enum).toEqual(["Claude", "Cursor"]);
  });

  test("a component dropdown's harvested options become its enum", async ({ page }) => {
    await load(
      page,
      `<div id="lbl">Seniority</div>
       <div id="t" role="button" aria-haspopup="listbox" aria-labelledby="lbl"
            style="width:180px;height:30px">Choose…</div>
       <script>
         document.getElementById('t').addEventListener('pointerdown', () => {
           if (document.querySelector('.pop')) return;
           const p = document.createElement('div'); p.className = 'pop';
           p.innerHTML = ['Junior','Mid','Senior']
             .map(t => '<div role="option" style="height:20px">' + t + '</div>').join('');
           document.body.appendChild(p);
         });
       </script>`,
    );
    await readDeep(page);
    const tool = (await page.evaluate(() =>
      window.__longtake.buildFillTool(window.__longtake.last!.specs),
    )) as unknown as Tool;
    expect(valueOf(tool, "seniority").enum).toEqual(["Junior", "Mid", "Senior"]);
  });

  test("a dropdown whose choices could not be read gets no enum, and says why", async ({ page }) => {
    await load(page, `<input role="combobox" aria-label="City" style="width:180px;height:24px">`);
    await page.evaluate(() => window.__longtake.inspect());
    const tool = (await page.evaluate(() =>
      window.__longtake.buildFillTool(window.__longtake.last!.specs),
    )) as unknown as Tool;
    const value = valueOf(tool, "city");
    expect(value.enum).toBeUndefined();
    expect(value.description!.toLowerCase()).toContain("could not be read");
  });
});

test.describe("what never reaches the schema", () => {
  test("a suspected trap is not offered to the model at all", async ({ page }) => {
    const { tool } = await buildFrom(
      page,
      `<label for="a">Email</label><input id="a" name="email">
       <label for="b">Website</label><input id="b" name="honeypot">`,
    );
    const names = Object.keys(tool.parameters.properties!);
    expect(names).toContain("email");
    expect(names).toHaveLength(1);
  });

  test("a file upload is not offered, because voice cannot do it", async ({ page }) => {
    const { tool } = await buildFrom(
      page,
      `<label for="a">Email</label><input id="a">
       <label for="b">Resume</label><input id="b" type="file">`,
    );
    expect(Object.keys(tool.parameters.properties!)).toEqual(["email"]);
  });

  test("an empty form produces a tool with no fields rather than a broken one", async ({ page }) => {
    const { tool, problems } = await buildFrom(page, `<p>Nothing here.</p>`);
    expect(Object.keys(tool.parameters.properties!)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("the schema is checked locally, because the API will not check it", () => {
  const pages: [name: string, html: string][] = [
    ["a plain form", `<label for="a">Name</label><input id="a"><label for="b">Email</label><input id="b">`],
    [
      "one with every control type",
      `<label for="a">Text</label><input id="a">
       <label for="b">Number</label><input id="b" type="number">
       <label for="c">Date</label><input id="c" type="date">
       <label for="d">Notes</label><textarea id="d"></textarea>
       <label for="e">Country</label><select id="e"><option>India</option></select>
       <label><input type="checkbox" name="f"> I agree</label>
       <fieldset><legend>Remote</legend>
         <label><input type="radio" name="g" value="y"> Yes</label>
         <label><input type="radio" name="g" value="n"> No</label></fieldset>`,
    ],
    [
      "labels full of punctuation",
      `<label for="a">Are you a veteran / have you served? *</label><input id="a">
       <label for="b">Salary (₹, per year)</label><input id="b">
       <label for="c">"Quoted" &amp; ampersanded</label><input id="c">`,
    ],
    [
      "two fields with the same label",
      `<label>Email <input name="a"></label><label>Email <input name="b"></label>`,
    ],
    [
      "a field with no label at all",
      `<div style="width:300px"><input name=""></div>`,
    ],
    [
      "options containing quotes and commas",
      `<label for="a">Disability</label>
       <select id="a">
         <option>Yes, I have a disability</option>
         <option>No, I don't</option>
         <option>I don't wish to answer</option>
       </select>`,
    ],
  ];

  for (const [name, html] of pages) {
    test(`${name}: the schema validates clean`, async ({ page }) => {
      const { problems } = await buildFrom(page, html);
      expect(problems).toEqual([]);
    });

    test(`${name}: every property name is a plain identifier`, async ({ page }) => {
      const { tool } = await buildFrom(page, html);
      for (const key of Object.keys(tool.parameters.properties!)) {
        expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      }
    });

    test(`${name}: every field declares a type`, async ({ page }) => {
      const { tool } = await buildFrom(page, html);
      for (const spec of Object.values(tool.parameters.properties!)) {
        expect(spec.type).toBe("object");
        expect(spec.properties!.value!.type).toBeTruthy();
      }
    });
  }

  test("the validator actually catches a missing type", async ({ page }) => {
    await load(page, `<label for="a">Name</label><input id="a">`);
    const problems = await page.evaluate(() => {
      const tool = window.__longtake.buildFillTool(window.__longtake.readForm().specs);
      // Break it the way a careless edit would.
      delete (tool.parameters as { type?: string }).type;
      return window.__longtake.validateTool(tool);
    });
    expect(problems.join(" ")).toContain("object");
  });

  test("the validator catches an empty enum", async ({ page }) => {
    await load(page, `<label for="a">Country</label><select id="a"><option>India</option></select>`);
    const problems = await page.evaluate(() => {
      const tool = window.__longtake.buildFillTool(window.__longtake.readForm().specs);
      const value = tool.parameters.properties!.country!.properties!.value!;
      value.enum = [];
      return window.__longtake.validateTool(tool);
    });
    expect(problems.join(" ")).toContain("enum is empty");
  });

  test("the validator catches a duplicated enum entry", async ({ page }) => {
    await load(page, `<label for="a">Country</label><select id="a"><option>India</option></select>`);
    const problems = await page.evaluate(() => {
      const tool = window.__longtake.buildFillTool(window.__longtake.readForm().specs);
      const value = tool.parameters.properties!.country!.properties!.value!;
      value.enum = ["India", "India"];
      return window.__longtake.validateTool(tool);
    });
    expect(problems.join(" ")).toContain("duplicate");
  });

  test("the validator catches a required name that is not defined", async ({ page }) => {
    await load(page, `<label for="a">Name</label><input id="a">`);
    const problems = await page.evaluate(() => {
      const tool = window.__longtake.buildFillTool(window.__longtake.readForm().specs);
      tool.parameters.required = ["not_a_field"];
      return window.__longtake.validateTool(tool);
    });
    expect(problems.join(" ")).toContain("not_a_field");
  });

  test("the validator catches a bad tool name", async ({ page }) => {
    await load(page, `<label for="a">Name</label><input id="a">`);
    const problems = await page.evaluate(() => {
      const tool = window.__longtake.buildFillTool(window.__longtake.readForm().specs);
      tool.name = "Fill Fields";
      return window.__longtake.validateTool(tool);
    });
    expect(problems.join(" ")).toContain("snake_case");
  });
});

test.describe("the form briefing that goes in the system prompt", () => {
  test("it names every usable field", async ({ page }) => {
    await load(
      page,
      `<label for="a">First name</label><input id="a">
       <label for="b">Email</label><input id="b">`,
    );
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief).toContain("First name");
    expect(brief).toContain("Email");
  });

  test("it marks which fields the form requires", async ({ page }) => {
    await load(page, `<label for="a">Email</label><input id="a" required>`);
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief).toContain("(required)");
  });

  test("it lists the choices for a dropdown", async ({ page }) => {
    await load(
      page,
      `<label for="a">Country</label><select id="a"><option>India</option><option>Nepal</option></select>`,
    );
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief).toContain("India, Nepal");
  });

  test("a long option list is truncated rather than flooding the prompt", async ({ page }) => {
    const options = Array.from({ length: 30 }, (_, i) => `<option>Option ${i}</option>`).join("");
    await load(page, `<label for="a">Many</label><select id="a">${options}</select>`);
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief).toContain("…");
    expect(brief.length).toBeLessThan(600);
  });

  test("a trap is not mentioned to the agent either", async ({ page }) => {
    await load(
      page,
      `<label for="a">Email</label><input id="a">
       <label for="b">Website</label><input id="b" name="honeypot">`,
    );
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief).not.toContain("Website");
  });

  test("an empty page says so plainly", async ({ page }) => {
    await load(page, `<p>Nothing.</p>`);
    await readDeep(page);
    const brief = await page.evaluate(() =>
      window.__longtake.describeForm(window.__longtake.last!.specs),
    );
    expect(brief.toLowerCase()).toContain("no form");
  });
});

test.describe("what is still missing, for the ask-back", () => {
  const FORM = `
    <label for="a">First name</label><input id="a" required>
    <label for="b">Email</label><input id="b" required>
    <label for="c">Middle name</label><input id="c">`;

  test("required fields nobody answered are reported", async ({ page }) => {
    await load(page, FORM);
    await readDeep(page);
    const missing = await page.evaluate(() =>
      window.__longtake.stillMissing(window.__longtake.last!.specs, []).map((s) => s.id),
    );
    expect(missing.sort()).toEqual(["email", "first_name"]);
  });

  test("an answered field drops off the list", async ({ page }) => {
    await load(page, FORM);
    await readDeep(page);
    const missing = await page.evaluate(() =>
      window.__longtake.stillMissing(window.__longtake.last!.specs, ["first_name"]).map((s) => s.id),
    );
    expect(missing).toEqual(["email"]);
  });

  test("optional fields are never chased", async ({ page }) => {
    await load(page, FORM);
    await readDeep(page);
    const missing = await page.evaluate(() =>
      window.__longtake.stillMissing(window.__longtake.last!.specs, []).map((s) => s.id),
    );
    expect(missing).not.toContain("middle_name");
  });

  test("a required trap is never chased either", async ({ page }) => {
    await load(page, `<label for="a">Website</label><input id="a" name="honeypot" required>`);
    await readDeep(page);
    const missing = await page.evaluate(() =>
      window.__longtake.stillMissing(window.__longtake.last!.specs, []).map((s) => s.id),
    );
    expect(missing).toEqual([]);
  });

  test("nothing missing when everything required is answered", async ({ page }) => {
    await load(page, FORM);
    await readDeep(page);
    const missing = await page.evaluate(() =>
      window.__longtake
        .stillMissing(window.__longtake.last!.specs, ["first_name", "email"])
        .map((s) => s.id),
    );
    expect(missing).toEqual([]);
  });
});

// Jotform's phone boxes say "Format: (000) 000-0000." under the box. The agent is told, so the
// answer arrives in the shape the form asks for.
test("the help the page gives for a field goes to the agent with it", async ({ page }) => {
  const { tool } = await buildFrom(
    page,
    `<label for="p">Phone Number</label><input id="p" type="tel" aria-describedby="h"><span id="h">Format: (000) 000-0000.</span>`,
  );
  expect(field(tool, "phone_number").description).toContain('the form adds: "Format: (000) 000-0000."');
});

// Each tool says when to use it, in its own description, and the persona does not repeat it.
// Short enough that the model reads all of it.
test("every tool's description is at most 600 characters", async ({ page }) => {
  await load(page, `<label for="a">First name</label><input id="a"><button type="button">Add another</button>`);
  const lengths = await page.evaluate(() => {
    const s = new window.__longtake.LongtakeSession({ root: () => document, ignore: "" });
    return s.tools().map((tool) => [tool.name, tool.description.length] as const);
  });
  for (const [name, length] of lengths) expect(length, name).toBeLessThanOrEqual(600);
  expect(lengths.map(([name]) => name)).toEqual(expect.arrayContaining(["fill_fields", "confirm_answer", "clear_fields", "skip_for_now", "save_for_next_time"]));
});
