/**
 * A returning person, end to end through the real session: what goes in before anyone speaks, what
 * waits for their yes, and how a changed, cleared or personal answer is settled for next time.
 *
 * Meanings come from `fakeUnderstanding` — the offline reading, but certain — so these test what
 * happens once meanings are known, not how good they are (that is tests/corpus/meaning.spec.ts).
 */

import { expect, test, type Page } from "@playwright/test";

import { load, saidBefore } from "./helpers";

const FORM = `
  <h1>Apply — Backend Engineer</h1>
  <label for="first">First Name</label><input id="first" required>
  <label for="email">Email</label><input id="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" type="tel">
  <label for="city">Current city</label><input id="city">
  <label for="gender">Gender</label>
  <select id="gender"><option value="">Select…</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>`;

const KNOWN = saidBefore({
  "identity.first_name": ["Rohit", "mera naam Rohit hai"],
  "contact.email": ["rohit@example.com", "rohit at example dot com"],
  "address.city": ["Kolkata", "Kolkata mein rehta hoon"],
});

type Say = Record<string, { concept?: string; subject?: string; confidence?: string }>;

/**
 * A session on the page with a profile and the stand-in model. `late: true` holds the model's answer
 * back until `window.__release()` — the first visit to a form, when the request is still out.
 */
async function start(page: Page, before: unknown[], say: Say = {}, { late = false, model = true } = {}) {
  await load(page, FORM);
  await page.evaluate(
    async ([changes, overrides, late, model]) => {
      const L = window.__longtake;
      const store = L.memoryProfileStore(L.applyChanges(L.emptyProfile(), changes as never).profile);
      const fake = L.fakeUnderstanding(overrides as never);
      let release: () => void = () => {};
      const gate = new Promise<void>((done) => (release = done));
      const understand = late ? async (snapshot: never) => (await gate, fake(snapshot)) : fake;
      const s = new L.LongtakeSession({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        profile: store,
        ...(model ? { understand } : {}),
      });
      Object.assign(window, { __s: s, __store: store, __release: () => release() });
    },
    [before, say, late, model] as const,
  );
}

type Win = {
  __s: InstanceType<typeof window.__longtake.LongtakeSession>;
  __store: ReturnType<typeof window.__longtake.memoryProfileStore>;
  __release: () => void;
};

const facts = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.values((window as unknown as Win).__store.current().facts).map((f) => [f.id, { value: f.value, source: f.history.at(-1)!.source }]),
    ),
  );

const view = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Win).__s;
    const state = s.state();
    return {
      fields: Object.fromEntries(state.fields.map((f) => [f.spec.id, { value: f.value, source: f.source, pending: f.pending?.reason ?? null }])),
      asks: state.asks.map((a) => [a.spec.id, a.ask.kind]),
      move: s.move(),
      greeting: s.greeting(),
    };
  });

const open = (page: Page) =>
  page.evaluate(async () => {
    const s = (window as unknown as Win).__s;
    await s.prefill();
    await s.open();
  });

async function tool(page: Page, name: "fill" | "confirm" | "clear" | "saveForNextTime", args: unknown, heard: string) {
  return page.evaluate(
    async ([n, a, h]) => {
      const s = (window as unknown as Win).__s;
      const done = await (s[n] as (args: unknown, heard: string) => Promise<{ result: Record<string, unknown> }>).call(s, a, h);
      return done.result;
    },
    [name, args, heard] as const,
  );
}

test.describe("a returning person", () => {
  test("their own answers go in before anyone speaks, and the opening line says they are from last time", async ({ page }) => {
    await start(page, KNOWN);
    await open(page);
    const v = await view(page);
    expect(v.fields.first_name).toMatchObject({ value: "Rohit", source: "memory" });
    expect(v.fields.email).toMatchObject({ value: "rohit@example.com", source: "memory" });
    expect(v.fields.current_city).toMatchObject({ value: "Kolkata", source: "memory" });
    expect(v.fields.phone).toMatchObject({ value: null });
    expect(v.greeting).toContain("from last time");
    // Every required question is answered from last time: straight to what is left, the optional ones.
    expect(v.move.kind).toBe("offer_optional");
    expect(JSON.stringify(v.move)).not.toContain("first_name");
  });

  test("an answer the model was not sure is the same question waits for a yes — and the call opens on it", async ({ page }) => {
    await start(page, KNOWN, { email: { confidence: "medium" } });
    await open(page);
    let v = await view(page);
    expect(v.fields.email).toMatchObject({ value: null, pending: "from_last_time" });
    expect(v.move.kind).toBe("confirm_recalled");
    expect(v.greeting).toMatch(/I've filled 2 from last time — your name and where you're based; 2 are new\. Email needs a quick yes — still right\?$/);

    const result = await tool(page, "confirm", { field: "email", agreed: true, evidence: "haan sahi hai" }, "haan sahi hai");
    expect(result.just_filled).toBeTruthy();
    v = await view(page);
    expect(v.fields.email).toMatchObject({ value: "rohit@example.com", source: "memory" });
    // Their yes is now part of the answer's history: next time it goes straight in.
    expect((await facts(page))["contact.email"]).toMatchObject({ source: "confirmed" });
  });

  test("without the model, nothing from last time goes in unasked — it all waits for a yes", async ({ page }) => {
    await start(page, KNOWN, {}, { model: false });
    await open(page);
    const v = await view(page);
    expect(v.fields.first_name).toMatchObject({ value: null, pending: "from_last_time" });
    expect(v.move.kind).toBe("confirm_recalled");
  });

  test("meanings that arrive after the call opened still bring the answers in, and what was said meanwhile is learned", async ({ page }) => {
    test.setTimeout(20_000);
    await start(page, KNOWN, {}, { late: true });
    await open(page); // waits a few seconds for the model, then opens without it
    const v = await view(page);
    expect(v.fields.first_name).toMatchObject({ pending: "from_last_time" });

    await tool(page, "fill", { phone: { value: "98765 43210", evidence: "nine eight seven six five, four three two one zero" } }, "nine eight seven six five, four three two one zero");
    expect((await facts(page))["contact.phone"]).toBeUndefined();

    await page.evaluate(() => (window as unknown as Win).__release());
    await expect.poll(async () => (await facts(page))["contact.phone"]?.value ?? null).toBe("98765 43210");
    // And what was waiting for a yes only because the model was late goes in now.
    await expect.poll(async () => (await view(page)).fields.first_name).toMatchObject({ value: "Rohit", source: "memory", pending: null });
  });
});

test.describe("next time is theirs to decide", () => {
  test("a different answer goes on this form at once, and is kept for next time only on their yes", async ({ page }) => {
    await start(page, KNOWN);
    await open(page);
    await tool(page, "clear", { fields: ["current_city"], evidence: "city hata do" }, "city hata do");
    await page.evaluate(() => (window as unknown as Win).__s.saveForNextTime({ fields: ["current_city"], agreed: false, evidence: "nahi rehne do" }, "nahi rehne do"));

    await tool(page, "fill", { current_city: { value: "Bengaluru", evidence: "ab Bengaluru mein hoon" } }, "city hata do. nahi rehne do. ab Bengaluru mein hoon");
    let v = await view(page);
    expect(v.fields.current_city).toMatchObject({ value: "Bengaluru", source: "spoken" });
    expect((await facts(page))["address.city"]!.value).toBe("Kolkata");
    expect(v.asks).toEqual([["current_city", "changed"]]);
    expect(v.move.kind).toBe("update_profile");

    const result = await tool(page, "saveForNextTime", { fields: ["current_city"], agreed: true, evidence: "haan update kar do" }, "haan update kar do");
    expect(result.kept_for_next_time).toEqual(["Current city"]);
    expect((await facts(page))["address.city"]!.value).toBe("Bengaluru");
    v = await view(page);
    expect(v.asks).toEqual([]);
  });

  test("a no leaves what was saved as it was", async ({ page }) => {
    await start(page, saidBefore({ "address.city": ["Kolkata", "Kolkata mein"] }));
    await open(page);
    await tool(page, "clear", { fields: ["current_city"], evidence: "clear city" }, "clear city");
    await tool(page, "saveForNextTime", { fields: ["current_city"], agreed: false, evidence: "no keep it" }, "clear city. no keep it");
    await tool(page, "fill", { current_city: { value: "Pune", evidence: "Pune for this one" } }, "Pune for this one");
    const result = await tool(page, "saveForNextTime", { fields: ["current_city"], agreed: false, evidence: "just this once" }, "Pune for this one. just this once");
    expect(result.left_as_before).toEqual(["Current city"]);
    expect((await facts(page))["address.city"]!.value).toBe("Kolkata");
  });

  test("a reply they did not say settles nothing", async ({ page }) => {
    await start(page, KNOWN);
    await open(page);
    await tool(page, "clear", { fields: ["email"], evidence: "remove email" }, "remove email");
    const result = await tool(page, "saveForNextTime", { fields: ["email"], agreed: true, evidence: "yes forget it" }, "remove email");
    expect(result.why).toBe("quote_not_found");
    expect((await facts(page))["contact.email"]).toBeDefined();
    expect((await view(page)).asks).toEqual([["email", "forget"]]);
  });

  test("clearing an answer from last time asks before forgetting it; on their yes it is gone", async ({ page }) => {
    await start(page, KNOWN);
    await open(page);
    const cleared = await tool(page, "clear", { fields: ["email"], evidence: "email hata do" }, "email hata do");
    expect(cleared.was_from_last_time).toEqual([{ field: "email", question: "Email" }]);
    expect((await facts(page))["contact.email"]).toBeDefined();
    expect(String((cleared as { do_next: string }).do_next)).toContain("forget it for next time too");

    await tool(page, "saveForNextTime", { fields: ["email"], agreed: true, evidence: "haan bhool jao" }, "email hata do. haan bhool jao");
    expect((await facts(page))["contact.email"]).toBeUndefined();
  });

  test("an answer said and then cleared in the same call is taken back from next time too", async ({ page }) => {
    await start(page, []);
    await open(page);
    await tool(page, "fill", { phone: { value: "98765 43210", evidence: "98765 43210" } }, "98765 43210");
    expect((await facts(page))["contact.phone"]).toBeDefined();
    await tool(page, "clear", { fields: ["phone"], evidence: "no wait, remove the phone" }, "98765 43210. no wait, remove the phone");
    expect((await facts(page))["contact.phone"]).toBeUndefined();
    expect((await view(page)).asks).toEqual([]);
  });

  test("a personal answer is kept only on their yes, asked once on the way out", async ({ page }) => {
    await start(page, [], { gender: { concept: "eeo.gender" } });
    await open(page);
    await tool(
      page,
      "fill",
      {
        first_name: { value: "Rohit", evidence: "Rohit" },
        email: { value: "rohit@example.com", evidence: "rohit@example.com" },
        phone: { value: "98765 43210", evidence: "98765 43210" },
        current_city: { value: "Kolkata", evidence: "Kolkata" },
        gender: { value: "Male", evidence: "male" },
      },
      "Rohit, rohit@example.com, 98765 43210, Kolkata, male",
    );
    expect((await facts(page))["eeo.gender"]).toBeUndefined();
    const v = await view(page);
    expect(v.asks).toEqual([["gender", "sensitive"]]);
    expect(v.move.kind).toBe("handover");
    const doNext = await page.evaluate(() => window.__longtake.doNext((window as unknown as Win).__s.move()));
    expect(doNext).toContain("ask whether to remember their answers to Gender for next time");

    await tool(page, "saveForNextTime", { fields: ["gender"], agreed: true, evidence: "yes remember it" }, "yes remember it");
    expect((await facts(page))["eeo.gender"]).toMatchObject({ value: "Male" });
    expect(await page.evaluate(() => window.__longtake.doNext((window as unknown as Win).__s.move()))).not.toContain("remember");
  });

  test("what they typed by hand is kept at the end — and next time only offered for a yes", async ({ page }) => {
    await start(page, []);
    await open(page);
    await page.fill("#phone", "98765 43210");
    await page.evaluate(() => (window as unknown as Win).__s.finish());
    expect((await facts(page))["contact.phone"]).toMatchObject({ value: "98765 43210", source: "typed" });

    const known = await page.evaluate(() => (window as unknown as Win).__store.current());
    await start(page, [], {});
    await page.evaluate((profile) => {
      const L = window.__longtake;
      const store = L.memoryProfileStore(profile as never);
      const s = new L.LongtakeSession({ root: () => document, ignore: "", profile: store, understand: L.fakeUnderstanding() });
      Object.assign(window, { __s: s, __store: store });
    }, known);
    await open(page);
    expect((await view(page)).fields.phone).toMatchObject({ value: null, pending: "from_last_time" });
  });
});

test.describe("a phone number, however a form splits it", () => {
  const SPLIT = `
    <h1>Apply</h1>
    <label for="code">Country</label>
    <select id="code"><option value="">Select…</option><option>United States +1</option><option>India +91</option><option>United Kingdom +44</option></select>
    <label for="tel">Phone</label><input id="tel" type="tel">`;

  test("what is kept is the whole number they said, not the part left in this form's number box", async ({ page }) => {
    await load(page, SPLIT);
    const facts = await page.evaluate(async () => {
      const L = window.__longtake;
      const store = L.memoryProfileStore();
      // The model calls the bare "Country" picker the person's country; its dialling codes say otherwise.
      const s = new L.LongtakeSession({ root: () => document, ignore: "", profile: store, understand: L.fakeUnderstanding({ country: { concept: "address.country" } }) });
      await s.open();
      await new Promise((r) => setTimeout(r, 50));
      await s.fill({ phone: { value: "+91 98765 43210", evidence: "phone is +91 98765 43210" } }, "phone is +91 98765 43210");
      return Object.values(store.current().facts).map((f) => [f.id, f.value]);
    });
    expect(facts).toEqual(expect.arrayContaining([["contact.phone", "+91 98765 43210"], ["contact.phone.country_code", "India +91"]]));
    expect(facts.map(([id]) => id)).not.toContain("address.country");
  });
});

test.describe("the call and the settings page at once", () => {
  test("an edit made elsewhere mid-call shows at once, and the call's own new answers do not undo it", async ({ page }) => {
    await load(page, FORM);
    const out = await page.evaluate(async (changes) => {
      const L = window.__longtake;
      const store = L.memoryProfileStore(L.applyChanges(L.emptyProfile(), changes as never).profile);
      const fake = new L.FakeVoice();
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        profile: store,
        services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start, understand: L.fakeUnderstanding() },
      });
      await conductor.start();
      await new Promise((r) => setTimeout(r, 20));
      // The settings page, on another tab: an edit, through the same owner.
      await store.apply([{ type: "replace", id: "contact.email", value: "edited@example.com", from: { value: "edited@example.com", evidence: "", source: "edited", host: "", url: "", askedAs: "Email", formTitle: "", at: Date.now() } }]);
      const shown = conductor.view().known.find((k) => k.id === "contact.email")?.value;
      fake.userSays("my phone is 98765 43210");
      await fake.toolCall("fill_fields", { phone: { value: "98765 43210", evidence: "98765 43210" } });
      const facts = store.current().facts;
      return { shown, email: facts["contact.email"]?.value, phone: facts["contact.phone"]?.value };
    }, KNOWN);
    expect(out.shown).toBe("edited@example.com");
    expect(out.email).toBe("edited@example.com");
    expect(out.phone).toBe("98765 43210");
  });

  test("save_for_next_time is one of the agent's tools, and it is routed", async ({ page }) => {
    await load(page, FORM);
    const out = await page.evaluate(async () => {
      const L = window.__longtake;
      const fake = new L.FakeVoice();
      const conductor = new L.Conductor({
        root: () => document,
        ignore: "[data-longtake-ignore]",
        services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start },
      });
      await conductor.start();
      await new Promise((r) => setTimeout(r, 20));
      const names = conductor.session.tools().map((t) => t.name);
      fake.userSays("yes");
      const result = (await conductor.runTool("save_for_next_time", { fields: ["email"], agreed: true, evidence: "yes" })) as Record<string, unknown>;
      return { names, result };
    });
    expect(out.names).toContain("save_for_next_time");
    expect(out.result.nothing_to_settle).toEqual(["Email"]);
  });
});

// GOV.UK marks nothing required and needs every answer. A form that marks nothing does not mark
// anything optional either: its questions are asked, never offered as "the optional ones".
test("a form that marks nothing required asks its questions, and never calls them optional", async ({ page }) => {
  await load(
    page,
    `<fieldset><legend>What is your date of birth?</legend>
       <label for="d">Day</label><input id="d" inputmode="numeric">
       <label for="m">Month</label><input id="m" inputmode="numeric">
       <label for="y">Year</label><input id="y" inputmode="numeric"></fieldset>
     <button type="submit">Continue</button>`,
  );
  const move = await page.evaluate(async () => {
    const L = window.__longtake;
    const s = new L.LongtakeSession({ root: () => document, ignore: "" });
    await s.open();
    return s.move();
  });
  expect(move.kind).toBe("ask");
});
