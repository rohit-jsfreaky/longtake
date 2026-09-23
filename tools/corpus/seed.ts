/**
 * A draft answer key from Chrome's accessibility tree — for a human to correct, never to trust.
 *
 * Pure: `ax.json` in, `truth.json` (unverified) out. Radios and checkboxes that answer one question
 * together become one field; the question is the group's legend or radiogroup name. A control
 * that is in the tree but has no size on screen is marked as a suspected honeypot for the reviewer.
 * Concepts are left empty — the meaning pass and the reviewer fill them.
 */

import { classify } from "../../core/src/actions";
import type { FieldKind } from "../../core/src/types";
import type { AxCapture, AxControl, Truth, TruthField } from "./types";

/** "Email*", "Email Required question", "Email (required)" are all the question "Email". */
export function cleanQuestion(raw: string): string {
  return raw
    .replace(/\s*\((required|optional)\)\s*$/i, "")
    .replace(/\s*required question\s*$/i, "")
    .replace(/[\s*✱]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindOf(control: AxControl, groupSize: number): FieldKind {
  const { role, dom } = control;
  if (dom.tag === "textarea") return "textarea";
  if (role === "textbox" || role === "searchbox") {
    if (dom.tag !== "input") return "textarea"; // contenteditable, role=textbox divs
    const type = (dom.type ?? "text").toLowerCase();
    if (["email", "tel", "url", "number", "date"].includes(type)) return type as FieldKind;
    if (["datetime-local", "month", "week"].includes(type)) return "date";
    return "text";
  }
  if (role === "combobox" || role === "listbox") return dom.multiple ? "multiselect" : "select";
  if (role === "radiogroup" || role === "radio") return "radio";
  if (role === "checkbox" || role === "switch") return groupSize > 1 ? "multiselect" : "checkbox";
  if (role === "spinbutton" || role === "slider") return "number";
  if (role === "Date" || role === "DateTime") return "date";
  return "text";
}

export function seedTruth(id: string, ax: AxCapture): Truth {
  const fields: TruthField[] = [];
  const pathKey = (control: AxControl) => control.locator.path.join(" >> ");
  const radiogroups = new Map(ax.controls.filter((c) => c.role === "radiogroup").map((c) => [`rg:${pathKey(c)}`, c]));

  // Controls that answer one question together, by group key.
  const groups = new Map<string, AxControl[]>();
  for (const control of ax.controls) {
    if (!control.group) continue;
    const list = groups.get(control.group.key) ?? [];
    list.push(control);
    groups.set(control.group.key, list);
  }

  const done = new Set<AxControl>();
  let n = 0;
  const key = () => `f${String(++n).padStart(2, "0")}`;

  for (const control of ax.controls) {
    if (done.has(control)) continue;

    // An ARIA radiogroup: one field, its radios are the options.
    if (control.role === "radiogroup") {
      const radios = groups.get(`rg:${pathKey(control)}`) ?? [];
      for (const radio of radios) done.add(radio);
      done.add(control);
      fields.push(field(key(), control, "radio", control.name, radios.map((r) => cleanQuestion(r.name))));
      continue;
    }

    // Native radios or a checkbox group sharing a name or fieldset.
    if (control.group && !radiogroups.has(control.group.key)) {
      const members = groups.get(control.group.key) ?? [control];
      for (const member of members) done.add(member);
      const kind = kindOf(control, members.length);
      const question = control.group.label || control.name;
      fields.push(
        field(key(), control, kind, question, kind === "checkbox" ? undefined : members.map((m) => cleanQuestion(m.name))),
      );
      continue;
    }

    done.add(control);
    fields.push(field(key(), control, kindOf(control, 1), control.name, control.options));
  }

  const actions: Truth["pages"][number]["actions"] = [];
  let submit: string | undefined;
  for (const button of ax.buttons) {
    const kind = classify(button.name);
    if (kind === "submit") submit ??= button.name;
    else if (kind) actions.push({ label: button.name, kind });
  }

  return {
    id,
    pages: [{ page: 1, fields, actions, ...(submit ? { submit } : {}) }],
    fillPlan: [],
    verified: null,
  };
}

function field(key: string, control: AxControl, kind: FieldKind, question: string, options?: string[]): TruthField {
  const labels = (options ?? []).filter(Boolean);
  return {
    key,
    locator: control.locator,
    question: cleanQuestion(question),
    axName: control.name,
    axRole: control.role,
    ...(control.nameSource ? { axNameSource: control.nameSource } : {}),
    kind,
    required: control.required || /[*✱]\s*$/.test(question) || /required question\s*$/i.test(question),
    ...(labels.length > 0 ? { options: { labels, complete: true, searchable: false, multi: kind === "multiselect" } } : {}),
    concept: "",
    subject: "self",
    scope: "remember",
    longForm: kind === "textarea",
    honeypot: !control.dom.visible,
  };
}
