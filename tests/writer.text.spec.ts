import { expect, test } from "@playwright/test";
import { load, read, readThenWrite, valueOf, write } from "./helpers";

/**
 * Writing text into somebody else's input, and proving the page kept it.
 *
 * Every assertion here reads the value back out of the live DOM rather than trusting the
 * outcome object. That distinction is not pedantry: reporting success from the value we just
 * assigned is exactly how a dropdown got reported as filled while the form held nothing.
 */

const SPOKE = (fieldId: string, value: unknown) => [
  { fieldId, value, evidence: "the person said so" },
];

test.describe("plain text fields", () => {
  const kinds: [type: string, value: string][] = [
    ["text", "Rohit Kashyap"],
    ["email", "rohit@example.com"],
    ["tel", "+91 98765 43210"],
    ["url", "https://rohitbuilds.tech"],
    ["search", "backend roles"],
  ];

  for (const [type, value] of kinds) {
    test(`writes into input[type=${type}]`, async ({ page }) => {
      await load(page, `<label for="f">Field</label><input id="f" type="${type}">`);
      const [outcome] = await readThenWrite(page, SPOKE("field", value));
      expect(outcome!.status).toBe("written");
      expect(await valueOf(page, "#f")).toBe(value);
    });
  }

  // Greenhouse's phone box keeps digits only: "98765 43210" becomes "9876543210". The page took
  // the answer; calling that a refusal held a returning person's phone back for a yes.
  test("a page that formats what it was given has taken the answer, and what it shows is what went in", async ({ page }) => {
    await load(page, `<label for="f">Phone</label><input id="f" type="tel" oninput="this.value = this.value.replace(/\\D/g, '')">`);
    const [outcome] = await readThenWrite(page, SPOKE("phone", "98765 43210"));
    expect(outcome).toMatchObject({ status: "written", wrote: "9876543210" });
    const [other] = await readThenWrite(page, SPOKE("phone", "nine eight"));
    expect(other!.status).toBe("rejected-by-page");
  });

  test("writes into a textarea", async ({ page }) => {
    await load(page, `<label for="f">Cover letter</label><textarea id="f"></textarea>`);
    const [outcome] = await readThenWrite(page, SPOKE("cover_letter", "I build things."));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#f")).toBe("I build things.");
  });

  test("writes a number", async ({ page }) => {
    await load(page, `<label for="f">Years</label><input id="f" type="number">`);
    await readThenWrite(page, SPOKE("years", "7"));
    expect(await valueOf(page, "#f")).toBe("7");
  });

  test("writes a date", async ({ page }) => {
    await load(page, `<label for="f">Start date</label><input id="f" type="date">`);
    await readThenWrite(page, SPOKE("start_date", "2026-10-01"));
    expect(await valueOf(page, "#f")).toBe("2026-10-01");
  });

  test("replaces whatever was already there", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" value="old text">`);
    await readThenWrite(page, SPOKE("field", "new text"));
    expect(await valueOf(page, "#f")).toBe("new text");
  });

  test("an empty spoken value clears the field rather than being ignored", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" value="old text">`);
    await readThenWrite(page, SPOKE("field", ""));
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("unicode survives the round trip", async ({ page }) => {
    await load(page, `<label for="f">Name</label><input id="f">`);
    await readThenWrite(page, SPOKE("name", "रोहित कश्यप"));
    expect(await valueOf(page, "#f")).toBe("रोहित कश्यप");
  });

  test("quotes and angle brackets are written literally, not as markup", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f">`);
    const tricky = `He said "<script>alert(1)</script>" & left`;
    await readThenWrite(page, SPOKE("field", tricky));
    expect(await valueOf(page, "#f")).toBe(tricky);
  });

  test("a very long answer is written in full when there is no limit", async ({ page }) => {
    await load(page, `<label for="f">Story</label><textarea id="f"></textarea>`);
    const long = "word ".repeat(400).trim();
    await readThenWrite(page, SPOKE("story", long));
    expect((await valueOf(page, "#f")).length).toBe(long.length);
  });
});

test.describe("the page's own limits are respected", () => {
  test("text is truncated to maxlength rather than silently rejected", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f" maxlength="5">`);
    const [outcome] = await readThenWrite(page, SPOKE("code", "1234567890"));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#f")).toBe("12345");
  });

  test("text within maxlength is untouched", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f" maxlength="10">`);
    await readThenWrite(page, SPOKE("code", "12345"));
    expect(await valueOf(page, "#f")).toBe("12345");
  });

  test("truncation reports what was actually written, not what was spoken", async ({ page }) => {
    await load(page, `<label for="f">Code</label><input id="f" maxlength="3">`);
    const [outcome] = await readThenWrite(page, SPOKE("code", "abcdefg"));
    expect(outcome!.wrote).toBe("abc");
  });
});

test.describe("frameworks that keep their own copy of the value", () => {
  /**
   * React, Vue and Svelte hold the value in component state and overwrite anything assigned
   * straight onto the element. Going through the prototype's native setter updates the value the
   * framework is watching, so the change survives the next render.
   *
   * The page below is a small, honest simulation of that: a state variable updated from the
   * `input` event, and a render loop that reverts the element whenever the two disagree.
   */
  const CONTROLLED = `
    <label for="f">Controlled</label><input id="f">
    <script>
      let state = '';
      const el = document.getElementById('f');
      el.addEventListener('input', (e) => { state = e.target.value; });
      setInterval(() => { if (el.value !== state) el.value = state; }, 10);
    </script>`;

  test("a controlled input keeps the written value", async ({ page }) => {
    await load(page, CONTROLLED);
    await readThenWrite(page, SPOKE("controlled", "survives the render"));
    await page.waitForTimeout(120); // let several render passes run
    expect(await valueOf(page, "#f")).toBe("survives the render");
  });

  test("the framework's own state is updated, not just the DOM", async ({ page }) => {
    await load(page, CONTROLLED);
    await readThenWrite(page, SPOKE("controlled", "in state"));
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => (window as unknown as { state?: string }).state ?? null)).toBeNull();
    // Proven indirectly: the render loop reverts to `state`, so surviving means state matched.
    expect(await valueOf(page, "#f")).toBe("in state");
  });

  test("assigning without the native setter would NOT survive — the control case", async ({ page }) => {
    await load(page, CONTROLLED);
    await page.evaluate(() => {
      (document.getElementById("f") as HTMLInputElement).value = "assigned directly";
    });
    await page.waitForTimeout(120);
    // This is what the naive implementation does, and why `writer.ts` does not do it.
    expect(await valueOf(page, "#f")).toBe("");
  });
});

test.describe("events the page is listening for", () => {
  const LISTENER = `
    <label for="f">Field</label><input id="f">
    <div id="seen"></div>
    <script>
      const el = document.getElementById('f');
      const seen = [];
      for (const kind of ['input', 'change']) {
        el.addEventListener(kind, () => { seen.push(kind); document.getElementById('seen').textContent = seen.join(','); });
      }
    </script>`;

  test("an input event is dispatched", async ({ page }) => {
    await load(page, LISTENER);
    await readThenWrite(page, SPOKE("field", "x"));
    expect(await page.textContent("#seen")).toContain("input");
  });

  test("a change event is dispatched", async ({ page }) => {
    await load(page, LISTENER);
    await readThenWrite(page, SPOKE("field", "x"));
    expect(await page.textContent("#seen")).toContain("change");
  });

  test("the events bubble, so a delegated listener on the form hears them", async ({ page }) => {
    await load(
      page,
      `<form id="wrap"><label for="f">Field</label><input id="f"></form>
       <div id="heard">no</div>
       <script>
         document.getElementById('wrap').addEventListener('input', () => {
           document.getElementById('heard').textContent = 'yes';
         });
       </script>`,
    );
    await readThenWrite(page, SPOKE("field", "x"));
    expect(await page.textContent("#heard")).toBe("yes");
  });
});

test.describe("contenteditable", () => {
  test("writes into a contenteditable div", async ({ page }) => {
    await load(page, `<div id="f" contenteditable="true" aria-label="Bio"></div>`);
    const [outcome] = await readThenWrite(page, SPOKE("bio", "Full-stack developer."));
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#f")).toBe("Full-stack developer.");
  });

  test("replaces existing content", async ({ page }) => {
    await load(page, `<div id="f" contenteditable="true" aria-label="Bio">old</div>`);
    await readThenWrite(page, SPOKE("bio", "new"));
    expect(await valueOf(page, "#f")).toBe("new");
  });

  test("markup in the spoken text is not interpreted", async ({ page }) => {
    await load(page, `<div id="f" contenteditable="true" aria-label="Bio"></div>`);
    await readThenWrite(page, SPOKE("bio", "<b>bold</b>"));
    expect(await page.evaluate(() => document.querySelector("#f")!.querySelector("b"))).toBeNull();
  });
});

test.describe("a page that refuses the value is reported honestly", () => {
  test("a field that reverts is reported as rejected, never as written", async ({ page }) => {
    await load(
      page,
      `<label for="f">Locked</label><input id="f">
       <script>
         const el = document.getElementById('f');
         el.addEventListener('input', () => { el.value = 'LOCKED'; });
       </script>`,
    );
    const [outcome] = await readThenWrite(page, SPOKE("locked", "my answer"));
    expect(outcome!.status).toBe("rejected-by-page");
    expect(outcome!.found).toBe("LOCKED");
  });

  test("a field removed between the read and the write is refused", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f">`);
    await read(page);
    await page.evaluate(() => document.getElementById("f")!.remove());
    const [outcome] = await write(page, SPOKE("field", "x"));
    expect(outcome!.status).toBe("refused");
    expect(outcome!.reason).toMatch(/no longer on the page/i);
  });

  test("a field id that never existed is refused, not invented", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f">`);
    const [outcome] = await readThenWrite(page, SPOKE("not_a_field", "x"));
    expect(outcome!.status).toBe("refused");
    expect(outcome!.reason).toMatch(/no such field/i);
  });
});

test.describe("several fields at once", () => {
  const FORM = `
    <label for="a">First name</label><input id="a">
    <label for="b">Last name</label><input id="b">
    <label for="c">Email</label><input id="c">
    <label for="d">Phone</label><input id="d">`;

  test("one utterance fills four fields", async ({ page }) => {
    await load(page, FORM);
    const outcomes = await readThenWrite(page, [
      { fieldId: "first_name", value: "Rohit", evidence: "mera naam Rohit Kashyap hai" },
      { fieldId: "last_name", value: "Kashyap", evidence: "mera naam Rohit Kashyap hai" },
      { fieldId: "email", value: "rohit@example.com", evidence: "email is…" },
      { fieldId: "phone", value: "+91 98765 43210", evidence: "number is…" },
    ]);
    expect(outcomes.every((o) => o.status === "written")).toBe(true);
    expect(await valueOf(page, "#a")).toBe("Rohit");
    expect(await valueOf(page, "#b")).toBe("Kashyap");
    expect(await valueOf(page, "#c")).toBe("rohit@example.com");
    expect(await valueOf(page, "#d")).toBe("+91 98765 43210");
  });

  test("one outcome is returned per value, in order", async ({ page }) => {
    await load(page, FORM);
    const outcomes = await readThenWrite(page, [
      { fieldId: "email", value: "a@b.c", evidence: "said" },
      { fieldId: "first_name", value: "Rohit", evidence: "said" },
    ]);
    expect(outcomes.map((o) => o.fieldId)).toEqual(["email", "first_name"]);
  });

  test("fields nobody spoke to are left completely alone", async ({ page }) => {
    await load(page, FORM);
    await readThenWrite(page, [{ fieldId: "email", value: "a@b.c", evidence: "said" }]);
    expect(await valueOf(page, "#a")).toBe("");
    expect(await valueOf(page, "#b")).toBe("");
    expect(await valueOf(page, "#d")).toBe("");
  });

  test("one failure does not stop the rest", async ({ page }) => {
    await load(page, FORM);
    const outcomes = await readThenWrite(page, [
      { fieldId: "nope", value: "x", evidence: "said" },
      { fieldId: "email", value: "a@b.c", evidence: "said" },
    ]);
    expect(outcomes[0]!.status).toBe("refused");
    expect(outcomes[1]!.status).toBe("written");
    expect(await valueOf(page, "#c")).toBe("a@b.c");
  });
});

// Jotform's phone boxes carry a mask, "(000) 000-0000", that takes keystrokes, not a pasted number.
test.describe("a number shaped to the box's own placeholder", () => {
  test("digits that fit the shape are put in it", async ({ page }) => {
    await load(page, `<label for="p">Mobile</label><input id="p" type="tel" placeholder="(000) 000-0000">`);
    const [outcome] = await readThenWrite(page, [{ fieldId: "mobile", value: "98765 43210", evidence: "98765 43210" }]);
    expect(outcome!.status).toBe("written");
    expect(await valueOf(page, "#p")).toBe("(987) 654-3210");
  });

  test("…and a number that does not fit is left as said, for the page to judge", async ({ page }) => {
    await load(page, `<label for="p">Mobile</label><input id="p" type="tel" placeholder="(000) 000-0000">`);
    await readThenWrite(page, [{ fieldId: "mobile", value: "+91 98765 43210", evidence: "+91 98765 43210" }]);
    expect(await valueOf(page, "#p")).toBe("+91 98765 43210");
  });
});
