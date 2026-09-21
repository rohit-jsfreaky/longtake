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

import { closeWidget, openWidget, optionNodes, pressOption } from "./dom-path";
import type { FieldHandles, FieldSpec, SpokenValue } from "./types";

export type WriteOutcome =
  | { fieldId: string; status: "written"; wrote: string }
  /** We chose not to write, and why. Always safe to show a person. */
  | { fieldId: string; status: "refused"; reason: string }
  /** We tried, and the page did not take it. Never reported as success. */
  | { fieldId: string; status: "rejected-by-page"; wrote: string; found: string };

/** How long to let a component draw its options before giving up on it. */
const WIDGET_OPEN_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function announce(el: HTMLElement, kinds: string[]): void {
  for (const kind of kinds) {
    el.dispatchEvent(new Event(kind, { bubbles: true }));
  }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words that mean no, in either of the two languages Longtake is built to hear. */
const MEANS_NO = /\b(no|not|false|never|decline|disagree|refuse|nahi|nahin)\b/i;
/** Words that mean yes. Only consulted once the negatives have had their say. */
const MEANS_YES = /\b(yes|true|agree|agreed|accept|confirm|ok|okay|sure|haan|han|ji|sahi)\b/i;

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
function matchAmong(candidates: string[], spoken: string): number | null {
  const want = normalise(spoken);
  if (!want) return null;

  const exact = candidates.findIndex((candidate) => normalise(candidate) === want);
  if (exact >= 0) return exact;

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
 * Which of the page's own options did the speaker mean?
 *
 * Returns `null` rather than a best guess. Every caller treats `null` as "leave it and ask".
 */
function matchOption(spec: FieldSpec, spoken: string): { value: string; label: string } | null {
  if (!spec.options || spec.options.length === 0) return null;

  // Labels and values are both offered, because a person says "India" and a form stores "in".
  const labels = spec.options.map((option) => option.label);
  const byLabel = matchAmong(labels, spoken);
  if (byLabel !== null) return spec.options[byLabel]!;

  const values = spec.options.map((option) => option.value);
  const byValue = matchAmong(values, spoken);
  return byValue !== null ? spec.options[byValue]! : null;
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
  // Walk up until something has text, rather than guessing at a container by class name.
  //
  // A class-based `closest()` looks tidier and gets this wrong. React-Select nests
  // `select__input` inside `select__input-container` inside `select__value-container`, and only
  // the outermost of those three holds the chosen label — so `closest("[class*='select']")`
  // lands on the empty middle one and reports every successful selection as a failure.
  let node: HTMLElement | null = el.parentElement;
  for (let hops = 0; node && hops < 5; hops++) {
    const text = (node.innerText ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
    node = node.parentElement;
  }
  return "";
}

/** Every radio sharing this one's name, wherever in the document they live. */
function radioGroup(el: HTMLElement): HTMLInputElement[] {
  const name = el.getAttribute("name");
  const root = el.getRootNode() as Document | ShadowRoot;
  // Tag name, not `instanceof` — see `readBack` for why an iframe breaks the latter.
  if (!name) return el.tagName.toLowerCase() === "input" ? [el as HTMLInputElement] : [];
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
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
  if (candidates.length === 0) candidates = optionNodes();

  const labels = candidates.map((option) => (option.innerText ?? "").trim());
  const index = want ? matchAmong(labels, want.label) : matchAmong(labels, spoken);
  const target = index !== null ? candidates[index] : undefined;
  const chosen = index !== null ? labels[index]! : (want?.label ?? spoken);

  if (!target) {
    closeWidget(el);
    if (candidates.length === 0) {
      return {
        fieldId: spec.id,
        status: "rejected-by-page",
        wrote: chosen,
        found: "the dropdown did not open",
      };
    }
    // The widget opened and simply does not offer this. That is a question for the person, not
    // a page failure, so it is a refusal — the agent will ask rather than apologise.
    return {
      fieldId: spec.id,
      status: "refused",
      reason: `"${spoken}" does not clearly match any of the choices this dropdown offers. Asking instead of guessing.`,
    };
  }

  pressOption(target);
  await sleep(200);

  // Confirmed against what the page now shows — never against the value we set ourselves.
  const showing = renderedText(el);
  const took = normalise(showing).includes(normalise(chosen)) && showing !== wasShowing;

  if (!took) {
    closeWidget(el);
    return { fieldId: spec.id, status: "rejected-by-page", wrote: chosen, found: showing };
  }

  return { fieldId: spec.id, status: "written", wrote: chosen };
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
    const want = matchOption(spec, wanted);

    // A component dropdown is worth opening even when we have no options for it. Some load
    // their choices only when asked, so the alternative is a field nobody can ever answer.
    if (!want && spec.custom && !spec.options?.length) {
      return pickFromWidget(spec, el, null, wanted);
    }

    if (!want) {
      return {
        fieldId: id,
        status: "refused",
        reason: `"${wanted}" does not clearly match any option on the page. Asking instead of guessing.`,
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
    const chosen = wanted
      .map((one) => matchOption(spec, one))
      .filter((v): v is { value: string; label: string } => v !== null);

    if (chosen.length === 0) {
      return {
        fieldId: id,
        status: "refused",
        reason: `"${wanted.join(", ")}" does not clearly match any option on the page. Asking instead of guessing.`,
      };
    }

    // A group built out of divs is pressed, not assigned.
    if (spec.custom) return pickFromWidget(spec, el, chosen[0]!, wanted.join(", "));

    if (spec.kind === "radio") {
      const target = radioGroup(el).find((radio) => radio.value === chosen[0]!.value);
      if (!target) {
        return { fieldId: id, status: "refused", reason: "That option is no longer on the page." };
      }
      target.checked = true;
      announce(target, ["input", "change"]);
      return target.checked
        ? { fieldId: id, status: "written", wrote: chosen[0]!.label }
        : { fieldId: id, status: "rejected-by-page", wrote: chosen[0]!.label, found: "" };
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

    const wantedValues = chosen.map((c) => c.value);
    for (const box of boxes) {
      const shouldCheck = wantedValues.includes(box.value);
      if (box.checked !== shouldCheck) {
        box.checked = shouldCheck;
        announce(box, ["input", "change"]);
      }
    }
    return { fieldId: id, status: "written", wrote: chosen.map((c) => c.label).join(", ") };
  }

  // ── A lone checkbox, or a div wearing role="checkbox" / role="switch" ────────────
  if (spec.kind === "checkbox") {
    const yes = readAsYesOrNo(spoken.value);

    if (spec.custom) {
      const already = el.getAttribute("aria-checked") === "true";
      if (already !== yes) {
        openWidget(el); // the same press sequence; a switch answers pointerdown too
        await sleep(120);
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
    box.checked = yes;
    announce(box, ["input", "change"]);
    return box.checked === yes
      ? { fieldId: id, status: "written", wrote: yes ? "checked" : "unchecked" }
      : { fieldId: id, status: "rejected-by-page", wrote: String(yes), found: String(box.checked) };
  }

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
 * Returns one outcome per value handed in — including the refusals and the rejections, which
 * are the interesting ones: they are what the agent asks about out loud.
 *
 * Sequential on purpose. Two dropdowns opening at once would fight over the same portal, and
 * the option-diffing that locates them would attribute one widget's choices to the other.
 */
export async function writeValues(
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

    outcomes.push(await writeOne(spec, el, spoken));
  }

  return outcomes;
}
