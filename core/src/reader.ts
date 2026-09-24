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
  choiceGroup,
  closeWidget,
  deepQueryAll,
  exclusively,
  isVisible,
  openWidget,
  optionNodes,
  ownsOptions,
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
  // A slider built from divs — rating scales, "how many years", salary bands.
  "[role='slider']",
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

/** A typeable dropdown with at least this many choices is searched, not picked from. */
const SEARCH_NOT_SCROLL = 50;

function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The words in a `<label>` that belong to the question rather than to the answer.
 *
 * Works on a detached clone so the live page is never touched, and reads `textContent` rather
 * than `innerText` because a clone is not rendered and has no `innerText` worth having.
 */
function labelTextWithoutControls(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  clone
    .querySelectorAll("input, textarea, select, option, [role='combobox'], [contenteditable]")
    .forEach((node) => node.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Is this element inside something we have been told to leave alone?
 *
 * Walks up through shadow hosts as well as parents, because `closest` stops dead at a shadow
 * boundary — and dev tooling, browser UI and Longtake's own widget all live in shadow roots.
 */
function isInside(el: Element, selector: string): boolean {
  let node: Element | null = el;
  while (node) {
    try {
      if (node.matches(selector)) return true;
    } catch {
      return false; // a selector the browser will not parse
    }
    if (node.parentElement) {
      node = node.parentElement;
      continue;
    }
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
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
    // A label that names only a part — Google Forms labels its date box "Date" and puts "Date of
    // Birth" on the group around it. Two date questions would both be "Date", and neither is
    // what the person is being asked. The group's name is the question.
    if (text && PART_ONLY.test(cleanLabel(text))) {
      const group = el.parentElement?.closest("[aria-labelledby], [aria-label], fieldset");
      const outer = group ? labelOf(group) : "";
      if (outer) return outer;
    }
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

  // 4. A <label> wrapped around the control, with the control's own text taken back out.
  //
  //    ⚠️ This subtraction is the entire point and skipping it is not subtle. `<label>Country
  //    <select>…</select></label>` is one of the most common shapes on the web, and reading the
  //    label whole gives "Country Select… India United States United Kingdom Germany" — every
  //    option swallowed into the question. A wrapped checkbox likewise ends up labelled with its
  //    own value.
  const wrapping = el.closest("label");
  if (wrapping) {
    const text = labelTextWithoutControls(wrapping);
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

/** A trigger for a menu — `aria-haspopup="menu"`, or `"true"`, which ARIA defines as the same. */
function isMenuButton(el: Element): boolean {
  const popup = el.getAttribute("aria-haspopup");
  const role = el.getAttribute("role");
  return (popup === "menu" || popup === "true") && role !== "combobox" && role !== "listbox";
}

/** What holds a set of radios or checkboxes and can say what question they answer. */
const GROUP_CONTAINER = "fieldset, [role='radiogroup'], [role='group']";

/**
 * The question a group of radios or checkboxes answers: the accessible name of the group around
 * it — a fieldset's own legend, or a radiogroup / group named by `aria-labelledby` or
 * `aria-label`. Jotform names every group by `aria-labelledby`; read only from a legend or an
 * `aria-label`, its questions came out as the inputs' `name` ("q40_areYou", "q25_typeA[]").
 *
 * The nearest named container, at most two out: an unnamed wrapper is skipped, but a whole form
 * wrapped in a named group must not become every group's question.
 */
function groupQuestion(el: Element): string {
  let container = el.parentElement?.closest(GROUP_CONTAINER) ?? null;
  for (let hops = 0; container && hops < 2; hops++) {
    const name = containerName(container);
    if (name) return name;
    container = container.parentElement?.closest(GROUP_CONTAINER) ?? null;
  }
  return "";
}

function containerName(container: Element): string {
  const root = container.getRootNode() as Document | ShadowRoot;
  const labelledBy = container.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(root.querySelector(`#${CSS.escape(id)}`) ?? container.ownerDocument?.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  const ariaLabel = container.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  return container.localName === "fieldset" ? textOf(container.querySelector(":scope > legend")) : "";
}

/**
 * A group is required when the group says so — `aria-required` on it — or when its question
 * carries the star. Each radio's own `required` counts too, and is added as members are read.
 */
function groupRequired(el: Element, question: string): boolean {
  const container = el.parentElement?.closest(GROUP_CONTAINER);
  return container?.getAttribute("aria-required") === "true" || STARRED.test(question);
}

/** A label that names a piece of an answer rather than the question. */
const PART_ONLY = /^(date|time|day|month|year|hour|minute|dd|mm|yyyy|hh)$/i;

/** A label ending in an asterisk marks a required question — the web's near-universal convention. */
const STARRED = /[*✱]\s*$/;

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
  if (role === "spinbutton" || role === "slider") return "number";

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

/** The document an element or document belongs to. */
function ownerDocumentOf(root: Document | Element): Document {
  return "ownerDocument" in root && root.ownerDocument ? root.ownerDocument : (root as Document);
}

/**
 * Read every answerable field on a page.
 *
 * `root` defaults to the live document. Pass one explicitly to read a detached document — which
 * is how the tests run a saved copy of a real page.
 */
export function readForm(
  /**
   * Where to look. A whole document, or one element to stay inside.
   *
   * Scoping matters wherever Longtake's own interface shares the page with the form: the landing
   * page has a nav, an FAQ and the widget's own controls on it, and reading the whole document
   * there builds the agent a tool made partly out of our furniture. The extension will want the
   * same when a site embeds a form in a panel.
   */
  root: Document | Element = document,
  url = ownerDocumentOf(root).location?.href ?? "",
  /**
   * Anything inside these is not part of the person's form.
   *
   * Longtake's own widget carries `data-longtake-ignore`, which is why it is the default. Pass a
   * wider selector to exclude other software's furniture: the Next.js dev overlay showed up as a
   * question called "Open Next.js Dev Tools", complete with a three-option enum, purely because
   * its button declares `aria-haspopup="menu"` like any other dropdown.
   */
  ignore = "[data-longtake-ignore]",
): FormRead {
  const candidates = deepQueryAll(root, CANDIDATE_SELECTOR).filter(
    (el) => !ignore || !isInside(el, ignore),
  );

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

  // Does this page keep its questions inside a <form>? Then a menu button outside every form is
  // the page's own chrome (see below).
  const formsHoldFields = candidates.some((el) => el.closest("form") && !isMenuButton(el));

  candidates.forEach((el, index) => {
    const tag = el.tagName.toLowerCase();

    // A menu button is two-faced: `aria-haspopup="menu"` opens a list of actions (Help, Share) as
    // often as a hand-rolled picker. On a page that keeps its questions in a <form>, one outside
    // every form is not among them — Google Forms' "help and feedback" button was being asked as
    // a question. Pages with no form keep the old reading: there, a menu button may be the picker.
    if (formsHoldFields && isMenuButton(el) && !el.closest("form")) return;

    // The text box of an "Other:" choice lives inside its radio group. It is part of that answer,
    // not a question of its own — read as one, the agent asked for "Other response" by name.
    // Only a text box: native radios inside a role="radiogroup" wrapper are the answers themselves.
    const typed = tag === "textarea" || (tag === "input" && !/^(radio|checkbox)$/i.test((el as HTMLInputElement).type));
    if (typed && el.parentElement?.closest("[role='radiogroup']")) return;

    // And the wrapper itself, when what it wraps are native radios: it is the question, and the
    // radios inside are read as the group — named from this wrapper, below. Read as a field of
    // its own, every Jotform radio question came out twice, and the copy the agent was given had
    // no choices, so none of them could be answered.
    if (el.getAttribute("role") === "radiogroup" && !el.querySelector("[role='radio']") && el.querySelector("input[type='radio']")) {
      return;
    }

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
    const rawLabel = labelOf(el);
    const label = cleanLabel(rawLabel);
    // Google Forms sets no `required` and no `aria-required` on a text answer: the only mark is
    // the asterisk on its question. Read as optional, a required question was never asked.
    const starred = STARRED.test(rawLabel);
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

    // Radios, and checkboxes sharing a name, are one question with several answers — the very set
    // the writer will look for again (`choiceGroup`), so what is read as one field can be written
    // as one: Jotform's `industry[other]` joins `industry[]` here and there alike.
    if ((kind === "radio" || kind === "checkbox") && name) {
      const members = tag === "input" ? choiceGroup(el) : [];
      const groupKey = `${kind}:${members[0]?.getAttribute("name") ?? name}`;
      const siblings =
        tag === "input"
          ? members.filter((other) => candidates.includes(other) && kindOf(other) === kind)
          : candidates.filter((other) => other.getAttribute("name") === name && kindOf(other) === kind);
      const isGroup = kind === "radio" || siblings.length > 1;

      if (isGroup) {
        const existing = groups.get(groupKey);
        const option: FieldOption = {
          value: (el as HTMLInputElement).value || label,
          label: label || (el as HTMLInputElement).value,
        };

        if (existing) {
          existing.options?.push(option);
          if ((el as HTMLInputElement).required) existing.required = true;
          // The handle map points at the group's first control; `writer.ts` walks from there.
          return;
        }

        // The group's own name — the legend, not the first radio's label.
        //
        // `label` at this point belongs to the individual control ("Yes, I am authorized"), and
        // using it for the group's id produced `yes_i_am_authorized` as the name of a question
        // actually called "Work authorization". The id and the label have to come from the same
        // place or the model is answering a question it cannot see.
        const question = groupQuestion(el);
        const groupLabel = cleanLabel(question || name);

        const spec: FieldSpec = {
          id: takeId(groupLabel || name, index),
          label: groupLabel,
          kind: kind === "radio" ? "radio" : "multiselect",
          required: (el as HTMLInputElement).required || groupRequired(el, question),
          options: [option],
          ...(visible ? {} : { suspectedHoneypot: true }),
        };
        const selector = uniqueSelector(el, ownerDocumentOf(root));
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
      required:
        Boolean((el as HTMLInputElement).required) || el.getAttribute("aria-required") === "true" || starred,
    };

    const selector = uniqueSelector(el, ownerDocumentOf(root));
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

    // A slider, whether a real `<input type=range>` or a div with role="slider": its range, so the
    // agent can say what it goes from and to, and the writer can step it there.
    const isRange = tag === "input" && (el as HTMLInputElement).type === "range";
    if (isRange || el.getAttribute("role") === "slider") {
      const read = (attr: string, aria: string, fallback: number) => {
        const raw = el.getAttribute(aria) ?? el.getAttribute(attr);
        const n = raw === null ? NaN : Number(raw);
        return Number.isFinite(n) ? n : fallback;
      };
      spec.range = { min: read("min", "aria-valuemin", 0), max: read("max", "aria-valuemax", 100), step: read("step", "aria-valuestep", 1) || 1 };
      if (!isRange) spec.custom = true;
    }
    if (looksLikeTrap(el, visible)) spec.suspectedHoneypot = true;

    specs.push(spec);
    handles.set(id, el as HTMLElement);
  });

  placeInSections(root, specs, handles, usedIds);

  return { specs, handles, skipped, url, readAt: Date.now() };
}

/** What counts as a heading that groups the fields after it. */
const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,legend,[role='heading']";

/**
 * What this form is called, for the agent's opening line.
 *
 * The nearest heading above the first field — "Society Membership Application", a job title —
 * and the page title only when there is none. Empty is a fine answer: the opening line then says
 * "this form" instead of inventing a name for it.
 */
export function titleOf(read: FormRead, root: Document | Element = document): string {
  const FOLLOWING = 4;
  const firstField = [...read.handles.values()].sort((a, b) =>
    a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1,
  )[0];

  if (firstField) {
    const above = deepQueryAll(root, "h1,h2,h3,h4,[role='heading']")
      .filter(isVisible)
      .filter((heading) => heading.compareDocumentPosition(firstField) & FOLLOWING);
    const nearest = above[above.length - 1];
    const text = nearest ? cleanLabel(textOf(nearest)) : "";
    if (text) return text.slice(0, 80);
  }

  const doc = ownerDocumentOf(root);
  return (doc.title ?? "").split(/\s[|·–-]\s/)[0]!.trim().slice(0, 80);
}

/**
 * Give every field the heading it sits under, and use it to tell repeated labels apart.
 *
 * A live Jotform membership application asks "First Name" twice — once for the person applying
 * and once for an alternate representative — and the accessible name of each is exactly that,
 * nothing more. The heading above is the only thing on the page that says whose name goes
 * where. Read without it, the tool has `first_name` and `first_name_2`, and the model has to
 * guess which one is the person talking.
 *
 * So each field records its section, and where a label repeats, the section goes into the id as
 * well: `alternate_designated_representative_first_name` is a question a model can answer
 * correctly. A label that is unique keeps its short id — nothing is renamed that did not need to
 * be, because the short ids are what the rest of the product and its tests are written against.
 */
function placeInSections(
  root: Document | Element,
  specs: FieldSpec[],
  handles: FieldHandles,
  usedIds: Set<string>,
): void {
  const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING, spelled out so an iframe's realm is irrelevant

  // Sorted rather than trusted: `deepQueryAll` gathers shadow roots and frames after the light
  // DOM, so its order is not the order a person reads the page in.
  const byPosition = (a: Element, b: Element) => (a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1);

  const fields = [...handles.values()].sort(byPosition);
  const first = fields[0];
  if (!first) return;

  // A heading above the very first field is the form's TITLE, not a section of it — the job
  // title on a Greenhouse page, the form name on a Jotform one. It governs everything, so it
  // tells nothing apart; and it can do real harm, because the exclusions in `memory.ts` read the
  // section. A role called "Customer Success Manager" would have ruled out every email field on
  // the page, since "manager" is how a manager's email is kept from being mistaken for yours.
  const isTitle = (heading: Element) =>
    heading.tagName.toLowerCase() !== "legend" &&
    Boolean(heading.compareDocumentPosition(first) & FOLLOWING);

  const headings = deepQueryAll(root, HEADING_SELECTOR)
    .filter(isVisible)
    .filter((heading) => !isTitle(heading))
    .sort(byPosition);
  if (headings.length === 0) return;

  const sectionOf = (el: Element, label: string): string => {
    let found = "";
    for (const heading of headings) {
      if (heading.contains(el)) continue;

      // A legend names its own fieldset and nothing after it. Treated like a heading, the
      // "Industry" legend of a checkbox group became the section of every field below it.
      const governs =
        heading.tagName.toLowerCase() === "legend"
          ? Boolean(heading.parentElement?.contains(el))
          : Boolean(heading.compareDocumentPosition(el) & FOLLOWING);

      if (governs) found = cleanLabel(textOf(heading));
    }
    // A radio group's legend is its own question, not the section it lives in.
    return found && found !== label ? found : "";
  };

  for (const spec of specs) {
    const el = handles.get(spec.id);
    if (!el) continue;
    const section = sectionOf(el, spec.label);
    if (section) spec.section = section;
  }

  // Only repeated labels are renamed, and only when a section actually separates them.
  const count = new Map<string, number>();
  for (const spec of specs) count.set(spec.label, (count.get(spec.label) ?? 0) + 1);

  for (const spec of specs) {
    if (!spec.section || (count.get(spec.label) ?? 0) < 2) continue;

    const base = slugify(`${spec.section} ${spec.label}`);
    if (!base || base === spec.id) continue;

    let candidate = base;
    for (let n = 2; usedIds.has(candidate); n++) candidate = `${base}_${n}`;

    const el = handles.get(spec.id)!;
    handles.delete(spec.id);
    usedIds.delete(spec.id);
    usedIds.add(candidate);
    spec.id = candidate;
    handles.set(candidate, el);
  }
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
export function harvestOptions(read: FormRead, settleMs = 150): Promise<FormRead> {
  // One widget sequence at a time on the page — see `exclusively` in dom-path.ts. Two harvests at
  // once (the memory pass at page load, and the one when the microphone is pressed) pressed each
  // other's dropdowns and read each other's options.
  return exclusively(() => harvestAll(read, settleMs));
}

/** How long a dropdown gets to show that it opened, however slow the machine. */
const MENU_TIMEOUT_MS = 2000;

async function harvestAll(read: FormRead, settleMs: number): Promise<FormRead> {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return read;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const allOptions = () => optionNodes(doc);

  /**
   * Press one widget and read what it offers. False when it did not react at all — no menu, not
   * even "expanded" — which says nothing about its options yet: `lastTry` decides whether that
   * silence may be read as "a list that fills as you type".
   */
  const pressAndRead = async (spec: FieldSpec, el: HTMLElement, lastTry: boolean): Promise<boolean> => {
    // Whatever is already on screen belongs to someone else. Diffing against it means we can
    // never attribute another widget's options to this field.
    const before = new Set(allOptions());
    const opened = () => allOptions().some((option) => !before.has(option)) || el.getAttribute("aria-expanded") === "true";

    try {
      openWidget(el);
      // Wait for the menu, not for a guess at how long a menu takes. A fixed 150 ms read
      // Greenhouse's 244 country codes as nothing on a busy machine — and a "+91" then had no
      // picker to go to. Open means new options on screen, or the widget saying it is expanded
      // (a list that fills as you type opens empty); read once the page has gone quiet.
      await whenSettled(doc, settleMs, MENU_TIMEOUT_MS, opened);
      if (!opened() && !lastTry) return false;

      let revealed = allOptions().filter((option) => !before.has(option));
      // Already open before we got here, so nothing is "new" — read its own options instead.
      if (revealed.length === 0 && el.getAttribute("aria-expanded") === "true") {
        revealed = allOptions().filter((option) => ownsOptions(el, option) === true);
      }
      const options: FieldOption[] = [];
      const seen = new Set<string>();

      for (const option of revealed) {
        const label = cleanLabel(textOf(option));
        if (!label || seen.has(label)) continue;
        seen.add(label);
        options.push({ value: option.getAttribute("data-value") ?? label, label });
      }

      if (options.length > 0) spec.options = options;

      // A list that says several can be picked is a multi-select, whatever the trigger looks like
      // — React-Select's tag pickers are an input like any other until their menu is open.
      const list = revealed[0]?.closest("[role='listbox']");
      if (list?.getAttribute("aria-multiselectable") === "true") spec.kind = "multiselect";

      // Opened, and nothing to read: a list that fills in as you type — a location, a college.
      // Its answers cannot be offered in advance; they are searched for when written.
      //
      // Opened, and a very long list you can type into: searched too. Greenhouse's School picker
      // opens on the first hundred schools alphabetically, and "IIT Kharagpur" is not among them —
      // it appears only when typed. Nobody scrolls fifty options by voice, and a list that long in
      // a box that takes typing may well be one page of a bigger one.
      const typesToSearch =
        el.tagName.toLowerCase() === "input" ||
        Boolean(el.getAttribute("aria-autocomplete")) ||
        Boolean(el.querySelector("input"));
      if (typesToSearch && (options.length === 0 || options.length >= SEARCH_NOT_SCROLL)) spec.searchable = true;
    } catch {
      // A widget that refuses to open is not a crash. The field keeps no options, the binder
      // leaves it as free text, and the agent asks about it out loud instead.
    } finally {
      closeWidget(el);
      await sleep(40);
    }
    return true;
  };

  const silent: [FieldSpec, HTMLElement][] = [];
  for (const spec of read.specs) {
    if (spec.kind !== "select" && spec.kind !== "multiselect") continue;
    if (spec.options && spec.options.length > 0) continue; // a real <select> already gave them up

    const el = read.handles.get(spec.id);
    if (!el || !el.isConnected) continue;
    if (!(await pressAndRead(spec, el, false))) silent.push([spec, el]);
  }

  // A widget that did not react at all has not said it has no options. A server-rendered page
  // shows its widgets before its scripts bring them to life: on a busy machine Greenhouse's
  // dropdowns stayed dead for eight seconds after load, and each was read as a list that fills
  // as you type — so no choices, and no picker for a phone's "+91". Ask them once more, after the
  // rest, before deciding.
  if (silent.length > 0) {
    await whenSettled(doc, 350, 3000);
    for (const [spec, el] of silent) if (el.isConnected) await pressAndRead(spec, el, true);
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
export function waitForForm(
  root: Document | Element = document,
  timeoutMs = 5000,
): Promise<void> {
  return whenSettled(
    root,
    350,
    timeoutMs,
    () => deepQueryAll(root, CANDIDATE_SELECTOR).some((el) => isVisible(el)),
  );
}
