import { expect, test } from "@playwright/test";
import { load, read, readThenWrite, valueOf, write } from "./helpers";

/**
 * Choosing among the options a page actually offers.
 *
 * The rule underneath all of it: **never guess.** If the spoken words do not clearly pick one of
 * the page's own choices, the field is left alone and the agent asks. Quietly taking the first
 * option is how a form ends up claiming someone attended a university they have never seen, or
 * worked somewhere they never worked — and they are about to put their name on it.
 */

const said = (fieldId: string, value: unknown) => [
  { fieldId, value, evidence: "the person said so" },
];

const COUNTRY = `
  <label for="f">Country</label>
  <select id="f">
    <option value="">Select…</option>
    <option value="in">India</option>
    <option value="us">United States</option>
    <option value="gb">United Kingdom</option>
  </select>`;

test.describe("native select", () => {
  test("matches an option by its visible label", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "India"));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#f")).toBe("in");
  });

  test("matches an option by its submitted value", async ({ page }) => {
    await load(page, COUNTRY);
    await readThenWrite(page, said("country", "gb"));
    expect(await valueOf(page, "#f")).toBe("gb");
  });

  test("matching ignores case", async ({ page }) => {
    await load(page, COUNTRY);
    await readThenWrite(page, said("country", "INDIA"));
    expect(await valueOf(page, "#f")).toBe("in");
  });

  test("matching ignores punctuation and spacing", async ({ page }) => {
    await load(page, COUNTRY);
    await readThenWrite(page, said("country", "united-states"));
    expect(await valueOf(page, "#f")).toBe("us");
  });

  test("a unique partial match is accepted", async ({ page }) => {
    await load(page, COUNTRY);
    await readThenWrite(page, said("country", "United Kingdom of Great Britain"));
    expect(await valueOf(page, "#f")).toBe("gb");
  });

  test("an AMBIGUOUS partial match is refused rather than guessed", async ({ page }) => {
    // "United" is inside both United States and United Kingdom. Two candidates means we do not
    // know, and the agent has to ask.
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "United"));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("a word the form does not offer is refused", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "Atlantis"));
    expect(outcome!.status).toBe("refused");
    expect(outcome!.reason).toMatch(/not one of the choices/i);
  });

  /**
   * A refusal that does not say what WOULD be accepted is not recoverable.
   *
   * Measured on a live run: the form offered Conference / Job Board / LinkedIn / Podcast, the
   * person said "I heard from X", and the agent asked "How did you hear about Glean?" three
   * times in a row — because all it was ever told was that the answer did not match. The field
   * ended the session empty. So the options travel with the refusal, both as a sentence the
   * agent can read out and as a list it can use as data.
   */
  test("the refusal carries the options, so the agent can read them out", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "Atlantis"));

    expect(outcome!.reason).toContain("India");
    expect(outcome!.reason).toContain("United States");
    expect(outcome!.choices).toEqual(["India", "United States", "United Kingdom"]);
  });

  /**
   * "Select…" is an option element and not an answer. Reading it out as one makes the agent
   * sound broken, and matching it would silently write the empty placeholder into the field.
   */
  test("the placeholder option is not offered as a choice", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "Atlantis"));
    expect(outcome!.reason).not.toContain("Select");
  });

  test("a refusal leaves the select on its original value", async ({ page }) => {
    await load(page, COUNTRY);
    await readThenWrite(page, said("country", "Atlantis"));
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("a refusal NEVER falls back to the first option", async ({ page }) => {
    // The specific failure this guards against: a school or employer dropdown quietly
    // answering itself with whatever happened to be at the top of the list.
    const SCHOOL = `
      <label for="f">Where did you study?</label>
      <select id="f">
        <option value="">Select…</option>
        <option value="mit">MIT</option>
        <option value="ox">Oxford</option>
      </select>`;
    await load(page, SCHOOL);
    const [outcome] = await readThenWrite(page, said("where_did_you_study", "a college in Kolkata"));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("a select with no blank option is left exactly as the page had it", async ({ page }) => {
    /**
     * ⚠️ A `<select>` whose first option is a real answer already *has* that answer before
     * anybody speaks — the browser selects it by default, and the form will submit it. So
     * "Where did you study? → MIT" is what this page says about a person who has said nothing.
     *
     * That is the page's doing, not ours, and Longtake must not make it worse by writing over
     * it with a guess. What it should do is notice and ask, which belongs to the ask-back in
     * Phase 4. This test pins the half we control: we change nothing.
     */
    await load(
      page,
      `<label for="f">Where did you study?</label>
       <select id="f"><option value="mit">MIT</option><option value="ox">Oxford</option></select>`,
    );
    const before = await valueOf(page, "#f");
    const [outcome] = await readThenWrite(page, said("where_did_you_study", "a college in Kolkata"));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe(before);
  });

  test("an empty spoken value is refused rather than selecting the blank option", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", ""));
    expect(outcome!.status).toBe("refused");
  });

  test("the outcome reports the label a person would recognise, not the value code", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, said("country", "in"));
    expect(outcome!.wrote).toBe("India");
  });

  test("a change event is fired so the page reacts", async ({ page }) => {
    await load(
      page,
      `${COUNTRY}<div id="heard">no</div>
       <script>document.getElementById('f').addEventListener('change', () => {
         document.getElementById('heard').textContent = 'yes';
       });</script>`,
    );
    await readThenWrite(page, said("country", "India"));
    expect(await page.textContent("#heard")).toBe("yes");
  });
});

test.describe("radio groups", () => {
  const AUTH = `
    <fieldset><legend>Work authorization</legend>
      <label><input type="radio" name="auth" value="yes"> Yes, I am authorized</label>
      <label><input type="radio" name="auth" value="no"> No, I need sponsorship</label>
      <label><input type="radio" name="auth" value="na"> Prefer not to say</label>
    </fieldset>`;

  test("a radio group is one field, not three", async ({ page }) => {
    await load(page, AUTH);
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("the group carries every option", async ({ page }) => {
    await load(page, AUTH);
    expect((await read(page)).specs[0]!.options).toHaveLength(3);
  });

  test("selecting by label checks the right radio", async ({ page }) => {
    await load(page, AUTH);
    const [outcome] = await readThenWrite(page, said("work_authorization", "No, I need sponsorship"));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, 'input[value="no"]')).toBe("checked");
  });

  test("selecting by value works too", async ({ page }) => {
    await load(page, AUTH);
    await readThenWrite(page, said("work_authorization", "yes"));
    expect(await valueOf(page, 'input[value="yes"]')).toBe("checked");
  });

  test("the other radios stay unchecked", async ({ page }) => {
    await load(page, AUTH);
    await readThenWrite(page, said("work_authorization", "yes"));
    expect(await valueOf(page, 'input[value="no"]')).toBe("unchecked");
    expect(await valueOf(page, 'input[value="na"]')).toBe("unchecked");
  });

  test("an unmatched answer leaves the whole group untouched", async ({ page }) => {
    await load(page, AUTH);
    const [outcome] = await readThenWrite(page, said("work_authorization", "it is complicated"));
    expect(outcome!.status).toBe("refused");
    for (const value of ["yes", "no", "na"]) {
      expect(await valueOf(page, `input[value="${value}"]`)).toBe("unchecked");
    }
  });

  test("a change event fires on the chosen radio", async ({ page }) => {
    await load(
      page,
      `${AUTH}<div id="heard">no</div>
       <script>document.querySelector('input[value="yes"]').addEventListener('change', () => {
         document.getElementById('heard').textContent = 'yes';
       });</script>`,
    );
    await readThenWrite(page, said("work_authorization", "yes"));
    expect(await page.textContent("#heard")).toBe("yes");
  });

  test("two separate radio groups stay separate", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Relocate</legend>
         <label><input type="radio" name="reloc" value="y"> Yes</label>
         <label><input type="radio" name="reloc" value="n"> No</label>
       </fieldset>
       <fieldset><legend>Remote</legend>
         <label><input type="radio" name="remote" value="y"> Yes</label>
         <label><input type="radio" name="remote" value="n"> No</label>
       </fieldset>`,
    );
    const result = await read(page);
    expect(result.specs).toHaveLength(2);
    await readThenWrite(page, said("relocate", "Yes"));
    expect(await valueOf(page, 'input[name="reloc"][value="y"]')).toBe("checked");
    expect(await valueOf(page, 'input[name="remote"][value="y"]')).toBe("unchecked");
  });
});

test.describe("checkboxes", () => {
  const CONSENT = `<label><input type="checkbox" id="c" name="consent"> I agree to the privacy policy</label>`;

  const yeses = ["yes", "Yes", "true", "agree", "I agree", "accept", "haan"];
  for (const word of yeses) {
    test(`"${word}" ticks the box`, async ({ page }) => {
      await load(page, CONSENT);
      await readThenWrite(page, said("i_agree_to_the_privacy_policy", word));
      expect(await valueOf(page, "#c")).toBe("checked");
    });
  }

  const noes = ["no", "No", "false", "nahi", "decline"];
  for (const word of noes) {
    test(`"${word}" leaves the box unticked`, async ({ page }) => {
      await load(page, CONSENT);
      await readThenWrite(page, said("i_agree_to_the_privacy_policy", word));
      expect(await valueOf(page, "#c")).toBe("unchecked");
    });
  }

  test("a real boolean true ticks the box", async ({ page }) => {
    await load(page, CONSENT);
    await readThenWrite(page, said("i_agree_to_the_privacy_policy", true));
    expect(await valueOf(page, "#c")).toBe("checked");
  });

  test("a real boolean false unticks it", async ({ page }) => {
    await load(page, `<label><input type="checkbox" id="c" name="consent" checked> I agree</label>`);
    await readThenWrite(page, said("i_agree", false));
    expect(await valueOf(page, "#c")).toBe("unchecked");
  });

  test("ticking an already-ticked box is safe to repeat", async ({ page }) => {
    await load(page, `<label><input type="checkbox" id="c" name="consent" checked> I agree</label>`);
    const [outcome] = await readThenWrite(page, said("i_agree", "yes"));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#c")).toBe("checked");
  });

  test("a change event fires", async ({ page }) => {
    await load(
      page,
      `${CONSENT}<div id="heard">no</div>
       <script>document.getElementById('c').addEventListener('change', () => {
         document.getElementById('heard').textContent = 'yes';
       });</script>`,
    );
    await readThenWrite(page, said("i_agree_to_the_privacy_policy", "yes"));
    expect(await page.textContent("#heard")).toBe("yes");
  });
});

test.describe("checkbox groups sharing a name", () => {
  const TOOLS = `
    <fieldset><legend>Which tools have you used?</legend>
      <label><input type="checkbox" name="tools" value="claude"> Claude</label>
      <label><input type="checkbox" name="tools" value="cursor"> Cursor</label>
      <label><input type="checkbox" name="tools" value="copilot"> Copilot</label>
    </fieldset>`;

  test("a checkbox group is one field", async ({ page }) => {
    await load(page, TOOLS);
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("it is a multiselect", async ({ page }) => {
    await load(page, TOOLS);
    expect((await read(page)).specs[0]!.kind).toBe("multiselect");
  });

  test("several answers tick several boxes", async ({ page }) => {
    await load(page, TOOLS);
    await readThenWrite(page, said("which_tools_have_you_used", ["Claude", "Cursor"]));
    expect(await valueOf(page, '[value="claude"]')).toBe("checked");
    expect(await valueOf(page, '[value="cursor"]')).toBe("checked");
  });

  test("boxes not spoken to stay unticked", async ({ page }) => {
    await load(page, TOOLS);
    await readThenWrite(page, said("which_tools_have_you_used", ["Claude"]));
    expect(await valueOf(page, '[value="copilot"]')).toBe("unchecked");
  });

  test("one unmatched name among several does not sink the rest", async ({ page }) => {
    await load(page, TOOLS);
    const [outcome] = await readThenWrite(
      page,
      said("which_tools_have_you_used", ["Claude", "Emacs"]),
    );
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, '[value="claude"]')).toBe("checked");
  });

  test("no matches at all is refused", async ({ page }) => {
    await load(page, TOOLS);
    const [outcome] = await readThenWrite(page, said("which_tools_have_you_used", ["Emacs", "Vim"]));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, '[value="claude"]')).toBe("unchecked");
  });

  test("a single string is accepted as well as an array", async ({ page }) => {
    await load(page, TOOLS);
    await readThenWrite(page, said("which_tools_have_you_used", "Copilot"));
    expect(await valueOf(page, '[value="copilot"]')).toBe("checked");
  });
});

/**
 * The choice the person named, recovered from their own words.
 *
 * Live run: "I'm based Kolkata, India." Glean has no City box, so the agent put "Kolkata" into
 * Country, the form rightly refused it, and the agent told the person "India is not an option" —
 * about an option that was on the list, that the person had said, inside the agent's own quote.
 */
test.describe("a choice named in what was said", () => {
  const spoke = (value: string, evidence: string) => [{ fieldId: "country", value, evidence }];

  test("a wrong value is rescued by the option the person actually named", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, spoke("Kolkata", "I'm based Kolkata, India"));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#f")).toBe("in");
  });

  test("only a whole word counts — 'Indian' does not name India", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, spoke("Mumbai", "I love Indian food"));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("two options named is not a choice — nothing is picked", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, spoke("Europe", "India or the United Kingdom, not sure"));
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("naming nothing on the list is still refused, with the choices", async ({ page }) => {
    await load(page, COUNTRY);
    const [outcome] = await readThenWrite(page, spoke("Twitter", "I heard from Twitter"));
    expect(outcome!.status).toBe("refused");
    expect(outcome!.choices).toContain("India");
  });

  test("a radio group is rescued the same way", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Willing to relocate?</legend>
         <label><input type="radio" name="r" value="yes"> Yes</label>
         <label><input type="radio" name="r" value="no"> No</label>
       </fieldset>`,
    );
    const r = await read(page);
    const [outcome] = await write(page, [
      { fieldId: r.specs[0]!.id, value: "sure thing", evidence: "yes, happy to move" },
    ]);
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "input[value=yes]")).toBe("checked");
  });

  test("a group of checkboxes is not guessed from the words", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Industry</legend>
         <label><input type="checkbox" name="i" value="Film"> Film</label>
         <label><input type="checkbox" name="i" value="Stage"> Stage</label>
       </fieldset>`,
    );
    const r = await read(page);
    const [outcome] = await write(page, [
      { fieldId: r.specs[0]!.id, value: "movies", evidence: "mostly Film work" },
    ]);
    expect(outcome!.status).toBe("refused");
  });
});

/**
 * Jotform's "Other": `industry[]` and `industry[other]` are one array on the server and one
 * question on the page. Read by the name alone, "Other" was a field of its own, and the group
 * could never be answered with it.
 */
test.describe("an array-named group and its Other", () => {
  const INDUSTRY = `
    <div role="group" aria-labelledby="q"><span id="q">Industry</span>
      <label><input type="checkbox" name="industry[]" value="Performing Arts"> Performing Arts</label>
      <label><input type="checkbox" name="industry[]" value="Motion Picture"> Motion Picture</label>
      <label><input type="checkbox" name="industry[other]" value="other"> Other</label>
    </div>`;

  test("is one field with every choice, Other included", async ({ page }) => {
    await load(page, INDUSTRY);
    const { specs } = await read(page);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.label).toBe("Industry");
    expect(specs[0]!.options!.map((o) => o.label)).toEqual(["Performing Arts", "Motion Picture", "Other"]);
  });

  test("Other can be ticked through it", async ({ page }) => {
    await load(page, INDUSTRY);
    const [outcome] = await readThenWrite(page, [{ fieldId: "industry", value: ["Other"], evidence: "other" }]);
    expect(outcome!.status).toBe("written");
    expect(await page.isChecked("input[name='industry[other]']")).toBe(true);
    expect(await page.isChecked("input[value='Motion Picture']")).toBe(false);
  });

  test("two questions that only share an array prefix stay two", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Terms</legend><label><input type="checkbox" name="user[terms]"> I accept the terms</label></fieldset>
       <fieldset><legend>News</legend><label><input type="checkbox" name="user[news]"> Send me news</label></fieldset>`,
    );
    expect((await read(page)).specs).toHaveLength(2);
  });

  test("array names outside any named group are not joined", async ({ page }) => {
    await load(
      page,
      `<label><input type="checkbox" name="prefs[email]"> Email me</label>
       <label><input type="checkbox" name="prefs[sms]"> Text me</label>`,
    );
    expect((await read(page)).specs).toHaveLength(2);
  });
});

/**
 * A native <select multiple> — USDA QuickStats has seven. It fell into the checkbox-group path,
 * found no checkboxes, and reported "written" with nothing chosen: the agent said it was in.
 */
test.describe("a native <select multiple>", () => {
  const LIST = `<label for="c">Commodity</label>
    <select id="c" name="commodity" multiple size="4"><option>CORN</option><option>WHEAT</option><option>RICE</option></select>`;
  const selected = (page: import("@playwright/test").Page) =>
    page.evaluate(() => Array.from((document.getElementById("c") as HTMLSelectElement).selectedOptions).map((o) => o.textContent));

  test("the choices are really selected, and only then called written", async ({ page }) => {
    await load(page, LIST);
    const [outcome] = await readThenWrite(page, [{ fieldId: "commodity", value: ["WHEAT", "RICE"], evidence: "wheat and rice" }]);
    expect(outcome!.status).toBe("written");
    expect(await selected(page)).toEqual(["WHEAT", "RICE"]);
  });

  test("an answer replaces what was picked before", async ({ page }) => {
    await load(page, LIST);
    await page.selectOption("#c", ["CORN"]);
    await readThenWrite(page, [{ fieldId: "commodity", value: ["RICE"], evidence: "just rice" }]);
    expect(await selected(page)).toEqual(["RICE"]);
  });

  test("it can be emptied", async ({ page }) => {
    await load(page, LIST);
    await page.selectOption("#c", ["CORN", "WHEAT"]);
    const result = await page.evaluate(async () => {
      const core = window.__longtake;
      const read = core.readForm();
      return core.clearValues(read.specs, read.handles, ["commodity"]);
    });
    expect((result as { status: string }[])[0]!.status).toBe("cleared");
    expect(await selected(page)).toEqual([]);
  });
});

test.describe("a checkbox group is read back after it is pressed", () => {
  test("a box the page will not let be ticked is not reported as written", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Tools</legend>
         <label><input type="checkbox" name="tools" value="claude"> Claude</label>
         <label><input type="checkbox" name="tools" value="cursor" onclick="return false"> Cursor</label>
       </fieldset>`,
    );
    const [outcome] = await readThenWrite(page, [{ fieldId: "tools", value: ["Cursor"], evidence: "cursor" }]);
    expect(outcome!.status).toBe("rejected-by-page");
  });
});
