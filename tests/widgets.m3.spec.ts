/**
 * The widgets real forms use that are not a list you can read in advance, and the form telling
 * you something is wrong.
 *
 *   · a search-as-you-type picker (a location, a college) — nothing to read until you type
 *   · a tag picker — several answers in one box
 *   · a slider built from divs
 *   · dates, in the shape the field wants
 *   · a phone number split from its country code
 *   · validation errors the form shows after a value goes in
 */

import { expect, test, type Page } from "@playwright/test";

import { load, valueOf } from "./helpers";

const CITIES = ["Kolkata, West Bengal, India", "Kochi, Kerala, India", "Kolhapur, Maharashtra, India", "Kota, Rajasthan, India"];

/** A location picker that asks a "server" as you type, the way an async React-Select does. */
const SEARCHABLE = `
  <label id="loc_label">Location (City)</label>
  <div class="control">
    <div class="value" id="loc_value"></div>
    <input id="loc" role="combobox" aria-labelledby="loc_label" aria-autocomplete="list"
           aria-expanded="false" style="width:220px;height:28px">
  </div>
  <script>
    const input = document.getElementById('loc');
    const shown = document.getElementById('loc_value');
    let list = null;
    const close = () => { if (list) { list.remove(); list = null; input.setAttribute('aria-expanded', 'false'); } };
    document.addEventListener('pointerdown', (e) => { if (list && !list.contains(e.target) && e.target !== input) close(); });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      close();
      if (!q) return;
      setTimeout(() => {                                   // the server answers a moment later
        const hits = ${JSON.stringify(CITIES)}.filter((c) => c.toLowerCase().startsWith(q) || c.toLowerCase().includes(q));
        if (!hits.length) return;
        list = document.createElement('ul');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-labelledby', 'loc_label');
        list.style.cssText = 'position:fixed;top:120px;left:10px;width:320px;background:#fff';
        for (const h of hits) {
          const li = document.createElement('li');
          li.setAttribute('role', 'option'); li.textContent = h; li.style.height = '22px';
          li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); shown.textContent = h; input.value = ''; close(); });
          list.appendChild(li);
        }
        document.body.appendChild(list);
        input.setAttribute('aria-expanded', 'true');
      }, 250);
    });
  </script>`;

async function harvestAndWrite(page: Page, fieldId: string, value: unknown, evidence = "they said it") {
  return page.evaluate(
    async ([id, v, e]) => {
      const L = window.__longtake;
      const read = await L.harvestOptions(L.readForm());
      const spec = read.specs.find((s) => s.id === id)!;
      const [outcome] = await L.writeValues(read.specs, read.handles, [{ fieldId: id as string, value: v as never, evidence: e as string }]);
      return { spec, outcome, value: L.readValue(spec, read.handles.get(id as string)!) };
    },
    [fieldId, value, evidence] as const,
  );
}

test.describe("a picker that searches as you type", () => {
  test("is recognised as one — opening it shows nothing to read", async ({ page }) => {
    await load(page, SEARCHABLE);
    const spec = await page.evaluate(async () => {
      const L = window.__longtake;
      return (await L.harvestOptions(L.readForm())).specs[0]!;
    });
    expect(spec.searchable).toBe(true);
    expect(spec.options).toBeUndefined();
  });

  test("a spoken city is typed, searched, and the one clear result picked", async ({ page }) => {
    await load(page, SEARCHABLE);
    const r = await harvestAndWrite(page, "location_city", "Kolkata");
    expect(r.outcome.status).toBe("written");
    expect(await page.textContent("#loc_value")).toBe("Kolkata, West Bengal, India");
  });

  test("'Kolkata, India' finds Kolkata by its first part", async ({ page }) => {
    await load(page, SEARCHABLE);
    const r = await harvestAndWrite(page, "location_city", "Kolkata, India");
    expect(r.outcome.status).toBe("written");
  });

  /** Never a coin flip: "Ko" is four cities. They come back as choices to ask about. */
  test("several results are offered, never guessed between", async ({ page }) => {
    await load(page, SEARCHABLE);
    const r = await harvestAndWrite(page, "location_city", "Ko");
    expect(r.outcome.status).toBe("refused");
    expect((r.outcome as { choices?: string[] }).choices).toContain("Kochi, Kerala, India");
    expect(await page.textContent("#loc_value")).toBe("");
  });

  test("nothing found is reported, and the half-typed search is cleared", async ({ page }) => {
    await load(page, SEARCHABLE);
    const r = await harvestAndWrite(page, "location_city", "Atlantis");
    expect(r.outcome.status).toBe("rejected-by-page");
    expect(await page.inputValue("#loc")).toBe("");
  });
});

/** A tag picker: its menu declares several can be picked; each pick shows as a tag. */
const TAGS = `
  <span id="t_label">Languages</span>
  <div style="position:relative"><div id="t" role="combobox" aria-labelledby="t_label" aria-expanded="false"
       tabindex="0" style="width:300px;height:30px;border:1px solid"><span class="tags"></span></div></div>
  <script>
    const trigger = document.getElementById('t');
    const tags = trigger.querySelector('.tags');
    const picked = [];
    let list = null;
    const close = () => { if (list) { list.remove(); list = null; trigger.setAttribute('aria-expanded', 'false'); } };
    document.addEventListener('pointerdown', (e) => { if (list && !list.contains(e.target) && e.target !== trigger) close(); });
    trigger.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (list) { close(); return; }
      list = document.createElement('ul');
      list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true');
      list.setAttribute('aria-labelledby', 't_label');
      list.style.cssText = 'position:fixed;top:120px;left:10px;width:220px;background:#fff';
      for (const o of ['Python', 'Go', 'Rust', 'TypeScript'].filter((o) => !picked.includes(o))) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option'); li.textContent = o; li.style.height = '22px';
        li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); picked.push(o); tags.textContent = picked.join(' '); close(); });
        list.appendChild(li);
      }
      document.body.appendChild(list);
      trigger.setAttribute('aria-expanded', 'true');
    });
  </script>`;

test.describe("a tag picker", () => {
  test("is recognised as taking several answers", async ({ page }) => {
    await load(page, TAGS);
    const spec = await page.evaluate(async () => {
      const L = window.__longtake;
      return (await L.harvestOptions(L.readForm())).specs[0]!;
    });
    expect(spec.kind).toBe("multiselect");
  });

  test("every answer said becomes a tag — not just the first", async ({ page }) => {
    await load(page, TAGS);
    const r = await harvestAndWrite(page, "languages", ["Python", "Go", "Rust"]);
    expect(r.outcome.status).toBe("written");
    expect(await page.textContent("#t .tags")).toBe("Python Go Rust");
    expect([...(r.value as string[])].sort()).toEqual(["Go", "Python", "Rust"]);
  });
});

test.describe("a slider", () => {
  const SLIDER = `
    <span id="s_label">Years of experience</span>
    <div id="s" role="slider" aria-labelledby="s_label" tabindex="0"
         aria-valuemin="0" aria-valuemax="20" aria-valuenow="0" style="width:200px;height:20px"></div>
    <script>
      const s = document.getElementById('s');
      s.addEventListener('keydown', (e) => {
        const now = Number(s.getAttribute('aria-valuenow'));
        if (e.key === 'ArrowRight') s.setAttribute('aria-valuenow', String(Math.min(20, now + 1)));
        if (e.key === 'ArrowLeft') s.setAttribute('aria-valuenow', String(Math.max(0, now - 1)));
      });
    </script>`;

  test("a div slider is stepped to the value with the arrow keys", async ({ page }) => {
    await load(page, SLIDER);
    const r = await harvestAndWrite(page, "years_of_experience", 7);
    expect(r.spec.range).toEqual({ min: 0, max: 20, step: 1 });
    expect(r.outcome.status).toBe("written");
    expect(await page.getAttribute("#s", "aria-valuenow")).toBe("7");
    expect(r.value).toBe("7");
  });

  test("a value past the end stops at the end", async ({ page }) => {
    await load(page, SLIDER);
    await harvestAndWrite(page, "years_of_experience", 50);
    expect(await page.getAttribute("#s", "aria-valuenow")).toBe("20");
  });

  test("a real range input is set directly", async ({ page }) => {
    await load(page, `<label for="r">Rating</label><input id="r" type="range" min="1" max="10" value="1">`);
    const r = await harvestAndWrite(page, "rating", 8);
    expect(r.outcome.status).toBe("written");
    expect(await valueOf(page, "#r")).toBe("8");
  });
});

test.describe("dates, in the shape the field wants", () => {
  test("a native date box gets YYYY-MM-DD from a spoken date", async ({ page }) => {
    await load(page, `<label for="d">Start date</label><input id="d" type="date">`);
    await harvestAndWrite(page, "start_date", "October 1st, 2026");
    expect(await valueOf(page, "#d")).toBe("2026-10-01");
  });

  test("a text box with a MM/DD/YYYY placeholder gets exactly that", async ({ page }) => {
    await load(page, `<label for="d">Start date</label><input id="d" placeholder="MM/DD/YYYY">`);
    await harvestAndWrite(page, "start_date", "2026-10-01");
    expect(await valueOf(page, "#d")).toBe("10/01/2026");
  });

  test("DD-MM-YYYY is honoured too", async ({ page }) => {
    await load(page, `<label for="d">Date of birth</label><input id="d" placeholder="DD-MM-YYYY">`);
    await harvestAndWrite(page, "date_of_birth", "2 March 1999");
    expect(await valueOf(page, "#d")).toBe("02-03-1999");
  });

  test("an ordinary text box is left as it was said", async ({ page }) => {
    await load(page, `<label for="n">Notes</label><input id="n" placeholder="Type here...">`);
    await harvestAndWrite(page, "notes", "October 1st");
    expect(await valueOf(page, "#n")).toBe("October 1st");
  });
});

test.describe("a phone number split from its country code", () => {
  const PHONE = `
    <label for="cc">Country code</label>
    <select id="cc"><option value="">Select…</option><option>India (+91)</option>
      <option>United States (+1)</option><option>Canada (+1)</option><option>United Kingdom (+44)</option></select>
    <label for="ph">Phone</label><input id="ph" type="tel">`;

  async function fillPhone(page: Page, value: string) {
    await load(page, PHONE);
    return page.evaluate(async (v) => {
      const L = window.__longtake;
      let mem = {};
      const s = new L.LongtakeSession({ root: () => document, ignore: "[data-longtake-ignore]", memory: { load: () => mem, save: (m) => { mem = m; } } });
      await s.open();
      const facts = L.nextMove(s.state(), { optionalOffered: false });
      await s.fill({ phone: { value: v, evidence: `my number is ${v}` } }, `my number is ${v}`);
      return { move: facts };
    }, value);
  }

  test("'+91 …' fills the code picker with India and the box with the number", async ({ page }) => {
    await fillPhone(page, "+91 98765 43210");
    expect(await page.$eval("#cc", (s) => (s as HTMLSelectElement).selectedOptions[0]!.textContent)).toBe("India (+91)");
    expect(await valueOf(page, "#ph")).toBe("98765 43210");
  });

  /** +1 is the United States and Canada. Picking one would be a guess. */
  test("'+1 …' leaves the code picker alone — it could be two countries", async ({ page }) => {
    await fillPhone(page, "+1 415 555 0100");
    expect(await valueOf(page, "#cc")).toBe("");
    expect(await valueOf(page, "#ph")).toBe("415 555 0100");
  });

  test("the planner asks for the two as one question", async ({ page }) => {
    await load(page, PHONE.replace('<input id="ph" type="tel">', '<input id="ph" type="tel" required>'));
    const next = await page.evaluate(async () => {
      const L = window.__longtake;
      let mem = {};
      const s = new L.LongtakeSession({ root: () => document, ignore: "[data-longtake-ignore]", memory: { load: () => mem, save: (m) => { mem = m; } } });
      await s.open();
      return L.doNext(L.nextMove(s.state(), { optionalOffered: false }));
    });
    expect(next).toContain("phone number, with its country code, as one question");
  });
});

test.describe("validation errors the form shows", () => {
  /** Validates on blur and shows its message the accessible way, like most form libraries. */
  const EMAIL = `
    <label for="e">Email</label>
    <input id="e" type="text" required aria-describedby="e_err">
    <div id="e_err"></div>
    <label for="n">Name</label><input id="n" required>
    <script>
      const e = document.getElementById('e');
      e.addEventListener('blur', () => {
        const bad = !/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(e.value);
        e.setAttribute('aria-invalid', String(bad));
        document.getElementById('e_err').textContent = bad ? 'Please enter a valid email address' : '';
      });
    </script>`;

  async function session(page: Page) {
    await page.evaluate(async () => {
      const L = window.__longtake;
      let mem = {};
      const s = new L.LongtakeSession({ root: () => document, ignore: "[data-longtake-ignore]", memory: { load: () => mem, save: (m) => { mem = m; } } });
      await s.open();
      (window as unknown as { __s: typeof s }).__s = s;
    });
  }

  test("a rejected value is read, and fixing it comes before anything new", async ({ page }) => {
    await load(page, EMAIL);
    await session(page);
    const result = await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      return (await s.fill({ email: { value: "rohit at example", evidence: "rohit at example" } }, "rohit at example")).result;
    });
    expect(String(result.do_next)).toContain('it says: "Please enter a valid email address"');

    const brief = await page.evaluate(() => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      const L = window.__longtake;
      return L.brief(s.state(), L.nextMove(s.state(), { optionalOffered: false }));
    });
    expect(brief).toContain('The form rejects: Email = "rohit at example"');
  });

  test("once fixed, the error is gone and the conversation moves on", async ({ page }) => {
    await load(page, EMAIL);
    await session(page);
    const next = await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      await s.fill({ email: { value: "rohit at example", evidence: "rohit at example" } }, "rohit at example");
      return (await s.fill({ email: { value: "rohit@example.com", evidence: "rohit@example.com" } }, "rohit at example\nrohit@example.com")).result.do_next;
    });
    expect(String(next)).toContain("Ask for Name");
  });

  test("the browser's own check catches a malformed email in an email box", async ({ page }) => {
    await load(page, `<label for="e">Email</label><input id="e" type="email">`);
    const error = await page.evaluate(async () => {
      const L = window.__longtake;
      const read = L.readForm();
      await L.writeValues(read.specs, read.handles, [{ fieldId: "email", value: "not-an-email", evidence: "not-an-email" }]);
      return L.readError(read.handles.get("email")!);
    });
    expect(error).toBeTruthy();
  });

  test("an error beside a different field is not this field's", async ({ page }) => {
    await load(
      page,
      `<div><label for="a">First</label><input id="a"></div>
       <div><label for="b">Second</label><input id="b"><span class="error">Second is required</span></div>`,
    );
    const errors = await page.evaluate(() => {
      const L = window.__longtake;
      return [L.readError(document.getElementById("a")!), L.readError(document.getElementById("b")!)];
    });
    expect(errors).toEqual([null, "Second is required"]);
  });
});
