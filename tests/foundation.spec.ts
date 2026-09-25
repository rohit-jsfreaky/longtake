/**
 * The foundation: one form state read off the page, a ledger for what the page cannot say, a gate
 * for answers the person did not clearly give, and a planner that decides what comes next.
 *
 * Every test here is pinned to a live failure. The ones that mattered most:
 *   #12  India was in the Country box and the agent asked where they were based — `isFilled`
 *        could not read a custom dropdown, so the opening line thought Country was empty.
 *   #13  "Twitter" became "Social Media" without asking.
 *   #14  "Two and a half or three years" became "3 years" without asking.
 *   #11  The counter said 6 / 14 on a form with eleven boxes full.
 */

import { expect, test, type Page } from "@playwright/test";

import { load, saidBefore } from "./helpers";

/** A dropdown built like the landing page's: a div trigger, a portal menu, a × to clear it. */
const combo = (id: string, label: string, options: string[], required = false) => `
  <span id="${id}_label">${label}${required ? " *" : ""}</span>
  <div style="position:relative">
    <div id="${id}" role="combobox" aria-labelledby="${id}_label" aria-expanded="false"
         ${required ? 'aria-required="true"' : ""} tabindex="0"
         style="width:260px;height:32px;border:1px solid">Select...</div>
    <span class="clear-slot"></span>
  </div>
  <script>
    (() => {
      const trigger = document.getElementById(${JSON.stringify(id)});
      const slot = trigger.parentElement.querySelector('.clear-slot');
      let list = null;
      const close = () => { if (list) { list.remove(); list = null; trigger.setAttribute('aria-expanded', 'false'); } };
      const choose = (text) => {
        trigger.textContent = text; close();
        slot.innerHTML = text === 'Select...' ? '' : '<button aria-label="Clear selection">×</button>';
        const x = slot.querySelector('button');
        if (x) x.addEventListener('pointerdown', (e) => { e.stopPropagation(); choose('Select...'); });
      };
      document.addEventListener('pointerdown', (e) => { if (list && !list.contains(e.target) && e.target !== trigger) close(); });
      trigger.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (list) { close(); return; }
        list = document.createElement('ul');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-labelledby', ${JSON.stringify(id + "_label")});
        list.style.cssText = 'position:fixed;top:300px;left:300px;width:260px;background:#fff';
        for (const o of ${JSON.stringify(options)}) {
          const li = document.createElement('li');
          li.setAttribute('role', 'option'); li.textContent = o; li.style.height = '22px';
          li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); choose(o); });
          list.appendChild(li);
        }
        document.body.appendChild(list);
        trigger.setAttribute('aria-expanded', 'true');
      });
    })();
  </script>`;

const HEARD = ["Conference", "Job Board", "LinkedIn", "Podcast", "Social Media", "Word of Mouth", "Other"];

/** Glean-shaped: text fields, a Country picker, a required "how did you hear", an optional gender. */
const APPLICATION = `
  <h3>Software Engineer, Backend</h3>
  <label for="first_name">First Name</label><input id="first_name" required>
  <label for="last_name">Last Name</label><input id="last_name" required>
  <label for="email">Email</label><input id="email" type="email" required>
  ${combo("country", "Country", ["Canada", "India", "United States"])}
  ${combo("heard", "How did you hear about Glean?", HEARD, true)}
  <label for="years">Total years of experience</label><input id="years" required>
  ${combo("gender", "Gender", ["Male", "Female", "Decline To Self Identify"])}`;

/**
 * Build a session in the page, with a profile holding what they said on an earlier form and the
 * stand-in model for what fields mean, and expose it to the tests.
 */
async function withSession(page: Page, body: string, before: unknown[] = []) {
  await load(page, body);
  await page.evaluate((changes) => {
    const L = window.__longtake;
    const session = new L.LongtakeSession({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      profile: L.memoryProfileStore(L.applyChanges(L.emptyProfile(), changes as never).profile),
      understand: L.fakeUnderstanding(),
    });
    (window as unknown as { __s: typeof session }).__s = session;
  }, before);
}

type Snap = {
  progress: { filled: number; total: number; requiredLeft: number; optionalLeft: number };
  fields: { id: string; value: unknown; source: string; declined: boolean; pending?: { suggestion: string; reason: string } }[];
  brief: string;
};

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
    const state = s.state();
    return {
      progress: state.progress,
      fields: state.fields.map((f) => ({
        id: f.spec.id,
        value: f.value,
        source: f.source,
        declined: f.declined,
        pending: f.pending ? { suggestion: f.pending.suggestion, reason: f.pending.reason } : undefined,
      })),
      brief: window.__longtake.brief(state, window.__longtake.nextMove(state, { optionalOffered: false })),
    };
  });
}

async function call(page: Page, tool: "fill" | "clear" | "confirm", args: unknown, heard: string) {
  return page.evaluate(
    async ([t, a, h]) => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      const done =
        t === "fill"
          ? await s.fill(a as never, h as string)
          : t === "confirm"
            ? await s.confirm(a as never, h as string)
            : await s.clear(a as never, h as string);
      return done.result as Record<string, unknown>;
    },
    [tool, args, heard] as const,
  );
}

const field = (s: Snap, id: string) => s.fields.find((f) => f.id === id)!;

// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe("reading what a field holds, for every kind", () => {
  test("text, a real select, radios, a tick box and a group of tick boxes", async ({ page }) => {
    await load(
      page,
      `<label for="t">Name</label><input id="t" value="Rohit">
       <label for="e">Empty</label><input id="e">
       <label for="s">Country</label><select id="s"><option value="">Select…</option><option value="in" selected>India</option></select>
       <fieldset><legend>Relocate?</legend>
         <label><input type="radio" name="r" value="y" checked> Yes</label><label><input type="radio" name="r" value="n"> No</label></fieldset>
       <label><input type="checkbox" id="c" checked> Agree</label>
       <fieldset><legend>Industry</legend>
         <label><input type="checkbox" name="i" value="Film" checked> Film</label>
         <label><input type="checkbox" name="i" value="Stage"> Stage</label></fieldset>`,
    );
    const values = await page.evaluate(() => {
      const L = window.__longtake;
      const read = L.readForm();
      return Object.fromEntries(read.specs.map((s) => [s.id, L.readValue(s, read.handles.get(s.id)!)]));
    });
    expect(values).toMatchObject({ name: "Rohit", empty: null, country: "India", relocate: "Yes", agree: true, industry: ["Film"] });
  });

  /** #12. The one `isFilled` could not read — and every mismatch of the last week followed from it. */
  test("a custom dropdown's choice is read off the page", async ({ page }) => {
    await load(page, APPLICATION);
    const values = await page.evaluate(async () => {
      const L = window.__longtake;
      const read = await L.harvestOptions(L.readForm());
      const before = L.readValue(read.specs.find((s) => s.id === "country")!, read.handles.get("country")!);
      await L.writeValues(read.specs, read.handles, [{ fieldId: "country", value: "India", evidence: "from India" }]);
      const after = L.readValue(read.specs.find((s) => s.id === "country")!, read.handles.get("country")!);
      return { before, after };
    });
    expect(values.before).toBeNull(); // "Select..." is a placeholder, not an answer
    expect(values.after).toBe("India"); // and the × beside it is not part of the answer
  });

  test("an input-based picker (React-Select) is read from the value shown around it", async ({ page }) => {
    await load(
      page,
      `<label id="l">Location</label>
       <div class="select__control"><div class="select__value-container">
         <div class="select__single-value">Canada</div>
         <div><input role="combobox" aria-labelledby="l" style="width:4px;height:20px"></div>
       </div></div>`,
    );
    const value = await page.evaluate(() => {
      const L = window.__longtake;
      const read = L.readForm();
      const spec = { ...read.specs[0]!, options: [{ value: "Canada", label: "Canada" }, { value: "India", label: "India" }] };
      return L.readValue(spec, read.handles.get(spec.id)!);
    });
    expect(value).toBe("Canada");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe("one form state — where every value came from", () => {
  test("remembered, spoken, typed by hand, already there, and empty are told apart", async ({ page }) => {
    await withSession(
      page,
      `<label for="a">First Name</label><input id="a" required>
       <label for="b">Email</label><input id="b" type="email" required>
       <label for="c">Phone</label><input id="c">
       <label for="d">Website</label><input id="d" value="rohit.dev">
       <label for="e">Notes</label><input id="e">`,
      saidBefore({ "identity.first_name": ["Rohit", "my name is Rohit"] }),
    );
    await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      await s.prefill();
      await s.open();
    });
    await call(page, "fill", { email: { value: "rohit@example.com", evidence: "email is rohit@example.com" } }, "email is rohit@example.com");
    await page.fill("#c", "98765"); // their own hand

    const s = await snap(page);
    expect(field(s, "first_name").source).toBe("memory");
    expect(field(s, "email").source).toBe("spoken");
    expect(field(s, "phone").source).toBe("typed");
    expect(field(s, "website").source).toBe("page");
    expect(field(s, "notes").source).toBe("empty");
  });

  /** #11 — counted off the page, remembered answers included. */
  test("the count comes from the page, not from this session's writes", async ({ page }) => {
    await withSession(
      page,
      APPLICATION,
      saidBefore({
        "identity.first_name": ["Rohit", "my name is Rohit Kashyap"],
        "identity.last_name": ["Kashyap", "my name is Rohit Kashyap"],
        "address.country": ["India", "I'm from Kolkata, India"],
      }),
    );
    await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      await s.prefill();
      await s.open();
    });
    const s = await snap(page);
    expect(s.progress.filled).toBe(3);
    expect(s.progress.total).toBe(7);
  });

  /** #12, end to end: the opening line must know Country is filled. */
  test("the opening line never asks for something already in a custom dropdown", async ({ page }) => {
    await withSession(page, APPLICATION, saidBefore({ "address.country": ["India", "I'm from Kolkata, India"] }));
    const greeting = await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      await s.prefill();
      await s.open();
      return s.greeting();
    });
    expect(greeting).toContain("I've filled 1 from last time — where you're based");
    expect(greeting).not.toMatch(/Easy ones first:[^.]*where you're based/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe("the gate — nothing goes in that they did not clearly say", () => {
  async function verdict(page: Page, spec: unknown, claim: unknown, held?: unknown) {
    await load(page, "<p>no form</p>");
    return page.evaluate(([s, c, h]) => window.__longtake.gate(s as never, c as never, h as never) as unknown, [spec, claim, held] as const) as Promise<{
      write: boolean;
      pending?: { suggestion: string; reason: string };
    }>;
  }
  const heard = { id: "heard", label: "How did you hear?", kind: "select", required: true, options: HEARD.map((l) => ({ value: l, label: l })) };
  const relocate = { id: "r", label: "Relocate?", kind: "radio", required: true, options: [{ value: "y", label: "Yes" }, { value: "n", label: "No" }] };
  const years = { id: "years", label: "Years of experience", kind: "text", required: true };
  const phone = { id: "phone", label: "Phone", kind: "tel", required: false };

  test("a named option goes straight in", async ({ page }) => {
    expect((await verdict(page, heard, { fieldId: "heard", value: "LinkedIn", evidence: "saw it on LinkedIn" })).write).toBe(true);
  });

  // Discord lists both "Science" and "Computer Science": saying the second named the first too,
  // two names read as not sure, and a plainly named answer waited for a yes.
  test("an option named inside a longer one is not named as well", async ({ page }) => {
    const discipline = { id: "d", label: "Discipline", kind: "select", required: false, options: ["Science", "Computer Science", "Political Science"].map((l) => ({ value: l, label: l })) };
    expect((await verdict(page, discipline, { fieldId: "d", value: "Computer Science", evidence: "Computer Science mein" })).write).toBe(true);
    const both = await verdict(page, discipline, { fieldId: "d", value: "Science", evidence: "Science ya Computer Science" });
    expect(both.write).toBe(false);
  });

  /** #13 */
  test("Twitter mapped to Social Media waits for their yes", async ({ page }) => {
    const v = await verdict(page, heard, { fieldId: "heard", value: "Social Media", evidence: "I heard from Twitter" });
    expect(v.write).toBe(false);
    expect(v.pending).toMatchObject({ suggestion: "Social Media", reason: "not_named" });
  });

  // A yes is not recognised by words any more — the model judges the reply and says so through
  // confirm_answer (see live-run.spec.ts). Sending the same answer again, with a yes-word in it,
  // keeps it waiting: live, "do it" four times over was on no list and nothing ever went in.
  test("the same answer sent again, even with 'haan', still waits — the yes is confirm_answer's", async ({ page }) => {
    const held = { suggestion: "Social Media", heard: "I heard from Twitter", reason: "not_named" };
    expect((await verdict(page, heard, { fieldId: "heard", value: "Social Media", evidence: "haan, that one" }, held)).write).toBe(false);
  });

  test("a no does not release it", async ({ page }) => {
    const held = { suggestion: "Social Media", heard: "I heard from Twitter", reason: "not_named" };
    expect((await verdict(page, heard, { fieldId: "heard", value: "Social Media", evidence: "no, not that" }, held)).write).toBe(false);
  });

  test("yes and no — in English or Hindi — answer a yes-or-no question, as the agent heard them", async ({ page }) => {
    expect((await verdict(page, relocate, { fieldId: "r", value: "Yes", evidence: "haan bilkul", how: "named" })).write).toBe(true);
    expect((await verdict(page, relocate, { fieldId: "r", value: "No", evidence: "nahi, I can't move", how: "named" })).write).toBe(true);
  });

  /** #14 — the agent hears the hedge and says so; code keeps no list of hedging words. */
  test("'two and a half or three years' waits when the agent heard it as unsure", async ({ page }) => {
    const v = await verdict(page, years, { fieldId: "years", value: "3 years", evidence: "about 2 and a half or 3 years", how: "unsure" });
    expect(v).toMatchObject({ write: false, pending: { reason: "hedged" } });
  });

  test("an answer the agent worked out, rather than heard, waits for their yes", async ({ page }) => {
    const v = await verdict(page, phone, { fieldId: "phone", value: "98765 43210", evidence: "same as my WhatsApp", how: "inferred" });
    expect(v).toMatchObject({ write: false, pending: { suggestion: "98765 43210", reason: "inferred" } });
  });

  test("an agent calling a mapped choice 'named' is still held: the option's name is not in their words", async ({ page }) => {
    const v = await verdict(page, heard, { fieldId: "heard", value: "Social Media", evidence: "I heard from Twitter", how: "named" });
    expect(v).toMatchObject({ write: false, pending: { reason: "not_named" } });
  });

  test("a yes or no in any language is the agent's to hear: 'named' on a yes-or-no question goes in", async ({ page }) => {
    expect((await verdict(page, relocate, { fieldId: "r", value: "Yes", evidence: "bilkul, kyun nahi", how: "named" })).write).toBe(true);
    expect((await verdict(page, relocate, { fieldId: "r", value: "Yes", evidence: "bilkul, kyun nahi", how: "inferred" })).write).toBe(false);
  });

  test("and a plain answer settles it", async ({ page }) => {
    const held = { suggestion: "3 years", heard: "2 and a half or 3 years", reason: "hedged" };
    expect((await verdict(page, years, { fieldId: "years", value: "3 years", evidence: "three years" }, held)).write).toBe(true);
  });

  test("a phone number with a dash is not a hedge", async ({ page }) => {
    expect((await verdict(page, phone, { fieldId: "phone", value: "98765-43210", evidence: "it's 98765-43210" })).write).toBe(true);
  });

  test("'I think' in an ordinary answer is not a hedge", async ({ page }) => {
    expect((await verdict(page, phone, { fieldId: "phone", value: "98765 43210", evidence: "I think it's 98765 43210" })).write).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe("the session — the whole loop, through the foundation", () => {
  async function open(page: Page) {
    await withSession(page, APPLICATION);
    await page.evaluate(async () => {
      const s = (window as unknown as { __s: InstanceType<typeof window.__longtake.LongtakeSession> }).__s;
      await s.open();
    });
  }

  test("a held answer is on the form state, in the brief, and the next move is to ask", async ({ page }) => {
    await open(page);
    const result = await call(page, "fill", { how_did_you_hear_about_glean: { value: "Social Media", evidence: "I heard from Twitter" } }, "I heard from Twitter");
    expect(result.waiting_for_yes).toEqual([
      expect.objectContaining({ field: "how_did_you_hear_about_glean", suggestion: "Social Media", they_said: "I heard from Twitter" }),
    ]);
    expect(String(result.do_next)).toContain("waiting for their yes");

    const s = await snap(page);
    expect(field(s, "how_did_you_hear_about_glean").value).toBeNull();
    expect(field(s, "how_did_you_hear_about_glean").pending?.suggestion).toBe("Social Media");
    expect(s.brief).toContain('Waiting for their yes: How did you hear about Glean? → "Social Media"');
  });

  test("their yes puts it in", async ({ page }) => {
    await open(page);
    await call(page, "fill", { how_did_you_hear_about_glean: { value: "Social Media", evidence: "I heard from Twitter" } }, "I heard from Twitter");
    const result = await call(page, "confirm", { field: "how_did_you_hear_about_glean", agreed: true, evidence: "haan wahi kar do" }, "I heard from Twitter\nhaan wahi kar do");
    expect(result.just_filled).toEqual([expect.objectContaining({ field: "how_did_you_hear_about_glean", value: "Social Media" })]);
    expect(await page.textContent("#heard")).toBe("Social Media");
  });

  test("a required field left empty is the next move, easy ones first", async ({ page }) => {
    await open(page);
    const s = await snap(page);
    // Several at once now, easy ones first — not one question per turn.
    expect(s.brief).toMatch(/DO NEXT: Ask for these together[^\n]*First Name/);
  });

  test("the optional ones are offered once the required ones are in", async ({ page }) => {
    await open(page);
    const result = await call(
      page,
      "fill",
      {
        first_name: { value: "Rohit", evidence: "I'm Rohit Kashyap" },
        last_name: { value: "Kashyap", evidence: "I'm Rohit Kashyap" },
        email: { value: "rohit@example.com", evidence: "rohit@example.com" },
        how_did_you_hear_about_glean: { value: "LinkedIn", evidence: "on LinkedIn" },
        total_years_of_experience: { value: "3 years", evidence: "three years" },
      },
      "I'm Rohit Kashyap, rohit@example.com, on LinkedIn, three years",
    );
    expect(String(result.do_next)).toMatch(/Every required field is in/);
    expect(String(result.do_next)).toContain("Country");
    expect(String(result.do_next)).toContain("Gender");
  });

  test("a cleared field is left empty on purpose and never asked for again", async ({ page }) => {
    await open(page);
    await call(page, "fill", { gender: { value: "Male", evidence: "it's male" } }, "it's male");
    const cleared = await call(page, "clear", { fields: ["gender"], evidence: "remove the gender" }, "it's male\nremove the gender");
    expect(cleared.cleared).toEqual([expect.objectContaining({ field: "gender" })]);
    expect(await page.textContent("#gender")).toBe("Select...");

    const s = await snap(page);
    expect(field(s, "gender").declined).toBe(true);
    expect(s.brief).toContain("Left empty on purpose (do not ask again): Gender");
    expect(s.brief).not.toMatch(/Still empty:[\s\S]*\n {2}Gender/);
  });

  test("the result never claims a submission", async ({ page }) => {
    await open(page);
    const result = await call(page, "fill", { first_name: { value: "Rohit", evidence: "Rohit" } }, "Rohit");
    expect(result.submitted).toBe(false);
  });
});
