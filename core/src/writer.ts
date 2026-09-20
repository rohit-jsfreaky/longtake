/**
 * Values in, live inputs out — on a form we do not own, without the page noticing anything odd.
 *
 * ## The rule this file exists to enforce
 *
 * **A field with no spoken evidence is never written.** Not discouraged in a prompt — refused
 * here, in code, with no path around it. `SpokenValue.evidence` is required by the type and
 * checked again at runtime, so "just fill the rest in" is not something a model can talk its
 * way into. Two reasons, and the second is the one that matters:
 *
 *   - Some forms plant fields specifically to catch software that fills everything in.
 *   - A form containing answers a person never gave is worse than an empty form. They are
 *     about to put their name on it.
 *
 * ## The other rule
 *
 * **Never guess an option.** If a spoken answer does not clearly match one of the choices the
 * page offers, the field is left alone and the reason is reported, so the agent can ask. Quietly
 * falling back to the first option is how a form ends up claiming someone attended a university
 * they have never been to, or worked somewhere they never worked.
 */

import type { FieldHandles, FieldSpec, SpokenValue } from "./types";

export type WriteOutcome =
  | { fieldId: string; status: "written"; wrote: string }
  /** We chose not to write, and why. Always safe to show a person. */
  | { fieldId: string; status: "refused"; reason: string }
  /** We wrote, and the page did not keep it. Usually a framework fighting back. */
  | { fieldId: string; status: "rejected-by-page"; wrote: string; found: string };

/**
 * React (and Vue, and Svelte) keep their own copy of an input's value and overwrite anything
 * set directly on the element. Going through the prototype's native setter updates the value
 * the framework is actually watching, so the change survives the next render.
 */
function setNativeValue(el: HTMLElement, value: string): void {
  const prototype =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }
}

/**
 * Tell the page something changed, the way a person would have.
 *
 * `pointerdown` is in the list because of a lesson from an earlier project: Radix — and so
 * shadcn/ui, and so a large share of forms built in the last two years — opens menus on
 * `pointerdown` and ignores a synthetic `click` entirely.
 */
function announce(el: HTMLElement, kinds: string[]): void {
  for (const kind of kinds) {
    el.dispatchEvent(new Event(kind, { bubbles: true }));
  }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Which of the page's own options did the speaker mean?
 *
 * Returns `null` rather than a best guess. Every caller treats `null` as "leave it and ask".
 */
function matchOption(spec: FieldSpec, spoken: string): string | null {
  if (!spec.options || spec.options.length === 0) return null;

  const want = normalise(spoken);
  if (!want) return null;

  const exact = spec.options.find(
    (option) => normalise(option.label) === want || normalise(option.value) === want,
  );
  if (exact) return exact.value;

  // One option contains the spoken words, or the spoken words contain it — but only if
  // exactly one does. Two candidates means we do not actually know.
  const partial = spec.options.filter((option) => {
    const label = normalise(option.label);
    return label.length > 0 && (label.includes(want) || want.includes(label));
  });
  if (partial.length === 1) return partial[0]!.value;

  return null;
}

function readBack(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value || "on" : "";
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  return (el.textContent ?? "").trim();
}

/** Every radio sharing this one's name, wherever in the document they live. */
function radioGroup(el: HTMLElement): HTMLInputElement[] {
  const name = el.getAttribute("name");
  const root = el.getRootNode() as Document | ShadowRoot;
  if (!name) return el instanceof HTMLInputElement ? [el] : [];
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
}

function writeOne(spec: FieldSpec, el: HTMLElement, spoken: SpokenValue): WriteOutcome {
  const { id } = spec;

  if (spec.kind === "file") {
    return {
      fieldId: id,
      status: "refused",
      reason: "A file cannot be attached by voice. Longtake leaves this for the person.",
    };
  }

  // Checkbox and radio groups: choose among the page's own options, or do nothing.
  if (spec.kind === "radio" || (spec.kind === "multiselect" && spec.options)) {
    const wanted = Array.isArray(spoken.value) ? spoken.value : [String(spoken.value)];
    const chosen = wanted.map((one) => matchOption(spec, one)).filter((v): v is string => v !== null);

    if (chosen.length === 0) {
      return {
        fieldId: id,
        status: "refused",
        reason: `"${wanted.join(", ")}" does not clearly match any option on the page. Asking instead of guessing.`,
      };
    }

    if (spec.kind === "radio") {
      const target = radioGroup(el).find((radio) => radio.value === chosen[0]);
      if (!target) {
        return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
      }
      target.checked = true;
      announce(target, ["input", "change"]);
      return target.checked
        ? { fieldId: id, status: "written", wrote: target.value }
        : { fieldId: id, status: "rejected-by-page", wrote: target.value, found: "" };
    }

    const name = el.getAttribute("name");
    const root = el.getRootNode() as Document | ShadowRoot;
    const boxes = name
      ? Array.from(
          root.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${CSS.escape(name)}"]`,
          ),
        )
      : [el as HTMLInputElement];

    for (const box of boxes) {
      const shouldCheck = chosen.includes(box.value);
      if (box.checked !== shouldCheck) {
        box.checked = shouldCheck;
        announce(box, ["input", "change"]);
      }
    }
    return { fieldId: id, status: "written", wrote: chosen.join(", ") };
  }

  // A lone checkbox is a yes or no.
  if (spec.kind === "checkbox") {
    const box = el as HTMLInputElement;
    const yes =
      typeof spoken.value === "boolean" ? spoken.value : /^(yes|true|agree|accept)/i.test(String(spoken.value));
    box.checked = yes;
    announce(box, ["input", "change"]);
    return { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" };
  }

  // A <select> must land on one of its own options.
  if (spec.kind === "select" || spec.kind === "multiselect") {
    const wanted = String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);
    const value = matchOption(spec, wanted);
    if (value === null) {
      return {
        fieldId: id,
        status: "refused",
        reason: `"${wanted}" does not clearly match any option on the page. Asking instead of guessing.`,
      };
    }
    setNativeValue(el, value);
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === value
      ? { fieldId: id, status: "written", wrote: value }
      : { fieldId: id, status: "rejected-by-page", wrote: value, found };
  }

  // A div pretending to be a text box.
  if (el.isContentEditable) {
    const text = String(spoken.value);
    el.textContent = text;
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === text
      ? { fieldId: id, status: "written", wrote: text }
      : { fieldId: id, status: "rejected-by-page", wrote: text, found };
  }

  // Everything else is text of some shape.
  let text = String(spoken.value);
  if (spec.maxLength && text.length > spec.maxLength) {
    text = text.slice(0, spec.maxLength);
  }

  setNativeValue(el, text);
  announce(el, ["input", "change"]);

  const found = readBack(el);
  return found === text
    ? { fieldId: id, status: "written", wrote: text }
    : { fieldId: id, status: "rejected-by-page", wrote: text, found };
}

/**
 * Write the values that were actually spoken, and nothing else.
 *
 * Returns one outcome per value handed in — including the refusals, which are the interesting
 * ones: they are what the agent asks about out loud.
 */
export function writeValues(
  specs: FieldSpec[],
  handles: FieldHandles,
  values: SpokenValue[],
): WriteOutcome[] {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));

  return values.map((spoken): WriteOutcome => {
    const spec = byId.get(spoken.fieldId);
    if (!spec) {
      return {
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "No such field on this page. The page may have changed since it was read.",
      };
    }

    // ── The rule. Do not soften it. ────────────────────────────────────────────────
    if (!spoken.evidence || spoken.evidence.trim() === "") {
      return {
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "Nothing was spoken about this field, so it stays empty.",
      };
    }

    if (spec.suspectedHoneypot) {
      return {
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "This field looks like it is there to catch software, not to be answered.",
      };
    }

    const el = handles.get(spoken.fieldId);
    if (!el || !el.isConnected) {
      return {
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "That field is no longer on the page.",
      };
    }

    return writeOne(spec, el, spoken);
  });
}
