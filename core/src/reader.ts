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
  ANSWERING,
  choiceGroup,
  choiceKey,
  toggleGroup,
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
import { accessibleDescription, accessibleName } from "./accname";
import { DATE_MASK } from "./shapes";
import type {
  FieldHandles,
  FieldKind,
  FieldOption,
  FieldSpec,
  FormRead,
  SkippedField,
} from "./types";
import { phoneFields } from "./phones";

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
  // Toggle buttons side by side are one question too (`toggleGroup`) — Ashby's Yes and No.
  "button[aria-pressed]",
  "[role='button'][aria-pressed]",
  "[role='checkbox']",
  "[role='switch']",
].join(",");

/** Input types that are a control, not an answer. */
const NON_ANSWER_TYPES = new Set(["submit", "button", "reset", "image", "hidden"]);

/** Is this something a person answers? Page data, buttons, and controls nobody can reach are not. */
function isAField(node: Element): boolean {
  if (node.tagName === "INPUT" && NON_ANSWER_TYPES.has(((node as HTMLInputElement).type || "text").toLowerCase())) return false;
  if (node.getAttribute("tabindex") === "-1" && node.closest("[aria-hidden='true']")) return false;
  return isVisible(node);
}

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

/**
 * Text as a person sees it: white space run together, and nothing at either end that draws
 * nothing. Luma sets a zero-width space before every input; U+200B is not white space to `\s` or
 * `trim()`, and "​" was read as the phone number's question. Inside a word such characters
 * stay — Hindi joins and parts its letters with them, and emoji are built with them.
 */
function tidy(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, "");
}

function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return tidy((el as HTMLElement).innerText ?? el.textContent ?? "");
}

/**
 * The words in a `<label>` that belong to the question rather than to the answer.
 *
 * Works on a detached clone so the live page is never touched, and reads `textContent` rather
 * than `innerText` because a clone is not rendered and has no `innerText` worth having.
 */
function labelTextWithoutControls(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  // Controls, and whatever widgets sit inside the label too: Workable wraps the phone's country
  // picker in the phone's label, and its 244 countries were being read as the question.
  clone
    .querySelectorAll(
      "input, textarea, select, option, [role='combobox'], [role='listbox'], [role='option'], [role='menu'], [contenteditable]",
    )
    .forEach((node) => node.remove());
  return tidy(clone.textContent ?? "");
}

/** Widgets whose text is their own, never a question's: remove or skip them in a label. */
const WIDGETS =
  "input, textarea, select, option, [role='combobox'], [role='listbox'], [role='option'], [role='menu'], [contenteditable]";

function shownText(node: Node): boolean {
  const parent = node.parentElement as HTMLElement | null;
  return Boolean(parent) && !(parent!.checkVisibility && !parent!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
}

/**
 * The words of a label wrapped around its control: only what is shown, never another widget's, and
 * — for a box you type into — only what comes before it. Lever wraps a whole question in one
 * `<label>`, dropdown included, and "Current location" came out as "Current location ✱No location
 * found. Try entering a different locationLoading". A checkbox's words follow it ("☐ I agree"), so
 * for a checkable everything shown counts.
 */
function wrappingLabelText(label: Element, control: Element): string {
  const type = (control.getAttribute("type") ?? "").toLowerCase();
  const checkable = control.tagName === "INPUT" && (type === "checkbox" || type === "radio");
  const parts: string[] = [];
  const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const widget = node.parentElement?.closest(WIDGETS);
    if (widget && label.contains(widget)) continue;
    if (!shownText(node)) continue;
    if (!checkable && !(control.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
    const text = tidy(node.textContent ?? "");
    if (text) parts.push(text);
  }
  return parts.join(" ").trim() || labelTextWithoutControls(label);
}

/**
 * The question in a field's own block, for pages that set the question beside the control with
 * nothing tying them together — Lever writes it in a div above, Ashby in a `<label for>` whose id
 * the control does not carry.
 *
 * The block is the smallest one around the control (or around all of a group's choices) that
 * holds no other field — so a section heading shared by several fields is never taken. In it, what
 * comes BEFORE the control: a `<label>` that labels none of the choices, or else the visible
 * text. Only before: hints ("Area Code", "example@example.com") and dropdown messages ("No
 * location found") come after it.
 */
function ownBlockLabel(members: Element[], isOtherField: (node: Element) => boolean): { text: string; from: Element[] } {
  const none = { text: "", from: [] };
  const first = members[0];
  if (!first) return none;
  const ours = (node: Node) => members.some((member) => member === node || member.contains(node) || (node instanceof Element && node.contains(member) && node.tagName === "LABEL"));
  const before = (node: Node) => (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
  const labelsAChoice = (label: HTMLLabelElement) => members.some((member) => label.contains(member) || (member.id !== "" && label.htmlFor === member.id));

  let block: Element | null = first.parentElement;
  while (block && !members.every((member) => block!.contains(member))) block = block.parentElement;
  for (let hops = 0; block && hops < 4; hops++, block = block.parentElement) {
    if (Array.from(block.querySelectorAll(CANDIDATE_SELECTOR)).some((node) => isOtherField(node) && !ours(node))) return none;

    const orphan = Array.from(block.querySelectorAll("label")).find((label) => before(label) && !labelsAChoice(label) && textOf(label));
    if (orphan) return { text: textOf(orphan), from: [orphan] };

    // The first block of text before the control is the question; a block after that is its
    // description (Lever: "Which university…?" then "Please select \"Other\" if…"). Inline pieces of
    // the first block — its ✱ — belong to it.
    // Text inside a control of its own — USDA's clickable "Hints" beside "Keyword Search" — is not
    // the question's.
    const clickable = (node: Node) => node.parentElement?.closest("a[href], button, [role='button'], [role='link'], [onclick]") ?? null;
    const counts = (node: Node) =>
      before(node) && !ours(node) && shownText(node) && tidy(node.textContent ?? "") !== "" && !(clickable(node) && block!.contains(clickable(node)));
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let first: Node | null = null;
    for (let node = walker.nextNode(); node && !first; node = walker.nextNode()) if (counts(node)) first = node;
    if (first) {
      const view = block.ownerDocument.defaultView;
      let holder = first.parentElement!;
      while (holder !== block && holder.parentElement && /^(inline|contents)/.test(view?.getComputedStyle(holder).display ?? "")) holder = holder.parentElement;
      const parts: string[] = [];
      const inner = block.ownerDocument.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
      for (let node = inner.nextNode(); node; node = inner.nextNode()) if (counts(node)) parts.push(tidy(node.textContent ?? ""));
      const text = parts.join(" ").trim();
      if (text) return { text: text.slice(0, 400), from: [holder] };
    }
  }
  return none;
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
 *
 * `from` holds the elements the words were read from — where a star drawn by the stylesheet
 * would be (`drawsAStar`). Empty when the words came from an attribute.
 *
 * A label that names only a piece of an answer — "Date", "Month" — is not the question. The
 * question is the one over the boxes together (`wholeQuestion`), and when there are several boxes
 * the piece is kept as `part`. A box can also carry both: IRCC's year box has the question as one
 * label and "Year" as another, for screen readers.
 */
function labelOf(el: Element): { text: string; from: Element[]; part?: string } {
  const own = ownLabelOf(el);
  const piece = (text: string) => text !== "" && PART_ONLY.test(cleanLabel(text));
  if (!piece(own.text)) {
    const labels = Array.from((el as HTMLInputElement).labels ?? []).map(textOf);
    const part = (labels.length > 1 ? labels.find(piece) : undefined) ?? sharedQuestionPiece(el, own.text);
    return part ? { ...own, part: cleanLabel(part) } : own;
  }
  const whole = wholeQuestion(el);
  if (!whole) return own;
  return whole.boxes > 1 ? { text: whole.text, from: whole.from, part: cleanLabel(own.text) } : { text: whole.text, from: whole.from };
}

/**
 * The piece a box names beside the question it shares with its sibling boxes. Jotform labels a
 * phone's area-code box by the question ("Phone Number", which the number box names too) and by
 * its own caption under it ("Area Code"). What the boxes share is the question; what is this box's
 * alone is its piece. Structure, not words: which labels are shared is in the markup.
 */
function sharedQuestionPiece(el: Element, question: string): string | undefined {
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (ids.length < 2) return undefined;
  const root = el.getRootNode() as Document | ShadowRoot;
  const shared = (id: string) => root.querySelectorAll(`[aria-labelledby~="${CSS.escape(id)}"]`).length > 1;
  if (!ids.some(shared)) return undefined;
  const own = ids
    .filter((id) => !shared(id))
    .map((id) => root.querySelector(`#${CSS.escape(id)}`))
    .filter((node): node is Element => node !== null && isVisible(node) && textOf(node) !== "" && !question.includes(textOf(node)));
  return own.length === 1 ? textOf(own[0]) : undefined;
}

/**
 * The answers of a list that is one piece of a date: the calendar's own values. IRCC opens its
 * year, month and day lists with "Select year" — with a real value, so it read as an answer. A day
 * is a number from 1 to 31 and a year four digits, whatever the language; a month list is twelve
 * months, so in one of thirteen the one before them is the prompt. Anything that does not fit
 * leaves the list as it was.
 */
function calendarChoices(options: FieldOption[], part: string): FieldOption[] {
  const piece = part.toLowerCase();
  const keep = (fits: (label: string) => boolean, least: number) => {
    const real = options.filter((option) => fits(option.label.trim()));
    return real.length >= least && real.length === options.length - 1 ? real : options;
  };
  if (/^(day|dd)$/.test(piece)) return keep((label) => /^\d{1,2}$/.test(label) && Number(label) >= 1 && Number(label) <= 31, 28);
  if (/^(year|yyyy)$/.test(piece)) return keep((label) => /^\d{4}$/.test(label), 2);
  if (/^(month|mm)$/.test(piece)) return options.length === 13 ? options.slice(1) : options;
  return options;
}

/** The most boxes one answer is split across — a date's three, a phone's four. More is a section. */
const MOST_PARTS = 4;

/**
 * The question over a box whose own label names only a piece of the answer. A group the author
 * named around it first: Google Forms labels its date box "Date" and puts "Date of Birth" on the
 * group; GOV.UK puts its question in the legend over "Day", "Month", "Year". Else the smallest
 * block holding the pieces, and the first label in it that names more than a piece: IRCC sets
 * "What is your date of birth?" over three boxes labelled "Year", "Month", "Day".
 */
function wholeQuestion(el: Element): { text: string; from: Element[]; boxes: number } | null {
  const fieldsIn = (node: Element) => Array.from(node.querySelectorAll(CANDIDATE_SELECTOR)).filter(isAField);
  const whole = (text: string) => text !== "" && !PART_ONLY.test(cleanLabel(text));

  const group = el.parentElement?.closest("[aria-labelledby], [aria-label], fieldset");
  if (group) {
    const boxes = fieldsIn(group).length;
    const named = boxes <= MOST_PARTS ? labelOf(group) : null;
    if (named && whole(named.text)) return { text: named.text, from: named.from, boxes };
  }

  let block = el.parentElement;
  while (block && fieldsIn(block).length < 2) block = block.parentElement;
  if (!block) return null;
  const fields = fieldsIn(block);
  if (fields.length > MOST_PARTS) return null;
  const before = (node: Node) => (fields[0]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
  const label = Array.from(block.querySelectorAll("label, legend")).find((node) => before(node) && whole(textOf(node)));
  return label ? { text: textOf(label), from: [label], boxes: fields.length } : null;
}

/** The name this box carries itself, by the rules below. */
function ownLabelOf(el: Element): { text: string; from: Element[] } {
  const doc = el.ownerDocument;
  const root = el.getRootNode() as Document | ShadowRoot;

  // 1. aria-labelledby — the author naming the label explicitly.
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => root.querySelector(`#${CSS.escape(id)}`) ?? doc?.getElementById(id))
      .filter((part): part is Element => part !== null && textOf(part) !== "");
    // aria-labelledby often strings several things together; the question is the part a person
    // reads as one — shown on screen, set before the control, and more than a number. MS Forms adds
    // "Single line text." for screen readers only; Jotform adds the hint under the box
    // ("example@example.com"); Typeform prefixes the question's number ("1").
    const before = (part: Element) => (el.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const worded = (part: Element) => !/^[\s\d.):#-]*$/.test(textOf(part));
    const question = parts.filter((part) => isVisible(part) && before(part) && worded(part));
    const shown = parts.filter((part) => isVisible(part) && worded(part));
    const chosen = question.length > 0 ? question : shown.length > 0 ? shown : parts;
    const text = chosen.map(textOf).join(" ");
    if (text) return { text, from: chosen };
  }

  // 2. aria-label — the author writing the label out.
  const ariaLabel = tidy(el.getAttribute("aria-label") ?? "");
  if (ariaLabel) return { text: ariaLabel, from: [] };

  // 3. <label for="…">. Searched from the element's own root so it works inside a shadow tree.
  if (el.id) {
    const forLabel = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = textOf(forLabel);
    if (text) return { text, from: [forLabel!] };
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
    const text = wrappingLabelText(wrapping, el);
    if (text) return { text, from: [wrapping] };
  }

  // 4b. A rich-text editor standing in for a textarea the page hides (Jotform's nicEdit): the page
  //     labels the textarea, and the editor is where a person writes it. Its own surroundings — the
  //     editor's toolbar — are not the question.
  if ((el as HTMLElement).isContentEditable) {
    const standsFor = hiddenTextareaBeside(el);
    if (standsFor) {
      const named = ownLabelOf(standsFor);
      if (named.text) return named;
    }
  }

  // 5. A fieldset's legend — how radio groups are almost always named.
  const legend = el.closest("fieldset")?.querySelector("legend");
  const legendText = textOf(legend);
  if (legendText) return { text: legendText, from: [legend!] };

  // 5b. The field's own block — a question set beside the control with nothing tying them. Before
  //     the placeholder: Lever's is "Type your response", Ashby's "Start typing...".
  const own = ownBlockLabel([el], isAField);
  if (own.text) return own;

  // 6. The author's fallbacks.
  const placeholder = tidy(el.getAttribute("placeholder") ?? "");
  if (placeholder) return { text: placeholder, from: [] };
  const title = tidy(el.getAttribute("title") ?? "");
  if (title) return { text: title, from: [] };

  // 7. Last resort: the nearest text sitting above the control. Bounded, because walking far
  //    enough up any page will always find *something*, and it will be wrong.
  let node: Element | null = el;
  for (let hops = 0; node && hops < 4; hops++) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      const text = textOf(sibling);
      if (text && text.length <= 120) return { text, from: [sibling] };
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }

  // 8. The standard's own answer, when none of the above found words. Not first: measured on the
  //    corpus, the W3C accessible name matched the question on 240 of 315 fields and these rules on
  //    305 — it strings on hints, screen-reader text and "(required)" (see RESEARCH.md).
  const standard = accessibleName(el);
  return { text: standard, from: [] };
}

/** The textarea a rich-text editor writes into for the page: hidden, and the nearest one to it. */
function hiddenTextareaBeside(editor: Element): Element | null {
  let block = editor.parentElement;
  for (let hops = 0; block && hops < 3; hops++, block = block.parentElement) {
    const textarea = Array.from(block.querySelectorAll("textarea")).find((node) => node !== editor && !isVisible(node));
    if (textarea) return textarea;
  }
  return null;
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
  const ariaLabel = tidy(container.getAttribute("aria-label") ?? "");
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

/**
 * A radio group built of divs is required when its radios say so: Workable marks every one of
 * them `aria-required` and the group itself nothing, and three required questions read optional.
 */
function choicesSayRequired(el: Element): boolean {
  return el.getAttribute("role") === "radiogroup" && el.querySelector("[role='radio'][aria-required='true'], input[type='radio'][required]") !== null;
}

/**
 * The help the page gives for a field — its format, an example: "Format: (000) 000-0000." From the
 * accessible description (`aria-describedby` and its kin), never the question again, and short:
 * it rides along to the agent with every field.
 */
function describe(el: Element, label: string): string {
  const text = accessibleDescription(el);
  if (!text || comparableText(text) === comparableText(label)) return "";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

const comparableText = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A label that names a piece of an answer rather than the question. */
const PART_ONLY = /^(date|time|day|month|year|hour|minute|dd|mm|yyyy|hh)$/i;

/** A label ending in an asterisk marks a required question — the web's near-universal convention. */
const STARRED = /^[\s\p{Cf}]*[*✱]|[*✱][\s\p{Cf}]*$/u; // at either end: Workable writes "* Phone"

/**
 * A required star drawn by the stylesheet rather than written. MS Forms puts
 * `::after { content: " * " }` on an empty span beside the question: every person sees it,
 * `innerText` does not, and every required MS Forms question was read as optional.
 */
/**
 * A star set beside the question rather than in it: Workable puts "*" in a span of its own before
 * the label. The label's line — the blocks around it, up to one that holds a field — carries it.
 */
function starBeside(sources: Element[], control: Element): boolean {
  return sources.some((source) => {
    let line = source.parentElement;
    for (let hops = 0; line && hops < 3; hops++, line = line.parentElement) {
      if (line.contains(control) || Array.from(line.querySelectorAll(CANDIDATE_SELECTOR)).some(isAField)) return false;
      if (STARRED.test(textOf(line))) return true;
    }
    return false;
  });
}

function drawsAStar(sources: Element[]): boolean {
  const starAlone = /^[\s\p{Cf}]*[*✱][\s\p{Cf}]*$/u;
  return sources.some((source) => {
    const view = source.ownerDocument.defaultView;
    if (!view) return false;
    // Bounded: a question is a line or two, and each style lookup costs.
    const nodes = [source, ...Array.from(source.querySelectorAll("*")).slice(0, 60)];
    return nodes.some((node) =>
      ["::before", "::after"].some((pseudo) => {
        // Only a quoted string is drawn text — not `none`, a counter or an image — and only a star
        // standing alone: an arrow or an empty spacer is decoration.
        const drawn = /^"(.*)"$/.exec(view.getComputedStyle(node, pseudo).content)?.[1] ?? "";
        return starAlone.test(drawn) && (node as HTMLElement).checkVisibility?.() !== false;
      }),
    );
  });
}

/** `Country*` and `Are you a veteran? *` are the same question. Drop the required marker. */
function cleanLabel(raw: string): string {
  return tidy(
    raw
      .replace(/[\s\p{Cf}*✱]+$/u, "")
      .replace(/^[\s\p{Cf}*✱]+/u, "")
      // A question's number is its place in the form, not its words: MS Forms' "1. First Name" is
      // asked as "First Name". Only a number followed by "." or ")" and a space — "2.5 GPA" and
      // "18+ years" keep theirs.
      .replace(/^\s*\d{1,3}[.)]\s+(?=\S)/, ""),
  );
}

function kindOf(el: Element): FieldKind {
  const tag = el.tagName.toLowerCase();

  // Role is checked before tag on purpose. A real Greenhouse dropdown is an `<input type=text>`
  // carrying `role="combobox"`; reading the tag first calls it a text box and the choices are
  // lost. The page under test had **no `<select>` elements at all** and twelve comboboxes.
  const role = el.getAttribute("role");
  const popup = el.getAttribute("aria-haspopup");
  // …except where the input's own type says what the answer is. Tally's phone box is an
  // `<input type=tel role=combobox>`: the list it opens is suggestions (a country), the answer is
  // typed. Read as a dropdown, the number was "rejected" and the box's placeholder text was taken
  // for its value.
  const typed = tag === "input" ? ((el as HTMLInputElement).type || "").toLowerCase() : "";
  if (typed === "tel" || typed === "email" || typed === "url" || typed === "number") return typed;
  // A textarea is typed into, whatever it suggests: Slate's Street is a `<textarea role=combobox>`.
  if (tag === "textarea") return "textarea";
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
        // A text box whose placeholder is a date's format takes a date — Jotform's "DD-MM-YYYY".
        // The writer puts the date in that very shape (`asFieldDate`).
        return DATE_MASK.test((el.getAttribute("placeholder") ?? "").trim()) ? "date" : "text";
    }
  }

  // A div wearing a role we did not recognise. Treated as free text.
  return "textarea";
}

function optionsOf(el: Element): FieldOption[] | undefined {
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const all = Array.from((el as HTMLSelectElement).options).filter((option) => option.value !== "" || textOf(option) !== "");
    // A choice is something a person can pick that answers the question. `<option value="">Please
    // Select</option>` submits nothing — it is "no answer", the HTML placeholder — and a disabled or
    // hidden option cannot be picked. Left in, "Please Select" sat in the tool's enum of answers.
    // A select whose options all submit nothing is unusual, not empty: keep them.
    const picks = all.filter((option) => option.value !== "" && !option.disabled && !option.hidden);
    const options = (picks.length > 0 ? picks : all).map((option) => ({ value: option.value, label: textOf(option) || option.value }));
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
  const groups = new Map<Element | string, FieldSpec>();

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

    // Toggle buttons side by side are one question with one answer pressed — Ashby's Yes and No,
    // whose state sits in a hidden checkbox. Read as buttons they were no question at all, and the
    // agent never asked them. Read once, at the group's first button.
    if (el.hasAttribute("aria-pressed")) {
      const toggles = toggleGroup(el);
      if (toggles[0] !== el || !isVisible(el)) return;
      const { text: question, from } = ownBlockLabel(toggles, isAField);
      const label = cleanLabel(question);
      const spec: FieldSpec = {
        id: takeId(label || "choice", index),
        label,
        kind: "radio",
        required: STARRED.test(question) || drawsAStar(from),
        options: toggles.map((toggle) => {
          const text = tidy(toggle.textContent ?? "");
          return { value: text, label: text };
        }),
        custom: true,
      };
      // The field is what holds the whole answer — the buttons and the state beside them
      // (Ashby's hidden checkbox) — as a radiogroup holds its radios.
      const holder = el.parentElement ?? el;
      const selector = uniqueSelector(holder, ownerDocumentOf(root));
      if (selector) spec.selector = selector;
      specs.push(spec);
      handles.set(spec.id, holder as HTMLElement);
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
    // …except a list you pick from: its box is read-only because you pick instead of type. Workable's
    // English level was dropped as unanswerable, and Cognito's Country — read-only once picked —
    // vanished from the form the moment it was answered.
    if ((el as HTMLInputElement).readOnly && kindOf(el) !== "select") return;

    // Taken out of the keyboard's reach AND hidden from screen readers: the author has said, twice,
    // that no person is meant to use it. Workable's address autofill-catchers (city, postcode,
    // country) are exactly this — 42 px boxes nobody can see, and the agent was being handed them
    // to fill. Either mark alone is ordinary (a modal hides the page behind it; a radio group
    // takes its unselected radios out of the tab order); both together never are.
    if (el.getAttribute("tabindex") === "-1" && el.closest("[aria-hidden='true']")) {
      skipped.push({ label: el.getAttribute("name") || kindOf(el), reason: "hidden from keyboard and screen readers" });
      return;
    }

    const visible = isVisible(el);
    const kind = kindOf(el);
    const { text: rawLabel, from: labelledFrom, part } = labelOf(el);
    const label = cleanLabel(rawLabel);
    // Google Forms sets no `required` and no `aria-required` on a text answer: the only mark is
    // the asterisk on its question. Read as optional, a required question was never asked.
    const starred = STARRED.test(rawLabel) || drawsAStar(labelledFrom) || starBeside(labelledFrom, el);
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
    const members = (kind === "radio" || kind === "checkbox") && tag === "input" ? choiceGroup(el) : [];
    if ((kind === "radio" || kind === "checkbox") && (name || members.length > 1)) {
      // Keyed by the group's first box, not its name: Tally's boxes have none.
      const groupKey: Element | string = members[0] ?? `${kind}:${name}`;
      const siblings =
        tag === "input"
          ? members.filter((other) => candidates.includes(other) && kindOf(other) === kind)
          : candidates.filter((other) => other.getAttribute("name") === name && kindOf(other) === kind);
      const isGroup = kind === "radio" || siblings.length > 1;

      if (isGroup) {
        const existing = groups.get(groupKey);
        const option: FieldOption = {
          // What tells this box from the others in its group — the writer finds it by the same.
          value: tag === "input" ? choiceKey(el, members) : (el as HTMLInputElement).value || label,
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
        // A named container first; else the group's own block (Lever's and Ashby's groups have
        // neither a legend nor a label, and came out named "cards[1c71…][field0]").
        const question = groupQuestion(el) || ownBlockLabel(siblings.length > 0 ? siblings : [el], isAField).text;
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
    // A lone checkbox in a group the page named for it — Slate's fieldset "Is your permanent home
    // address different?" around one box labelled "Yes". The group's name is the question; the
    // box's own label only says what ticking it means, and travels with it as its description.
    let question = label;
    let ticking = "";
    if (kind === "checkbox" && tag === "input") {
      const container = el.parentElement?.closest(GROUP_CONTAINER);
      const named = container && container.querySelectorAll(ANSWERING).length === 1 ? cleanLabel(containerName(container)) : "";
      if (named && named !== label) {
        question = named;
        ticking = label;
      }
    }

    const id = takeId(part && question ? `${question} ${part}` : question || name || el.id, index);
    const spec: FieldSpec = {
      id,
      label: question,
      kind,
      required:
        Boolean((el as HTMLInputElement).required) || el.getAttribute("aria-required") === "true" || starred || choicesSayRequired(el),
    };
    if (part) spec.part = part;
    spec.nameSource = labelledFrom.some((node) => isVisible(node)) ? "shown" : "attribute";

    const selector = uniqueSelector(el, ownerDocumentOf(root));
    if (selector) spec.selector = selector;

    const options = optionsOf(el);
    if (options) spec.options = part ? calendarChoices(options, part) : options;

    const description = [ticking, describe(el, question)].filter(Boolean).join(" — ");
    if (description) spec.description = description;

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

  // A dial-code picker that shows a person only a flag — named "Telephone country code" for screen
  // readers alone (Workable) — asks, on screen, the phone's own question: it takes that question,
  // and its own name becomes the piece of the answer it holds. One named on screen ("Country" on
  // Greenhouse) keeps its name.
  for (const [id, partner] of phoneFields(specs)) {
    const spec = specs.find((s) => s.id === id);
    const tel = specs.find((s) => s.id === partner);
    if (!spec || !tel || spec.kind === "tel" || spec.nameSource !== "attribute" || spec.part || !tel.label) continue;
    spec.part = spec.label;
    spec.label = tel.label;
  }

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
    const above = deepQueryAll(root, "h1,h2,h3,h4,h5,h6,[role='heading']")
      .filter(isVisible)
      .filter((heading) => heading.compareDocumentPosition(firstField) & FOLLOWING)
      .filter((heading) => cleanLabel(textOf(heading)) !== "");
    // The page's own title names the form ("Job Application for Software Engineer, Backend at
    // Glean"): the heading it contains is the form's name — not the nearest "Apply for this job",
    // "Personal information", or a question's own heading. Else the nearest heading, as a site's
    // header ("Acme Careers") sits above a form's own title.
    const flat = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const pageTitle = flat(ownerDocumentOf(root).title ?? "");
    const named = above.filter((heading) => {
      const text = flat(textOf(heading));
      return text.length >= 4 && pageTitle.includes(text);
    });
    const chosen = named[0] ?? above[above.length - 1];
    const text = chosen ? cleanLabel(textOf(chosen)) : "";
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

  const first = [...handles.values()].sort(byPosition)[0];
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

  /**
   * With no heading over it, a named group holding several fields gives them its name: Jotform's
   * "Business Address" names a group of Street, City, State and Zip boxes, and without it a form
   * asking for two addresses — the business's and the person's — asked "Street Address" twice
   * with nothing to tell them apart. A heading still wins: it is the wider context ("Alternate
   * Designated Representative"), the one that says whose answer it is.
   */
  // A group named by one of its own fields' questions is that question's group — Greenhouse's
  // "Phone" holds the number and its country code — not a section: named so, the code picker and
  // the number fell into different sections and were no longer paired.
  const groupName = (el: Element): string => {
    const group = el.parentElement?.closest("fieldset, [role='group']");
    if (!group) return "";
    const inside = specs.filter((spec) => {
      const field = handles.get(spec.id);
      return field !== undefined && group.contains(field);
    });
    if (inside.length < 2) return "";
    const name = cleanLabel(containerName(group));
    return inside.some((spec) => spec.label === name) ? "" : name;
  };

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
    if (!found) found = groupName(el);
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
    let revealed: HTMLElement[] = [];

    try {
      openWidget(el);
      // Wait for the menu, not for a guess at how long a menu takes. A fixed 150 ms read
      // Greenhouse's 244 country codes as nothing on a busy machine — and a "+91" then had no
      // picker to go to. Open means new options on screen, or the widget saying it is expanded
      // (a list that fills as you type opens empty); read once the page has gone quiet.
      await whenSettled(doc, settleMs, MENU_TIMEOUT_MS, opened);
      if (!opened() && !lastTry) return false;

      revealed = allOptions().filter((option) => !before.has(option));
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
      // Handed what it showed, so closing stops once the list is gone (see `closeWidget`).
      closeWidget(el, revealed.length > 0 ? revealed : undefined);
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
