/**
 * The corpus itself is sound: every form opens offline, `core/` loads on it, every control Chrome
 * saw at capture can still be found by its locator, and nothing tries to leave the page.
 *
 * Runs only where the private corpus is checked out as `corpus/`; elsewhere there is nothing to run.
 */

import { expect, test } from "@playwright/test";

import { corpusForms, joinTruth, openForm, readAsIs, sentSoFar } from "./load";

const forms = corpusForms();

test("the corpus is checked out", () => {
  test.skip(forms.length === 0, "no corpus/ here — clone the private longtake-corpus repo into it");
  expect(forms.length).toBeGreaterThan(0);
});

for (const form of forms) {
  test(`${form.id} opens offline and every captured control is still there`, async ({ page }) => {
    test.skip(!form.meta.fillable, "replay does not reproduce this page — read-only form");
    const sent = await openForm(page, form);
    await readAsIs(page);
    const { best, found, otherOrigin } = await joinTruth(
      page,
      form.ax.controls.map((c) => [c.locator]),
    );
    const at = (i: number) => [...form.ax.controls[i]!.locator.frames, ...form.ax.controls[i]!.locator.path].join(" | ");

    // Inside another origin's frame (a Terms widget, a captcha) the page cannot look — the
    // extension reads such a frame from inside it. Out of reach here, not lost.
    const lost = found.flatMap((ok, i) => (ok || otherOrigin[i] ? [] : [at(i)]));
    expect(lost, "locators that no longer resolve").toEqual([]);
    const elsewhere = otherOrigin.filter(Boolean).length;
    if (elsewhere > 0) test.info().annotations.push({ type: "in other origins' frames", description: String(elsewhere) });

    // A radio or checkbox group is read when any of its choices is part of a field we read.
    const groupRead = new Set<string>();
    form.ax.controls.forEach((control, i) => {
      if (control.group && best[i] !== null) groupRead.add(control.group.key);
    });
    const unread = form.ax.controls
      .filter((control, i) =>
        control.group ? !groupRead.has(control.group.key) : control.dom.visible && best[i] === null,
      )
      .map((control) => `${control.role} "${control.group?.label || control.name}"`)
      .filter((text, i, all) => all.indexOf(text) === i);
    test.info().annotations.push({ type: "unread by core", description: unread.join("; ") || "none" });

    expect(await sentSoFar(page, sent)).toEqual({ submits: [], posts: [] });
  });
}
