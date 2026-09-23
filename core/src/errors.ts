/**
 * What the form says is wrong with a field — "Please enter a valid email", "Invalid phone number".
 *
 * ## Why
 *
 * A value that went in is not the same as a value the form accepts. A form that rejects it shows a
 * red line under the box and waits; an agent that does not read it moves on, and the person finds
 * out at the submit button, three minutes later, with no idea which answer was the problem.
 *
 * Read the way assistive technology reads it, most declared first:
 *   1. `aria-invalid="true"` with `aria-errormessage` / `aria-describedby` — the pattern every
 *      accessible form library uses, and so the one that means exactly this;
 *   2. an error element in the field's own block — `role="alert"`, or a visible element whose class
 *      says error — found by walking a few levels up from the field, never across to a neighbour;
 *   3. the browser's own check (`validity`) for a box with something in it — a malformed email in a
 *      `type=email` box, a value that breaks the page's `pattern`.
 */

import { isVisible } from "./dom-path";

const ERROR_CLASS = /(^|[\s_-])(error|invalid|danger|field-error|error-message|help-block-error)([\s_-]|$)/i;

function text(el: Element | null | undefined): string {
  return ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The message, or `null` when the form is not complaining about this field. */
export function readError(el: HTMLElement): string | null {
  const doc = el.ownerDocument;

  // ── 1. Declared, the accessible way ───────────────────────────────────────────────
  if (el.getAttribute("aria-invalid") === "true") {
    const ids = `${el.getAttribute("aria-errormessage") ?? ""} ${el.getAttribute("aria-describedby") ?? ""}`
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      const node = doc?.getElementById(id);
      if (node && isVisible(node) && text(node)) return text(node);
    }
  }

  // ── 2. An error element inside the field's own block ─────────────────────────────
  // A few levels up is the field's wrapper; further than that is the form, and an error there
  // belongs to some other field. Stop at the first ancestor holding a different input.
  let block: HTMLElement | null = el.parentElement;
  for (let hops = 0; block && hops < 3; hops++) {
    const others = Array.from(block.querySelectorAll("input,select,textarea,[role='combobox']")).filter(
      (other) => other !== el && !el.contains(other) && !other.contains(el),
    );
    if (others.length > 0) break;

    const found = Array.from(block.querySelectorAll<HTMLElement>("[role='alert'], [class]")).find(
      (node) =>
        node !== el &&
        !node.contains(el) &&
        (node.getAttribute("role") === "alert" || ERROR_CLASS.test(node.className?.toString() ?? "")) &&
        isVisible(node) &&
        text(node).length > 0,
    );
    if (found) return text(found);
    block = block.parentElement;
  }

  // ── 3. The browser's own check, for a box that has something in it ───────────────
  const input = el as HTMLInputElement;
  if (typeof input.validity === "object" && input.value) {
    const v = input.validity;
    if (v.typeMismatch || v.patternMismatch || v.tooShort || v.tooLong || v.rangeOverflow || v.rangeUnderflow || v.badInput) {
      return input.validationMessage || "The form does not accept this value.";
    }
  }

  return null;
}
