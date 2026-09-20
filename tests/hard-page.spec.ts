import { expect, test } from "@playwright/test";
import { byLabel, load, read, readDeep, valueOf, write } from "./helpers";

/**
 * The hard page: every awkward thing a real website does, on one page.
 *
 * Ported from the fixture of the same name in Cairn, an earlier project of ours that drives real
 * websites. Its list was not invented — every entry on it had already broken a recorded flow in
 * the wild. Three of the twelve are not Longtake's problem (we never click a link, answer a
 * `confirm()`, or scroll a feed), and those are marked rather than quietly dropped.
 *
 * The point of keeping it as one page rather than twelve small ones is that a real form is also
 * one page, and the hazards interfere with each other.
 */

const HARD = `
<h1>Everything that breaks a form filler</h1>

<!-- 5. A cookie banner covering the page, before anything else can be used. -->
<div id="cookies" style="position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99">
  <button id="accept-cookies">Accept all</button>
</div>

<!-- 1. A dropdown made of divs. No <select> anywhere. -->
<div id="month-label">Start month</div>
<div id="month-button" role="button" aria-haspopup="listbox" aria-labelledby="month-label"
     tabindex="0" style="width:200px;height:30px;border:1px solid #ccc">Choose a month</div>
<div id="month-list" hidden></div>

<!-- 2. A field inside a shadow root. -->
<div id="shadow-host"></div>

<!-- 3. A field inside an iframe. -->
<iframe id="widget" srcdoc='<label for="ref">Referral code</label><input id="ref">'></iframe>

<!-- 4. Content that only appears after the data arrives. -->
<div id="slow">Loading…</div>

<!-- 8. A hidden file input behind a styled button. -->
<input type="file" id="upload-input" style="display:none">
<button id="upload-button">Attach a receipt</button>

<!-- 10. A menu that opens on pointerdown and ignores click. -->
<div id="notice-label">Notice period</div>
<button id="pointer-menu-button" aria-haspopup="listbox" aria-labelledby="notice-label"
        style="width:200px;height:30px">Row actions</button>

<!-- 12. Controls with no accessible name at all. -->
<table><tr><td>Vendor A</td><td>
  <input id="nameless" style="width:120px">
</td></tr></table>

<script>
  // 1. The div dropdown, with its options appearing only once opened.
  const monthList = document.getElementById('month-list');
  document.getElementById('month-button').addEventListener('click', () => {
    monthList.hidden = false;
    monthList.innerHTML =
      '<div role="option">August 2026</div><div role="option">September 2026</div>' +
      '<div role="option">October 2026</div>';
    monthList.querySelectorAll('[role=option]').forEach((o) => {
      o.style.height = '20px';
      o.addEventListener('click', () => {
        document.getElementById('month-button').textContent = o.textContent;
        monthList.hidden = true;
        monthList.innerHTML = '';
      });
    });
  });

  // 2. A real open shadow root with a real field in it.
  document.getElementById('shadow-host').attachShadow({ mode: 'open' }).innerHTML =
    '<label for="nick">Preferred name</label><input id="nick">';

  // 4. A field that simply is not there yet.
  setTimeout(() => {
    document.getElementById('slow').innerHTML =
      '<label for="late">Current employer</label><input id="late">';
  }, 350);

  // 10. Radix's trigger opens on pointerdown; no click listener is registered at all.
  const trigger = document.getElementById('pointer-menu-button');
  trigger.addEventListener('pointerdown', () => {
    if (document.getElementById('pointer-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'pointer-menu';
    ['Immediate', '30 days', '90 days'].forEach((text) => {
      const o = document.createElement('div');
      o.setAttribute('role', 'option');
      o.textContent = text;
      o.style.height = '20px';
      o.addEventListener('click', () => {
        trigger.textContent = text;
        menu.remove();
      });
      menu.appendChild(o);
    });
    document.body.appendChild(menu);      // a portal
  });

  // 5. The banner clears itself when accepted.
  document.getElementById('accept-cookies').addEventListener('click', () => {
    document.getElementById('cookies').remove();
  });
</script>`;

test.describe("the hard page, read", () => {
  test("1. a dropdown made of divs is found as a field", async ({ page }) => {
    await load(page, HARD);
    expect(byLabel(await read(page), "Start month").kind).toBe("select");
  });

  test("1b. its options are learned by opening it", async ({ page }) => {
    await load(page, HARD);
    const spec = byLabel(await readDeep(page), "Start month");
    expect(spec.options?.map((o) => o.label)).toEqual([
      "August 2026",
      "September 2026",
      "October 2026",
    ]);
  });

  test("2. a field inside a shadow root is found", async ({ page }) => {
    await load(page, HARD);
    expect(byLabel(await read(page), "Preferred name")).toBeTruthy();
  });

  test("3. a field inside an iframe is found", async ({ page }) => {
    await load(page, HARD);
    await page.waitForTimeout(200);
    expect(byLabel(await read(page), "Referral code")).toBeTruthy();
  });

  test("4. a field that arrives late is missed by an immediate read", async ({ page }) => {
    await load(page, HARD);
    expect(await read(page).then((r) => r.specs.some((s) => s.label === "Current employer"))).toBe(
      false,
    );
  });

  test("4b. …and found once the page has settled", async ({ page }) => {
    await load(page, HARD);
    expect(byLabel(await readDeep(page), "Current employer")).toBeTruthy();
  });

  test("5. a cookie banner does not hide the fields underneath it", async ({ page }) => {
    await load(page, HARD);
    expect((await read(page)).specs.length).toBeGreaterThan(3);
  });

  test("8. the hidden file input is kept out of the schema", async ({ page }) => {
    await load(page, HARD);
    const result = await read(page);
    expect(result.specs.some((s) => s.kind === "file")).toBe(false);
  });

  test("10. a pointerdown-only menu is found as a field", async ({ page }) => {
    await load(page, HARD);
    expect(byLabel(await read(page), "Notice period").kind).toBe("select");
  });

  test("10b. and its options are learned despite ignoring clicks", async ({ page }) => {
    await load(page, HARD);
    expect(byLabel(await readDeep(page), "Notice period").options).toHaveLength(3);
  });

  test("12. a control with no accessible name is still reported, with an empty label", async ({ page }) => {
    await load(page, HARD);
    const result = await read(page);
    // It gets a usable id even with nothing to name it — dropping it entirely would be worse,
    // because the agent can still ask "there is one more box here, what goes in it?"
    expect(result.specs.some((s) => s.id.length > 0)).toBe(true);
  });

  test("every field on the page gets a distinct id", async ({ page }) => {
    await load(page, HARD);
    const result = await readDeep(page);
    expect(new Set(result.specs.map((s) => s.id)).size).toBe(result.specs.length);
  });

  test("nothing on this page throws", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, HARD);
    await readDeep(page);
    expect(errors).toEqual([]);
  });
});

test.describe("the hard page, filled", () => {
  test("the div dropdown is genuinely set", async ({ page }) => {
    await load(page, HARD);
    await readDeep(page);
    const [outcome] = await write(page, [
      { fieldId: "start_month", value: "September 2026", evidence: "September se start" },
    ]);
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#month-button")).toBe("September 2026");
  });

  test("the pointerdown-only menu is genuinely set", async ({ page }) => {
    await load(page, HARD);
    await readDeep(page);
    const [outcome] = await write(page, [
      { fieldId: "notice_period", value: "30 days", evidence: "thirty days ka notice" },
    ]);
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#pointer-menu-button")).toBe("30 days");
  });

  test("the shadow-root field is filled", async ({ page }) => {
    await load(page, HARD);
    await readDeep(page);
    const [outcome] = await write(page, [
      { fieldId: "preferred_name", value: "Rohit", evidence: "sab mujhe Rohit bulate hain" },
    ]);
    expect(outcome!.status).toBe("written");
    const inside = await page.evaluate(
      () =>
        (
          document.getElementById("shadow-host")!.shadowRoot!.getElementById(
            "nick",
          ) as HTMLInputElement
        ).value,
    );
    expect(inside).toBe("Rohit");
  });

  test("the iframe field is filled", async ({ page }) => {
    await load(page, HARD);
    await page.waitForTimeout(200);
    await readDeep(page);
    const [outcome] = await write(page, [
      { fieldId: "referral_code", value: "LONGTAKE", evidence: "code is longtake" },
    ]);
    expect(outcome!.status).toBe("written");
    const inside = await page.evaluate(
      () =>
        (
          (document.getElementById("widget") as HTMLIFrameElement).contentDocument!.getElementById(
            "ref",
          ) as HTMLInputElement
        ).value,
    );
    expect(inside).toBe("LONGTAKE");
  });

  test("the late-arriving field is filled", async ({ page }) => {
    await load(page, HARD);
    await readDeep(page);
    const [outcome] = await write(page, [
      { fieldId: "current_employer", value: "Techorigins", evidence: "abhi Techorigins mein hoon" },
    ]);
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#late")).toBe("Techorigins");
  });

  test("a whole page is filled in one pass, and every claim of success is true", async ({ page }) => {
    await load(page, HARD);
    await page.waitForTimeout(250);
    await readDeep(page);
    const outcomes = await write(page, [
      { fieldId: "start_month", value: "October 2026", evidence: "October se" },
      { fieldId: "notice_period", value: "Immediate", evidence: "abhi join kar sakta hoon" },
      { fieldId: "preferred_name", value: "Rohit", evidence: "Rohit bulate hain" },
      { fieldId: "current_employer", value: "Techorigins", evidence: "Techorigins mein hoon" },
    ]);
    expect(outcomes.filter((o) => o.status === "written")).toHaveLength(4);
    expect(await page.textContent("#month-button")).toBe("October 2026");
    expect(await page.textContent("#pointer-menu-button")).toBe("Immediate");
    expect(await valueOf(page, "#late")).toBe("Techorigins");
  });

  test("a field nobody spoke to on this page is still empty afterwards", async ({ page }) => {
    await load(page, HARD);
    await readDeep(page);
    await write(page, [{ fieldId: "start_month", value: "August 2026", evidence: "August" }]);
    expect(await valueOf(page, "#nameless")).toBe("");
  });
});

test.describe("hazards that belong to a browser agent, not to a form filler", () => {
  /**
   * Kept as notes rather than deleted. Cairn had to solve all three because it drives a whole
   * site; Longtake reads and writes the form in front of it and never navigates.
   */
  test("6. a confirm() is never triggered, because nothing here submits", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await load(page, HARD);
    await readDeep(page);
    await write(page, [{ fieldId: "start_month", value: "August 2026", evidence: "August" }]);
    expect(dialogs).toBe(0);
  });

  test("7. no new tab is opened by reading or filling", async ({ page }) => {
    await load(page, `${HARD}<a id="new-tab" href="https://example.com" target="_blank">Open</a>`);
    const before = page.context().pages().length;
    await readDeep(page);
    expect(page.context().pages().length).toBe(before);
  });

  test("9. an infinite-scroll list is not scrolled into by the reader", async ({ page }) => {
    await load(page, `${HARD}<div id="feed" style="height:200px;overflow:auto"></div>`);
    const before = await page.evaluate(() => window.scrollY);
    await read(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});
