/**
 * Two things operating dropdowns on the same page at the same time.
 *
 * Found on the landing page, traced rather than guessed: the hook reads the form at page load to
 * bring back remembered answers, and reads it again when the microphone is pressed. Pressed soon
 * after load, both passes ran at once — `pointerdown gender` from one, `pointerdown country` from
 * the other four milliseconds later. Country ended empty, and on a live run it was refused with
 * "pick from: Yes, No, Decline To Self Identify" — the Hispanic/Latino question's options.
 *
 * The widget below behaves like the real ones: options rendered into a portal at the end of
 * <body> a moment after the press, the trigger toggles, and any press outside closes it.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const WIDGETS = `
  <span id="c_label">Country</span>
  <div id="country" role="combobox" aria-labelledby="c_label" aria-expanded="false" tabindex="0"
       style="width:220px;height:32px;border:1px solid">Select...</div>
  <span id="h_label">Are you Hispanic/Latino?</span>
  <div id="hisp" role="combobox" aria-labelledby="h_label" aria-expanded="false" tabindex="0"
       style="width:220px;height:32px;border:1px solid">Select...</div>
  <script>
    function combo(trigger, labelId, options) {
      let list = null;
      const outside = (e) => { if (list && !list.contains(e.target) && e.target !== trigger) close(); };
      const close = () => {
        if (!list) return;
        list.remove(); list = null;
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside);
      };
      trigger.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (list) { close(); return; }             // a second press shuts it, like every real one
        setTimeout(() => {                          // options arrive a moment later, like React's
          list = document.createElement('ul');
          list.setAttribute('role', 'listbox');
          list.setAttribute('aria-labelledby', labelId);
          list.style.cssText = 'position:fixed;top:120px;left:10px;width:220px;background:#fff';
          for (const o of options) {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.textContent = o;
            li.style.height = '22px';
            li.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); trigger.textContent = o; close(); });
            list.appendChild(li);
          }
          document.body.appendChild(list);
          trigger.setAttribute('aria-expanded', 'true');
          document.addEventListener('pointerdown', outside);
        }, 60);
      });
    }
    combo(document.getElementById('country'), 'c_label', ['India', 'Canada', 'Germany']);
    combo(document.getElementById('hisp'), 'h_label', ['Yes', 'No', 'Decline To Self Identify']);
  </script>`;

async function harvestTwiceAtOnce(page: Page) {
  await load(page, WIDGETS);
  return page.evaluate(async () => {
    const L = window.__longtake;
    const a = L.readForm();
    const b = L.readForm();
    await Promise.all([L.harvestOptions(a), L.harvestOptions(b)]);
    const options = (read: typeof a) =>
      Object.fromEntries(read.specs.map((spec) => [spec.id, (spec.options ?? []).map((o) => o.label)]));
    return { a: options(a), b: options(b), open: document.querySelectorAll("[role=listbox]").length };
  });
}

test("two option-reading passes at once each learn the right options", async ({ page }) => {
  const { a, b } = await harvestTwiceAtOnce(page);
  for (const learned of [a, b]) {
    expect(learned["country"]).toEqual(["India", "Canada", "Germany"]);
    expect(learned["are_you_hispanic_latino"]).toEqual(["Yes", "No", "Decline To Self Identify"]);
  }
});

test("and leave no menu open behind them", async ({ page }) => {
  const { open } = await harvestTwiceAtOnce(page);
  expect(open).toBe(0);
});

/** The live failure exactly: an option-reading pass, and a remembered answer being written. */
test("writing an answer while options are being read still picks the right one", async ({ page }) => {
  await load(page, WIDGETS);
  const result = await page.evaluate(async () => {
    const L = window.__longtake;
    const forWrite = await L.harvestOptions(L.readForm());
    const forRead = L.readForm();
    const [outcomes] = await Promise.all([
      L.writeValues(forWrite.specs, forWrite.handles, [
        { fieldId: "country", value: "India", evidence: "from India" },
      ]),
      L.harvestOptions(forRead),
    ]);
    return { outcome: outcomes[0], shown: document.getElementById("country")!.textContent };
  });
  expect(result.outcome.status).toBe("written");
  expect(result.shown).toBe("India");
});

/**
 * Belt and braces: even with another question's menu left open, a dropdown that does not open
 * must never be judged against that menu's options.
 */
test("another question's open menu is never taken as this one's choices", async ({ page }) => {
  await load(page, WIDGETS);
  const outcome = await page.evaluate(async () => {
    const L = window.__longtake;
    const read = await L.harvestOptions(L.readForm());

    // Leave Hispanic/Latino open, then make Country refuse to open at all.
    document.getElementById("hisp")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const country = document.getElementById("country")!;
    country.addEventListener("pointerdown", (e) => e.stopImmediatePropagation(), { capture: true });

    // No options known in advance, so the writer has to look at whatever opens.
    const spec = read.specs.find((s) => s.id === "country")!;
    const blind = { ...spec, options: undefined };
    const [result] = await L.writeValues([blind], read.handles, [
      { fieldId: "country", value: "India", evidence: "from India" },
    ]);
    return result;
  });

  // The failure this guards: "not one of the choices — pick from: Yes, No, Decline…"
  expect(JSON.stringify(outcome)).not.toContain("Decline To Self Identify");
  expect(outcome.status).not.toBe("written");
});

test("a dropdown that is already open is read, not pressed shut", async ({ page }) => {
  await load(page, WIDGETS);
  const learned = await page.evaluate(async () => {
    const L = window.__longtake;
    document.getElementById("country")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const read = await L.harvestOptions(L.readForm());
    return read.specs.find((s) => s.id === "country")!.options?.map((o) => o.label);
  });
  expect(learned).toEqual(["India", "Canada", "Germany"]);
});

/**
 * The landing page's demo, pressed Start: the harvest scrolled the form's own frame to the last
 * dropdown ("Disability status") and left it there, with the focus in it, before a word was said.
 * Reading the options is ours to do; the page goes back to where the person had it.
 */
test("reading the options leaves the page, the box it scrolls in, and the focus where they were", async ({ page }) => {
  await load(
    page,
    `<button id="start">Start</button>
     <div id="box" style="height:120px;overflow-y:auto;border:1px solid">
       <div style="height:400px">top of the form</div>
       ${WIDGETS}
       <div style="height:400px"></div>
     </div>
     <div style="height:2000px"></div>`,
  );
  const out = await page.evaluate(async () => {
    const L = window.__longtake;
    document.getElementById("start")!.focus();
    const box = document.getElementById("box")!;
    const read = await L.harvestOptions(L.readForm());
    return {
      learned: read.specs.find((s) => s.id === "country")?.options?.length ?? 0,
      box: box.scrollTop,
      page: window.scrollY,
      focus: document.activeElement?.id,
    };
  });
  expect(out.learned).toBe(3); // it really pressed them
  expect(out).toMatchObject({ box: 0, page: 0, focus: "start" });
});
