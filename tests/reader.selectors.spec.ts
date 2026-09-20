import { expect, test, type Page } from "@playwright/test";
import { byLabel, load, only, read } from "./helpers";

/**
 * Finding a field again after the page has re-rendered.
 *
 * The governing rule is borrowed from an earlier project and is not negotiable: **give up rather
 * than return an ambiguous selector.** A selector that matches the wrong element does not fail
 * loudly — it silently types one answer into a different question's box.
 */

/**
 * The invariant that matters more than any individual case: every selector we hand out must
 * resolve to the exact element it was made for. Cheap to check, and it catches whole classes of
 * bug at once.
 */
async function everySelectorResolves(page: Page) {
  return page.evaluate(() => {
    const last = window.__longtake.last!;
    const wrong: string[] = [];
    for (const spec of last.specs) {
      if (!spec.selector) continue;
      const found = document.querySelectorAll(spec.selector);
      if (found.length !== 1 || found[0] !== last.handles.get(spec.id)) {
        wrong.push(`${spec.id} → ${spec.selector} (matched ${found.length})`);
      }
    }
    return wrong;
  });
}

test.describe("the shortest selector that is still unique", () => {
  test("a unique id is used directly", async ({ page }) => {
    await load(page, `<label for="email">Email</label><input id="email">`);
    expect(only(await read(page)).selector).toBe("#email");
  });

  test("an id needing escaping is escaped", async ({ page }) => {
    await load(page, `<label for="a.b:c">Odd</label><input id="a.b:c">`);
    const selector = only(await read(page)).selector!;
    expect(selector).toContain("\\");
    expect(await everySelectorResolves(page)).toEqual([]);
  });

  test("a unique name is used when there is no id", async ({ page }) => {
    await load(page, `<label>Email <input name="email"></label>`);
    expect(only(await read(page)).selector).toBe('input[name="email"]');
  });

  test("an id is preferred over a name", async ({ page }) => {
    await load(page, `<label for="x">Email</label><input id="x" name="email">`);
    expect(only(await read(page)).selector).toBe("#x");
  });

  test("with neither, a structural path is built", async ({ page }) => {
    await load(page, `<div><label>Email <input></label></div>`);
    const selector = only(await read(page)).selector!;
    expect(selector).not.toBe("");
    expect(await everySelectorResolves(page)).toEqual([]);
  });

  test("look-alikes are told apart by position", async ({ page }) => {
    await load(
      page,
      `<div><label>One <input></label><label>Two <input></label><label>Three <input></label></div>`,
    );
    const result = await read(page);
    expect(result.specs).toHaveLength(3);
    expect(await everySelectorResolves(page)).toEqual([]);
  });

  test("duplicate names fall back to a path rather than an ambiguous name selector", async ({ page }) => {
    await load(
      page,
      `<div><label>First <input name="dup"></label><label>Second <input name="dup"></label></div>`,
    );
    const result = await read(page);
    for (const spec of result.specs) {
      expect(spec.selector).not.toBe('input[name="dup"]');
    }
    expect(await everySelectorResolves(page)).toEqual([]);
  });

  test("an ancestor id anchors the path once the path alone is ambiguous", async ({ page }) => {
    // Two structurally identical blocks, so the positional path matches both and the walk has
    // to keep going until it reaches something that pins one of them down.
    await load(
      page,
      `<div><div><label>Email <input></label></div></div>
       <section id="application"><div><div><label>Email <input></label></div></div></section>`,
    );
    const result = await read(page);
    expect(result.specs).toHaveLength(2);
    expect(result.specs.some((spec) => spec.selector?.includes("#application"))).toBe(true);
  });
});

test.describe("when there is no honest answer", () => {
  test("a field inside a shadow root gets no document selector", async ({ page }) => {
    await load(page, `<div id="host"></div>`);
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML =
        `<label for="a">Shadow field</label><input id="a">`;
    });
    // `document.querySelector` cannot see into a shadow root, so offering a selector would be a
    // lie. Absent is the correct answer, and callers treat it as "cannot be re-found".
    expect(byLabel(await read(page), "Shadow field").selector).toBeUndefined();
  });

  test("a field inside an iframe gets no parent-document selector", async ({ page }) => {
    await load(page, `<iframe srcdoc='<label for="a">Frame field</label><input id="a">'></iframe>`);
    await page.waitForTimeout(150);
    expect(byLabel(await read(page), "Frame field").selector).toBeUndefined();
  });

  test("an id that is duplicated across the page is not trusted", async ({ page }) => {
    // Invalid HTML, and common. `#dup` would match two elements, so it must not be used.
    await load(page, `<div><label>A <input id="dup"></label><label>B <input id="dup"></label></div>`);
    const result = await read(page);
    for (const spec of result.specs) {
      expect(spec.selector).not.toBe("#dup");
    }
    expect(await everySelectorResolves(page)).toEqual([]);
  });
});

test.describe("the invariant, on progressively nastier pages", () => {
  const pages: [name: string, html: string][] = [
    ["a flat form", `<label>A <input></label><label>B <input></label><label>C <input></label>`],
    [
      "deeply nested wrappers",
      `<div><div><div><div><div><div><label>Deep <input></label></div></div></div></div></div></div>`,
    ],
    [
      "repeated identical rows",
      `<table><tr><td><input name="r"></td></tr><tr><td><input name="r"></td></tr>
       <tr><td><input name="r"></td></tr></table>`,
    ],
    [
      "mixed controls",
      `<label>Text <input></label>
       <label>Area <textarea></textarea></label>
       <label>Pick <select><option>A</option></select></label>
       <label>Check <input type="checkbox" name="c"></label>`,
    ],
    [
      "ids that collide with CSS syntax",
      `<label for="a b">Spacey</label><input id="a b">
       <label for="1num">Numeric</label><input id="1num">
       <label for="has#hash">Hash</label><input id="has#hash">`,
    ],
    [
      "a form inside a form-like wrapper",
      `<form id="apply"><fieldset><legend>Details</legend>
         <label>Name <input name="n"></label><label>Email <input name="e"></label>
       </fieldset></form>`,
    ],
  ];

  for (const [name, html] of pages) {
    test(`${name}: every selector resolves to exactly its own element`, async ({ page }) => {
      await load(page, html);
      await read(page);
      expect(await everySelectorResolves(page)).toEqual([]);
    });

    test(`${name}: no field is silently dropped`, async ({ page }) => {
      await load(page, html);
      const result = await read(page);
      expect(result.specs.length).toBeGreaterThan(0);
    });
  }
});

test.describe("ids given to the binder", () => {
  test("the label becomes the property name, not the element id", async ({ page }) => {
    // Real ATS forms use meaningless names like `question_69292246`. The model reads these ids
    // while deciding where each spoken phrase belongs, so they have to mean something.
    await load(page, `<label for="question_69292246">Desired salary</label><input id="question_69292246">`);
    expect(only(await read(page)).id).toBe("desired_salary");
  });

  test("the name is used when there is no label", async ({ page }) => {
    await load(page, `<input name="postal_code" placeholder="">`);
    expect(only(await read(page)).id).toBe("postal_code");
  });

  test("ids are slugified to something a schema can hold", async ({ page }) => {
    await load(page, `<label for="f">Are you a veteran? (Yes/No)</label><input id="f">`);
    expect(only(await read(page)).id).toMatch(/^[a-z0-9_]+$/);
  });

  test("two fields with the same label get distinct ids", async ({ page }) => {
    await load(page, `<label>Email <input name="a"></label><label>Email <input name="b"></label>`);
    const result = await read(page);
    expect(new Set(result.specs.map((s) => s.id)).size).toBe(2);
  });

  test("three fields with the same label still get distinct ids", async ({ page }) => {
    await load(
      page,
      `<label>Phone <input name="a"></label><label>Phone <input name="b"></label>
       <label>Phone <input name="c"></label>`,
    );
    const result = await read(page);
    expect(new Set(result.specs.map((s) => s.id)).size).toBe(3);
  });

  test("a field with nothing to name it still gets a usable id", async ({ page }) => {
    await load(page, `<input>`);
    expect(only(await read(page)).id).toMatch(/^[a-z0-9_]+$/);
  });

  test("very long labels are truncated rather than becoming unusable keys", async ({ page }) => {
    const long = "Please describe in as much detail as you can manage exactly what you did";
    await load(page, `<label for="f">${long}</label><input id="f">`);
    expect(only(await read(page)).id.length).toBeLessThanOrEqual(48);
  });
});
