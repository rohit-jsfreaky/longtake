/**
 * The buttons that are not answers: "Add another", "Next" — and Submit, which is never pressed.
 *
 * Real forms have more than one page and sections that repeat. Longtake presses Next and Add
 * another when the person asks, and nothing on this page can make it press a button that sends
 * the form: it is never offered, never in the tool, and re-checked at the moment of pressing.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

test.describe("telling buttons apart", () => {
  const cases: [string, string | null][] = [
    ["Submit Application", "submit"],
    ["Apply", "submit"],
    ["Send", "submit"],
    ["Continue to payment", "submit"],
    ["Next", "next"],
    ["Continue", "next"],
    ["Save & Continue", "next"],
    ["Add another", "add-another"],
    ["+ Add", "add-another"],
    ["Add education", "add-another"],
    ["Back", null],
    ["Cancel", null],
  ];
  for (const [words, kind] of cases) {
    test(`"${words}" is ${kind ?? "not ours to press"}`, async ({ page }) => {
      await load(page, "<p>no form</p>");
      expect(await page.evaluate((w) => window.__longtake.classify(w), words)).toBe(kind);
    });
  }

  test("a submit button is never offered as an action — only named", async ({ page }) => {
    await load(
      page,
      `<button>Add another</button><button>Next</button><button type="submit">Submit Application</button>`,
    );
    const read = await page.evaluate(() => {
      const r = window.__longtake.readActions(document);
      return { kinds: r.actions.map((a) => a.kind), submitLabel: r.submitLabel };
    });
    expect(read.kinds).toEqual(["add-another", "next"]);
    expect(read.submitLabel).toBe("Submit Application");
  });

  test("the press tool never contains a submit button", async ({ page }) => {
    await load(page, `<button>Next</button><button>Submit</button>`);
    const tool = await page.evaluate(() => {
      const L = window.__longtake;
      return L.buildPressTool(L.readActions(document).actions);
    });
    expect(tool!.parameters.properties!.action!.enum).toEqual(["next_next"]);
    expect(JSON.stringify(tool)).not.toMatch(/submit"/i);
  });

  test("no buttons, no tool", async ({ page }) => {
    await load(page, `<label for="a">Name</label><input id="a">`);
    const tool = await page.evaluate(() => window.__longtake.buildPressTool(window.__longtake.readActions(document).actions));
    expect(tool).toBeNull();
  });

  /** A multi-step form's Next often says "Submit" on the last step. Checked again at the press. */
  test("a Next that has turned into Submit is refused at the moment of pressing", async ({ page }) => {
    await load(page, `<button id="b">Next</button><div id="sent">no</div>
      <script>document.getElementById('b').addEventListener('click', () => { document.getElementById('sent').textContent = 'SENT'; });</script>`);
    const result = await page.evaluate(() => {
      const L = window.__longtake;
      const read = L.readActions(document);
      document.getElementById("b")!.textContent = "Submit"; // the page renamed it
      return L.pressAction(read.handles.get(read.actions[0]!.id)!);
    });
    expect(result.pressed).toBe(false);
    expect(await page.textContent("#sent")).toBe("no");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-step form that swaps its fields in place, and whose button says Submit on the last step. */
const TWO_STEPS = `
  <form onsubmit="event.preventDefault()">
    <h3>Volunteer sign-up</h3>
    <div id="step1">
      <label for="n">Full name</label><input id="n" required>
      <label for="e">Email</label><input id="e" type="email" required>
    </div>
    <div id="step2" style="display:none">
      <label for="c">City</label><input id="c" required>
      <label for="w">Why do you want to volunteer?</label><textarea id="w"></textarea>
    </div>
    <button type="button" id="go">Next</button>
    <div id="sent">not sent</div>
  </form>
  <script>
    const go = document.getElementById('go');
    go.addEventListener('click', () => {
      if (go.textContent === 'Next') {
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = '';
        go.textContent = 'Submit';
      } else {
        document.getElementById('sent').textContent = 'SENT';
      }
    });
  </script>`;

async function session(page: Page, body: string) {
  await load(page, body);
  await page.evaluate(async () => {
    const L = window.__longtake;
    let mem = {} as never;
    const reshapes: number[] = [];
    const s = new L.LongtakeSession({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      memory: { load: () => mem, save: (m) => { mem = m as never; } },
      onReshape: () => reshapes.push(1),
    });
    await s.open();
    Object.assign(window, { __s: s, __reshapes: reshapes });
  });
}

type S = InstanceType<typeof window.__longtake.LongtakeSession>;

test.describe("a form with more than one page", () => {
  test("when the page is done, the next move is to offer the next page", async ({ page }) => {
    await session(page, TWO_STEPS);
    const next = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      const r = await s.fill(
        { full_name: { value: "Rohit Kashyap", evidence: "Rohit Kashyap" }, email: { value: "rohit@example.com", evidence: "rohit@example.com" } },
        "Rohit Kashyap rohit@example.com",
      );
      return String(r.result.do_next);
    });
    expect(next).toContain('press "Next" with press_form_button only on their yes');
  });

  test("pressing Next brings the second page's questions into the form state and the tools", async ({ page }) => {
    await session(page, TWO_STEPS);
    const after = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      await s.fill(
        { full_name: { value: "Rohit Kashyap", evidence: "Rohit Kashyap" }, email: { value: "rohit@example.com", evidence: "rohit@example.com" } },
        "Rohit Kashyap rohit@example.com",
      );
      const r = await s.press({ action: "next_next", evidence: "yes next page" }, "Rohit Kashyap rohit@example.com\nyes next page");
      return {
        result: r.result,
        fields: s.state().fields.map((f) => f.spec.id),
        tools: s.tools().map((t) => t.name),
        reshapes: (window as unknown as { __reshapes: number[] }).__reshapes.length,
      };
    });
    expect(after.result.pressed).toBe("Next");
    expect(after.fields).toContain("city");
    expect(after.fields).not.toContain("full_name");
    expect(String(after.result.do_next)).toContain("Ask for City");
    // The button now says Submit: no press tool left to offer, and the agent was re-briefed.
    expect(after.tools).not.toContain("press_form_button");
    expect(after.reshapes).toBeGreaterThan(0);
  });

  test("on the last page the hand-over names the submit button, and nothing is sent", async ({ page }) => {
    await session(page, TWO_STEPS);
    const last = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      await s.fill(
        { full_name: { value: "Rohit", evidence: "Rohit" }, email: { value: "rohit@example.com", evidence: "rohit@example.com" } },
        "Rohit rohit@example.com",
      );
      await s.press({ action: "next_next", evidence: "next page" }, "Rohit rohit@example.com\nnext page");
      const r = await s.fill({ city: { value: "Kolkata", evidence: "Kolkata" } }, "Rohit rohit@example.com\nnext page\nKolkata");
      // they decline the optional question
      return String((await s.fill({}, "no thanks")).result.do_next) + " || " + String(r.result.do_next);
    });
    expect(last).toContain('press "Submit" themselves');
    expect(await page.textContent("#sent")).toBe("not sent");
  });

  test("asking to press a button that is not there is refused", async ({ page }) => {
    await session(page, TWO_STEPS);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.press({ action: "submit_submit", evidence: "submit it" }, "submit it")).result;
    });
    expect(r.not_pressed).toBeTruthy();
    expect(await page.textContent("#sent")).toBe("not sent");
  });

  test("pressing needs the person's own words", async ({ page }) => {
    await session(page, TWO_STEPS);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.press({ action: "next_next", evidence: "go ahead to the next one" }, "my name is Rohit")).result;
    });
    expect(r.not_pressed).toBe("quote_not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

/** Education that repeats, the way Greenhouse builds it: "Add another" appends a second block. */
const EDUCATION = `
  <h3>Application</h3>
  <label for="fn">First Name</label><input id="fn" required>
  <h4>Education</h4>
  <div id="edu">
    <div class="entry"><label for="s0">School</label><input id="s0"><label for="d0">Degree</label><input id="d0"></div>
  </div>
  <button type="button" id="add">Add another</button>
  <button type="submit">Submit Application</button>
  <script>
    let n = 1;
    document.getElementById('add').addEventListener('click', () => {
      const i = n++;
      const div = document.createElement('div');
      div.className = 'entry';
      div.innerHTML = '<label for="s' + i + '">School</label><input id="s' + i + '"><label for="d' + i + '">Degree</label><input id="d' + i + '">';
      document.getElementById('edu').appendChild(div);
    });
  </script>`;

test.describe("a section that repeats", () => {
  test("'I also studied at…' — Add another is pressed, and the new entry can be filled", async ({ page }) => {
    await session(page, EDUCATION);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      const heard = "I studied at IIT Kharagpur, BTech. Also add another school";
      await s.fill(
        { school: { value: "IIT Kharagpur", evidence: "I studied at IIT Kharagpur" }, degree: { value: "BTech", evidence: "BTech" } },
        heard,
      );
      const pressed = await s.press({ action: "add_add_another", evidence: "add another school" }, heard);
      const ids = s.state().fields.map((f) => f.spec.id);
      const second = ids.find((id) => /school/.test(id) && id !== "school")!;
      const filled = await s.fill({ [second]: { value: "Delhi Public School", evidence: "Delhi Public School" } }, heard + "\nDelhi Public School");
      return { pressed: pressed.result, ids, second, filled: filled.result.just_filled };
    });
    expect(r.pressed.pressed).toBe("Add another");
    expect(r.ids.filter((id) => /school/.test(id))).toHaveLength(2);
    expect(await page.inputValue("#s1")).toBe("Delhi Public School");
    expect(await page.inputValue("#s0")).toBe("IIT Kharagpur"); // the first entry untouched
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Greenhouse's School picker, as it behaves live (2026-09-23): opens on a first page of sixty-odd
 * schools, and searches the WHOLE string — "IIT Kharagpur" finds nothing, "Kharagpur" finds it.
 */
const SCHOOL_PICKER = `
  <h3>Education</h3>
  <div id="edu">
    <div class="entry"><label id="s0l" for="s0">School</label>
      <div class="box"><div class="value">Select...</div><input id="s0" role="combobox" aria-autocomplete="list" aria-labelledby="s0l"></div>
    </div>
  </div>
  <button type="button" id="add">Add another</button>
  <script>
    const FIRST_PAGE = Array.from({ length: 60 }, (_, i) => 'Aalto Campus ' + (i + 1));
    const ALL = [...FIRST_PAGE, 'Indian Institute of Technology Kharagpur (IITKGP)', 'Indian Institute of Technology Delhi (IITD)', 'University of Delhi', 'Public Health Institute'];
    let menu = null;
    function show(input, list) {
      menu?.remove(); menu = null;
      if (!list.length) return;
      menu = document.createElement('ul'); menu.setAttribute('role', 'listbox');
      for (const name of list) {
        const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = name;
        li.addEventListener('mousedown', () => { input.previousElementSibling.textContent = name; input.value = ''; show(input, []); });
        menu.appendChild(li);
      }
      document.body.appendChild(menu);
    }
    function wire(input) {
      input.addEventListener('mousedown', () => show(input, input.value ? [] : FIRST_PAGE));
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase(); show(input, []);
        setTimeout(() => { if (input.value.toLowerCase() === q) show(input, q ? ALL.filter((s) => s.toLowerCase().includes(q)) : FIRST_PAGE); }, 150);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(input, []); });
    }
    wire(document.getElementById('s0'));
    let n = 1;
    document.getElementById('add').addEventListener('click', () => {
      const i = n++;
      const div = document.createElement('div'); div.className = 'entry';
      div.innerHTML = '<label id="s' + i + 'l" for="s' + i + '">School</label><div class="box"><div class="value">Select...</div><input id="s' + i + '" role="combobox" aria-autocomplete="list" aria-labelledby="s' + i + 'l"></div>';
      document.getElementById('edu').appendChild(div);
      wire(div.querySelector('input'));
    });
  </script>`;

test.describe("a long picker you type into", () => {
  test("is searched, not read as a fixed list — and never becomes an enum", async ({ page }) => {
    await session(page, SCHOOL_PICKER);
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __s: S }).__s;
      const spec = s.state().fields[0]!.spec;
      // Wherever the value's schema sits, no enum anywhere in this field's part of the tool.
      const field = JSON.stringify(s.tools()[0]!.parameters.properties![spec.id]);
      return { searchable: spec.searchable, enum: field.includes('"enum"') ? field : null };
    });
    expect(r.searchable).toBe(true);
    expect(r.enum).toBeNull();
  });

  test("'IIT Kharagpur' is found by searching 'Kharagpur', because every word they said is in it", async ({ page }) => {
    await session(page, SCHOOL_PICKER);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ school: { value: "IIT Kharagpur", evidence: "IIT Kharagpur" } }, "I went to IIT Kharagpur")).result;
    });
    expect(JSON.stringify(r.just_filled)).toContain("Indian Institute of Technology Kharagpur (IITKGP)");
    expect(await page.textContent(".value")).toBe("Indian Institute of Technology Kharagpur (IITKGP)");
  });

  test("a word search never lands on a result missing the rest of what they said", async ({ page }) => {
    await session(page, SCHOOL_PICKER);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      // "Public" alone finds "Public Health Institute" — which is not Delhi Public School.
      return (await s.fill({ school: { value: "Delhi Public School", evidence: "Delhi Public School" } }, "Delhi Public School")).result;
    });
    expect(r.just_filled).toEqual([]);
    expect(await page.textContent(".value")).toBe("Select...");
  });

  test("still searchable after Add another re-reads the form", async ({ page }) => {
    await session(page, SCHOOL_PICKER);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      await s.press({ action: "add_add_another", evidence: "add another school" }, "add another school");
      return { searchable: s.state().fields.map((f) => f.spec.searchable), prompt: s.prompt() };
    });
    expect(r.searchable).toEqual([true, true]);
    expect(r.prompt).not.toContain("options; ask them to look at the list");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Google Forms, as it renders (read off a live form on 2026-09-23): no <label for> anywhere, the
 * required mark only an asterisk on the heading, a date box labelled just "Date", choices as
 * div role="radio", and a Next that stays put — with "This is a required question" — when a
 * required question is empty.
 */
const GOOGLE_FORM = `
  <div role="list" id="page">
    <div role="listitem">
      <div role="heading" aria-level="3" id="h1"><span>First Name</span><span aria-label="Required question"> *</span></div>
      <input type="text" aria-labelledby="h1" aria-describedby="a1"><div id="a1" role="alert"></div>
    </div>
    <div role="listitem">
      <div role="heading" aria-level="3" id="h2"><span>Date of Birth</span><span aria-label="Required question"> *</span></div>
      <div aria-labelledby="h2"><div id="d2">Date</div><input type="date" aria-labelledby="d2"></div>
    </div>
    <div role="listitem">
      <div role="heading" aria-level="3" id="h3"><span>Gender</span><span aria-label="Required question"> *</span></div>
      <div role="radiogroup" aria-labelledby="h3" aria-required="true" aria-describedby="a3">
        <label><div role="radio" aria-label="Male" data-value="Male" aria-checked="false" tabindex="0"></div><span>Male</span></label>
        <label><div role="radio" aria-label="Female" data-value="Female" aria-checked="false" tabindex="0"></div><span>Female</span></label>
        <label><div role="radio" aria-label="Other:" data-value="__other_option__" aria-checked="false" tabindex="0"></div>Other: <input type="text" aria-label="Other response"></label>
      </div>
      <div id="a3" role="alert"></div>
    </div>
  </div>
  <div role="button" tabindex="0" id="next">Next</div>
  <div role="button" tabindex="0">Clear form</div>
  <script>
    document.querySelectorAll('[role=radio]').forEach((r) => r.addEventListener('click', () => {
      r.closest('[role=radiogroup]').querySelectorAll('[role=radio]').forEach((o) => o.setAttribute('aria-checked', String(o === r)));
    }));
    document.getElementById('next').addEventListener('click', () => {
      const gender = document.querySelector('[role=radio][aria-checked=true]');
      document.getElementById('a3').textContent = gender ? '' : 'This is a required question';
      if (gender && document.querySelector('input[type=text]').value) {
        document.getElementById('page').innerHTML = '<div role="listitem"><div role="heading" aria-level="3" id="h9">Timezone</div><input type="text" aria-labelledby="h9"></div>';
      }
    });
  </script>`;

test.describe("a Google Form", () => {
  test("reads required from the asterisk, the date by its question, and not the Other box", async ({ page }) => {
    await session(page, GOOGLE_FORM);
    const fields = await page.evaluate(() => {
      const s = (window as unknown as { __s: S }).__s;
      return s.state().fields.map((f) => ({ id: f.spec.id, kind: f.spec.kind, required: f.spec.required }));
    });
    expect(fields).toEqual([
      { id: "first_name", kind: "text", required: true },
      { id: "date_of_birth", kind: "date", required: true },
      { id: "gender", kind: "radio", required: true },
    ]);
  });

  test("a div radio is pressed, and reads back", async ({ page }) => {
    await session(page, GOOGLE_FORM);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ gender: { value: "Male", evidence: "male" } }, "I am male")).result;
    });
    expect(JSON.stringify(r.just_filled)).toContain("Male");
    expect(await page.getAttribute("[aria-label=Male]", "aria-checked")).toBe("true");
  });

  test("a Next the form refuses is reported as refused, with what the form said", async ({ page }) => {
    await session(page, GOOGLE_FORM);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      await s.fill({ first_name: { value: "Rohit", evidence: "Rohit" } }, "Rohit");
      return (await s.press({ action: "next_next", evidence: "next page" }, "Rohit\nnext page")).result;
    });
    expect(r.page_did_not_change).toBe(true);
    expect(JSON.stringify(r.the_form_says)).toContain("This is a required question");
    // Still on this page, so the plan is still this page: the next empty required question.
    expect(String(r.do_next)).toMatch(/Ask for (Date of Birth|Gender)/);
  });

  test("once it is answered, the same Next moves on", async ({ page }) => {
    await session(page, GOOGLE_FORM);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      await s.fill({ first_name: { value: "Rohit", evidence: "Rohit" }, gender: { value: "Male", evidence: "male" } }, "Rohit, male");
      const pressed = (await s.press({ action: "next_next", evidence: "next page" }, "Rohit, male\nnext page")).result;
      return { pressed, fields: s.state().fields.map((f) => f.spec.id) };
    });
    expect(r.pressed.page_did_not_change).toBeUndefined();
    expect(r.fields).toEqual(["timezone"]);
  });
});
