/**
 * A form that changes shape while it is being filled in.
 *
 * Modelled on a live Jotform membership application (form.jotform.com/221326312365043): it loads
 * with one question, "Independent" reveals one set of fields, "Organization" reveals a different
 * set plus a second contact, and the fields common to both stay put. The markup below keeps the
 * two things about the real page that make it hard:
 *
 *   - hidden fields stay in the DOM with `display: none`, keeping whatever was typed into them
 *   - the representative and the alternate are both labelled just "First Name" and "Email",
 *     and only the heading above says whose is whose
 *
 * One deliberate difference: the reveal listens for `click` only, the way React's `onChange` does
 * for radios. The writer used to set `.checked` and fire `change`, which works on the plain
 * Jotform page and silently does nothing on a React form — the box ticks and the form never
 * reacts. Testing against the stricter page is what catches that.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const MEMBERSHIP = `
<form>
  <h3>Society Membership Application</h3>

  <fieldset>
    <legend>Are you applying as an Independent Representative, or a Representative of your Organization?</legend>
    <label><input type="radio" name="q40" value="Independent Representative" required> Independent Representative</label>
    <label><input type="radio" name="q40" value="Organization Representative"> Organization Representative</label>
  </fieldset>

  <div id="ind" style="display:none">
    <h4>Independent Information</h4>
    <label for="n42">Independent's Name</label><input id="n42" required>
    <label for="c43">City</label><input id="c43">
  </div>

  <div id="org" style="display:none">
    <h4>Organization Information</h4>
    <label for="n39">Organization Name</label><input id="n39" required>
    <label for="c9">City</label><input id="c9">
  </div>

  <div id="rep" style="display:none">
    <h4>Designated Representative</h4>
    <label for="f17">First Name</label><input id="f17" required>
    <label for="e18">Email</label><input id="e18" type="email" required>
  </div>

  <div id="alt" style="display:none">
    <h4>Alternate Designated Representative</h4>
    <label for="f21">First Name</label><input id="f21">
    <label for="e22">Email</label><input id="e22" type="email">
  </div>
</form>
<script>
  for (const radio of document.querySelectorAll('input[name=q40]')) {
    radio.addEventListener('click', () => {
      const independent = radio.value.startsWith('Independent');
      document.getElementById('ind').style.display = independent ? '' : 'none';
      document.getElementById('org').style.display = independent ? 'none' : '';
      document.getElementById('alt').style.display = independent ? 'none' : '';
      document.getElementById('rep').style.display = '';
    });
  }
</script>`;

type Snapshot = {
  ids: string[];
  sections: Record<string, string | undefined>;
  appeared: string[];
  disappeared: string[];
};

type Journey = {
  opening: string;
  gate: string;
  start: Snapshot;
  independent: Snapshot;
  organization: Snapshot;
  back: Snapshot;
  cityKept: string;
  cityFilled: boolean | null;
  keys: Record<string, string | null>;
};

/**
 * Walk the form the way a session does: read, answer the gate, re-read, change the answer,
 * re-read, change it back. Every read goes through one `FieldRegistry`, as in the product.
 */
async function journey(page: Page): Promise<Journey> {
  await load(page, MEMBERSHIP);
  return page.evaluate(async () => {
    const L = window.__longtake;
    const registry = new L.FieldRegistry();
    const snap = (change: ReturnType<typeof registry.adopt>) => ({
      ids: change.read.specs.map((spec) => spec.id),
      sections: Object.fromEntries(change.read.specs.map((spec) => [spec.id, spec.section])),
      appeared: change.appeared.map((spec) => spec.id),
      disappeared: change.disappeared.map((spec) => spec.id),
    });

    const first = registry.adopt(L.readForm());
    const gate = first.read.specs[0]!.id;
    const opening = L.openingLine(first.read.specs, L.titleOf(first.read));
    const start = snap(first);

    const pick = async (value: string) => {
      const read = registry.read!;
      await L.writeValues(read.specs, read.handles, [{ fieldId: gate, value, evidence: value }]);
    };

    await pick("Independent Representative");
    const afterIndependent = registry.adopt(L.readForm());
    const independent = snap(afterIndependent);

    // Something typed into the individual's city, which is about to be hidden.
    const city = afterIndependent.read.specs.find((spec) => spec.label === "City")!;
    (afterIndependent.read.handles.get(city.id) as HTMLInputElement).value = "Vancouver";

    await pick("Organization Representative");
    const orgChange = registry.adopt(L.readForm());
    const organization = snap(orgChange);
    // Read while the organisation's fields are on the page — the alternate only exists then.
    const keys = Object.fromEntries(
      orgChange.read.specs.map((spec) => [spec.id, L.canonicalKey(spec)]),
    );

    await pick("Independent Representative");
    const backChange = registry.adopt(L.readForm());
    const back = snap(backChange);
    const cityNow = backChange.read.handles.get(city.id) as HTMLInputElement | undefined;

    return {
      opening,
      gate,
      start,
      independent,
      organization,
      back,
      cityKept: cityNow?.value ?? "(gone)",
      cityFilled: cityNow ? L.isFilled(city, cityNow) : null,
      keys,
    };
  }) as Promise<Journey>;
}

test.describe("a form that starts as one question", () => {
  test("only the gate is read at first — the hidden fields are not questions yet", async ({ page }) => {
    const { start } = await journey(page);
    expect(start.ids).toHaveLength(1);
  });

  test("the opening line asks the gate, with its choices", async ({ page }) => {
    const { opening } = await journey(page);
    expect(opening).toContain("Right, this is Society Membership Application. It opens with one question:");
    expect(opening).toContain("Independent Representative or Organization Representative?");
  });
});

test.describe("answering the gate", () => {
  /**
   * The React case. The reveal listens for `click` only; setting `.checked` and firing `change`
   * would tick the box and reveal nothing. This fails against the old writer.
   */
  test("picking a radio reveals the fields it controls, even on a page that only hears clicks", async ({
    page,
  }) => {
    const { independent } = await journey(page);
    expect(independent.appeared.length).toBeGreaterThanOrEqual(4);
  });

  test("the individual's fields appear, the organisation's do not", async ({ page }) => {
    const { independent } = await journey(page);
    expect(independent.ids).toContain("independent_s_name");
    expect(independent.ids).not.toContain("organization_name");
  });

  test("a field keeps its section", async ({ page }) => {
    const { independent } = await journey(page);
    expect(independent.sections["independent_s_name"]).toBe("Independent Information");
    expect(independent.sections["first_name"]).toBe("Designated Representative");
  });
});

test.describe("changing the answer", () => {
  test("the individual's fields go and the organisation's arrive", async ({ page }) => {
    const { organization } = await journey(page);
    expect(organization.disappeared).toContain("independent_s_name");
    expect(organization.appeared).toContain("organization_name");
  });

  test("fields common to both keep their ids — the agent's ids never shift under it", async ({
    page,
  }) => {
    const { independent, organization } = await journey(page);
    for (const id of ["first_name", "email"]) {
      expect(independent.ids).toContain(id);
      expect(organization.ids).toContain(id);
      expect(organization.appeared).not.toContain(id);
    }
  });

  /**
   * The alternate's boxes are labelled exactly like the representative's. The heading is the only
   * difference, so it has to end up in the id — otherwise the model sees two "first_name"s.
   */
  test("the alternate's 'First Name' is named for its section, not numbered", async ({ page }) => {
    const { organization } = await journey(page);
    expect(organization.ids).toContain("alternate_designated_representative_first_name");
    expect(organization.ids).toContain("alternate_designated_representative_email");
    expect(organization.ids.some((id) => /_\d+$/.test(id))).toBe(false);
  });

  /**
   * The organisation's "City" is a different question from the individual's, asked in the same
   * words. It must not inherit the individual's id — that id means the other box, which still
   * holds the other answer.
   */
  test("a new field asking the same words never inherits a departed field's id", async ({ page }) => {
    const { independent, organization } = await journey(page);
    expect(independent.ids).toContain("city");
    expect(organization.ids).not.toContain("city");
    expect(organization.ids).toContain("organization_information_city");
  });
});

test.describe("changing it back", () => {
  test("the individual's fields return under their original ids", async ({ page }) => {
    const { independent, back } = await journey(page);
    expect(back.appeared).toContain("independent_s_name");
    expect(back.appeared).toContain("city");
    expect(back.ids.filter((id) => independent.ids.includes(id))).toEqual(independent.ids);
  });

  test("what was typed into a hidden field is still there when it comes back", async ({ page }) => {
    const { cityKept, cityFilled } = await journey(page);
    expect(cityKept).toBe("Vancouver");
    expect(cityFilled).toBe(true);
  });
});

test.describe("whose details are whose", () => {
  test("the representative's name is the person's own", async ({ page }) => {
    const { keys } = await journey(page);
    expect(keys["first_name"]).toBe("first_name");
    expect(keys["email"]).toBe("email");
  });

  /** Memory must never put the person's own name into the box meant for their stand-in. */
  test("the alternate's name and email are never treated as the person's", async ({ page }) => {
    const { keys } = await journey(page);
    const alternate = Object.keys(keys).filter((id) => id.startsWith("alternate_"));
    expect(alternate).toHaveLength(2); // the check below must not pass by checking nothing
    for (const id of alternate) expect(keys[id], id).toBeNull();
  });

  test("the organisation's city is not the person's city", async ({ page }) => {
    const { keys } = await journey(page);
    expect(keys).toHaveProperty("organization_information_city");
    expect(keys["organization_information_city"]).toBeNull();
  });
});

/**
 * Not every form hides a field. React forms usually unmount it and build a fresh one when it is
 * needed again — a new element, the same question. It must come back under the same id, or the
 * answer kept for it has nowhere to go.
 */
test.describe("a form that rebuilds its fields instead of hiding them", () => {
  test("a remounted field gets its old id back", async ({ page }) => {
    await load(
      page,
      `<form>
         <fieldset><legend>Contact me by</legend>
           <label><input type="radio" name="how" value="Email"> Email</label>
           <label><input type="radio" name="how" value="Phone"> Phone</label>
         </fieldset>
         <div id="slot"></div>
       </form>
       <script>
         const slot = document.getElementById('slot');
         for (const r of document.querySelectorAll('input[name=how]')) r.addEventListener('click', () => {
           slot.innerHTML = r.value === 'Email'
             ? '<label for="a">Email address</label><input id="a" type="email">'
             : '<label for="b">Phone number</label><input id="b" type="tel">';
         });
       </script>`,
    );

    const ids = await page.evaluate(async () => {
      const L = window.__longtake;
      const registry = new L.FieldRegistry();
      const first = registry.adopt(L.readForm());
      const gate = first.read.specs[0]!.id;
      const pick = async (value: string) => {
        const read = registry.read!;
        await L.writeValues(read.specs, read.handles, [{ fieldId: gate, value, evidence: value }]);
        return registry.adopt(L.readForm()).read.specs.map((spec) => spec.id);
      };
      return { email: await pick("Email"), phone: await pick("Phone"), again: await pick("Email") };
    });

    expect(ids.email).toContain("email_address");
    expect(ids.phone).not.toContain("email_address");
    expect(ids.again).toContain("email_address");
    expect(ids.again.some((id) => /_\d+$/.test(id))).toBe(false);
  });
});
