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
 * ## Never guess an option
 *
 * If a spoken answer does not clearly match one of the choices the page offers, the field is
 * left alone and the reason is reported, so the agent can ask. Quietly falling back to the
 * first option is how a form ends up claiming someone attended a university they have never
 * been to, or worked somewhere they never worked.
 *
 * ## Why this file is async, and why "written" is checked against the page
 *
 * A modern dropdown is not a `<select>`. It is a component that keeps its selection in its own
 * state and ignores the DOM. Assigning `.value` to one **changes what the box looks like and
 * submits nothing** — measured on a live Greenhouse form, where the raw input read back `"No"`
 * while the component still held nothing at all.
 *
 * So a custom widget is operated the way a person operates it: open it, wait for the options to
 * exist, press one. And success is never taken on trust — every write is confirmed by reading
 * what the page now shows, not by reading back the value we just set. That distinction is the
 * difference between a demo that looks like it works and a form that is actually filled in.
 */

import { choiceGroup, choiceKey, closeWidget, deepQueryAll, exclusively, openWidget, optionNodes, ownsOptions, pressOption } from "./dom-path";
import type { FieldHandles, FieldSpec, SpokenValue } from "./types";

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

/** How long to let a component draw its options before giving up on it. */
const WIDGET_OPEN_MS = 400;

/**
 * How long to wait before trying a rejected write once more.
 *
 * A form that re-renders while we are writing — a validation pass, a controlled component
 * catching up — drops the first value and keeps the second. One retry converts most of those
 * into successes, and the ones it does not are then reported as genuinely failed rather than
 * silently left empty.
 */
const RETRY_AFTER_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
function confirmed(done: () => boolean, timeoutMs = CONFIRM_MS): Promise<boolean> {
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
 * This works for text. It does **not** work for a component's selection — see the file note.
 */
function setNativeValue(el: HTMLElement, value: string): void {
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
function pressChoice(box: HTMLInputElement, want: boolean): void {
  if (box.checked !== want) box.click();
  // A page that cancels the click (some "are you sure?" handlers do) leaves it unchanged; the
  // caller reads `.checked` back and reports that honestly rather than forcing it.
}

function announce(el: HTMLElement, kinds: string[]): void {
  for (const kind of kinds) {
    el.dispatchEvent(new Event(kind, { bubbles: true }));
  }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words that mean no, in either of the two languages Longtake is built to hear. */
export const MEANS_NO = /\b(no|not|false|never|decline|disagree|refuse|nahi|nahin)\b/i;
/** Words that mean yes. Only consulted once the negatives have had their say. */
export const MEANS_YES = /\b(yes|true|agree|agreed|accept|confirm|ok|okay|sure|haan|han|ji|sahi)\b/i;

/**
 * Did the speaker mean yes?
 *
 * The negative is tested first and that ordering is the whole point: "I do not agree" contains
 * the word "agree", and a tick-box for a privacy policy is not the place to get that backwards.
 * Anchoring on the first word instead — which is the obvious implementation — fails on "I agree",
 * which is how most people actually say it.
 */
function readAsYesOrNo(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value);
  if (MEANS_NO.test(text)) return false;
  return MEANS_YES.test(text);
}

/**
 * The matching rule itself, over any list of candidate wordings.
 *
 * Shared so that a dropdown whose options were read in advance and one whose options only exist
 * once it is open are judged by exactly the same standard. Returns the index of the single
 * candidate the speaker meant, or `null`.
 */
/**
 * An option's name without what a person never says aloud: a trailing dialling code ("India +91")
 * or a bracketed short form ("… Kharagpur (IITKGP)"). Normalised.
 */
function bareName(label: string): string {
  return normalise(label.replace(/\s*\+\d[\d\s-]*$/, "").replace(/\s*\([^)]*\)\s*$/, ""));
}

/**
 * Does a widget showing this text hold this choice?
 *
 * Usually it shows the choice's words. Some show only part of them: Greenhouse's phone Country
 * picker, given "India +91", shows a flag and "+91". Checked for the whole label only, that write
 * was reported as refused by the page — twice — while India sat in the box.
 */
function showsChoice(showing: string, chosen: string): boolean {
  const shown = normalise(showing);
  const wanted = normalise(chosen);
  if (!shown) return false;
  return shown.includes(wanted) || (shown.length >= 2 && ` ${wanted} `.includes(` ${shown} `));
}

function matchAmong(candidates: string[], spoken: string): number | null {
  const want = normalise(spoken);
  if (!want) return null;

  const exact = candidates.findIndex((candidate) => normalise(candidate) === want);
  if (exact >= 0) return exact;

  // The same once a dialling code or a bracketed short name is set aside: "India +91" is India,
  // "Indian Institute of Technology Kharagpur (IITKGP)" is the institute.
  const plain = candidates.map(bareName);
  if (plain.filter((text) => text === want).length === 1) return plain.indexOf(want);

  // The spoken words as whole words. Greenhouse's phone Country search for "India" returns
  // "British Indian Ocean Territory +246" and "India +91": as a bare substring "india" is in
  // both, and the field was refused as ambiguous with India right there on the list.
  const whole: number[] = [];
  candidates.forEach((candidate, index) => {
    if (` ${normalise(candidate)} `.includes(` ${want} `)) whole.push(index);
  });
  if (whole.length === 1) return whole[0]!;

  // One candidate contains the spoken words, or the spoken words contain it — but only if
  // exactly one does. Two means we do not actually know which was meant, and a coin flip on
  // "United States" versus "United Kingdom" is not a thing to do to somebody's application.
  const partial: number[] = [];
  candidates.forEach((candidate, index) => {
    const text = normalise(candidate);
    if (text.length > 0 && (text.includes(want) || want.includes(text))) partial.push(index);
  });
  return partial.length === 1 ? partial[0]! : null;
}

/**
 * The one option the person named, word for word, somewhere in what they said.
 *
 * ## Why
 *
 * Live run: "I'm based in Kolkata, India." The Glean application has no City box, so the agent put
 * the location into Country — as "Kolkata" — and the form, correctly, did not offer Kolkata. The
 * agent then announced "India is not an option", which was false: India was on the list, and the
 * person had said it, and the agent's own evidence quote contained it.
 *
 * So when the value does not match, the evidence is read for an option named in it. This does not
 * loosen the rule that nothing unspoken is written — the option has to appear in the person's own
 * words, as a whole word or phrase, and exactly one option may. "Twitter" still matches nothing on
 * a list without Twitter; "yes, no problem" names two answers and is left alone.
 */
export function optionNamedIn(spec: FieldSpec, evidence: string | undefined): { value: string; label: string } | null {
  const heard = ` ${normalise(evidence ?? "")} `;
  if (!heard.trim()) return null;

  // Named in full, or by the name a person actually says — "India" for "India +91". Longest names
  // first, each taking its words out of what was heard: "Computer Science" names Computer Science
  // and not also "Science", an option of its own on Discord's list — two names meant "not sure",
  // and a plainly named answer waited for a yes.
  const names = (spec.options ?? [])
    .filter((option) => option.value !== "")
    .flatMap((option) => [normalise(option.label), bareName(option.label)].filter((label) => label.length >= 2).map((label) => ({ option, label })))
    .sort((a, b) => b.label.length - a.label.length);
  let rest = heard;
  const named = new Set<{ value: string; label: string }>();
  for (const { option, label } of names) {
    if (!rest.includes(` ${label} `)) continue;
    named.add(option);
    rest = rest.split(` ${label} `).join("  ");
  }

  return named.size === 1 ? [...named][0]! : null;
}

/**
 * Which of the page's own options did the speaker mean?
 *
 * Returns `null` rather than a best guess. Every caller treats `null` as "leave it and ask".
 */
export function matchOption(spec: FieldSpec, spoken: string): { value: string; label: string } | null {
  if (!spec.options || spec.options.length === 0) return null;

  // Labels and values are both offered, because a person says "India" and a form stores "in".
  const labels = spec.options.map((option) => option.label);
  const byLabel = matchAmong(labels, spoken);
  if (byLabel !== null) return spec.options[byLabel]!;

  const values = spec.options.map((option) => option.value);
  const byValue = matchAmong(values, spoken);
  return byValue !== null ? spec.options[byValue]! : null;
}

/**
 * The page's own wording for what this field will accept, as a sentence the agent can say.
 *
 * Capped, because the agent has to read it out loud and a person cannot hold thirty options in
 * their head. Past the cap it says how many more there are, which is enough for the agent to
 * offer to go through them.
 */
const MOST_CHOICES_TO_SAY = 10;

/**
 * The options a person could actually pick, with the placeholder dropped.
 *
 * A `<select>` almost always opens with `<option value="">Select…</option>`, and the reader
 * keeps it because it is a real option element. It is not a real answer, though, and an agent
 * reading "choose from: Select, India, United States" out loud sounds broken.
 */
export function realChoices(options: { value: string; label: string }[] | undefined): string[] {
  const real = (options ?? []).filter((option) => option.value !== "");
  // If every option has an empty value the form is unusual, not placeholder-only — keep them all
  // rather than telling the person this field has no choices at all.
  return (real.length > 0 ? real : (options ?? [])).map((option) => option.label).filter(Boolean);
}

function sayableChoices(labels: string[]): string {
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  const shown = clean.slice(0, MOST_CHOICES_TO_SAY);
  const rest = clean.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
}

function readBack(el: HTMLElement): string {
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
function renderedText(el: HTMLElement): string {
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
function radioGroup(el: HTMLElement): HTMLInputElement[] {
  // Tag name, not `instanceof` — see `readBack` for why an iframe breaks the latter.
  if (el.tagName.toLowerCase() !== "input") return [];
  return choiceGroup(el);
}

/** What a field holds: text, the chosen option(s), a tick — or `null` when it is empty. */
export type FieldValue = string | string[] | boolean | null;

/** What a dropdown shows when nothing is chosen: "Select...", "Choose one", "-- Please select --". */
const PLACEHOLDER = /^(select|choose|pick|please (select|choose)|none selected)\b|^-+.*-+$|(\.\.\.|…)$/i;

/**
 * What this field holds right now — read off the page, for every kind of field.
 *
 * ## Why this is the foundation
 *
 * Everything that says anything about the form — the opening line, the counter, "still empty",
 * what the agent is told — has to agree, and the only thing they can all agree on is the page.
 * The previous version (`isFilled`) could not read a custom dropdown at all and answered "don't
 * know", so each caller guessed differently: on a live run India was sitting in the Country box
 * while the opening line asked where the person was based.
 *
 * A custom dropdown paints its choice as text, next to a placeholder when empty. So the text on
 * show is matched against the field's own options: an option on show is the value; a placeholder
 * or nothing is empty. Where the options were never learned, whatever non-placeholder text is on
 * show is taken as the value.
 */
export function readValue(spec: FieldSpec, el: HTMLElement): FieldValue {
  const tag = el.tagName.toLowerCase();

  if (spec.kind === "radio") {
    if (tag === "input") {
      const radios = radioGroup(el);
      const on = radios.find((radio) => radio.checked);
      if (!on) return null;
      return spec.options?.find((option) => option.value === choiceKey(on, radios))?.label ?? on.value;
    }
    const on = el.querySelector<HTMLElement>("[aria-checked='true']");
    return on ? (on.getAttribute("aria-label") ?? on.textContent ?? "").trim() || null : null;
  }

  if (tag === "select" && (el as HTMLSelectElement).multiple) {
    const picked = Array.from((el as HTMLSelectElement).selectedOptions).map((option) => option.textContent?.trim() || option.value);
    return picked.length > 0 ? picked : null;
  }

  if (spec.kind === "multiselect" && tag === "input") {
    const boxes = choiceGroup(el);
    const ticked = boxes
      .filter((box) => box.checked)
      .map((box) => spec.options?.find((option) => option.value === choiceKey(box, boxes))?.label ?? box.value);
    return ticked.length > 0 ? ticked : null;
  }

  if (spec.kind === "checkbox") {
    const on = tag === "input" ? (el as HTMLInputElement).checked : el.getAttribute("aria-checked") === "true";
    return on ? true : null;
  }

  if (tag === "select") {
    const select = el as HTMLSelectElement;
    if (!select.value) return null;
    return (select.selectedOptions[0]?.textContent ?? "").trim() || select.value;
  }

  // A div slider carries its value in ARIA; there is nothing else to read.
  if (el.getAttribute("role") === "slider") {
    return el.getAttribute("aria-valuenow");
  }

  if (spec.custom) {
    // A div trigger shows its choice in its own text; an input-based one (React-Select) shows it
    // in the block around it.
    const own = tag === "input" ? "" : (el.innerText ?? "").replace(/\s+/g, " ").trim();
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

  const text = readBack(el).trim();
  return text ? text : null;
}

/** Does this field have an answer in it right now? Read off the page — see `readValue`. */
export function isFilled(spec: FieldSpec, el: HTMLElement): boolean {
  return readValue(spec, el) !== null;
}

/**
 * Operate a dropdown that is not a `<select>`: open it, find the option, press it.
 *
 * The options are found by diffing against what was already on screen, because they usually
 * arrive through a **React portal** — rendered at the end of `<body>`, structurally nowhere near
 * the field they belong to. Looking inside the trigger's container finds nothing.
 */
async function pickFromWidget(
  spec: FieldSpec,
  el: HTMLElement,
  /**
   * The option we already know we want, when the choices were read in advance — or `null`, when
   * they were not, in which case the spoken words are matched against whatever the widget shows
   * once it opens. The second case covers dropdowns that load their choices on demand, and it is
   * the difference between such a field being fillable and being permanently unanswerable.
   */
  want: { value: string; label: string } | null,
  spoken: string,
): Promise<WriteOutcome> {
  const before = new Set(optionNodes());
  const wasShowing = renderedText(el);

  openWidget(el);
  await sleep(WIDGET_OPEN_MS);

  // What appeared because we opened it — the reliable signal, since options usually arrive
  // through a portal and cannot be found by looking inside the trigger.
  let candidates = optionNodes().filter((option) => !before.has(option));

  // …but nothing appearing does not always mean nothing opened. A widget that was ALREADY open —
  // left that way by the option-harvesting pass, because not every menu closes on Escape —
  // reveals nothing new, and treating that as a failure refuses a field we could have filled.
  //
  // Only options that are this widget's own, though. Taking "whatever is open" is how Country was
  // once refused with the Hispanic/Latino question's choices — another menu happened to be open.
  // Where the page does not say which list belongs to which trigger, there is nothing to check
  // against, and the old behaviour stands; `exclusively` is what keeps our own menus out of it.
  if (candidates.length === 0) {
    candidates = optionNodes().filter((option) => ownsOptions(el, option) !== false);
  }

  const labels = candidates.map((option) => (option.innerText ?? "").trim());
  const index = want ? matchAmong(labels, want.label) : matchAmong(labels, spoken);
  const target = index !== null ? candidates[index] : undefined;
  const chosen = index !== null ? labels[index]! : (want?.label ?? spoken);

  if (!target) {
    closeWidget(el, candidates);
    if (candidates.length === 0) {
      return {
        fieldId: spec.id,
        status: "rejected-by-page",
        wrote: chosen,
        found: "the dropdown did not open",
      };
    }
    // The widget opened and simply does not offer this. That is a question for the person, not
    // a page failure, so it is a refusal — and the refusal carries the choices, so the agent
    // reads them out instead of asking the same question again.
    return {
      fieldId: spec.id,
      status: "refused",
      reason: `"${spoken}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.`,
      choices: labels.filter(Boolean),
    };
  }

  pressOption(target);
  await sleep(200);

  // Confirmed against what the page now shows — never against the value we set ourselves.
  const showing = renderedText(el);
  const took = showsChoice(showing, chosen) && showing !== wasShowing;

  if (!took) {
    closeWidget(el, candidates);
    return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
  }

  return { fieldId: spec.id, status: "written", wrote: chosen };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Widgets that are not a list you can read in advance
// ═══════════════════════════════════════════════════════════════════════════════════════

/** How long a search-as-you-type list gets to answer a query before we stop waiting. */
const SEARCH_WAIT_MS = 2000;

/** Words that say what kind of place something is, not which one. Never searched on their own. */
const GENERIC_WORD = /^(university|college|institute|school|academy|technology|the|and|of|in|at|for|city)$/i;

/** The two longest words of an answer that could pick it out — "Kharagpur" from "IIT Kharagpur". */
function distinctiveWords(spoken: string): string[] {
  return spoken
    .split(/[\s,]+/)
    .filter((word) => word.length >= 4 && !GENERIC_WORD.test(word))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

/** The one result containing every word they said — "IIT" inside "(IITKGP)" counts. */
function everyWordIn(candidates: string[], spoken: string): number | null {
  const words = normalise(spoken).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const hits = candidates
    .map((candidate, index) => ({ text: normalise(candidate), index }))
    .filter(({ text }) => words.every((word) => text.includes(word)));
  return hits.length === 1 ? hits[0]!.index : null;
}

/**
 * A dropdown that searches as you type — a location, a college.
 *
 * Opening it shows nothing to read: the choices come from a server, for whatever has been typed.
 * So the spoken answer is typed in, and the results are judged by the same rule as every other
 * choice — exactly one must clearly be what they said. Several results that fit ("Kolkata" and
 * "Kolkata Airport") come back as choices for the person to pick between; none at all is reported.
 * If the full answer finds nothing, the part before the first comma is tried, because people say
 * "Kolkata, India" and a city search wants "Kolkata". Then its most distinctive words, one at a
 * time: Greenhouse's School search matches the whole string, so "IIT Kharagpur" finds nothing and
 * "Kharagpur" finds "Indian Institute of Technology Kharagpur (IITKGP)". A result found that way
 * is only taken when every word they said is in it — never on the searched word alone, or "Delhi
 * Public School" searched as "Public" could land on any school with Public in its name.
 */
async function typeAndPick(spec: FieldSpec, el: HTMLElement, spoken: string): Promise<WriteOutcome> {
  const input = (el.tagName.toLowerCase() === "input" ? el : el.querySelector("input")) as HTMLInputElement | null;
  if (!input) return pickFromWidget(spec, el, null, spoken);

  const queries = [spoken.trim(), spoken.split(",")[0]!.trim(), ...distinctiveWords(spoken)].filter(
    (q, i, all) => q && all.indexOf(q) === i,
  );
  let lastLabels: string[] = [];

  let lastShown: HTMLElement[] = [];
  for (const query of queries) {
    const before = new Set(optionNodes());
    openWidget(el);
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    setNativeValue(input, query);
    announce(input, ["input"]);

    // Poll: results arrive whenever the server answers.
    let candidates: HTMLElement[] = [];
    for (let waited = 0; waited < SEARCH_WAIT_MS; waited += 100) {
      await sleep(100);
      candidates = optionNodes().filter((o) => !before.has(o) && ownsOptions(el, o) !== false);
      if (candidates.length > 0) break;
    }

    lastShown = candidates;
    const labels = candidates.map((o) => (o.innerText ?? "").trim());
    const whole = query === spoken.trim() || query === spoken.split(",")[0]!.trim();
    const index = matchAmong(labels, spoken) ?? (whole ? matchAmong(labels, query) : null) ?? everyWordIn(labels, spoken);
    if (index !== null) {
      const chosen = labels[index]!;
      pressOption(candidates[index]!);
      await sleep(200);
      const showing = renderedText(el);
      if (showsChoice(showing, chosen)) return { fieldId: spec.id, status: "written", wrote: chosen };
      closeWidget(el, candidates);
      return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
    }
    if (labels.length > 0) lastLabels = labels;
  }

  // Leave the box as we found it — a half-typed search is not an answer.
  setNativeValue(input, "");
  announce(input, ["input"]);
  closeWidget(el, lastShown);

  if (lastLabels.length > 0) {
    return {
      fieldId: spec.id,
      status: "refused",
      reason: `"${spoken}" matches more than one result. The search offers: ${sayableChoices(lastLabels)}. Ask which one.`,
      choices: lastLabels,
    };
  }
  return { fieldId: spec.id, status: "rejected-by-page", wrote: spoken, found: `no result for "${spoken}"` };
}

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

/**
 * Leave the field the way a person does, so the form checks what was typed.
 *
 * Plenty of forms validate on blur — "invalid email", "enter a valid phone number" — and without
 * this the agent would move on with the error never having been raised.
 */
function leave(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  el.dispatchEvent(new FocusEvent("blur", { composed: true }));
}

async function writeOne(
  spec: FieldSpec,
  el: HTMLElement,
  spoken: SpokenValue,
): Promise<WriteOutcome> {
  const { id } = spec;

  if (spec.kind === "file") {
    return {
      fieldId: id,
      status: "refused",
      reason: "A file cannot be attached by voice. Longtake leaves this for the person.",
    };
  }

  // ── Dropdowns ────────────────────────────────────────────────────────────────────
  if (spec.kind === "select") {
    const wanted = String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);

    // A list that fills in as you type has nothing to match against until something is typed.
    // When it did show choices on opening and the search finds nothing, the refusal below still
    // names them — "Kolkata" typed into a Country search is still a city, not a country.
    if (spec.searchable) {
      const searched = await typeAndPick(spec, el, wanted);
      if (searched.status !== "rejected-by-page" || !spec.options?.length || searched.wrote !== wanted) return searched;
    }

    const want = matchOption(spec, wanted) ?? optionNamedIn(spec, spoken.evidence);

    // A component dropdown is worth opening even when we have no options for it. Some load
    // their choices only when asked, so the alternative is a field nobody can ever answer.
    if (!want && spec.custom && !spec.options?.length) {
      return pickFromWidget(spec, el, null, wanted);
    }

    if (!want) {
      const labels = realChoices(spec.options);
      return {
        fieldId: id,
        status: "refused",
        reason: labels.length
          ? `"${wanted}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.`
          : `"${wanted}" does not match anything this field offers, and its choices could not be read. Ask the person to fill this one in themselves.`,
        choices: labels,
      };
    }

    if (spec.custom) return pickFromWidget(spec, el, want, wanted);

    setNativeValue(el, want.value);
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === want.value
      ? { fieldId: id, status: "written", wrote: want.label }
      : { fieldId: id, status: "rejected-by-page", wrote: want.label, found };
  }

  // ── Choices: radio groups, and checkbox groups sharing a name ────────────────────
  if (spec.kind === "radio" || (spec.kind === "multiselect" && spec.options)) {
    const wanted = Array.isArray(spoken.value) ? spoken.value : [String(spoken.value)];
    let chosen = wanted
      .map((one) => matchOption(spec, one))
      .filter((v): v is { value: string; label: string } => v !== null);

    // A single choice can be recovered from the person's own words, as for a dropdown. Not a
    // group of checkboxes: which of several named things they meant to tick is not a fact the
    // words alone settle.
    if (chosen.length === 0 && spec.kind === "radio") {
      const named = optionNamedIn(spec, spoken.evidence);
      if (named) chosen = [named];
    }

    if (chosen.length === 0) {
      const labels = realChoices(spec.options);
      return {
        fieldId: id,
        status: "refused",
        reason: labels.length
          ? `"${wanted.join(", ")}" is not one of the choices. This field only accepts: ${sayableChoices(labels)}. Read those out to the person and ask which one fits.`
          : `"${wanted.join(", ")}" does not match anything this field offers. Ask the person to fill this one in themselves.`,
        choices: labels,
      };
    }

    // A native <select multiple>: each choice is selected on the element itself. It used to fall
    // into the checkbox-group path below, find no checkboxes, and report "written" with nothing
    // chosen — the agent told the person it was in; the page held nothing.
    if (el.tagName.toLowerCase() === "select" && (el as HTMLSelectElement).multiple) {
      const select = el as HTMLSelectElement;
      const wantedValues = new Set(chosen.map((c) => c.value));
      for (const option of Array.from(select.options)) option.selected = wantedValues.has(option.value);
      announce(select, ["input", "change"]);
      const now = Array.from(select.selectedOptions);
      const wrote = chosen.map((c) => c.label).join(", ");
      return now.length === wantedValues.size && now.every((option) => wantedValues.has(option.value))
        ? { fieldId: id, status: "written", wrote }
        : { fieldId: id, status: "rejected-by-page", wrote, found: now.map((option) => option.textContent?.trim() ?? "").join(", ") };
    }

    // A group built out of divs is pressed, not assigned.
    if (spec.custom && spec.kind === "multiselect") {
      // A tag picker: one pick per answer, each confirmed. Already-picked ones are skipped — most
      // pickers drop a chosen option from the menu, so looking for it again would fail.
      const already = readValue(spec, el);
      const onShow = new Set(Array.isArray(already) ? already.map(normalise) : []);
      const picked: string[] = [];
      for (const option of chosen) {
        if (onShow.has(normalise(option.label))) {
          picked.push(option.label);
          continue;
        }
        const outcome = await pickFromWidget(spec, el, option, option.label);
        if (outcome.status !== "written") return outcome;
        picked.push(option.label);
      }
      // A picker that stays open for the next pick is closed once the last is in. Left open, Luma's
      // list sat over the questions below it, and its search box was read as a question.
      closeWidget(el, optionNodes().filter((option) => ownsOptions(el, option) !== false));
      return { fieldId: id, status: "written", wrote: picked.join(", ") };
    }

    // An ARIA radio group — Google Forms builds every choice question this way. Its answers are
    // already on the page, so it is pressed like one, not opened like a dropdown: opening it found
    // no menu, and every choice question on a Google Form came back refused.
    if (spec.kind === "radio" && el.getAttribute("role") === "radiogroup") {
      const want = normalise(chosen[0]!.label);
      const target = deepQueryAll(el, "[role='radio']").find(
        (radio) =>
          normalise(radio.getAttribute("aria-label") ?? radio.textContent ?? "") === want ||
          radio.getAttribute("data-value") === chosen[0]!.value,
      ) as HTMLElement | undefined;
      if (!target) return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
      if (target.getAttribute("aria-checked") !== "true") target.click();
      return (await confirmed(() => target.getAttribute("aria-checked") === "true"))
        ? { fieldId: id, status: "written", wrote: chosen[0]!.label }
        : { fieldId: id, status: "rejected-by-page", wrote: chosen[0]!.label, found: "" };
    }

    if (spec.custom) return pickFromWidget(spec, el, chosen[0]!, wanted.join(", "));

    if (spec.kind === "radio") {
      const radios = radioGroup(el);
      const target = radios.find((radio) => choiceKey(radio, radios) === chosen[0]!.value);
      if (!target) {
        return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
      }
      pressChoice(target, true);
      return target.checked
        ? { fieldId: id, status: "written", wrote: chosen[0]!.label }
        : { fieldId: id, status: "rejected-by-page", wrote: chosen[0]!.label, found: "" };
    }

    const boxes = choiceGroup(el);

    // Each box by the key the reader gave its option — not its value: boxes without one all say "on".
    const wantedValues = chosen.map((c) => c.value);
    const wants = (box: HTMLInputElement) => wantedValues.includes(choiceKey(box, boxes));
    for (const box of boxes) {
      const shouldCheck = wants(box);
      if (box.checked !== shouldCheck) {
        pressChoice(box, shouldCheck);
      }
    }
    // Read back, as everywhere else: "written" is a claim about the page, not about our presses.
    const wrote = chosen.map((c) => c.label).join(", ");
    const off = boxes.filter((box) => box.checked !== wants(box));
    return off.length === 0 && boxes.length > 0
      ? { fieldId: id, status: "written", wrote }
      : { fieldId: id, status: "rejected-by-page", wrote, found: boxes.filter((box) => box.checked).map((box) => box.value).join(", ") };
  }

  // ── A lone checkbox, or a div wearing role="checkbox" / role="switch" ────────────
  if (spec.kind === "checkbox") {
    const yes = readAsYesOrNo(spoken.value);

    if (spec.custom) {
      const already = el.getAttribute("aria-checked") === "true";
      if (already !== yes) {
        openWidget(el); // the same press sequence; a switch answers pointerdown too
        await confirmed(() => (el.getAttribute("aria-checked") === "true") === yes);
      }
      const now = el.getAttribute("aria-checked") === "true";
      return now === yes
        ? { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" }
        : {
            fieldId: id,
            status: "rejected-by-page",
            wrote: yes ? "checked" : "unchecked",
            found: `aria-checked=${el.getAttribute("aria-checked")}`,
          };
    }

    const box = el as HTMLInputElement;
    pressChoice(box, yes);
    return box.checked === yes
      ? { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" }
      : { fieldId: id, status: "rejected-by-page", wrote: String(yes), found: String(box.checked) };
  }

  // ── A slider built from divs ────────────────────────────────────────────────────
  if (el.getAttribute("role") === "slider") return stepSlider(spec, el, spoken);

  // ── A div pretending to be a text box ───────────────────────────────────────────
  if (el.isContentEditable) {
    const text = String(spoken.value);
    el.textContent = text;
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === text
      ? { fieldId: id, status: "written", wrote: text }
      : { fieldId: id, status: "rejected-by-page", wrote: text, found };
  }

  // ── Everything else is text of some shape ───────────────────────────────────────
  let text = asFieldDate(String(spoken.value), spec, el);
  if (spec.maxLength && text.length > spec.maxLength) {
    text = text.slice(0, spec.maxLength);
  }

  setNativeValue(el, text);
  announce(el, ["input", "change"]);
  leave(el);

  const found = readBack(el);
  return found === text
    ? { fieldId: id, status: "written", wrote: text }
    : { fieldId: id, status: "rejected-by-page", wrote: text, found };
}

/**
 * Write the values that were actually spoken, and nothing else.
 *
 * Returns one outcome per value handed in — including the refusals and the rejections, which
 * are the interesting ones: they are what the agent asks about out loud.
 *
 * Sequential on purpose. Two dropdowns opening at once would fight over the same portal, and
 * the option-diffing that locates them would attribute one widget's choices to the other.
 */
export function writeValues(
  specs: FieldSpec[],
  handles: FieldHandles,
  values: SpokenValue[],
): Promise<WriteOutcome[]> {
  // One widget sequence at a time on the page — see `exclusively` in dom-path.ts.
  return exclusively(() => writeAll(specs, handles, values));
}

async function writeAll(
  specs: FieldSpec[],
  handles: FieldHandles,
  values: SpokenValue[],
): Promise<WriteOutcome[]> {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const outcomes: WriteOutcome[] = [];

  for (const spoken of values) {
    const spec = byId.get(spoken.fieldId);
    if (!spec) {
      outcomes.push({
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "No such field on this page. The page may have changed since it was read.",
      });
      continue;
    }

    // ── The rule. Do not soften it. ────────────────────────────────────────────────
    if (!spoken.evidence || spoken.evidence.trim() === "") {
      outcomes.push({
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "Nothing was spoken about this field, so it stays empty.",
      });
      continue;
    }

    if (spec.suspectedHoneypot) {
      outcomes.push({
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "This field looks like it is there to catch software, not to be answered.",
      });
      continue;
    }

    const el = handles.get(spoken.fieldId);
    if (!el || !el.isConnected) {
      outcomes.push({
        fieldId: spoken.fieldId,
        status: "refused",
        reason: "That field is no longer on the page.",
      });
      continue;
    }

    // ── Try, and if the page threw it away, try once more ──────────────────────────
    //
    // Never a silent failure. A value the page refused to keep used to come back as one more
    // row in a list nobody read, and the field simply stayed empty while the agent moved on to
    // the next question — which is the single worst thing this can do, because the person
    // believes the answer went in. So: one retry for the ordinary case (a controlled component
    // re-rendering over the top of the write), and if that fails too it is marked `retried` and
    // the agent is told to hand the field back to the person in plain words.
    let outcome = await writeOne(spec, el, spoken);

    if (outcome.status === "rejected-by-page") {
      await sleep(RETRY_AFTER_MS);
      // Re-checked rather than reused: the re-render that ate the first write may also have
      // replaced the node, and writing to a detached element fails silently forever.
      const fresh = handles.get(spoken.fieldId);
      const target = fresh && fresh.isConnected ? fresh : el.isConnected ? el : null;

      outcome = target
        ? await writeOne(spec, target, spoken)
        : { ...outcome, found: "the field left the page before it could be written" };

      if (outcome.status === "rejected-by-page") outcome = { ...outcome, retried: true };
    }

    outcomes.push(outcome);
  }

  return outcomes;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Clearing — taking an answer back out
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Live run: "Remove the gender." There was no way to remove anything — the agent could only fill —
// so it filled Gender with "Decline To Self Identify" and said "I've cleared the gender field."
// That is a false claim about an action, on the person's own form, the same kind of lie as "I
// have submitted your application". A person must be able to take an answer back, and when the
// form itself will not let an answer be removed, they must be told so, not handed a substitute.

export type ClearOutcome =
  | { fieldId: string; status: "cleared" }
  /** The page offers no way to empty this one. Said plainly; never replaced with another answer. */
  | { fieldId: string; status: "cannot-clear"; reason: string };

/** A control inside a custom dropdown that empties it — React-Select's ×, and its cousins. */
const CLEAR_CONTROL =
  "[aria-label*='clear' i], [title*='clear' i], [class*='clear-indicator'], [class*='clearIndicator'], [class*='ClearIndicator']";

function press(el: HTMLElement): void {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  }
}

async function clearOne(spec: FieldSpec, el: HTMLElement): Promise<ClearOutcome> {
  const id = spec.id;
  const cannot = (reason: string): ClearOutcome => ({ fieldId: id, status: "cannot-clear", reason });
  const tag = el.tagName.toLowerCase();

  if (spec.kind === "file") return cannot("A file upload cannot be cleared by voice.");

  // ── Radio: untick the group ───────────────────────────────────────────────────
  if (spec.kind === "radio" && tag === "input") {
    for (const radio of radioGroup(el)) {
      if (!radio.checked) continue;
      radio.checked = false;
      announce(radio, ["input", "change"]);
    }
    return radioGroup(el).some((radio) => radio.checked)
      ? cannot("The form put the choice back — it will not let this be left unanswered.")
      : { fieldId: id, status: "cleared" };
  }

  // ── Checkboxes: untick them the way a person does ─────────────────────────────
  if ((spec.kind === "multiselect" || spec.kind === "checkbox") && tag === "input") {
    const boxes = choiceGroup(el);
    for (const box of boxes) pressChoice(box, false);
    return boxes.some((box) => box.checked)
      ? cannot("The form would not let this be unticked.")
      : { fieldId: id, status: "cleared" };
  }

  if (spec.kind === "checkbox") {
    if (el.getAttribute("aria-checked") === "true") {
      openWidget(el);
      await confirmed(() => el.getAttribute("aria-checked") !== "true");
    }
    return el.getAttribute("aria-checked") === "true"
      ? cannot("The switch would not turn off.")
      : { fieldId: id, status: "cleared" };
  }

  // ── A <select multiple>: nothing selected is its empty state ─────────────────────
  if (tag === "select" && (el as HTMLSelectElement).multiple) {
    const select = el as HTMLSelectElement;
    for (const option of Array.from(select.options)) option.selected = false;
    announce(select, ["input", "change"]);
    return select.selectedOptions.length === 0 ? { fieldId: id, status: "cleared" } : cannot("The form put a choice back.");
  }

  // ── A real <select>: back to its empty option, if it has one ───────────────────
  if (tag === "select") {
    const select = el as HTMLSelectElement;
    const blank = Array.from(select.options).find((option) => option.value === "");
    if (!blank) return cannot("This dropdown has no empty choice, so one of its options has to stay picked.");
    setNativeValue(select, "");
    announce(select, ["input", "change"]);
    return select.value === "" ? { fieldId: id, status: "cleared" } : cannot("The form put the choice back.");
  }

  // ── A custom dropdown: use its own clear control, or Backspace, as a person would ─
  if (spec.custom) {
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
      ? { fieldId: id, status: "cleared" }
      : cannot("This dropdown has no way to empty it — once picked, the form keeps a choice.");
  }

  // ── Text of every shape ────────────────────────────────────────────────────────
  if (el.isContentEditable) {
    el.textContent = "";
    announce(el, ["input", "change"]);
    return readBack(el) === "" ? { fieldId: id, status: "cleared" } : cannot("The page put the text back.");
  }

  setNativeValue(el, "");
  announce(el, ["input", "change"]);
  return readBack(el) === "" ? { fieldId: id, status: "cleared" } : cannot("The page put the text back.");
}

/**
 * Empty the fields the person asked to have cleared.
 *
 * The rule that nothing is written without being said applies here too: the caller checks the
 * request against the transcript before this runs. Every result is confirmed against the page.
 */
export function clearValues(specs: FieldSpec[], handles: FieldHandles, ids: string[]): Promise<ClearOutcome[]> {
  return exclusively(async () => {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    const outcomes: ClearOutcome[] = [];
    for (const id of ids) {
      const spec = byId.get(id);
      const el = handles.get(id);
      if (!spec || !el || !el.isConnected) {
        outcomes.push({ fieldId: id, status: "cannot-clear", reason: "That field is not on the page." });
        continue;
      }
      outcomes.push(await clearOne(spec, el));
    }
    return outcomes;
  });
}
