/**
 * The badges beside each field (core/src/overlay.ts) and the review list beside them: placed where
 * the field is — through scrolling and inside a same-origin iframe — never read as part of the form,
 * and never mistaken by our own watcher for the form changing.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const FORM = `
  <div style="height:300px"></div>
  <label for="n">Full name*</label><input id="n" required style="display:block;width:300px">
  <label for="e">Email*</label><input id="e" type="email" required style="display:block;width:300px">
  <label for="w">Why us?*</label><textarea id="w" required></textarea>
  <div style="height:1500px"></div>`;

type Win = {
  __c: InstanceType<typeof window.__longtake.Conductor>;
  __fake: InstanceType<typeof window.__longtake.FakeVoice>;
  __reads: number;
};

async function start(page: Page) {
  await load(page, FORM);
  await page.evaluate(async () => {
    const L = window.__longtake;
    const fake = new L.FakeVoice();
    const conductor = new L.Conductor({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      services: { getToken: async () => "t", workletUrl: "", startVoice: fake.start },
    });
    // Every re-read the page watcher asks for, counted.
    let reads = 0;
    const original = conductor.session.pageChanged.bind(conductor.session);
    conductor.session.pageChanged = () => {
      reads++;
      (window as unknown as Win).__reads = reads;
      return original();
    };
    (window as unknown as Win).__reads = 0;
    await conductor.start();
    await new Promise((r) => setTimeout(r, 20));
    Object.assign(window, { __c: conductor, __fake: fake });
    fake.userSays("I'm Rohit Kashyap, rohit@example.com");
    await fake.toolCall("fill_fields", {
      full_name: { value: "Rohit Kashyap", evidence: "I'm Rohit Kashyap", how: "named" },
      email: { value: "rohit@example.com", evidence: "rohit@example.com", how: "named" },
    });
  });
  await page.waitForTimeout(100);
}

const badge = (page: Page, id: string) => page.evaluate((field) => (window as unknown as Win).__c.badgePositions()[field], id);
const rect = (page: Page, css: string) => page.evaluate((sel) => document.querySelector(sel)!.getBoundingClientRect().toJSON() as DOMRect, css);

test("a badge sits on its field's corner, and follows it when the page scrolls", async ({ page }) => {
  await start(page);
  let b = await badge(page, "full_name");
  let r = await rect(page, "#n");
  expect(b!.shown).toBe(true);
  expect(Math.abs(b!.x - r.right)).toBeLessThanOrEqual(2);
  expect(Math.abs(b!.y - r.top)).toBeLessThanOrEqual(2);

  await page.evaluate(() => window.scrollBy(0, 240));
  r = await rect(page, "#n");
  expect(r.top).toBeLessThan(100); // it really moved
  // Placed on the next frame after the scroll; on a busy machine that frame can be late.
  await expect.poll(async () => Math.abs((await badge(page, "full_name"))!.y - r.top)).toBeLessThanOrEqual(2);
  b = await badge(page, "full_name");
  expect(b!.shown).toBe(true);
});

test("a field that is not answered has no badge; one waiting or not in says so", async ({ page }) => {
  await start(page);
  const positions = await page.evaluate(() => (window as unknown as Win).__c.badgePositions());
  expect(Object.keys(positions).sort()).toEqual(["email", "full_name"]);
  const states = await page.evaluate(() => {
    const L = window.__longtake;
    const c = (window as unknown as Win).__c;
    return L.badgesFor(c.view().form, [{ fieldId: "why_us", question: "Why us?", why: "the page refused it" }]).map((b) => [b.fieldId, b.state]);
  });
  expect(states).toEqual([
    ["full_name", "spoken"],
    ["email", "spoken"],
    ["why_us", "not_in"],
  ]);
});

test("a field inside a same-origin iframe is badged where it shows on the page", async ({ page }) => {
  await load(
    page,
    `<div style="height:120px"></div>
     <iframe id="f" style="width:500px;height:300px;border:7px solid #ccc;margin-left:40px"
       srcdoc="<div style='height:60px'></div><label for=x>City</label><input id=x style='margin-left:25px;width:200px'>"></iframe>`,
  );
  await page.waitForFunction(() => (document.getElementById("f") as HTMLIFrameElement).contentDocument?.getElementById("x"));
  const out = await page.evaluate(async () => {
    const L = window.__longtake;
    const frame = document.getElementById("f") as HTMLIFrameElement;
    const input = frame.contentDocument!.getElementById("x")!;
    const overlay = new L.Overlay(document, () => new Map([["city", input as HTMLElement]]));
    overlay.show([{ fieldId: "city", state: "spoken", detail: "You said Kolkata." }]);
    const outer = frame.getBoundingClientRect();
    const inner = input.getBoundingClientRect();
    const at = overlay.positions().city!;
    overlay.destroy();
    return { at, x: outer.left + frame.clientLeft + inner.right, y: outer.top + frame.clientTop + inner.top };
  });
  expect(Math.abs(out.at.x - out.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(out.at.y - out.y)).toBeLessThanOrEqual(2);
});

// The landing page's demo: the form sits in a browser frame that scrolls on its own. Scrolled out
// of it, "Spoken" floated over the headline above the frame.
test("a field scrolled out of a box that scrolls on its own has no badge; half in, the badge stays inside the box", async ({ page }) => {
  await load(
    page,
    `<h1 style="height:200px;margin:0">Headline</h1>
     <div id="box" style="height:200px;overflow-y:auto;border:3px solid #ccc;width:420px">
       <label for="a">First</label><input id="a" style="display:block;width:300px;height:40px">
       <div style="height:120px"></div>
       <label for="b">Second</label><input id="b" style="display:block;width:300px;height:40px">
       <div style="height:600px"></div>
     </div>`,
  );
  const out = await page.evaluate(async () => {
    const L = window.__longtake;
    const box = document.getElementById("box")!;
    const handles = new Map([
      ["a", document.getElementById("a") as HTMLElement],
      ["b", document.getElementById("b") as HTMLElement],
    ]);
    const overlay = new L.Overlay(document, () => handles);
    overlay.show([
      { fieldId: "a", state: "spoken", detail: "" },
      { fieldId: "b", state: "spoken", detail: "" },
    ]);
    const before = overlay.positions();
    // "a" leaves the box entirely; "b" is cut through the middle by the box's top edge.
    const b = document.getElementById("b")!;
    box.scrollTop = b.offsetTop - box.offsetTop + 20;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = overlay.positions();
    const top = box.getBoundingClientRect().top + box.clientTop;
    overlay.destroy();
    return { before, after, top };
  });
  expect(out.before.a!.shown).toBe(true);
  expect(out.after.a!.shown).toBe(false);
  expect(out.after.b!.shown).toBe(true);
  expect(out.after.b!.y).toBeGreaterThan(out.top); // inside the box, not over the headline
});

test("the badges never make our own watcher re-read the form, and the reader never sees them", async ({ page }) => {
  await start(page);
  // More fills: badges added and changed each time.
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    w.__fake.userSays("because I love the product");
    await w.__fake.toolCall("fill_fields", { why_us: { value: "because I love the product", evidence: "because I love the product", how: "named" } });
  });
  await page.waitForTimeout(900); // past the watcher's settle time
  const out = await page.evaluate(() => {
    const L = window.__longtake;
    const read = L.readForm(document, undefined, "[data-longtake-ignore]");
    return {
      reads: (window as unknown as Win).__reads,
      host: document.querySelectorAll("longtake-badges").length,
      specs: read.specs.map((s) => s.id),
      badges: Object.keys((window as unknown as Win).__c.badgePositions()).length,
    };
  });
  expect(out.host).toBe(1);
  expect(out.badges).toBe(3);
  expect(out.reads).toBe(0);
  expect(out.specs).toEqual(["full_name", "email", "why_us"]);
});

test("the review list reads the same form: what went in, and what is still theirs", async ({ page }) => {
  await start(page);
  const groups = await page.evaluate(() => (window as unknown as Win).__c.view().review.map((g) => [g.title, g.items.map((i) => i.question)]));
  expect(groups).toEqual([["Spoken", ["Full name", "Email"]]]);
});
