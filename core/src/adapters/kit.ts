/**
 * What every widget adapter shares: the outcomes it reports, and the handful of ways a page is
 * touched — assign a value the framework will keep, press a box, announce a change, read back
 * what the page now shows. See `writer.ts` for the rules these serve.
 */

import { closeWidget, choiceGroup } from "../dom-path";
import { normalise, realChoices, sayableChoices, type Choice } from "../choices";
import type { FieldSpec } from "../types";

export type WriteOutcome =
  | { fieldId: string; status: "written"; wrote: string }
  /**
   * We chose not to write, and why. Always safe to show a person.
   *
   * `choices` is set whenever the refusal was "that is not one of the options", and it carries
   * the page's real wording. Without it the agent can only repeat the question it just asked,
   * get the same answer, and repeat it again — which is exactly what happened on a live run:
   * the form offered Conference / Job Board / LinkedIn / Podcast, the person said "I heard from
   * X", and the agent asked "How did you hear about Glean?" twice more before giving up. A
   * refusal has to say what would be accepted, or it is not a recoverable failure.
   */
  | { fieldId: string; status: "refused"; reason: string; choices?: string[] }
  /** We tried, and the page did not take it. Never reported as success. */
  | {
      fieldId: string;
      status: "rejected-by-page";
      wrote: string;
      found: string;
      /** Set once the second attempt has also failed, so the agent knows to stop trying. */
      retried?: boolean;
    };

export type ClearOutcome =
  | { fieldId: string; status: "cleared" }
  /** The page offers no way to empty this one. Said plainly; never replaced with another answer. */
  | { fieldId: string; status: "cannot-clear"; reason: string };

/** What a field holds: text, the chosen option(s), a tick — or `null` when it is empty. */
export type FieldValue = string | string[] | boolean | null;

/** How long to let a component draw its options before giving up on it. */
export const WIDGET_OPEN_MS = 400;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a page gets to show that it took a press, however busy the machine. */
const CONFIRM_MS = 1500;

/**
 * Wait for the page to confirm what was pressed — not for a guess at how long that takes. True as
 * soon as `done()` holds (a quick page answers within a frame); false once `timeoutMs` passes (a
 * page that really did refuse).
 *
 * A fixed 30 ms after a click read Google Forms' choices as refused on a busy machine: the agent
 * was told "that didn't go in" — and then the choice landed anyway, a moment later. Polled rather
 * than observed, because a `checked` property changes without any mutation to observe.
 */
export function confirmed(done: () => boolean, timeoutMs = CONFIRM_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (done()) resolve(true);
      else if (Date.now() - started >= timeoutMs) resolve(false);
      else setTimeout(check, 16);
    };
    check();
  });
}

/**
 * React (and Vue, and Svelte) keep their own copy of an input's value and overwrite anything
 * set directly on the element. Going through the prototype's native setter updates the value
 * the framework is actually watching, so the change survives the next render.
 *
 * This works for text. It does **not** work for a component's selection — see `writer.ts`.
 */
export function setNativeValue(el: HTMLElement, value: string): void {
  // ⚠️ The prototype must come from the element's OWN window, not ours.
  //
  // An input inside an iframe is an instance of *that frame's* `HTMLInputElement`, a different
  // class in a different realm. `el instanceof HTMLInputElement` is false for it, and a setter
  // borrowed from the parent's prototype does not apply. The symptom is not an exception, it is
  // a field that silently stays empty — and ATS forms are embedded in iframes all the time.
  const view = (el.ownerDocument?.defaultView ?? window) as Window & typeof globalThis;
  const tag = el.tagName.toLowerCase();

  const prototype =
    tag === "textarea"
      ? view.HTMLTextAreaElement.prototype
      : tag === "select"
        ? view.HTMLSelectElement.prototype
        : view.HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }
}

/**
 * Tick or untick a native radio or checkbox the way a person does: by clicking it.
 *
 * ⚠️ Not by setting `.checked` and firing `change`. That looked right and passed every test on
 * plain HTML, and it does nothing on a React form — React's `onChange` for radios and checkboxes
 * listens for `click`, so the box shows a tick while the component never hears about it. On a
 * form whose questions depend on this answer ("applying as an individual or an organisation?")
 * that is the difference between the rest of the form appearing and nothing happening at all.
 *
 * A native `click()` sets the state and fires `click`, `input` and `change` in the browser's own
 * order, which every framework and every plain page agrees on. Only clicked when the state is
 * wrong, because clicking a checkbox that is already right would un-tick it.
 */
export function pressChoice(box: HTMLInputElement, want: boolean): void {
  if (box.checked !== want) box.click();
  // A page that cancels the click (some "are you sure?" handlers do) leaves it unchanged; the
  // caller reads `.checked` back and reports that honestly rather than forcing it.
}

export function announce(el: HTMLElement, kinds: string[]): void {
  for (const kind of kinds) {
    el.dispatchEvent(new Event(kind, { bubbles: true }));
  }
}

/** Press a control the whole way — for the × that empties a component dropdown. */
export function press(el: HTMLElement): void {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  }
}

/**
 * Leave the field the way a person does, so the form checks what was typed.
 *
 * Plenty of forms validate on blur — "invalid email", "enter a valid phone number" — and without
 * this the agent would move on with the error never having been raised.
 */
export function leave(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  el.dispatchEvent(new FocusEvent("blur", { composed: true }));
}

export function readBack(el: HTMLElement): string {
  // Tag name rather than `instanceof`, for the same cross-realm reason as `setNativeValue`:
  // an element from an iframe fails every `instanceof` check made against our own window, and
  // would fall through to reading `textContent` — which is always empty on an input, so a
  // perfectly good write reports itself as rejected.
  const tag = el.tagName.toLowerCase();

  if (tag === "input") {
    const input = el as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") {
      return input.checked ? input.value || "on" : "";
    }
    return input.value;
  }
  if (tag === "textarea" || tag === "select") return (el as HTMLTextAreaElement).value;
  return (el.textContent ?? "").trim();
}

/**
 * What the page is now *showing* for this control.
 *
 * Deliberately reads the surrounding block rather than the element, because a component paints
 * its chosen value into a sibling `div`, not into the input it happens to own.
 */
export function renderedText(el: HTMLElement): string {
  // A box you type into can show its choice as its own value — Luma's "How did you hear" puts
  // "LinkedIn" in the input itself — and `innerText` never includes a value. Read as not taken,
  // the pick was "rejected" and the widget closed on a form that had already moved on.
  const own = el.tagName.toLowerCase() === "input" ? ((el as HTMLInputElement).value ?? "").trim() : "";
  // Walk up until something has text, rather than guessing at a container by class name.
  //
  // A class-based `closest()` looks tidier and gets this wrong. React-Select nests
  // `select__input` inside `select__input-container` inside `select__value-container`, and only
  // the outermost of those three holds the chosen label — so `closest("[class*='select']")`
  // lands on the empty middle one and reports every successful selection as a failure.
  let node: HTMLElement | null = el.parentElement;
  for (let hops = 0; node && hops < 5; hops++) {
    const text = (node.innerText ?? "").replace(/\s+/g, " ").trim();
    if (text) return own ? `${own} ${text}` : text;
    node = node.parentElement;
  }
  return own;
}

/** Every radio sharing this one's name, wherever in the document they live. */
export function radioGroup(el: HTMLElement): HTMLInputElement[] {
  // Tag name, not `instanceof` — see `readBack` for why an iframe breaks the latter.
  if (el.tagName.toLowerCase() !== "input") return [];
  return choiceGroup(el);
}

/** The refusal for an answer that is none of the choices — carrying the choices, always. */
export function notAChoice(spec: FieldSpec, wanted: string, unread = ". Ask the person to fill this one in themselves."): WriteOutcome {
  const labels = realChoices(spec.options);
  return {
    fieldId: spec.id,
    status: "refused",
    reason: labels.length
      ? `"${wanted}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.`
      : `"${wanted}" does not match anything this field offers${unread}`,
    choices: labels,
  };
}

// ── Reading and clearing that several widgets share ────────────────────────────────────

/** What a dropdown shows when nothing is chosen: "Select...", "Choose one", "-- Please select --". */
const PLACEHOLDER = /^(select|choose|pick|please (select|choose)|none selected)\b|^-+.*-+$|(\.\.\.|…)$/i;

/** A box you type into: what it holds, or null. */
export function readText(el: HTMLElement): FieldValue {
  const text = readBack(el).trim();
  return text ? text : null;
}

/**
 * A component: its choice is shown, not held. The text on show is matched against the field's own
 * options — an option on show is the value; a placeholder or nothing is empty. Where the options
 * were never learned, whatever non-placeholder text is on show is taken as the value.
 */
export function readShown(spec: FieldSpec, el: HTMLElement): FieldValue {
  // A div trigger shows its choice in its own text; an input-based one (React-Select) shows it
  // in the block around it.
  const own = el.tagName.toLowerCase() === "input" ? "" : (el.innerText ?? "").replace(/\s+/g, " ").trim();
  const shown = (own || renderedText(el)).replace(/\s*×\s*$/, "").trim();
  if (!shown) return null;

  const choices = realChoices(spec.options);
  const heard = ` ${normalise(shown)} `;
  const onShow = choices
    .filter((choice) => {
      const word = normalise(choice);
      return word.length > 0 && heard.includes(` ${word} `);
    })
    .sort((a, b) => b.length - a.length);
  // A tag picker shows every pick at once; a single picker shows one.
  if (onShow.length > 0) return spec.kind === "multiselect" ? onShow : onShow[0]!;

  // Showing text that is none of its options: a placeholder, or a label from further up.
  // A searchable list's options are only what it showed when opened; a pick from a search
  // is none of them and is still an answer.
  if (PLACEHOLDER.test(shown) || (choices.length > 0 && !spec.searchable)) return null;
  return shown;
}

/** A control inside a custom dropdown that empties it — React-Select's ×, and its cousins. */
const CLEAR_CONTROL =
  "[aria-label*='clear' i], [title*='clear' i], [class*='clear-indicator'], [class*='clearIndicator'], [class*='ClearIndicator']";

export const cannot = (spec: FieldSpec, reason: string): ClearOutcome => ({ fieldId: spec.id, status: "cannot-clear", reason });

/** A component: use its own clear control, or Backspace, as a person would. */
export async function clearShown(spec: FieldSpec, el: HTMLElement): Promise<ClearOutcome> {
  const before = renderedText(el);
  let host: HTMLElement | null = el.parentElement;
  let control: HTMLElement | null = null;
  for (let hops = 0; host && !control && hops < 3; hops++) {
    control = host.querySelector<HTMLElement>(CLEAR_CONTROL);
    host = host.parentElement;
  }

  if (control) {
    press(control);
  } else {
    el.focus();
    for (const key of ["Backspace", "Delete"]) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, composed: true }));
    }
  }
  await sleep(150);
  closeWidget(el);

  return renderedText(el) !== before
    ? { fieldId: spec.id, status: "cleared" }
    : cannot(spec, "This dropdown has no way to empty it — once picked, the form keeps a choice.");
}

/** Text of every shape: emptied, and confirmed empty. */
export async function clearText(spec: FieldSpec, el: HTMLElement): Promise<ClearOutcome> {
  if (el.isContentEditable) {
    el.textContent = "";
    announce(el, ["input", "change"]);
    return readBack(el) === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The page put the text back.");
  }
  setNativeValue(el, "");
  announce(el, ["input", "change"]);
  return readBack(el) === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The page put the text back.");
}

export type { Choice };
