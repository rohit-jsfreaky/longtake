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

/**
 * aria-labelledby strung together: the question is the part a person reads as one. Each case is a
 * real form: MS Forms (screen-reader text), Jotform (the hint under the box), Typeform (the number).
 */
test.describe("the question among several labelling parts", () => {
  test("screen-reader-only text is not part of the question", async ({ page }) => {
    await load(
      page,
      `<span id="q">First Name</span>
       <span id="t" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Single line text.</span>
       <input id="f" aria-labelledby="q t">`,
    );
    expect(only(await read(page)).label).toBe("First Name");
  });

  test("a hint set after the box is not part of the question", async ({ page }) => {
    await load(page, `<label id="q" for="f">Email</label> <input id="f" aria-labelledby="q h"> <label id="h" for="f">example@example.com</label>`);
    expect(only(await read(page)).label).toBe("Email");
  });

  test("the question's number is not part of it", async ({ page }) => {
    await load(page, `<span id="n">1</span> <span id="q">What’s your first name?</span> <input id="f" aria-labelledby="n q">`);
    expect(only(await read(page)).label).toBe("What’s your first name?");
  });

  test("…nor a number written into the same text", async ({ page }) => {
    await load(page, `<label for="f">1. First Name</label><input id="f">`);
    expect(only(await read(page)).label).toBe("First Name");
  });

  test("…while a number that belongs to the question stays", async ({ page }) => {
    await load(page, `<label for="f">2.5 GPA or above?</label><input id="f">`);
    expect(only(await read(page)).label).toBe("2.5 GPA or above?");
  });
});

/**
 * No label, no aria: the question written beside the control (Lever), or a label whose `for` names
 * an id the control does not have (Ashby). The field's own block holds the question.
 */
test.describe("a question set beside its control", () => {
  test("the text before the control in its own block is the question, not the placeholder", async ({ page }) => {
    await load(
      page,
      `<ul><li><div class="label">Preferred Name</div><div><input name="cards[a][field0]" placeholder="Type your response"></div></li>
           <li><div class="label">Name Pronunciation</div><div><input name="cards[a][field1]" placeholder="Type your response"></div></li></ul>`,
    );
    expect((await read(page)).specs.map((s) => s.label)).toEqual(["Preferred Name", "Name Pronunciation"]);
  });

  test("a radio group with no legend is named by its own block", async ({ page }) => {
    await load(
      page,
      `<li><div class="label">Are you legally authorized to work here? <span>✱</span></div>
         <ul><li><label><input type="radio" name="cards[b][field0]" value="Yes"> Yes</label></li>
             <li><label><input type="radio" name="cards[b][field0]" value="No"> No</label></li></ul></li>`,
    );
    const spec = only(await read(page));
    expect(spec.label).toBe("Are you legally authorized to work here?");
    expect(spec.required).toBe(true);
  });

  test("a label whose for= names nothing still names the control in its block", async ({ page }) => {
    await load(page, `<div><label for="gone">Location</label><div><input role="combobox" placeholder="Start typing..."></div></div>`);
    expect(only(await read(page)).label).toBe("Location");
  });

  test("a block shared with another field gives no question — a section heading is not one", async ({ page }) => {
    await load(
      page,
      `<section><h3>Contact</h3><input placeholder="Email address"><input placeholder="Phone number"></section>`,
    );
    expect((await read(page)).specs.map((s) => s.label)).toEqual(["Email address", "Phone number"]);
  });

  test("a hint after the control is not the question", async ({ page }) => {
    await load(page, `<div><input placeholder="Your city"><small>We only show this to the recruiter</small></div>`);
    expect(only(await read(page)).label).toBe("Your city");
  });
});

test.describe("what a label's words are", () => {
  // Lever wraps a whole question in one <label>, its location dropdown included.
  test("a label wrapped round a text box gives only what is shown before the box", async ({ page }) => {
    await load(
      page,
      `<label><div>Current location <span>✱</span></div>
         <input name="location">
         <div>No location found. Try entering a different location</div>
         <div style="display:none">Loading</div></label>`,
    );
    expect(only(await read(page)).label).toBe("Current location");
  });

  test("…while a checkbox's words after it still count", async ({ page }) => {
    await load(page, `<label><input type="checkbox" name="agree"> I agree to the terms</label>`);
    expect(only(await read(page)).label).toBe("I agree to the terms");
  });

  // Workable writes its star first: "* Phone".
  test("a star before the question marks it required, and is not part of it", async ({ page }) => {
    await load(page, `<label for="f">* Phone</label><input id="f" type="tel">`);
    const spec = only(await read(page));
    expect(spec.label).toBe("Phone");
    expect(spec.required).toBe(true);
  });

  test("the question is the first block before the control, not the description under it", async ({ page }) => {
    await load(
      page,
      `<li><div><div>Which university did you attend? <span>✱</span></div><div>Please select Other if yours is not listed.</div></div>
         <div><select name="cards[c][field0]"><option>Aalto University</option><option>Other</option></select></div></li>`,
    );
    const spec = only(await read(page));
    expect(spec.label).toBe("Which university did you attend?");
    expect(spec.required).toBe(true);
  });
  // Luma sets a zero-width space before every input. It draws nothing — but it is not white space
  // to `\s` or `trim()`, and "\u200b" came out as the phone number's question.
  test("a character that draws nothing is not the question", async ({ page }) => {
    await load(
      page,
      `<div><label><div>Phone Number&nbsp;*</div></label>
         <div><div>\u200b</div><input type="tel" placeholder="+91 81234 56789" required></div></div>`,
    );
    expect(only(await read(page)).label).toBe("Phone Number");
  });

  test("…while one inside a word stays: Hindi joins its letters with it", async ({ page }) => {
    // Ka, virama, ZERO WIDTH JOINER, sha: the joiner asks for the half form of ka.
    const hindi = "\u0915\u094d\u200d\u0937 \u0928\u093e\u092e";
    await load(page, `<label for="f">${hindi}</label><input id="f">`);
    expect(only(await read(page)).label).toBe(hindi);
  });
});
