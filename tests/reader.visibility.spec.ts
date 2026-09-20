import { expect, test } from "@playwright/test";
import { load, read } from "./helpers";

/**
 * Which fields a person can actually see.
 *
 * This is the rule that keeps honeypots out of the tool schema, so it has to be strict. It is
 * also the rule most easily broken in a way nobody notices — see the scrolling tests at the
 * bottom, which exist because exactly that happened on a real form.
 */

const LABELLED = `<label for="f">Field</label>`;

async function counts(page: import("@playwright/test").Page) {
  const result = await read(page);
  return { fields: result.specs.length, skipped: result.skipped.length };
}

test.describe("hidden by style", () => {
  const hidden: [name: string, style: string][] = [
    ["display:none", "display:none"],
    ["visibility:hidden", "visibility:hidden"],
    ["visibility:collapse", "visibility:collapse"],
    ["opacity:0", "opacity:0"],
    ["zero width", "width:0;height:20px"],
    ["zero height", "width:200px;height:0"],
    ["one-pixel box", "width:1px;height:1px"],
    ["parked off-canvas left", "position:absolute;left:-9999px"],
    ["parked off-canvas top", "position:absolute;top:-9999px"],
    ["scaled to nothing", "transform:scale(0);width:0;height:0"],
  ];

  for (const [name, style] of hidden) {
    test(`${name} keeps the field out of the schema`, async ({ page }) => {
      await load(page, `${LABELLED}<input id="f" style="${style}">`);
      expect((await counts(page)).fields).toBe(0);
    });

    test(`${name} is explained in skipped rather than vanishing silently`, async ({ page }) => {
      await load(page, `${LABELLED}<input id="f" style="${style}">`);
      expect((await counts(page)).skipped).toBe(1);
    });
  }

  test("a hidden PARENT hides the field too", async ({ page }) => {
    await load(page, `<div style="display:none">${LABELLED}<input id="f"></div>`);
    expect((await counts(page)).fields).toBe(0);
  });

  test("a parent with visibility:hidden hides the field too", async ({ page }) => {
    await load(page, `<div style="visibility:hidden">${LABELLED}<input id="f"></div>`);
    expect((await counts(page)).fields).toBe(0);
  });

  test("a closed <details> hides what is inside it", async ({ page }) => {
    await load(page, `<details><summary>More</summary>${LABELLED}<input id="f"></details>`);
    expect((await counts(page)).fields).toBe(0);
  });

  test("an open <details> does not", async ({ page }) => {
    await load(page, `<details open><summary>More</summary>${LABELLED}<input id="f"></details>`);
    expect((await counts(page)).fields).toBe(1);
  });
});

test.describe("visible, despite appearances", () => {
  test("opacity just above zero is still visible", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" style="opacity:0.02">`);
    expect((await counts(page)).fields).toBe(1);
  });

  test("a field underneath a full-page overlay is still a field", async ({ page }) => {
    // A cookie banner covers the form; the fields beneath it are real and will be fillable the
    // moment it is dismissed. Treating them as hidden would empty the schema on half the web.
    await load(
      page,
      `<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99"></div>
       ${LABELLED}<input id="f">`,
    );
    expect((await counts(page)).fields).toBe(1);
  });

  test("a field inside a scrollable container is a field", async ({ page }) => {
    await load(
      page,
      `<div style="height:60px;overflow:auto">
         <div style="height:400px"></div>${LABELLED}<input id="f">
       </div>`,
    );
    expect((await counts(page)).fields).toBe(1);
  });
});

test.describe("scrolling is not hiding — the bug that dropped First Name", () => {
  /**
   * `rect.bottom < 0` looks like a correct off-screen test and is badly wrong: on any form
   * taller than the window, every field above the scroll position has a negative `rect.bottom`.
   * On a real Reddit application that silently removed "First Name" from the form.
   */
  const TALL = `<div style="height:3000px"></div>`;

  test("a field below the fold is read", async ({ page }) => {
    await load(page, `${TALL}${LABELLED}<input id="f">`);
    expect((await counts(page)).fields).toBe(1);
  });

  test("a field ABOVE the scroll position is still read", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f">${TALL}`);
    await page.evaluate(() => window.scrollTo(0, 2500));
    expect((await counts(page)).fields).toBe(1);
  });

  test("scrolling far past a field does not turn it into a honeypot", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f">${TALL}`);
    await page.evaluate(() => window.scrollTo(0, 2900));
    const result = await read(page);
    expect(result.specs[0]?.suspectedHoneypot).toBeUndefined();
  });

  test("a genuinely off-canvas field is still caught while scrolled", async ({ page }) => {
    await load(
      page,
      `${LABELLED}<input id="f" style="position:absolute;left:-9999px">${TALL}`,
    );
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect((await counts(page)).fields).toBe(0);
  });
});

test.describe("suspected traps", () => {
  test("a name that says honeypot is flagged", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" name="honeypot">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBe(true);
  });

  test("an hp_ prefix is flagged", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" name="hp_email">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBe(true);
  });

  test("a bot-trap name is flagged", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" name="bot_trap">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBe(true);
  });

  test("a leave-blank name is flagged", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" name="leave_this_blank">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBe(true);
  });

  test("tabindex=-1 with autocomplete=off is the classic plain-HTML trap", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" tabindex="-1" autocomplete="off">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBe(true);
  });

  test("autocomplete=off on its own is NOT a trap — half the web sets it", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" autocomplete="off">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBeUndefined();
  });

  test("tabindex=-1 on its own is not a trap either", async ({ page }) => {
    await load(page, `${LABELLED}<input id="f" tabindex="-1">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBeUndefined();
  });

  test("an ordinary field is not flagged", async ({ page }) => {
    await load(page, `<label for="f">Email</label><input id="f" name="email">`);
    expect((await read(page)).specs[0]?.suspectedHoneypot).toBeUndefined();
  });
});

test.describe("controls that really are tiny", () => {
  /**
   * React-Select's combobox is an autosize `<input>` measuring about 3.5 × 20 pixels when it is
   * empty — the box a person sees is its parent. A flat minimum size took every dropdown off a
   * live Greenhouse form, turning twenty fields into nine.
   *
   * The rule that tells the two apart is declaration, not size: a control that announces
   * `role="combobox"` to assistive technology is a control. A honeypot never announces itself,
   * because being read out by a screen reader is precisely what it is trying to avoid.
   */
  test("a 3-pixel combobox input inside a normal container is visible", async ({ page }) => {
    await load(
      page,
      `<div style="width:220px;height:24px">
         <input role="combobox" aria-label="Country" style="width:3px;height:20px;border:0;padding:0">
       </div>`,
    );
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("a 3-pixel input with NO role is not", async ({ page }) => {
    await load(
      page,
      `<div style="width:220px;height:24px">
         <label for="f">Field</label><input id="f" style="width:3px;height:20px;border:0;padding:0">
       </div>`,
    );
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("declaring a role does not rescue a control inside a hidden container", async ({ page }) => {
    await load(
      page,
      `<div style="display:none;width:220px;height:24px">
         <input role="combobox" aria-label="Country" style="width:3px;height:20px;border:0;padding:0">
       </div>`,
    );
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("declaring a role does not rescue one whose container is also tiny", async ({ page }) => {
    await load(
      page,
      `<div style="width:4px;height:4px">
         <input role="combobox" aria-label="Country" style="width:3px;height:3px;border:0;padding:0">
       </div>`,
    );
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("aria-haspopup counts as declaring itself too", async ({ page }) => {
    await load(
      page,
      `<div style="width:220px;height:30px">
         <div aria-haspopup="listbox" aria-label="Seniority" style="width:2px;height:2px"></div>
       </div>`,
    );
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("a zero-size honeypot inside a perfectly normal form is still caught", async ({ page }) => {
    await load(
      page,
      `<form style="width:400px"><label for="f">Field</label>
         <input id="f" name="honeypot" style="width:0;height:0;border:0;padding:0">
       </form>`,
    );
    expect((await read(page)).specs).toHaveLength(0);
  });
});
