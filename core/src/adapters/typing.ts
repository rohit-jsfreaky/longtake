/**
 * Answers that are typed, or stepped to: text of every shape, a div made editable, a slider built
 * from divs — and the file upload, which is never answered by voice.
 */

import type { FieldSpec, SpokenValue } from "../types";
import type { WidgetAdapter } from "./index";
import { announce, cannot, clearShown, clearText, leave, readBack, readShown, readText, setNativeValue, sleep, type WriteOutcome } from "./kit";

/** A component shows its value; a box holds it. */
const readTyped = (spec: FieldSpec, el: HTMLElement) => (spec.custom ? readShown(spec, el) : readText(el));
const clearTyped = (spec: FieldSpec, el: HTMLElement) => (spec.custom ? clearShown(spec, el) : clearText(spec, el));

export const file: WidgetAdapter = {
  name: "file",
  matches: (spec) => spec.kind === "file",
  write: async (spec) => ({ fieldId: spec.id, status: "refused", reason: "A file cannot be attached by voice. Longtake leaves this for the person." }),
  read: (_spec, el) => readText(el),
  clear: async (spec) => cannot(spec, "A file upload cannot be cleared by voice."),
};

/**
 * A slider built from divs: moved with the arrow keys, the way a keyboard user moves it.
 *
 * Nothing else is reliable — there is no value to assign, and a drag needs geometry the widget may
 * compute differently. Every slider that follows the ARIA pattern answers the arrows.
 */
async function stepSlider(spec: FieldSpec, el: HTMLElement, spoken: SpokenValue): Promise<WriteOutcome> {
  const target = Number(String(spoken.value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(target)) {
    return { fieldId: spec.id, status: "refused", reason: `"${spoken.value}" is not a number this slider can go to.` };
  }
  const { min, max, step } = spec.range ?? { min: 0, max: 100, step: 1 };
  const goal = Math.min(max, Math.max(min, target));
  const now = () => Number(el.getAttribute("aria-valuenow"));

  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  for (let presses = 0; presses < 500 && Math.abs(now() - goal) >= step / 2; presses++) {
    const key = now() < goal ? "ArrowRight" : "ArrowLeft";
    el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, bubbles: true }));
    if (presses % 20 === 19) await sleep(0);
  }

  const landed = now();
  return Math.abs(landed - goal) < step / 2
    ? { fieldId: spec.id, status: "written", wrote: String(landed) }
    : { fieldId: spec.id, status: "rejected-by-page", wrote: String(goal), found: String(landed) };
}

export const slider: WidgetAdapter = {
  name: "slider",
  matches: (_spec, el) => el.getAttribute("role") === "slider",
  write: stepSlider,
  // A div slider carries its value in ARIA; there is nothing else to read.
  read: (_spec, el) => el.getAttribute("aria-valuenow"),
  clear: clearTyped,
};

/** A div pretending to be a text box. */
export const contentEditable: WidgetAdapter = {
  name: "contenteditable",
  matches: (_spec, el) => el.isContentEditable,
  async write(spec, el, spoken) {
    const text = String(spoken.value);
    el.textContent = text;
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === text
      ? { fieldId: spec.id, status: "written", wrote: text }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: text, found };
  },
  read: readTyped,
  clear: clearTyped,
};

/** A placeholder that is really a date format: "MM/DD/YYYY", "dd-mm-yyyy", "YYYY-MM-DD". */
const DATE_MASK = /^(mm|dd|yyyy)([/.\-\s])(mm|dd)\2(yyyy|mm|dd)$/i;

/**
 * A spoken date, in the shape this field takes.
 *
 * A native date input wants YYYY-MM-DD and silently stays empty given anything else. A text box
 * with a "MM/DD/YYYY" placeholder wants exactly that, and "1 October 2026" in it fails the form's
 * own validation. Anything that cannot be read as a date is left as it was said.
 */
export function asFieldDate(value: string, spec: FieldSpec, el: HTMLElement): string {
  const isNative = el.tagName.toLowerCase() === "input" && (el as HTMLInputElement).type === "date";
  const mask = DATE_MASK.exec((spec.placeholder ?? "").trim());
  if (!isNative && !mask) return value;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parsed = new Date(value.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1"));
    if (Number.isNaN(parsed.getTime())) return value;
    [y, m, d] = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }
  const two = (n: number) => String(n).padStart(2, "0");
  if (isNative || !mask) return `${y}-${two(m)}-${two(d)}`;

  const [, first, sep, second, third] = mask;
  const part = (token: string) => (/y/i.test(token) ? String(y) : /m/i.test(token) ? two(m) : two(d));
  return [first!, second!, third!].map(part).join(sep!);
}

/** A placeholder that is really a number's shape: "(000) 000-0000", "###-###-####". */
const DIGIT_MASK = /^[\s()+\-./]*[09#](?:[\s()+\-./]*[09#])*[\s()+\-./]*$/;

/**
 * A spoken number, in the shape the box's own placeholder shows — when it has exactly as many
 * digits as the shape has places. Jotform's phone boxes carry a mask "(000) 000-0000" that takes
 * keystrokes, not a pasted "98765 43210", and every such number was rejected by the page. Any
 * other number is left as it was said, for the page to judge.
 */
export function asFieldShape(value: string, spec: FieldSpec): string {
  const shape = (spec.placeholder ?? "").trim();
  if (!DIGIT_MASK.test(shape)) return value;
  const digits = value.replace(/\D/g, "");
  const places = shape.replace(/[^09#]/g, "").length;
  if (digits.length !== places) return value;
  let next = 0;
  return shape.replace(/[09#]/g, () => digits[next++]!);
}

/** Everything else is text of some shape: assigned the way the framework keeps it, left, read back. */
export const text: WidgetAdapter = {
  name: "text",
  matches: () => true,
  async write(spec, el, spoken) {
    let value = asFieldShape(asFieldDate(String(spoken.value), spec, el), spec);
    if (spec.maxLength && value.length > spec.maxLength) value = value.slice(0, spec.maxLength);

    setNativeValue(el, value);
    announce(el, ["input", "change"]);
    leave(el);

    const found = readBack(el);
    return found === value
      ? { fieldId: spec.id, status: "written", wrote: value }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: value, found };
  },
  read: readTyped,
  clear: clearTyped,
};
