/**
 * The heading a field sits under, and the name of the form itself.
 *
 * Real forms reuse labels — two "First Name"s, two "City"s — and only the heading above tells
 * them apart. And the heading above ALL the fields is not a section at all, it is the form's
 * title, which is what the agent's opening line names.
 */

import { expect, test } from "@playwright/test";

import { field, load, read } from "./helpers";

test.describe("sections", () => {
  test("a field records the heading it sits under", async ({ page }) => {
    await load(
      page,
      `<h3>Application</h3>
       <label for="a">Email</label><input id="a" type="email">
       <h4>Emergency contact</h4>
       <label for="b">Phone</label><input id="b" type="tel">`,
    );
    const r = await read(page);
    expect(field(r, "phone").section).toBe("Emergency contact");
  });

  /**
   * The title governs every field, so it tells nothing apart — and it can do harm. The exclusions
   * in memory.ts read the section, and a job called "Customer Success Manager" would otherwise
   * rule out every email field on the page, because "manager" is how a manager's email is kept
   * from being mistaken for yours.
   */
  test("the heading above the first field is the title, not a section", async ({ page }) => {
    await load(
      page,
      `<h3>Customer Success Manager</h3>
       <label for="a">Email</label><input id="a" type="email">`,
    );
    const r = await read(page);
    expect(field(r, "email").section).toBeUndefined();
    const key = await page.evaluate(
      (spec) => window.__longtake.canonicalKey(spec as never),
      field(r, "email"),
    );
    expect(key).toBe("email");
  });

  test("a legend names its own fieldset, and nothing after it", async ({ page }) => {
    await load(
      page,
      `<label for="z">Name</label><input id="z">
       <fieldset><legend>Industry</legend>
         <label><input type="checkbox" name="i" value="Film"> Film</label>
         <label><input type="checkbox" name="i" value="Stage"> Stage</label>
       </fieldset>
       <label for="u">Unions</label><input id="u">`,
    );
    const r = await read(page);
    expect(field(r, "unions").section).toBeUndefined();
  });

  test("a group's legend is its question, not its section", async ({ page }) => {
    await load(
      page,
      `<label for="z">Name</label><input id="z">
       <fieldset><legend>Industry</legend>
         <label><input type="checkbox" name="i" value="Film"> Film</label>
         <label><input type="checkbox" name="i" value="Stage"> Stage</label>
       </fieldset>`,
    );
    const r = await read(page);
    expect(field(r, "industry").section).toBeUndefined();
  });

  test("a hidden heading is not a section", async ({ page }) => {
    await load(
      page,
      `<label for="z">Name</label><input id="z">
       <h4 style="display:none">Secret</h4>
       <label for="a">Email</label><input id="a" type="email">`,
    );
    const r = await read(page);
    expect(field(r, "email").section).toBeUndefined();
  });
});

test.describe("repeated labels", () => {
  const TWO_CONTACTS = `
    <h3>Membership</h3>
    <label for="o">Organization Name</label><input id="o">
    <h4>Designated Representative</h4>
    <label for="f1">First Name</label><input id="f1">
    <h4>Alternate Designated Representative</h4>
    <label for="f2">First Name</label><input id="f2">`;

  test("the section goes into the id, instead of a number", async ({ page }) => {
    await load(page, TWO_CONTACTS);
    const r = await read(page);
    const ids = r.specs.map((spec) => spec.id);
    expect(ids).toContain("designated_representative_first_name");
    expect(ids).toContain("alternate_designated_representative_first_name");
    expect(ids).not.toContain("first_name_2");
  });

  test("a label that appears once keeps its short id", async ({ page }) => {
    await load(page, TWO_CONTACTS);
    const r = await read(page);
    expect(r.specs.map((spec) => spec.id)).toContain("organization_name");
  });

  test("the label itself is left alone — the section is kept beside it", async ({ page }) => {
    await load(page, TWO_CONTACTS);
    const r = await read(page);
    expect(field(r, "alternate_designated_representative_first_name").label).toBe("First Name");
  });

  test("repeated labels with no heading between them are numbered as before", async ({ page }) => {
    await load(
      page,
      `<label for="a">Reference</label><input id="a"><label for="b">Reference</label><input id="b">`,
    );
    const r = await read(page);
    expect(r.specs.map((spec) => spec.id)).toEqual(["reference", "reference_2"]);
  });
});

test.describe("the form's title", () => {
  test("is the nearest heading above the first field", async ({ page }) => {
    await load(
      page,
      `<h1>Acme Careers</h1><h3>Society Membership Application</h3>
       <label for="a">Email</label><input id="a" type="email">`,
    );
    const title = await page.evaluate(() => {
      const L = window.__longtake;
      return L.titleOf(L.readForm());
    });
    expect(title).toBe("Society Membership Application");
  });

  test("falls back to the page title, without the site name", async ({ page }) => {
    await load(page, `<label for="a">Email</label><input id="a" type="email">`, "<title>Trademark Intake | Jotform</title>");
    const title = await page.evaluate(() => {
      const L = window.__longtake;
      return L.titleOf(L.readForm());
    });
    expect(title).toBe("Trademark Intake");
  });
});

// Greenhouse: the page's <title> names the job; "Apply for this job" is the nearest heading.
test("the form's title is the heading the page's own title names, not the nearest one", async ({ page }) => {
  await load(
    page,
    `<h1>Software Engineer, Backend</h1><h2>Apply for this job</h2>
     <label for="a">Email</label><input id="a" type="email">`,
    "<title>Job Application for Software Engineer, Backend at Glean</title>",
  );
  const title = await page.evaluate(() => {
    const L = window.__longtake;
    return L.titleOf(L.readForm());
  });
  expect(title).toBe("Software Engineer, Backend");
});

// Google Forms: every question is a `role="heading"` its input is labelled by. On the landing
// page's copy (whose <title> is ours) the agent opened with "Right, this is First Name".
test("a question's own heading is never the form's title", async ({ page }) => {
  await load(
    page,
    `<div role="heading" aria-level="1">Volunteer Registration &amp; Interest Form</div>
     <div role="list">
       <div role="listitem"><div role="heading" aria-level="3" id="q1">First Name</div>
         <input aria-labelledby="q1"></div>
       <div role="listitem"><div role="heading" aria-level="3" id="q2">Last Name</div>
         <input aria-labelledby="q2"></div>
     </div>`,
    "<title>Longtake — the whole form, in one take</title>",
  );
  const title = await page.evaluate(() => {
    const L = window.__longtake;
    return L.titleOf(L.readForm());
  });
  expect(title).toBe("Volunteer Registration & Interest Form");
});
