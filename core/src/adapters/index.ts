/**
 * One adapter per kind of widget, and the order they are tried in. The first that matches a field
 * writes it, reads it and clears it — so the three can never disagree about what the field is.
 *
 * A new widget is a new adapter here, placed before whatever would otherwise catch it.
 */

import type { FieldSpec, SpokenValue } from "../types";
import type { ClearOutcome, FieldValue, WriteOutcome } from "./kit";
import { customDropdown, nativeSelect, nativeSelectMultiple, searchableCombobox, tagPicker } from "./dropdowns";
import { ariaCheckbox, ariaRadiogroup, checkbox, checkboxGroup, customRadio, nativeRadio, toggleButtons } from "./choosing";
import { contentEditable, file, slider, text } from "./typing";

export type WidgetAdapter = {
  /** Which kind of widget this is — for logs and tests. */
  name: string;
  matches: (spec: FieldSpec, el: HTMLElement) => boolean;
  /** Put the spoken answer in, and say what the page now shows. Never trusts its own presses. */
  write: (spec: FieldSpec, el: HTMLElement, spoken: SpokenValue) => Promise<WriteOutcome>;
  /** What the field holds right now, read off the page — or null when it is empty. */
  read: (spec: FieldSpec, el: HTMLElement) => FieldValue;
  /** Take the answer back out, or say plainly that the page will not allow it. */
  clear: (spec: FieldSpec, el: HTMLElement) => Promise<ClearOutcome>;
};

/** Most particular first: every entry is only reached by fields the ones above it did not take. */
export const ADAPTERS: WidgetAdapter[] = [
  file,
  searchableCombobox,
  customDropdown,
  nativeSelect,
  nativeSelectMultiple,
  tagPicker,
  ariaRadiogroup,
  toggleButtons,
  customRadio,
  nativeRadio,
  checkboxGroup,
  ariaCheckbox,
  checkbox,
  slider,
  contentEditable,
  text,
];

export function adapterFor(spec: FieldSpec, el: HTMLElement): WidgetAdapter {
  return ADAPTERS.find((adapter) => adapter.matches(spec, el)) ?? text;
}
