import { expect, test } from "@playwright/test";
import { byLabel, load, readDeep, shownNear, write } from "./helpers";

/**
 * Writing into things that are not form elements.
 *
 * This file exists because of a specific failure. A real Greenhouse dropdown was reported as
 * filled with "No" while the component held nothing at all — the input's `.value` had been
 * assigned, the component ignored it, and the form would have submitted an empty answer. The
 * check had read back the value we set ourselves, which proves nothing.
 *
 * So: every assertion below confirms against **what the page shows**, and the widget is operated
 * the way a person operates it — opened, then an option pressed.
 */

const said = (fieldId: string, value: unknown) => [
  { fieldId, value, evidence: "the person said so" },
];

/**
 * A component-style dropdown, of the kind React-Select and Radix produce: a trigger, a value
 * painted into a sibling, options that do not exist until it is opened, and a portal that puts
 * them at the end of `<body>`. Assigning `.value` to the input does nothing at all.
 */
const COMPONENT_SELECT = (label: string, options: string[], id = "w") => `
  <div id="${id}-wrap" style="width:220px">
    <div id="${id}-label">${label}</div>
    <div id="${id}-value" style="height:20px"></div>
    <input id="${id}" role="combobox" aria-labelledby="${id}-label"
           aria-expanded="false" style="width:200px;height:24px">
  </div>
  <script>
    (() => {
      const input = document.getElementById('${id}');
      const shown = document.getElementById('${id}-value');
      let chosen = null;
      const close = () => { document.querySelectorAll('.pop-${id}').forEach(n => n.remove()); };
      input.addEventListener('pointerdown', () => {
        if (document.querySelector('.pop-${id}')) return;
        const pop = document.createElement('div');
        pop.className = 'pop-${id}';
        ${JSON.stringify(options)}.forEach((text) => {
          const opt = document.createElement('div');
          opt.setAttribute('role', 'option');
          opt.textContent = text;
          opt.style.height = '20px';
          opt.addEventListener('click', () => { chosen = text; shown.textContent = text; close(); });
          pop.appendChild(opt);
        });
        document.body.appendChild(pop);           // a portal, far from the trigger
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      // The component owns the answer. Anything written straight to the input is discarded.
      setInterval(() => { if (input.value !== '') input.value = ''; }, 10);
    })();
  </script>`;

test.describe("a component dropdown is genuinely filled", () => {
  test("the option is pressed and the page shows it", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await readDeep(page);
    const [outcome] = await write(page, said("seniority", "Senior"));
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#w-value")).toBe("Senior");
  });

  test("assigning the input value alone would NOT work — the control case", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await page.evaluate(() => {
      (document.getElementById("w") as HTMLInputElement).value = "Senior";
    });
    await page.waitForTimeout(120);
    expect(await page.textContent("#w-value")).toBe("");
  });

  test("the choice is confirmed from the rendered page, not from our own write", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await readDeep(page);
    await write(page, said("seniority", "Mid"));
    expect(await shownNear(page, "#w")).toContain("Mid");
  });

  test("matching by label works with different casing", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await readDeep(page);
    const [outcome] = await write(page, said("seniority", "senior"));
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#w-value")).toBe("Senior");
  });

  test("an answer the widget does not offer is refused", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await readDeep(page);
    const [outcome] = await write(page, said("seniority", "Principal"));
    expect(outcome!.status).toBe("refused");
    expect(await page.textContent("#w-value")).toBe("");
  });

  test("a refusal leaves the widget closed and untouched", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Seniority", ["Junior", "Mid", "Senior"]));
    await readDeep(page);
    await write(page, said("seniority", "Principal"));
    expect(await page.locator(".pop-w").count()).toBe(0);
  });

  // Luma: the form sits in a popup that closes on Escape and on a click outside it, and its
  // dropdown shows the pick as the input's own value. Read as not taken, the widget was "closed"
  // after the pick — and the Escape closed the popup, with every answer in it.
  test("a pick shown as the box's value is taken, and the popup around it stays open", async ({ page }) => {
    await load(
      page,
      `<div id="popup">
         <label id="q">How did you hear?</label>
         <input id="h" role="combobox" aria-labelledby="q" aria-expanded="false" style="width:200px;height:24px">
       </div>
       <script>
         const popup = document.getElementById('popup');
         const input = document.getElementById('h');
         const list = () => document.querySelector('.list');
         document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (list()) list().remove(); else popup.remove(); });
         document.body.addEventListener('pointerdown', (e) => {
           if (list()) { if (!e.target.closest('.list') && e.target !== input) list().remove(); }
           else if (!popup.contains(e.target)) popup.remove();
         });
         input.addEventListener('pointerdown', () => {
           if (list()) return;
           const box = document.createElement('div');
           box.className = 'list';
           ['LinkedIn', 'Newsletter'].forEach((text) => {
             const option = document.createElement('div');
             option.setAttribute('role', 'option');
             option.textContent = text;
             option.style.height = '20px';
             option.addEventListener('click', () => { input.value = text; box.remove(); });
             box.appendChild(option);
           });
           document.body.appendChild(box);
         });
       </script>`,
    );
    await readDeep(page);
    const [outcome] = await write(page, said("how_did_you_hear", "LinkedIn"));
    expect(outcome!.status).toBe("written");
    expect(await page.locator("#popup").count()).toBe(1);
    expect(await page.inputValue("#h")).toBe("LinkedIn");
  });

  test("the outcome reports the option's own wording", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Work authorization", ["Yes", "No"]));
    await readDeep(page);
    const [outcome] = await write(page, said("work_authorization", "No"));
    expect(outcome!.wrote).toBe("No");
  });

  test("Yes and No are not confused with each other", async ({ page }) => {
    await load(page, COMPONENT_SELECT("Work authorization", ["Yes", "No"]));
    await readDeep(page);
    await write(page, said("work_authorization", "No"));
    expect(await page.textContent("#w-value")).toBe("No");
  });

  test("a long option label is matched in full", async ({ page }) => {
    await load(
      page,
      COMPONENT_SELECT("Disability", [
        "Yes, I have a disability, or have had one in the past",
        "No, I do not have a disability",
        "I do not wish to answer",
      ]),
    );
    await readDeep(page);
    const [outcome] = await write(page, said("disability", "I do not wish to answer"));
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#w-value")).toBe("I do not wish to answer");
  });
});

test.describe("several component dropdowns on one page", () => {
  const TWO = `
    ${COMPONENT_SELECT("Work authorization", ["Yes", "No"], "a")}
    ${COMPONENT_SELECT("Needs sponsorship", ["Yes", "No"], "b")}`;

  test("each one learns only its own options", async ({ page }) => {
    await load(page, TWO);
    const result = await readDeep(page);
    expect(byLabel(result, "Work authorization").options).toHaveLength(2);
    expect(byLabel(result, "Needs sponsorship").options).toHaveLength(2);
  });

  test("filling both lands the right answer in each", async ({ page }) => {
    await load(page, TWO);
    await readDeep(page);
    const outcomes = await write(page, [
      { fieldId: "work_authorization", value: "No", evidence: "said" },
      { fieldId: "needs_sponsorship", value: "Yes", evidence: "said" },
    ]);
    expect(outcomes.every((o) => o.status === "written")).toBe(true);
    expect(await page.textContent("#a-value")).toBe("No");
    expect(await page.textContent("#b-value")).toBe("Yes");
  });

  test("writing one does not disturb the other", async ({ page }) => {
    await load(page, TWO);
    await readDeep(page);
    await write(page, said("work_authorization", "Yes"));
    expect(await page.textContent("#b-value")).toBe("");
  });

  test("no stray popup is left open afterwards", async ({ page }) => {
    await load(page, TWO);
    await readDeep(page);
    await write(page, [
      { fieldId: "work_authorization", value: "No", evidence: "said" },
      { fieldId: "needs_sponsorship", value: "Yes", evidence: "said" },
    ]);
    expect(await page.locator(".pop-a, .pop-b").count()).toBe(0);
  });
});

test.describe("a widget that only answers pointerdown", () => {
  /** Radix, and so shadcn/ui, registers `pointerdown` and never registers `click`. */
  const POINTER_ONLY = `
    <div id="t" role="button" aria-haspopup="listbox" aria-label="Notice period"
         style="width:180px;height:30px">Choose…</div>
    <div id="out"></div>
    <script>
      const t = document.getElementById('t');
      t.addEventListener('pointerdown', () => {
        if (document.querySelector('.menu')) return;
        const menu = document.createElement('div');
        menu.className = 'menu';
        ['Immediate', '30 days', '60 days'].forEach((text) => {
          const o = document.createElement('div');
          o.setAttribute('role', 'option');
          o.textContent = text;
          o.style.height = '20px';
          o.addEventListener('click', () => {
            document.getElementById('out').textContent = text;
            menu.remove();
          });
          menu.appendChild(o);
        });
        document.body.appendChild(menu);
      });
    </script>`;

  test("it opens, and its options are learned", async ({ page }) => {
    await load(page, POINTER_ONLY);
    expect(byLabel(await readDeep(page), "Notice period").options).toHaveLength(3);
  });

  test("an option can be chosen", async ({ page }) => {
    await load(page, POINTER_ONLY);
    await readDeep(page);
    const [outcome] = await write(page, said("notice_period", "30 days"));
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#out")).toBe("30 days");
  });

  test("a click-only implementation would have failed here", async ({ page }) => {
    await load(page, POINTER_ONLY);
    await page.evaluate(() => {
      document.getElementById("t")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    expect(await page.locator(".menu").count()).toBe(0);
  });
});

test.describe("ARIA checkboxes and switches", () => {
  const SWITCH = `
    <div id="s" role="switch" aria-checked="false" aria-label="Open to remote"
         style="width:40px;height:20px"></div>
    <script>
      const s = document.getElementById('s');
      s.addEventListener('pointerdown', () => {
        s.setAttribute('aria-checked', s.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      });
    </script>`;

  test("a switch is turned on", async ({ page }) => {
    await load(page, SWITCH);
    await readDeep(page);
    const [outcome] = await write(page, said("open_to_remote", "yes"));
    expect(outcome!.status).toBe("written");
    expect(await page.getAttribute("#s", "aria-checked")).toBe("true");
  });

  test("a switch already in the right state is left alone", async ({ page }) => {
    await load(page, SWITCH);
    await readDeep(page);
    const [outcome] = await write(page, said("open_to_remote", "no"));
    expect(outcome!.status).toBe("written");
    expect(await page.getAttribute("#s", "aria-checked")).toBe("false");
  });

  test("turning it on twice does not turn it back off", async ({ page }) => {
    await load(page, SWITCH);
    await readDeep(page);
    await write(page, said("open_to_remote", "yes"));
    await write(page, said("open_to_remote", "yes"));
    expect(await page.getAttribute("#s", "aria-checked")).toBe("true");
  });

  test("a div checkbox is ticked", async ({ page }) => {
    await load(
      page,
      `<div id="c" role="checkbox" aria-checked="false" aria-label="I agree"
            style="width:20px;height:20px"></div>
       <script>
         const c = document.getElementById('c');
         c.addEventListener('pointerdown', () => c.setAttribute('aria-checked', 'true'));
       </script>`,
    );
    await readDeep(page);
    await write(page, said("i_agree", "I agree"));
    expect(await page.getAttribute("#c", "aria-checked")).toBe("true");
  });

  test("a switch that refuses to move is reported honestly", async ({ page }) => {
    await load(
      page,
      `<div id="s" role="switch" aria-checked="false" aria-label="Locked"
            style="width:40px;height:20px"></div>`,
    );
    await readDeep(page);
    const [outcome] = await write(page, said("locked", "yes"));
    expect(outcome!.status).toBe("rejected-by-page");
  });
});

/**
 * A menu drawn late. On a busy machine Greenhouse's country picker drew its 244 options after
 * the fixed 150 ms the harvest used to wait, so it was read as empty — and a "+91" had no picker
 * to go to. The harvest now waits for the menu itself, not for a guess at how long one takes.
 */
test.describe("a dropdown whose menu is slow to draw", () => {
  const SLOW_SELECT = (delay: number) => `
    <div style="width:220px">
      <div id="s-label">Seniority</div>
      <div id="s-value" style="height:20px"></div>
      <input id="s" role="combobox" aria-labelledby="s-label" aria-expanded="false" style="width:200px;height:24px">
    </div>
    <script>
      const input = document.getElementById('s');
      input.addEventListener('pointerdown', () => {
        if (document.querySelector('.pop')) return;
        setTimeout(() => {
          const pop = document.createElement('div');
          pop.className = 'pop';
          ['Junior', 'Mid', 'Senior'].forEach((text) => {
            const opt = document.createElement('div');
            opt.setAttribute('role', 'option');
            opt.textContent = text;
            opt.style.height = '20px';
            opt.addEventListener('click', () => { document.getElementById('s-value').textContent = text; pop.remove(); });
            pop.appendChild(opt);
          });
          document.body.appendChild(pop);
        }, ${delay});
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.pop')?.remove(); });
    </script>`;

  test("its choices are still learned", async ({ page }) => {
    await load(page, SLOW_SELECT(400));
    const read = await readDeep(page);
    expect(byLabel(read, "Seniority")?.options?.map((o) => o.label)).toEqual(["Junior", "Mid", "Senior"]);
    expect(byLabel(read, "Seniority")?.searchable).toBeFalsy();
  });

  test("and one of them can be chosen", async ({ page }) => {
    await load(page, SLOW_SELECT(400));
    await readDeep(page);
    const [outcome] = await write(page, said("seniority", "Senior"));
    expect(outcome!.status).toBe("written");
    expect(await page.textContent("#s-value")).toBe("Senior");
  });

  test("a list that opens empty — it fills as you type — is not waited on", async ({ page }) => {
    await load(
      page,
      `<div style="width:220px"><div id="c-label">City</div>
         <input id="c" role="combobox" aria-labelledby="c-label" aria-autocomplete="list" aria-expanded="false" style="width:200px;height:24px"></div>
       <script>document.getElementById('c').addEventListener('pointerdown', (e) => e.target.setAttribute('aria-expanded', 'true'));</script>`,
    );
    const started = Date.now();
    const read = await readDeep(page);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(byLabel(read, "City")?.searchable).toBe(true);
  });
});

/**
 * A page that confirms a press late — Google Forms on a busy machine. A fixed 30 ms after the
 * click read it as refused; the agent said "that didn't go in", and the choice landed anyway.
 */
test.describe("a choice the page confirms late", () => {
  const SLOW_RADIOS = (delay: number | null) => `
    <div role="radiogroup" aria-label="Gender" style="width:300px">
      ${["Male", "Female", "Prefer not to say"]
        .map((label) => `<div role="radio" aria-checked="false" aria-label="${label}" style="height:24px">${label}</div>`)
        .join("")}
    </div>
    <script>
      document.querySelectorAll('[role=radio]').forEach((radio) => radio.addEventListener('click', () => {
        ${delay === null ? "" : `setTimeout(() => {
          document.querySelectorAll('[role=radio]').forEach((r) => r.setAttribute('aria-checked', 'false'));
          radio.setAttribute('aria-checked', 'true');
        }, ${delay});`}
      }));
    </script>`;

  test("is written once the page confirms it", async ({ page }) => {
    await load(page, SLOW_RADIOS(600));
    await readDeep(page);
    const [outcome] = await write(page, said("gender", "Female"));
    expect(outcome!.status).toBe("written");
    expect(await page.getAttribute("[aria-label=Female]", "aria-checked")).toBe("true");
  });

  test("a page that never confirms is still reported, not waited on forever", async ({ page }) => {
    await load(page, SLOW_RADIOS(null));
    await readDeep(page);
    const [outcome] = await write(page, said("gender", "Female"));
    expect(outcome!.status).toBe("rejected-by-page");
  });
});

/**
 * A widget that is on the page before its script is. Server-rendered forms show their dropdowns
 * first and bring them to life later — on a busy machine, Greenhouse's took eight seconds. Pressed
 * too early, nothing happens; that silence is not "a list with no choices".
 */
test.describe("a dropdown whose script arrives late", () => {
  test("is asked again before it is written off", async ({ page }) => {
    await load(
      page,
      `<div style="width:220px"><div id="h-label">Seniority</div>
         <input id="h" role="combobox" aria-labelledby="h-label" aria-expanded="false" style="width:200px;height:24px"></div>
       <script>
         setTimeout(() => {
           const input = document.getElementById('h');
           input.addEventListener('pointerdown', () => {
             if (document.querySelector('.pop')) return;
             input.setAttribute('aria-expanded', 'true');
             const pop = document.createElement('div');
             pop.className = 'pop';
             ['Junior', 'Mid', 'Senior'].forEach((text) => {
               const opt = document.createElement('div');
               opt.setAttribute('role', 'option');
               opt.textContent = text;
               opt.style.height = '20px';
               pop.appendChild(opt);
             });
             document.body.appendChild(pop);
           });
           input.addEventListener('keydown', (e) => {
             if (e.key === 'Escape') { document.querySelector('.pop')?.remove(); input.setAttribute('aria-expanded', 'false'); }
           });
         }, 2500);
       </script>`,
    );
    const read = await readDeep(page);
    expect(byLabel(read, "Seniority")?.options?.map((o) => o.label)).toEqual(["Junior", "Mid", "Senior"]);
    expect(byLabel(read, "Seniority")?.searchable).toBeFalsy();
  });
});
