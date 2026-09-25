/**
 * Three failures from the first live run of the extension, on Discord's Greenhouse application
 * (job-boards.greenhouse.io/discord/jobs/8571766002), 23 Sep 2026.
 *
 *  1. "India" into the phone Country picker was refused. Greenhouse's search for "India" returns
 *     "British Indian Ocean Territory +246" and "India +91"; "india" is a substring of both, so it
 *     was called ambiguous. And once picked, the widget shows only a flag and "+91", so the write
 *     was checked against "India +91" and reported as refused by the page.
 *  2. "Skip this, do the rest first" had nowhere to go. The plan kept asking Country, and the agent
 *     told the person the form would not let them move on.
 *  3. Name and email were already in from memory, the counter said 3 filled, and the opening line
 *     said only "I've put in your email" — because an empty optional Preferred First Name counted
 *     against "your name".
 */

import { expect, test, type Page } from "@playwright/test";

import { load, saidBefore } from "./helpers";

/** Greenhouse's phone Country picker, as it behaves live: search by typing, show only the code. */
const PHONE_COUNTRY = `
  <label id="cl" for="country">Country*</label>
  <div class="box"><div class="value"></div><input id="country" role="combobox" aria-autocomplete="list" aria-labelledby="cl" aria-required="true"></div>
  <label for="phone">Phone*</label><input id="phone" type="tel" required>
  <script>
    const ALL = ['Afghanistan +93', 'British Indian Ocean Territory +246', 'India +91', 'Indonesia +62', 'United States +1'];
    const input = document.getElementById('country');
    let menu = null;
    function show(list) {
      menu?.remove(); menu = null;
      if (!list.length) return;
      menu = document.createElement('ul'); menu.setAttribute('role', 'listbox');
      for (const name of list) {
        const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = name;
        // Like the live widget: a flag and the dialling code, never the country's name.
        li.addEventListener('mousedown', () => { input.previousElementSibling.textContent = '🇮🇳 ' + name.split(' ').pop(); input.value = ''; show([]); });
        menu.appendChild(li);
      }
      document.body.appendChild(menu);
    }
    input.addEventListener('mousedown', () => show(input.value ? [] : ALL));
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase(); show([]);
      setTimeout(() => { if (input.value.toLowerCase() === q) show(ALL.filter((s) => s.toLowerCase().includes(q))); }, 100);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') show([]); });
  </script>`;

type S = InstanceType<typeof window.__longtake.LongtakeSession>;

async function session(page: Page, body: string, before: unknown[] = []) {
  await load(page, body);
  await page.evaluate(async (changes) => {
    const L = window.__longtake;
    const s = new L.LongtakeSession({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      profile: L.memoryProfileStore(L.applyChanges(L.emptyProfile(), changes as never).profile),
      understand: L.fakeUnderstanding(),
    });
    await s.prefill();
    await s.open();
    (window as unknown as { __s: S }).__s = s;
  }, before);
}

test.describe("1 · India into Greenhouse's phone Country picker", () => {
  test("'India' is India +91, not British Indian Ocean Territory — and the flag-and-code display counts", async ({ page }) => {
    await session(page, PHONE_COUNTRY);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ country: { value: "India", evidence: "choose India" } }, "for the phone country choose India")).result;
    });
    expect(r.just_filled).toEqual([{ field: "country", question: "Country", value: "India +91" }]);
    expect(r.waiting_for_yes).toEqual([]);
    expect(await page.textContent(".value")).toContain("+91");
  });

  test("a whole word, not a piece of one: 'Indian' does not answer 'India'", async ({ page }) => {
    await load(page, "<p>x</p>");
    const picked = await page.evaluate(() => {
      const spec = {
        id: "c", label: "Country", kind: "select", required: true,
        options: ["British Indian Ocean Territory +246", "India +91"].map((label) => ({ value: label, label })),
      } as never;
      return window.__longtake.matchOption(spec, "India")?.label ?? null;
    });
    expect(picked).toBe("India +91");
  });

  test("the Location search's own results for 'Chennai': only one has it as a word", async ({ page }) => {
    await load(page, "<p>x</p>");
    const picked = await page.evaluate(() => {
      // What Greenhouse's Location (City) search returned for "Chennai" on the live page.
      const results = [
        "Chennai, Tamil Nadu, India",
        "Gali Chennaiah Palem, Andhra Pradesh, India",
        "Chennaipally Tanda, Telangana, India",
        "Chennaikatte, Karnataka, India",
        "Chennaipalem, Telangana, India",
      ];
      const spec = { id: "l", label: "Location (City)", kind: "select", required: true, options: results.map((label) => ({ value: label, label })) } as never;
      return window.__longtake.matchOption(spec, "Chennai")?.label ?? null;
    });
    expect(picked).toBe("Chennai, Tamil Nadu, India");
  });
});

const FORM = `
  <h1>Apply</h1>
  <label for="fn">First Name*</label><input id="fn" required>
  <label for="ln">Last Name*</label><input id="ln" required>
  <label for="pn">Preferred First Name</label><input id="pn">
  <label for="em">Email*</label><input id="em" type="email" required>
  <label for="ci">City*</label><input id="ci" required>
  <label for="why">Why do you want to work here?*</label><textarea id="why" required></textarea>`;

test.describe("2 · 'skip this, do the rest first'", () => {
  test("a skipped field goes to the end, is named as set aside, and is asked again last", async ({ page }) => {
    await session(page, FORM);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      const before = String(s.state() && (await s.fill({}, "hi")).result.do_next);
      const heard = "skip the name for now, fill the other fields first";
      const skipped = s.setAside({ fields: ["first_name", "last_name"], evidence: "skip the name for now" }, heard).result;
      const prompt = s.prompt();
      const all = heard + "\nrohit@example.com, Kolkata, I love the product";
      const done = await s.fill(
        {
          email: { value: "rohit@example.com", evidence: "rohit@example.com" },
          city: { value: "Kolkata", evidence: "Kolkata" },
          why_do_you_want_to_work_here: { value: "I love the product", evidence: "I love the product" },
        },
        all,
      );
      return { before, skipped, prompt, after: String(done.result.do_next), tools: s.tools().map((t) => t.name) };
    });
    expect(r.before).toContain("First Name");
    expect(r.skipped.set_aside).toEqual(["First Name", "Last Name"]);
    // Straight on to the next thing, not the skipped one.
    expect(String(r.skipped.do_next)).not.toMatch(/First Name|Last Name/);
    expect(r.prompt).toContain("Set aside for later");
    // Everything else is in: now it comes back.
    expect(r.after).toContain("First Name");
    expect(r.tools).toContain("skip_for_now");
  });

  test("skipping needs the person's own words", async ({ page }) => {
    await session(page, FORM);
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __s: S }).__s;
      return s.setAside({ fields: ["first_name"], evidence: "skip that" }, "my name is Rohit").result;
    });
    expect(r.why).toBe("quote_not_found");
    expect(r.set_aside).toEqual([]);
  });

  test("the agent is told any field can wait", async ({ page }) => {
    await load(page, "<p>x</p>");
    const prompt = await page.evaluate(() => window.__longtake.systemPrompt(""));
    expect(prompt).toContain("skip_for_now");
    expect(prompt).toContain("never tell them the form makes them answer in order");
  });
});

test.describe("3 · the opening line names what memory put in", () => {
  test("name and email in, optional Preferred First Name empty: both are named", async ({ page }) => {
    await session(
      page,
      FORM,
      saidBefore({
        "identity.first_name": ["Rohit", "I'm Rohit Kashyap"],
        "identity.last_name": ["Kashyap", "I'm Rohit Kashyap"],
        "contact.email": ["rohit@example.com", "rohit@example.com"],
      }),
    );
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __s: S }).__s;
      return { greeting: s.greeting(), filled: s.state().progress.filled };
    });
    expect(r.filled).toBe(3);
    expect(r.greeting).toContain("I've already put in your name and email");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// The second live run, same form, same evening
// ═══════════════════════════════════════════════════════════════════════════════════════

const HEARD = `
  <label for="n">Full name*</label><input id="n" required>
  <label for="h">How did you hear about us?</label>
  <select id="h"><option value="">Select…</option><option>Conference</option><option>LinkedIn</option><option>Social Media</option></select>`;

test.describe("4 · a yes is the model's to judge, not a word list's", () => {
  async function held(page: Page) {
    await session(page, HEARD);
    return page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ how_did_you_hear_about_us: { value: "Social Media", evidence: "I heard from Twitter" } }, "I heard from Twitter")).result;
    });
  }

  test("'do it' — on no list of yes-words — puts it in when the agent reports it as agreed", async ({ page }) => {
    const first = await held(page);
    expect(first.waiting_for_yes).toHaveLength(1);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.confirm({ field: "how_did_you_hear_about_us", agreed: true, evidence: "do it" }, "I heard from Twitter\ndo it")).result;
    });
    expect(r.just_filled).toEqual([expect.objectContaining({ field: "how_did_you_hear_about_us", value: "Social Media" })]);
    expect(await page.inputValue("#h")).toBe("Social Media");
  });

  test("a no stops it waiting, and the question is asked again", async ({ page }) => {
    await held(page);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      const result = (await s.confirm({ field: "how_did_you_hear_about_us", agreed: false, evidence: "nahi, kuch aur" }, "I heard from Twitter\nnahi, kuch aur")).result;
      return { result, pending: s.state().fields.find((f) => f.spec.id === "how_did_you_hear_about_us")!.pending ?? null };
    });
    expect(r.result.not_confirmed).toBeTruthy();
    expect(r.pending).toBeNull();
    expect(await page.inputValue("#h")).toBe("");
  });

  test("the reply has to be one they gave", async ({ page }) => {
    await held(page);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.confirm({ field: "how_did_you_hear_about_us", agreed: true, evidence: "yes go ahead" }, "I heard from Twitter")).result;
    });
    expect(r.why).toBe("quote_not_found");
    expect(await page.inputValue("#h")).toBe("");
  });

  test("the plan names the tool, and the brief counts what is waiting", async ({ page }) => {
    const first = await held(page);
    expect(String(first.do_next)).toContain("confirm_answer");
    const brief = await page.evaluate(() => (window as unknown as { __s: S }).__s.prompt());
    expect(brief).toMatch(/1 waiting for their yes/);
  });
});

const LONG_FORM = `
  <label for="a">First Name*</label><input id="a" required>
  <label for="b">Last Name*</label><input id="b" required>
  <label for="c">Email*</label><input id="c" type="email" required>
  <label for="d">Phone*</label><input id="d" type="tel" required>
  <label for="e">City*</label><input id="e" required>
  <label for="f">LinkedIn Profile*</label><input id="f" required>
  <label for="g">Why do you want to work here?*</label><textarea id="g" required></textarea>
  <label for="i">Current company*</label><input id="i" required>`;

test.describe("5 · several questions at once, not one per turn", () => {
  test("the next four are asked together; a long answer is asked on its own", async ({ page }) => {
    await session(page, LONG_FORM);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      const first = String((await s.fill({}, "hi")).result.do_next);
      const heard = "Rohit Kashyap, rohit@example.com, 98765 43210, Kolkata, linkedin.com/in/rohit, at Glean";
      const second = String(
        (
          await s.fill(
            {
              first_name: { value: "Rohit", evidence: "Rohit Kashyap" },
              last_name: { value: "Kashyap", evidence: "Rohit Kashyap" },
              email: { value: "rohit@example.com", evidence: "rohit@example.com" },
              phone: { value: "98765 43210", evidence: "98765 43210" },
              city: { value: "Kolkata", evidence: "Kolkata" },
              linkedin_profile: { value: "linkedin.com/in/rohit", evidence: "linkedin.com/in/rohit" },
              current_company: { value: "Glean", evidence: "at Glean" },
            },
            heard,
          )
        ).result.do_next,
      );
      return { first, second };
    });
    expect(r.first).toContain("Ask for these together");
    expect(r.first.split(";").length).toBe(4);
    expect(r.first).not.toContain("Why do you want");
    expect(r.second).toMatch(/^Ask for Why do you want to work here\? — a longer answer/);
  });
});

test.describe("6 · the call is patient first, quick after — through the documented knob", () => {
  test("no raw VAD settings are sent: semantic barge-in stays on", async ({ page }) => {
    await load(page, "<p>x</p>");
    const source = await page.evaluate(() => window.__longtake.startVoiceSession.toString());
    expect(source).toContain("transcription_mode");
    expect(source).not.toContain("turn_detection:");
  });
});

test.describe("7 · a long answer is never held as a hedge", () => {
  test("'about five years' inside 'why do you want to work here?' goes straight in", async ({ page }) => {
    await session(page, `<label for="w">Why do you want to work at Discord?*</label><textarea id="w" required></textarea>`);
    const answer = "I have used Discord for about 5 years with my friends and I want to help keep it safe";
    const r = await page.evaluate(async (said) => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ why_do_you_want_to_work_at_discord: { value: said, evidence: said } }, said)).result;
    }, answer);
    expect(r.waiting_for_yes).toEqual([]);
    expect(await page.inputValue("#w")).toBe(answer);
  });

  test("a short number field still waits on '2 or 3 years'", async ({ page }) => {
    await session(page, `<label for="y">Years of experience*</label><input id="y" required>`);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ years_of_experience: { value: "3", evidence: "2 or 3 years" } }, "2 or 3 years")).result;
    });
    expect(r.waiting_for_yes).toHaveLength(1);
  });
});

test.describe("8 · the prompt's own example was being copied", () => {
  test("no 'Twitter → Social Media' line for the agent to parrot; a text box keeps their words", async ({ page }) => {
    await load(page, "<p>x</p>");
    const prompt = await page.evaluate(() => window.__longtake.systemPrompt(""));
    expect(prompt).not.toContain("Twitter's not on their list");
    expect(prompt).not.toContain("Social Media's closest");
    expect(prompt).toContain("Only when a result says not_an_option");
    expect(prompt).toContain("If they say Twitter, Twitter goes in. Never swap their answer for another.");
    // A fill sent without their words did not go in; the agent used to be told to stay quiet.
    expect(prompt).toContain("not_heard: you sent none of their words, so nothing went in — say so and ask again.");
  });

  test("and the form agrees: Twitter into a text box goes in as Twitter", async ({ page }) => {
    await session(page, `<label for="h">How did you hear about this job?</label><input id="h">`);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __s: S }).__s;
      return (await s.fill({ how_did_you_hear_about_this_job: { value: "Twitter", evidence: "I heard from Twitter" } }, "Uh, I heard from Twitter.")).result;
    });
    expect(r.waiting_for_yes).toEqual([]);
    expect(await page.inputValue("#h")).toBe("Twitter");
  });
});
