/**
 * The buttons on a form that are not answers — and the one that must never be pressed.
 *
 * Real forms are not one page of boxes. A job application has "Add another" under Education and
 * Experience; a Google Form has Next between its sections; everything ends in a Submit button.
 * Longtake has to be able to press the first two when the person asks — "I also studied at IIT",
 * "okay, next page" — or half of every such form is out of reach.
 *
 * The third is the product's one hard line: **it never submits.** Not discouraged in a prompt —
 * refused here. A submit-looking button is never offered as an action, never appears in the tool the
 * agent is given, and is re-checked at the moment of pressing, in case the page renamed a Next
 * button to "Submit" on its last page.
 */

import { deepQueryAll, isVisible } from "./dom-path";

export type ActionKind = "add-another" | "next";

export type FormAction = {
  id: string;
  kind: ActionKind;
  /** The button's own words: "Add another", "Next". */
  label: string;
};

export type ActionsRead = {
  actions: FormAction[];
  handles: Map<string, HTMLElement>;
  /** The form's submit button, by its own words — so the agent can say "press Submit Application". */
  submitLabel?: string;
};

const BUTTONS = "button, input[type='submit'], input[type='button'], [role='button'], a[role='button']";

/**
 * Anything that sends, pays, or finishes. Checked first, and it wins — so "Continue to payment" and
 * "Continue to checkout" are never a Next.
 */
const SUBMIT = /\b(submit|apply|send|finish|complete|pay|payment|checkout|place order|purchase|confirm|sign up|register|done)\b/i;
const NEXT = /^\s*(next|continue|save (and|&) continue|save & next|proceed|next (page|step|section))\b/i;
// "+ Add" sits outside the leading \b: a "+" at the start of the words is not a word boundary.
const ADD_ANOTHER = /(^\s*\+\s*add\b)|\b(add (another|more|one more|a new)|add (an? )?(education|experience|job|position|school|degree|reference|link|entry|employer|language|certification|project))/i;

function wordsOf(el: HTMLElement): string {
  const own =
    el.tagName.toLowerCase() === "input" ? (el as HTMLInputElement).value : (el.innerText ?? el.textContent ?? "");
  return (own || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
}

/** What a button is, from its words alone. Submit wins over everything. */
export function classify(words: string): ActionKind | "submit" | null {
  if (!words) return null;
  if (SUBMIT.test(words)) return "submit";
  if (NEXT.test(words)) return "next";
  if (ADD_ANOTHER.test(words)) return "add-another";
  return null;
}

function slug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export function readActions(root: Document | Element, ignore = "[data-longtake-ignore]"): ActionsRead {
  const actions: FormAction[] = [];
  const handles = new Map<string, HTMLElement>();
  let submitLabel: string | undefined;

  for (const node of deepQueryAll(root, BUTTONS)) {
    const el = node as HTMLElement;
    if (ignore && el.closest(ignore)) continue;
    if ((el as HTMLButtonElement).disabled && classify(wordsOf(el)) !== "submit") continue;
    if (!isVisible(el)) continue;

    const words = wordsOf(el);
    const kind = classify(words);
    if (kind === "submit") {
      submitLabel ??= words;
      continue;
    }
    if (!kind) continue;

    let id = slug(`${kind === "next" ? "next" : "add"} ${words}`) || kind;
    for (let n = 2; handles.has(id); n++) id = `${slug(`${kind} ${words}`)}_${n}`;
    actions.push({ id, kind, label: words });
    handles.set(id, el);
  }

  return { actions, handles, ...(submitLabel ? { submitLabel } : {}) };
}

/**
 * Press an action — after checking, at that moment, that it is still what it was.
 *
 * A multi-step form's Next button often becomes "Submit" on the last step. Classified when the page
 * was read, pressed a turn later, it could send the form. So it is read again right before the press.
 */
export function pressAction(el: HTMLElement): { pressed: true } | { pressed: false; reason: string } {
  if (!el.isConnected) return { pressed: false, reason: "That button is no longer on the page." };
  const kind = classify(wordsOf(el));
  if (kind === "submit") return { pressed: false, reason: "That button submits the form. Only the person presses that." };
  if (!kind) return { pressed: false, reason: "That button is not one Longtake presses." };
  el.scrollIntoView({ block: "nearest" });
  el.click();
  return { pressed: true };
}
