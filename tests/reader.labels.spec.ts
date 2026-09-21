import { expect, test } from "@playwright/test";
import { byLabel, field, load, only, read } from "./helpers";

/**
 * How a field gets its name.
 *
 * This is the first thing the whole product depends on: the label is what the speaker will say
 * out loud, and what the language model matches their words against. A field called "" is a
 * field nobody can fill by voice.
 */

test.describe("label resolution, in priority order", () => {
  test("aria-labelledby beats everything else", async ({ page }) => {
    await load(
      page,
      `<span id="lbl">Desired salary</span>
       <label for="f">Ignored label</label>
       <input id="f" aria-labelledby="lbl" aria-label="Ignored aria" placeholder="Ignored ph">`,
    );
    expect(only(await read(page)).label).toBe("Desired salary");
  });

  test("aria-labelledby can join several elements", async ({ page }) => {
    await load(
      page,
      `<span id="a">Phone</span><span id="b">number</span>
       <input id="f" aria-labelledby="a b">`,
    );
    expect(only(await read(page)).label).toBe("Phone number");
  });

  test("a missing aria-labelledby target falls through rather than yielding empty", async ({ page }) => {
    await load(page, `<input id="f" aria-labelledby="nope" aria-label="Fallback">`);
    expect(only(await read(page)).label).toBe("Fallback");
  });

  test("aria-label beats a <label for>", async ({ page }) => {
    await load(page, `<label for="f">Written label</label><input id="f" aria-label="Spoken label">`);
    expect(only(await read(page)).label).toBe("Spoken label");
  });

  test("<label for> is used when there is no aria", async ({ page }) => {
    await load(page, `<label for="f">Email address</label><input id="f">`);
    expect(only(await read(page)).label).toBe("Email address");
  });

  test("a <label> wrapping the field works", async ({ page }) => {
    await load(page, `<label>Home city <input name="city"></label>`);
    expect(only(await read(page)).label).toBe("Home city");
  });

  test("a fieldset legend names a radio group", async ({ page }) => {
    await load(
      page,
      `<fieldset><legend>Work authorization</legend>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </fieldset>`,
    );
    expect(only(await read(page)).label).toBe("Work authorization");
  });

  test("placeholder is used when nothing else names the field", async ({ page }) => {
    await load(page, `<input name="q" placeholder="Search jobs">`);
    expect(only(await read(page)).label).toBe("Search jobs");
  });

  test("title is used after placeholder", async ({ page }) => {
    await load(page, `<input name="q" title="Your reference">`);
    expect(only(await read(page)).label).toBe("Your reference");
  });

  test("nearby preceding text is the last resort", async ({ page }) => {
    await load(page, `<div><p>Portfolio URL</p><input name="portfolio"></div>`);
    expect(only(await read(page)).label).toBe("Portfolio URL");
  });

  test("a field with nothing to name it reports an empty label, not a guess", async ({ page }) => {
    await load(page, `<input name="mystery">`);
    expect(only(await read(page)).label).toBe("");
  });
});

test.describe("label cleanup", () => {
  const markers: [string, string][] = [
    ["Country*", "Country"],
    ["Country *", "Country"],
    ["Are you a veteran? *", "Are you a veteran?"],
    ["  Spaced   out  ", "Spaced out"],
    ["Multi\nline\nlabel", "Multi line label"],
  ];

  for (const [raw, expected] of markers) {
    test(`"${raw.replace(/\n/g, "\n")}" becomes "${expected}"`, async ({ page }) => {
      await load(page, `<label for="f">${raw}</label><input id="f">`);
      expect(only(await read(page)).label).toBe(expected);
    });
  }

  test("the required marker is dropped from the label but kept as required", async ({ page }) => {
    await load(page, `<label for="f">Country*</label><input id="f" required>`);
    const spec = only(await read(page));
    expect(spec.label).toBe("Country");
    expect(spec.required).toBe(true);
  });
});

test.describe("labels across boundaries", () => {
  test("a label inside the same shadow root is found", async ({ page }) => {
    await load(page, `<div id="host"></div>`);
    await page.evaluate(() => {
      const root = document.getElementById("host")!.attachShadow({ mode: "open" });
      root.innerHTML = `<label for="inner">Shadow label</label><input id="inner">`;
    });
    expect(only(await read(page)).label).toBe("Shadow label");
  });

  test("a field inside a same-origin iframe is labelled from that frame", async ({ page }) => {
    await load(
      page,
      `<iframe srcdoc='<label for="f">Frame label</label><input id="f">'></iframe>`,
    );
    await page.waitForTimeout(150);
    expect(only(await read(page)).label).toBe("Frame label");
  });
});

test.describe("a wrapping label must not swallow the answer", () => {
  /**
   * `<label>Country <select>…</select></label>` is one of the most common shapes on the web, and
   * reading the label whole gives "Country Select… India United States Germany" — every option
   * absorbed into the question. It reached a running page before it was noticed, because the
   * field still worked; it was just called something absurd.
   */
  test("a wrapped select is labelled with the question, not its options", async ({ page }) => {
    await load(
      page,
      `<label>Country
         <select name="c"><option value="">Select…</option><option>India</option>
           <option>United States</option></select>
       </label>`,
    );
    expect(only(await read(page)).label).toBe("Country");
  });

  test("the options are still read as options", async ({ page }) => {
    await load(
      page,
      `<label>Country <select name="c"><option>India</option><option>Nepal</option></select></label>`,
    );
    expect(only(await read(page)).options?.map((o) => o.label)).toEqual(["India", "Nepal"]);
  });

  test("a wrapped checkbox is not labelled with its own value", async ({ page }) => {
    await load(page, `<label><input type="checkbox" name="c" value="yes"> I agree</label>`);
    expect(only(await read(page)).label).toBe("I agree");
  });

  test("a wrapped text input keeps its question", async ({ page }) => {
    await load(page, `<label>Home city <input name="city" value="Kolkata"></label>`);
    expect(only(await read(page)).label).toBe("Home city");
  });

  test("a wrapped textarea with content keeps its question", async ({ page }) => {
    await load(page, `<label>Notes <textarea name="n">already typed</textarea></label>`);
    expect(only(await read(page)).label).toBe("Notes");
  });

  test("a label holding two controls still reads cleanly", async ({ page }) => {
    await load(page, `<label>Full name <input name="a"> <input name="b"></label>`);
    const result = await read(page);
    for (const spec of result.specs) expect(spec.label).toBe("Full name");
  });

  test("markup inside the label is kept, controls are not", async ({ page }) => {
    await load(page, `<label><strong>Desired</strong> salary <input name="s"></label>`);
    expect(only(await read(page)).label).toBe("Desired salary");
  });
});

test.describe("furniture that is not part of the person's form", () => {
  test("anything marked data-longtake-ignore is skipped by default", async ({ page }) => {
    await load(
      page,
      `<label for="a">Email</label><input id="a">
       <div data-longtake-ignore><label for="b">Our own widget</label><input id="b"></div>`,
    );
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("the ignore applies through a shadow root, where closest() gives up", async ({ page }) => {
    await load(page, `<label for="a">Email</label><input id="a"><div id="tool" data-longtake-ignore></div>`);
    await page.evaluate(() => {
      document.getElementById("tool")!.attachShadow({ mode: "open" }).innerHTML =
        `<label for="x">Inside our widget</label><input id="x">`;
    });
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("a caller can widen the ignore to another tool's overlay", async ({ page }) => {
    await load(
      page,
      `<label for="a">Email</label><input id="a">
       <dev-overlay><label for="b">Open Dev Tools</label><input id="b"></dev-overlay>`,
    );
    const count = await page.evaluate(
      () => window.__longtake.readForm(document, "", "[data-longtake-ignore], dev-overlay").specs.length,
    );
    expect(count).toBe(1);
  });

  test("an empty ignore selector disables the filter rather than throwing", async ({ page }) => {
    await load(page, `<div data-longtake-ignore><label for="b">Widget</label><input id="b"></div>`);
    const count = await page.evaluate(
      () => window.__longtake.readForm(document, "", "").specs.length,
    );
    expect(count).toBe(1);
  });
});
