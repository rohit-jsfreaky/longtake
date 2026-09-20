/**
 * ⭐ THE MOAT — somebody else's DOM in, a `FieldSpec[]` out.
 *
 * This is the only file that looks at a form we do not own. Everything downstream — the tool
 * schema the Voice Agent calls, the per-field Dictation prompts, the ask-back — is built from
 * what this file returns. If it misreads a page, nothing after it can recover.
 *
 * ## Three things it refuses to do
 *
 * 1. **It does not walk a fixed list of tags.** `querySelectorAll("input, textarea, select")`
 *    is the obvious implementation and it is wrong on the modern web. In an earlier project of
 *    ours a hand-written collector shaped exactly like that found **one** control on a page
 *    that really had seven — the rest were behind a shadow root, inside an iframe, or were
 *    `div`s wearing an ARIA role. See `dom-path.ts` for how the walking is done instead.
 *
 * 2. **It does not invent options.** A select's choices are read off the page, in the site's
 *    own wording, because those are the words the speaker will actually say out loud.
 *
 * 3. **It does not decide anything is safe to fill.** It reports what it sees, including
 *    fields it suspects are bot traps. The rule that a field with no spoken evidence never
 *    gets written lives in `writer.ts`, in code, with no path around it.
 */

import {
  closeWidget,
  deepQueryAll,
  isVisible,
  openWidget,
  optionNodes,
  uniqueSelector,
  whenSettled,
} from "./dom-path";
import type {
  FieldHandles,
  FieldKind,
  FieldOption,
  FieldSpec,
  FormRead,
  SkippedField,
} from "./types";

/**
 * Anything that might hold an answer. Wide on purpose — narrowing happens below, where the
 * reason for each exclusion can be written down.
 */
const CANDIDATE_SELECTOR = [
  // Real form elements.
  "input",
  "textarea",
  "select",
  // Something a person types into that is not an input.
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='spinbutton']",
  // Dropdowns that are not `<select>`. `role="combobox"` covers Radix and React-Select;
  // `aria-haspopup` covers Headless UI and every hand-rolled menu, whose trigger is usually a
  // plain `role="button"` and would otherwise be completely invisible to this file.
  "[role='combobox']",
  "[aria-haspopup='listbox']",
  "[aria-haspopup='menu']",
  // Choices built out of divs. The group is the question; its children are the answers.
  "[role='radiogroup']",
  "[role='checkbox']",
  "[role='switch']",
].join(",");

/** Input types that are a control, not an answer. */
const NON_ANSWER_TYPES = new Set(["submit", "button", "reset", "image", "hidden"]);

/** Labels that mean a long spoken answer, and so earn a Dictation pass of their own. */
const LONG_FORM_LABEL = /cover letter|why (do|are|would)|tell us|describe|excites|about your|in your own words|summar/i;

/**
 * Field names that are traps by convention rather than by looking hidden.
 *
 * Matched against the name with separators flattened to spaces, so `bot_trap`, `bot-trap` and
 * `botTrap` are all the same thing. Writing the underscores into the pattern instead is how
 * `leave_this_blank` slipped past on the first attempt.
 */
const TRAP_NAME = /honey ?pot|\bhp\b|bot ?(field|check|trap)|leave (this )?blank|do not fill/i;

/**
 * A long answer is one the speaker talks through, not one they spell out.
 *
 * This started at 200 and produced nonsense on a real Reddit application: `maxlength` there is
 * a few hundred characters on First Name, Email and LinkedIn alike, so every one of them was
 * marked as an essay. A form author who genuinely expects prose leaves far more room than that,
 * or uses a `<textarea>`.
 */
const LONG_FORM_MIN_MAXLENGTH = 1000;

function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The name a person would call this field, resolved roughly the way a screen reader would.
 *
 * Order matters: what the page author declared beats what we can infer from the layout.
 */
function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  const root = el.getRootNode() as Document | ShadowRoot;

  // 1. aria-labelledby — the author naming the label explicitly.
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(root.querySelector(`#${CSS.escape(id)}`) ?? doc?.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  // 2. aria-label — the author writing the label out.
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  // 3. <label for="…">. Searched from the element's own root so it works inside a shadow tree.
  if (el.id) {
    const forLabel = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = textOf(forLabel);
    if (text) return text;
  }

  // 4. A <label> wrapped around the control. Strip the control's own text back out, or a
  //    checkbox ends up labelled with its own value.
  const wrapping = el.closest("label");
  if (wrapping) {
    const text = textOf(wrapping);
    if (text) return text;
  }

  // 5. A fieldset's legend — how radio groups are almost always named.
  const legend = el.closest("fieldset")?.querySelector("legend");
  const legendText = textOf(legend);
  if (legendText) return legendText;

  // 6. The author's fallbacks.
  const placeholder = el.getAttribute("placeholder")?.trim();
  if (placeholder) return placeholder;
  const title = el.getAttribute("title")?.trim();
  if (title) return title;

  // 7. Last resort: the nearest text sitting above the control. Bounded, because walking far
  //    enough up any page will always find *something*, and it will be wrong.
  let node: Element | null = el;
  for (let hops = 0; node && hops < 4; hops++) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      const text = textOf(sibling);
      if (text && text.length <= 120) return text;
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }

  return "";
}

/** `Country*` and `Are you a veteran? *` are the same question. Drop the required marker. */
function cleanLabel(raw: string): string {
  return raw.replace(/[\s*✱]+$/g, "").replace(/\s+/g, " ").trim();
}

function kindOf(el: Element): FieldKind {
  const tag = el.tagName.toLowerCase();

  // Role is checked before tag on purpose. A real Greenhouse dropdown is an `<input type=text>`
  // carrying `role="combobox"`; reading the tag first calls it a text box and the choices are
  // lost. The page under test had **no `<select>` elements at all** and twelve comboboxes.
  const role = el.getAttribute("role");
  const popup = el.getAttribute("aria-haspopup");
  if (role === "combobox" || popup === "listbox" || popup === "menu") return "select";
  if (role === "radiogroup") return "radio";
  if (role === "checkbox" || role === "switch") return "checkbox";
  if (role === "spinbutton") return "number";

  if (tag === "textarea") return "textarea";
  if (tag === "select") {
    return (el as HTMLSelectElement).multiple ? "multiselect" : "select";
  }
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    switch (type) {
      case "email":
      case "tel":
      case "url":
      case "number":
      case "date":
      case "checkbox":
      case "radio":
      case "file":
        return type as FieldKind;
      case "datetime-local":
      case "month":
      case "week":
        return "date";
      case "range":
        return "number";
      default:
        return "text";
    }
  }

  // A div wearing a role we did not recognise. Treated as free text.
  return "textarea";
}

function optionsOf(el: Element): FieldOption[] | undefined {
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const options = Array.from((el as HTMLSelectElement).options)
      .filter((option) => option.value !== "" || textOf(option) !== "")
      .map((option) => ({ value: option.value, label: textOf(option) || option.value }));
    return options.length > 0 ? options : undefined;
  }

  // An ARIA radio group carries its answers inside it, already in the DOM.
  if (el.getAttribute("role") === "radiogroup") {
    const options = deepQueryAll(el, "[role='radio']")
      .map((radio) => {
        const label = cleanLabel(radio.getAttribute("aria-label") ?? textOf(radio));
        return { value: radio.getAttribute("value") ?? label, label };
      })
      .filter((option) => option.label !== "");
    return options.length > 0 ? options : undefined;
  }

  return undefined;
}

/**
 * Is this a component rather than a form element?
 *
 * The distinction decides how it gets written, so it is worth being exact. A real `<select>`
 * takes an assigned value. Everything else — including a real `<input>` that a component is
 * merely using as its text box — keeps its selection somewhere JavaScript can see and the DOM
 * cannot. Assigning to those changes the display and submits nothing.
 */
function isCustom(el: Element, kind: FieldKind): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return false;
  if (tag !== "input" && tag !== "textarea") return true;
  // A native input wearing a combobox role is React-Select, or something shaped like it.
  return kind === "select" || kind === "multiselect";
}

/**
 * Do we think this field exists to catch software rather than to be answered?
 *
 * Only ever a flag. The real protection is that nothing gets written without spoken evidence —
 * a visible trap phrased as a question defeats detection but not that rule.
 */
function looksLikeTrap(el: Element, visible: boolean): boolean {
  if (!visible) return true; // present, fillable, and invisible to the person filling it in

  const name = `${el.getAttribute("name") ?? ""} ${el.id ?? ""}`
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  if (TRAP_NAME.test(name)) return true;

  // `tabindex="-1"` plus `autocomplete="off"` on a text box is the standard plain-HTML trap.
  if (el.getAttribute("tabindex") === "-1" && el.getAttribute("autocomplete") === "off") {
    return true;
  }

  return false;
}

function isLongForm(el: Element, kind: FieldKind, label: string): boolean {
  if (kind === "textarea") return true;
  if (kind !== "text") return false;

  const maxLength = (el as HTMLInputElement).maxLength;
  if (maxLength && maxLength >= LONG_FORM_MIN_MAXLENGTH) return true;

  return LONG_FORM_LABEL.test(label);
}

/** `Desired salary (USD) *` → `desired_salary_usd`. Readable to a model, stable across a read. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Read every answerable field on a page.
 *
 * `root` defaults to the live document. Pass one explicitly to read a detached document — which
 * is how the tests run a saved copy of a real page.
 */
export function readForm(root: Document = document, url = root.location?.href ?? ""): FormRead {
  const candidates = deepQueryAll(root, CANDIDATE_SELECTOR);

  const specs: FieldSpec[] = [];
  const skipped: SkippedField[] = [];
  const handles: FieldHandles = new Map();
  const usedIds = new Set<string>();
  /** Radios and same-named checkboxes collapse into one field, so remember what we have seen. */
  const groups = new Map<string, FieldSpec>();

  const takeId = (preferred: string, index: number): string => {
    const base = slugify(preferred) || `field_${index + 1}`;
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    for (let n = 2; ; n++) {
      const candidate = `${base}_${n}`;
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
  };

  candidates.forEach((el, index) => {
    const tag = el.tagName.toLowerCase();

    if (tag === "input") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (NON_ANSWER_TYPES.has(type)) return;
      // A password is never something Longtake should be speaking out loud or storing.
      if (type === "password") return;
    }

    // Disabled and read-only fields cannot receive an answer, so they are not fields.
    if ((el as HTMLInputElement).disabled) return;
    if ((el as HTMLInputElement).readOnly) return;

    const visible = isVisible(el);
    const kind = kindOf(el);
    const label = cleanLabel(labelOf(el));
    const name = el.getAttribute("name") ?? "";

    // ── Kept out of the schema entirely, rather than flagged inside it ──────────────
    //
    // Anything in `specs` becomes a property on the tool the language model calls, and a
    // property it can see is a property it can decide to fill. A honeypot is invisible by
    // design, so the only safe place for it is outside the schema. Real Greenhouse pages
    // also carry invisible twins of visible fields — a hidden search box behind the phone
    // widget, a hidden file input behind a styled Attach button — and those were showing up
    // as duplicate questions.
    if (!visible) {
      skipped.push({ label: label || name || kind, reason: "not visible on the page" });
      return;
    }
    if (kind === "file") {
      skipped.push({ label: label || name, reason: "a file cannot be attached by voice" });
      return;
    }

    // Radios, and checkboxes sharing a name, are one question with several answers.
    if ((kind === "radio" || kind === "checkbox") && name) {
      const groupKey = `${kind}:${name}`;
      const siblings = candidates.filter(
        (other) => other.getAttribute("name") === name && kindOf(other) === kind,
      );
      const isGroup = kind === "radio" || siblings.length > 1;

      if (isGroup) {
        const existing = groups.get(groupKey);
        const option: FieldOption = {
          value: (el as HTMLInputElement).value || label,
          label: label || (el as HTMLInputElement).value,
        };

        if (existing) {
          existing.options?.push(option);
          // The handle map points at the group's first control; `writer.ts` walks from there.
          return;
        }

        // The group's own name — the legend, not the first radio's label.
        //
        // `label` at this point belongs to the individual control ("Yes, I am authorized"), and
        // using it for the group's id produced `yes_i_am_authorized` as the name of a question
        // actually called "Work authorization". The id and the label have to come from the same
        // place or the model is answering a question it cannot see.
        const groupLabel = cleanLabel(
          textOf(el.closest("fieldset")?.querySelector("legend")) ||
            el.closest("[role='radiogroup']")?.getAttribute("aria-label") ||
            name,
        );

        const spec: FieldSpec = {
          id: takeId(groupLabel || name, index),
          label: groupLabel,
          kind: kind === "radio" ? "radio" : "multiselect",
          required: (el as HTMLInputElement).required,
          options: [option],
          ...(visible ? {} : { suspectedHoneypot: true }),
        };
        const selector = uniqueSelector(el, root);
        if (selector) spec.selector = selector;

        groups.set(groupKey, spec);
        specs.push(spec);
        handles.set(spec.id, el as HTMLElement);
        return;
      }
    }

    // The label first, not the name. This becomes a JSON-Schema property name that a language
    // model reads while deciding where each spoken phrase belongs, so `desired_salary` is worth
    // far more than `question_69292246` — and meaningless `name` attributes are the norm on
    // real ATS forms. The name is the fallback, and the element id the fallback's fallback.
    const id = takeId(label || name || el.id, index);
    const spec: FieldSpec = {
      id,
      label,
      kind,
      required: Boolean((el as HTMLInputElement).required) || el.getAttribute("aria-required") === "true",
    };

    const selector = uniqueSelector(el, root);
    if (selector) spec.selector = selector;

    const options = optionsOf(el);
    if (options) spec.options = options;

    const maxLength = (el as HTMLInputElement).maxLength;
    if (maxLength && maxLength > 0) spec.maxLength = maxLength;

    const pattern = el.getAttribute("pattern");
    if (pattern) spec.pattern = pattern;

    const placeholder = el.getAttribute("placeholder");
    if (placeholder) spec.placeholder = placeholder;

    if (isLongForm(el, kind, label)) spec.longForm = true;
    if (isCustom(el, kind)) spec.custom = true;
    if (looksLikeTrap(el, visible)) spec.suspectedHoneypot = true;

    specs.push(spec);
    handles.set(id, el as HTMLElement);
  });

  return { specs, handles, skipped, url, readAt: Date.now() };
}

/**
 * Open every dropdown, write down the real choices, close it again.
 *
 * ## Why this is not optional
 *
 * A real Greenhouse application has **no `<select>` elements at all**. Measured on a live Reddit
 * posting: zero native selects, twelve `role="combobox"` inputs, and — this is the part that
 * forces the issue — **the options do not exist in the DOM until the dropdown is opened.**
 * Before a click there were 0 `role="option"` nodes. After one click there were 244.
 *
 * So a purely passive read cannot know the choices, `binder.ts` cannot put real enum values in
 * the tool schema, and the agent is left guessing at answers to questions like "are you
 * authorised to work in the U.S.". Guessing is the one thing Longtake must never do.
 *
 * This runs once, before anybody speaks. It is deliberately a separate, explicit, async pass:
 * `readForm` stays synchronous and side-effect free, and this is the one function in `core/`
 * that touches the page in order to learn about it.
 */
export async function harvestOptions(read: FormRead, settleMs = 150): Promise<FormRead> {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return read;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const allOptions = () => optionNodes(doc);

  for (const spec of read.specs) {
    if (spec.kind !== "select" && spec.kind !== "multiselect") continue;
    if (spec.options && spec.options.length > 0) continue; // a real <select> already gave them up

    const el = read.handles.get(spec.id);
    if (!el || !el.isConnected) continue;

    // Whatever is already on screen belongs to someone else. Diffing against it means we can
    // never attribute another widget's options to this field.
    const before = new Set(allOptions());

    try {
      openWidget(el);
      await sleep(settleMs);

      const revealed = allOptions().filter((option) => !before.has(option));
      const options: FieldOption[] = [];
      const seen = new Set<string>();

      for (const option of revealed) {
        const label = cleanLabel(textOf(option));
        if (!label || seen.has(label)) continue;
        seen.add(label);
        options.push({ value: option.getAttribute("data-value") ?? label, label });
      }

      if (options.length > 0) spec.options = options;
    } catch {
      // A widget that refuses to open is not a crash. The field keeps no options, the binder
      // leaves it as free text, and the agent asks about it out loud instead.
    } finally {
      closeWidget(el);
      await sleep(40);
    }
  }

  return read;
}

/**
 * Wait until this page actually has a form on it, then stop waiting.
 *
 * The plain "wait for the DOM to go quiet" version is not enough on its own, and fails in the
 * exact case it exists for: a React app that has not begun rendering is perfectly quiet, so the
 * wait returns at once and the form reads as empty. This waits for quiet **and** for at least
 * one candidate control to exist, giving up at `timeoutMs` either way so a page that polls in
 * the background can never hang the hotkey.
 */
export function waitForForm(root: Document = document, timeoutMs = 5000): Promise<void> {
  return whenSettled(
    root,
    350,
    timeoutMs,
    () => deepQueryAll(root, CANDIDATE_SELECTOR).some((el) => isVisible(el)),
  );
}
