/**
 * The corpus itself is sound: every form opens offline, `core/` loads on it, every control Chrome
 * saw at capture can still be found by its locator, and nothing tries to leave the page.
 *
 * Runs only where the private corpus is checked out as `corpus/`; elsewhere there is nothing to run.
 */

import { expect, test } from "@playwright/test";

import { corpusForms, joinByElement, openForm, sentSoFar } from "./load";

const forms = corpusForms();

test("the corpus is checked out", () => {
  test.skip(forms.length === 0, "no corpus/ here — clone the private longtake-corpus repo into it");
  expect(forms.length).toBeGreaterThan(0);
});

for (const form of forms) {
  test(`${form.id} opens offline and every captured control is still there`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — read-only form");
    const sent = await openForm(page, form);
    const { joined } = await joinByElement(
      page,
      form.ax.controls.map((c) => c.locator),
    );

    const lost = joined.filter((j) => !j.found).map((j) => j.at);
    expect(lost, "locators that no longer resolve").toEqual([]);

    // A radio or checkbox group is read when any of its choices is part of a field we read.
    const groupRead = new Set<string>();
    form.ax.controls.forEach((control, i) => {
      if (control.group && joined[i]!.specId !== null) groupRead.add(control.group.key);
    });
    const unread = form.ax.controls
      .filter((control, i) =>
        control.group ? !groupRead.has(control.group.key) : control.dom.visible && joined[i]!.specId === null,
      )
      .map((control) => `${control.role} "${control.group?.label || control.name}"`)
      .filter((text, i, all) => all.indexOf(text) === i);
    test.info().annotations.push({ type: "unread by core", description: unread.join("; ") || "none" });

    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
