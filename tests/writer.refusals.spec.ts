import { expect, test } from "@playwright/test";
import { load, read, readThenWrite, valueOf } from "./helpers";

/**
 * The rules that make Longtake safe to point at a real application form.
 *
 * These are not prompt instructions. A language model cannot be argued out of them, because they
 * are checks in `writer.ts` with no path around them. Two reasons, and the second is the one
 * that matters: some forms plant fields to catch software that fills everything in, and a form
 * containing answers a person never gave is worse than an empty form — they are about to put
 * their name on it.
 */

test.describe("no spoken evidence, no write", () => {
  const FORM = `<label for="f">Desired salary</label><input id="f">`;

  test("an empty evidence string is refused", async ({ page }) => {
    await load(page, FORM);
    const [outcome] = await readThenWrite(page, [
      { fieldId: "desired_salary", value: "3000000", evidence: "" },
    ]);
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("whitespace-only evidence is refused", async ({ page }) => {
    await load(page, FORM);
    const [outcome] = await readThenWrite(page, [
      { fieldId: "desired_salary", value: "3000000", evidence: "   \n  " },
    ]);
    expect(outcome!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("missing evidence entirely is refused", async ({ page }) => {
    await load(page, FORM);
    await read(page);
    const outcomes = await page.evaluate(async () => {
      const last = window.__longtake.last!;
      // Deliberately malformed, the way a model's tool call might arrive.
      const spoken = [{ fieldId: "desired_salary", value: "3000000" }] as never;
      return (await window.__longtake.writeValues(last.specs, last.handles, spoken)) as unknown;
    });
    expect((outcomes as { status: string }[])[0]!.status).toBe("refused");
    expect(await valueOf(page, "#f")).toBe("");
  });

  test("the refusal says why, in words a person can be shown", async ({ page }) => {
    await load(page, FORM);
    const [outcome] = await readThenWrite(page, [
      { fieldId: "desired_salary", value: "3000000", evidence: "" },
    ]);
    expect(outcome!.reason).toMatch(/nothing was spoken/i);
  });

  test("evidence of any length is enough — we do not judge its quality", async ({ page }) => {
    await load(page, FORM);
    const [outcome] = await readThenWrite(page, [
      { fieldId: "desired_salary", value: "30 lakh", evidence: "thirty" },
    ]);
    expect(outcome!.status).toBe("written");
  });

  test("one field without evidence does not block the others", async ({ page }) => {
    await load(
      page,
      `<label for="a">First name</label><input id="a">
       <label for="b">Desired salary</label><input id="b">`,
    );
    const outcomes = await readThenWrite(page, [
      { fieldId: "first_name", value: "Rohit", evidence: "mera naam Rohit hai" },
      { fieldId: "desired_salary", value: "3000000", evidence: "" },
    ]);
    expect(outcomes[0]!.status).toBe("written");
    expect(outcomes[1]!.status).toBe("refused");
    expect(await valueOf(page, "#a")).toBe("Rohit");
    expect(await valueOf(page, "#b")).toBe("");
  });
});

test.describe("suspected traps are never written, even with evidence", () => {
  const traps: [name: string, html: string][] = [
    ["a honeypot by name", `<label for="f">Field</label><input id="f" name="honeypot">`],
    ["an hp_ prefix", `<label for="f">Field</label><input id="f" name="hp_email">`],
    ["a bot-check name", `<label for="f">Field</label><input id="f" name="bot_check">`],
    [
      "tabindex -1 with autocomplete off",
      `<label for="f">Field</label><input id="f" name="x" tabindex="-1" autocomplete="off">`,
    ],
  ];

  for (const [name, html] of traps) {
    test(`${name} is refused`, async ({ page }) => {
      await load(page, html);
      const result = await read(page);
      const id = result.specs[0]!.id;
      const [outcome] = await readThenWrite(page, [
        { fieldId: id, value: "filled in", evidence: "the person said something" },
      ]);
      expect(outcome!.status).toBe("refused");
      expect(await valueOf(page, "#f")).toBe("");
    });

    test(`${name} explains itself without accusing anyone`, async ({ page }) => {
      await load(page, html);
      const result = await read(page);
      const [outcome] = await readThenWrite(page, [
        { fieldId: result.specs[0]!.id, value: "x", evidence: "said" },
      ]);
      expect(outcome!.reason).toMatch(/catch software/i);
    });
  }

  test("an invisible field never even reaches the schema, so it cannot be targeted", async ({ page }) => {
    await load(page, `<label for="f">Field</label><input id="f" style="display:none">`);
    const result = await read(page);
    expect(result.specs).toHaveLength(0);
    const [outcome] = await readThenWrite(page, [
      { fieldId: "field", value: "x", evidence: "said" },
    ]);
    expect(outcome!.status).toBe("refused");
    expect(outcome!.reason).toMatch(/no such field/i);
  });
});

test.describe("things voice cannot do", () => {
  test("a file upload is refused, and says so plainly", async ({ page }) => {
    await load(page, `<label for="f">Resume</label><input id="f" type="file">`);
    const result = await read(page);
    expect(result.skipped.some((s) => /file cannot be attached/i.test(s.reason))).toBe(true);
  });

  test("a password field is never offered for filling", async ({ page }) => {
    await load(page, `<label for="f">Password</label><input id="f" type="password">`);
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("a password field is not even reported in skipped, by name", async ({ page }) => {
    // It is left out of everything. Nothing about a password should travel with an utterance.
    await load(page, `<label for="f">Password</label><input id="f" type="password">`);
    const result = await read(page);
    expect(JSON.stringify(result)).not.toContain("Password");
  });
});

test.describe("what the agent is given to ask about", () => {
  test("every refusal carries a reason", async ({ page }) => {
    await load(
      page,
      `<label for="a">Country</label>
       <select id="a"><option value="">Select…</option><option>India</option></select>
       <label for="b">Salary</label><input id="b">`,
    );
    const outcomes = await readThenWrite(page, [
      { fieldId: "country", value: "Atlantis", evidence: "said" },
      { fieldId: "salary", value: "x", evidence: "" },
    ]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("refused");
      expect(outcome.reason && outcome.reason.length > 0).toBe(true);
    }
  });

  test("a refusal is distinguishable from a page rejection", async ({ page }) => {
    // The agent says different things about these two. One is "I did not have that from you";
    // the other is "the site would not take it".
    await load(
      page,
      `<label for="a">Locked</label><input id="a">
       <script>
         const el = document.getElementById('a');
         el.addEventListener('input', () => { el.value = 'LOCKED'; });
       </script>
       <label for="b">Salary</label><input id="b">`,
    );
    const outcomes = await readThenWrite(page, [
      { fieldId: "locked", value: "mine", evidence: "said" },
      { fieldId: "salary", value: "x", evidence: "" },
    ]);
    expect(outcomes[0]!.status).toBe("rejected-by-page");
    expect(outcomes[1]!.status).toBe("refused");
  });

  test("nothing is reported as written unless the page kept it", async ({ page }) => {
    await load(
      page,
      `<label for="a">Locked</label><input id="a">
       <script>
         const el = document.getElementById('a');
         el.addEventListener('input', () => { el.value = ''; });
       </script>`,
    );
    const [outcome] = await readThenWrite(page, [
      { fieldId: "locked", value: "mine", evidence: "said" },
    ]);
    expect(outcome!.status).not.toBe("written");
  });
});
