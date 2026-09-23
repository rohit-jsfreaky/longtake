/**
 * Taking an answer back out.
 *
 * Live run: "Remove the gender." There was no way to remove anything, so the agent filled Gender
 * with "Decline To Self Identify" and said it had cleared it — a false claim about an action, on
 * the person's own form. These pin the replacement: every kind of field can be emptied, every
 * clear is confirmed against the page, and a field the form will not let go of is reported as
 * exactly that — never quietly swapped for some other answer.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, read, valueOf } from "./helpers";

type Clear = { fieldId: string; status: "cleared" | "cannot-clear"; reason?: string };

async function fillThenClear(page: Page, fill: { fieldId: string; value: unknown }[], clear: string[]) {
  await read(page);
  return page.evaluate(
    async ([toFill, toClear]) => {
      const L = window.__longtake;
      const last = L.last!;
      await L.writeValues(
        last.specs,
        last.handles,
        (toFill as { fieldId: string; value: unknown }[]).map((f) => ({ ...f, evidence: "they said it" })) as never,
      );
      return (await L.clearValues(last.specs, last.handles, toClear as string[])) as unknown;
    },
    [fill, clear] as const,
  ) as Promise<Clear[]>;
}

test("a text box is emptied", async ({ page }) => {
  await load(page, `<label for="a">Phone</label><input id="a">`);
  const [outcome] = await fillThenClear(page, [{ fieldId: "phone", value: "12345" }], ["phone"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "#a")).toBe("");
});

test("a long answer is emptied", async ({ page }) => {
  await load(page, `<label for="a">Why us?</label><textarea id="a"></textarea>`);
  const [outcome] = await fillThenClear(page, [{ fieldId: "why_us", value: "Because." }], ["why_us"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "#a")).toBe("");
});

test("a dropdown goes back to its empty choice", async ({ page }) => {
  await load(
    page,
    `<label for="g">Gender</label>
     <select id="g"><option value="">Select…</option><option value="m">Male</option><option value="f">Female</option></select>`,
  );
  const [outcome] = await fillThenClear(page, [{ fieldId: "gender", value: "Male" }], ["gender"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "#g")).toBe("");
});

/**
 * The failure this whole file exists for: a form that cannot be emptied must be reported as one,
 * not answered with a different option.
 */
test("a dropdown with no empty choice is reported, never swapped for another answer", async ({ page }) => {
  await load(
    page,
    `<label for="g">Gender</label>
     <select id="g"><option value="m">Male</option><option value="d">Decline To Self Identify</option></select>`,
  );
  const [outcome] = await fillThenClear(page, [{ fieldId: "gender", value: "Male" }], ["gender"]);
  expect(outcome!.status).toBe("cannot-clear");
  expect(outcome!.reason).toMatch(/no empty choice/i);
  expect(await valueOf(page, "#g")).toBe("m");
});

test("a radio group is unticked", async ({ page }) => {
  await load(
    page,
    `<fieldset><legend>Relocate?</legend>
       <label><input type="radio" name="r" value="yes"> Yes</label>
       <label><input type="radio" name="r" value="no"> No</label>
     </fieldset>`,
  );
  const [outcome] = await fillThenClear(page, [{ fieldId: "relocate", value: "Yes" }], ["relocate"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "input[value=yes]")).toBe("unchecked");
});

test("a tick box is unticked, the way a person does it", async ({ page }) => {
  await load(
    page,
    `<label><input type="checkbox" id="c"> Send me news</label>
     <div id="heard">no</div>
     <script>document.getElementById('c').addEventListener('click', () => {
       document.getElementById('heard').textContent = 'clicked';
     });</script>`,
  );
  const [outcome] = await fillThenClear(page, [{ fieldId: "send_me_news", value: true }], ["send_me_news"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "#c")).toBe("unchecked");
  expect(await page.textContent("#heard")).toBe("clicked");
});

test("a group of tick boxes is all unticked", async ({ page }) => {
  await load(
    page,
    `<fieldset><legend>Industry</legend>
       <label><input type="checkbox" name="i" value="Film"> Film</label>
       <label><input type="checkbox" name="i" value="Stage"> Stage</label>
     </fieldset>`,
  );
  const [outcome] = await fillThenClear(page, [{ fieldId: "industry", value: ["Film", "Stage"] }], ["industry"]);
  expect(outcome!.status).toBe("cleared");
  expect(await valueOf(page, "input[value=Film]")).toBe("unchecked");
  expect(await valueOf(page, "input[value=Stage]")).toBe("unchecked");
});

/** Built like the landing page's picker: a portal menu, and a × beside the chosen value. */
const PICKER = (withClear: boolean) => `
  <span id="g_label">Gender</span>
  <div style="position:relative">
    <div id="g" role="combobox" aria-labelledby="g_label" aria-expanded="false" tabindex="0"
         style="width:220px;height:32px;border:1px solid">Select...</div>
    <span id="slot"></span>
  </div>
  <script>
    const trigger = document.getElementById('g');
    const slot = document.getElementById('slot');
    let list = null;
    const close = () => { if (list) { list.remove(); list = null; trigger.setAttribute('aria-expanded', 'false'); } };
    const choose = (text) => {
      trigger.textContent = text;
      close();
      slot.innerHTML = ${withClear} && text !== 'Select...' ? '<button aria-label="Clear selection">×</button>' : '';
      const x = slot.querySelector('button');
      if (x) x.addEventListener('pointerdown', (e) => { e.stopPropagation(); choose('Select...'); });
    };
    document.addEventListener('pointerdown', (e) => { if (list && !list.contains(e.target) && e.target !== trigger) close(); });
    trigger.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (list) { close(); return; }
      list = document.createElement('ul');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-labelledby', 'g_label');
      list.style.cssText = 'position:fixed;top:120px;left:10px;width:220px;background:#fff';
      for (const o of ['Male', 'Female', 'Decline To Self Identify']) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = o;
        li.style.height = '22px';
        li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); choose(o); });
        list.appendChild(li);
      }
      document.body.appendChild(list);
      trigger.setAttribute('aria-expanded', 'true');
    });
  </script>`;

async function pickThenClear(page: Page) {
  return page.evaluate(async () => {
    const L = window.__longtake;
    const r = await L.harvestOptions(L.readForm());
    await L.writeValues(r.specs, r.handles, [{ fieldId: "gender", value: "Male", evidence: "male" }]);
    const picked = document.getElementById("g")!.textContent;
    const [outcome] = await L.clearValues(r.specs, r.handles, ["gender"]);
    return { picked, outcome, shown: document.getElementById("g")!.textContent };
  });
}

test("a custom dropdown is emptied with its own clear control", async ({ page }) => {
  await load(page, PICKER(true));
  const { picked, outcome, shown } = await pickThenClear(page);
  expect(picked).toBe("Male");
  expect(outcome!.status).toBe("cleared");
  expect(shown).toBe("Select...");
});

test("a custom dropdown with no way to clear it is reported as exactly that", async ({ page }) => {
  await load(page, PICKER(false));
  const { outcome, shown } = await pickThenClear(page);
  expect(outcome!.status).toBe("cannot-clear");
  expect(shown).toBe("Male"); // untouched — and not "Decline To Self Identify"
});

test("a field that is not on the page is reported, not invented", async ({ page }) => {
  await load(page, `<label for="a">Phone</label><input id="a">`);
  const [outcome] = await fillThenClear(page, [], ["no_such_field"]);
  expect(outcome!.status).toBe("cannot-clear");
});

test("clearing something already empty is fine", async ({ page }) => {
  await load(page, `<label for="a">Phone</label><input id="a">`);
  const [outcome] = await fillThenClear(page, [], ["phone"]);
  expect(outcome!.status).toBe("cleared");
});

test.describe("the clear tool", () => {
  test("names only real, answerable fields, and needs the person's words", async ({ page }) => {
    await load(page, "<p>no form needed</p>");
    const tool = await page.evaluate(() =>
      window.__longtake.buildClearTool([
        { id: "gender", label: "Gender", kind: "select", required: false },
        { id: "trap", label: "Leave blank", kind: "text", required: false, suspectedHoneypot: true },
        { id: "cv", label: "Resume", kind: "file", required: false },
      ] as never),
    );
    expect(tool.name).toBe("clear_fields");
    expect(tool.parameters.properties!.fields!.items!.enum).toEqual(["gender"]);
    expect(tool.parameters.required).toEqual(["fields", "evidence"]);
    const problems = await page.evaluate((t) => window.__longtake.validateTool(t as never), tool);
    expect(problems).toEqual([]);
  });
});
