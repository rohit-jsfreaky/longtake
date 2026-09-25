/**
 * Answers that are pressed, not typed: a radio group (native, ARIA, or a component), a group of
 * checkboxes, and a single checkbox or switch.
 */

import { choiceGroup, choiceKey, deepQueryAll, openWidget, toggleGroup } from "../dom-path";
import { matchOption, normalise, optionNamedIn, readAsYesOrNo, type Choice } from "../choices";
import type { FieldSpec, SpokenValue } from "../types";
import type { WidgetAdapter } from "./index";
import { announce, cannot, clearShown, confirmed, notAChoice, pressChoice, radioGroup, type WriteOutcome } from "./kit";
import { pickFromWidget } from "./dropdowns";

/**
 * The options a group's answer names — or the refusal that says which it would take.
 *
 * A single choice can be recovered from the person's own words, as for a dropdown. Not a group of
 * checkboxes: which of several named things they meant to tick is not a fact the words alone settle.
 */
export function chosenFrom(spec: FieldSpec, spoken: SpokenValue): { chosen: Choice[]; wanted: string[] } | WriteOutcome {
  const wanted = Array.isArray(spoken.value) ? spoken.value : [String(spoken.value)];
  let chosen = wanted.map((one) => matchOption(spec, one)).filter((v): v is Choice => v !== null);
  if (chosen.length === 0 && spec.kind === "radio") {
    const named = optionNamedIn(spec, spoken.evidence);
    if (named) chosen = [named];
  }
  return chosen.length > 0 ? { chosen, wanted } : notAChoice(spec, wanted.join(", "));
}

/** A radio group built of divs (or a component) holds its answer as aria-checked. */
function readAriaRadio(_spec: FieldSpec, el: HTMLElement) {
  const on = el.querySelector<HTMLElement>("[aria-checked='true']");
  return on ? (on.getAttribute("aria-label") ?? on.textContent ?? "").trim() || null : null;
}

/**
 * An ARIA radio group — Google Forms builds every choice question this way. Its answers are
 * already on the page, so it is pressed like one, not opened like a dropdown: opening it found
 * no menu, and every choice question on a Google Form came back refused.
 */
export const ariaRadiogroup: WidgetAdapter = {
  name: "aria-radiogroup",
  matches: (spec, el) => spec.kind === "radio" && el.getAttribute("role") === "radiogroup",
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    const first = decided.chosen[0]!;
    const want = normalise(first.label);
    const target = deepQueryAll(el, "[role='radio']").find(
      (radio) => normalise(radio.getAttribute("aria-label") ?? radio.textContent ?? "") === want || radio.getAttribute("data-value") === first.value,
    ) as HTMLElement | undefined;
    if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
    // Pressed where a person presses it. Workable's ARIA radio wraps a label and a real radio, and
    // listens to the radio — a click on the wrapper went nowhere, and all three of its yes-or-no
    // questions were "rejected by the page".
    const native = target.querySelector<HTMLInputElement>("input[type='radio']");
    if (native) pressChoice(native, true);
    else if (target.getAttribute("aria-checked") !== "true") target.click();
    return (await confirmed(() => target.getAttribute("aria-checked") === "true" || Boolean(native?.checked)))
      ? { fieldId: spec.id, status: "written", wrote: first.label }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
  },
  read: readAriaRadio,
  clear: clearShown,
};

/** Toggle buttons that answer one question (`toggleGroup`): the named one pressed, confirmed by aria-pressed. */
export const toggleButtons: WidgetAdapter = {
  name: "toggle-buttons",
  matches: (spec, el) => spec.kind === "radio" && toggleGroup(el).length > 0,
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    const first = decided.chosen[0]!;
    const target = toggleGroup(el).find((toggle) => normalise(toggle.textContent ?? "") === normalise(first.label));
    if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
    if (target.getAttribute("aria-pressed") !== "true") target.click();
    return (await confirmed(() => target.getAttribute("aria-pressed") === "true"))
      ? { fieldId: spec.id, status: "written", wrote: first.label }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
  },
  read(_spec, el) {
    const on = toggleGroup(el).find((toggle) => toggle.getAttribute("aria-pressed") === "true");
    return on ? (on.textContent ?? "").trim() || null : null;
  },
  async clear(spec, el) {
    const on = toggleGroup(el).find((toggle) => toggle.getAttribute("aria-pressed") === "true");
    if (on) {
      on.click();
      await confirmed(() => on.getAttribute("aria-pressed") !== "true");
    }
    return on?.getAttribute("aria-pressed") === "true"
      ? cannot(spec, "The form will not let this be left unanswered once picked.")
      : { fieldId: spec.id, status: "cleared" };
  },
};

/** A single-choice component that is neither a native radio nor an ARIA group: opened and pressed. */
export const customRadio: WidgetAdapter = {
  name: "custom-radio",
  matches: (spec) => spec.kind === "radio" && Boolean(spec.custom),
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    return pickFromWidget(spec, el, decided.chosen[0]!, decided.wanted.join(", "));
  },
  read: readAriaRadio,
  clear: clearShown,
};

/** Native radios: the named one pressed, by the key reader and writer share (`choiceKey`). */
export const nativeRadio: WidgetAdapter = {
  name: "native-radio",
  matches: (spec) => spec.kind === "radio",
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    const first = decided.chosen[0]!;
    const radios = radioGroup(el);
    const target = radios.find((radio) => choiceKey(radio, radios) === first.value);
    if (!target) return { fieldId: spec.id, status: "refused", reason: "That option is no longer on the page." };
    pressChoice(target, true);
    return target.checked
      ? { fieldId: spec.id, status: "written", wrote: first.label }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: first.label, found: "" };
  },
  read(spec, el) {
    if (el.tagName.toLowerCase() !== "input") return readAriaRadio(spec, el);
    const radios = radioGroup(el);
    const on = radios.find((radio) => radio.checked);
    if (!on) return null;
    return spec.options?.find((option) => option.value === choiceKey(on, radios))?.label ?? on.value;
  },
  async clear(spec, el) {
    if (el.tagName.toLowerCase() !== "input") return clearShown(spec, el);
    for (const radio of radioGroup(el)) {
      if (!radio.checked) continue;
      radio.checked = false;
      announce(radio, ["input", "change"]);
    }
    return radioGroup(el).some((radio) => radio.checked)
      ? cannot(spec, "The form put the choice back — it will not let this be left unanswered.")
      : { fieldId: spec.id, status: "cleared" };
  },
};

/** Tick exactly the named boxes of a group, and untick the rest — found by `choiceKey`, not value. */
export const checkboxGroup: WidgetAdapter = {
  name: "checkbox-group",
  matches: (spec) => spec.kind === "multiselect" && Boolean(spec.options),
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    const boxes = choiceGroup(el);
    // Each box by the key the reader gave its option — not its value: boxes without one all say "on".
    const wantedValues = decided.chosen.map((c) => c.value);
    const wants = (box: HTMLInputElement) => wantedValues.includes(choiceKey(box, boxes));
    for (const box of boxes) {
      const shouldCheck = wants(box);
      if (box.checked !== shouldCheck) pressChoice(box, shouldCheck);
    }
    // Read back, as everywhere else: "written" is a claim about the page, not about our presses.
    const wrote = decided.chosen.map((c) => c.label).join(", ");
    const off = boxes.filter((box) => box.checked !== wants(box));
    return off.length === 0 && boxes.length > 0
      ? { fieldId: spec.id, status: "written", wrote }
      : { fieldId: spec.id, status: "rejected-by-page", wrote, found: boxes.filter((box) => box.checked).map((box) => box.value).join(", ") };
  },
  read(spec, el) {
    const boxes = choiceGroup(el);
    const ticked = boxes
      .filter((box) => box.checked)
      .map((box) => spec.options?.find((option) => option.value === choiceKey(box, boxes))?.label ?? box.value);
    return ticked.length > 0 ? ticked : null;
  },
  async clear(spec, el) {
    const boxes = choiceGroup(el);
    for (const box of boxes) pressChoice(box, false);
    return boxes.some((box) => box.checked) ? cannot(spec, "The form would not let this be unticked.") : { fieldId: spec.id, status: "cleared" };
  },
};

/** A div wearing role="checkbox" or role="switch": pressed the way the reader found it answers. */
export const ariaCheckbox: WidgetAdapter = {
  name: "aria-checkbox",
  matches: (spec) => spec.kind === "checkbox" && Boolean(spec.custom),
  async write(spec, el, spoken) {
    const yes = readAsYesOrNo(spoken.value);
    const already = el.getAttribute("aria-checked") === "true";
    if (already !== yes) {
      openWidget(el); // the same press sequence; a switch answers pointerdown too
      await confirmed(() => (el.getAttribute("aria-checked") === "true") === yes);
    }
    const now = el.getAttribute("aria-checked") === "true";
    return now === yes
      ? { fieldId: spec.id, status: "written", wrote: yes ? "checked" : "unchecked" }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: yes ? "checked" : "unchecked", found: `aria-checked=${el.getAttribute("aria-checked")}` };
  },
  read: (_spec, el) => (el.getAttribute("aria-checked") === "true" ? true : null),
  async clear(spec, el) {
    if (el.getAttribute("aria-checked") === "true") {
      openWidget(el);
      await confirmed(() => el.getAttribute("aria-checked") !== "true");
    }
    return el.getAttribute("aria-checked") === "true" ? cannot(spec, "The switch would not turn off.") : { fieldId: spec.id, status: "cleared" };
  },
};

/** A native checkbox: clicked only when its state is wrong, and read back. */
export const checkbox: WidgetAdapter = {
  name: "checkbox",
  matches: (spec) => spec.kind === "checkbox",
  async write(spec, el, spoken) {
    const yes = readAsYesOrNo(spoken.value);
    const box = el as HTMLInputElement;
    pressChoice(box, yes);
    return box.checked === yes
      ? { fieldId: spec.id, status: "written", wrote: yes ? "checked" : "unchecked" }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: String(yes), found: String(box.checked) };
  },
  read: (_spec, el) => ((el as HTMLInputElement).checked ? true : null),
  clear: checkboxGroup.clear,
};
