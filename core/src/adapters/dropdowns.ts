/**
 * Every kind of list a person picks from: a real `<select>`, a `<select multiple>`, a component
 * dropdown that has to be opened and pressed, one that searches as you type, and a tag picker
 * that takes several answers. See `writer.ts` for why a component is never simply assigned.
 */

import { closeWidget, openWidget, optionNodes, ownsOptions, pressOption } from "../dom-path";
import { matchAmong, matchOption, normalise, optionNamedIn, sayableChoices, showsChoice, type Choice } from "../choices";
import type { FieldSpec, SpokenValue } from "../types";
import type { WidgetAdapter } from "./index";
import {
  announce,
  clearShown,
  clearText,
  cannot,
  notAChoice,
  readBack,
  readShown,
  readText,
  renderedText,
  setNativeValue,
  sleep,
  WIDGET_OPEN_MS,
  type ClearOutcome,
  type FieldValue,
  type WriteOutcome,
} from "./kit";
import { chosenFrom } from "./choosing";

/**
 * Operate a dropdown that is not a `<select>`: open it, find the option, press it.
 *
 * The options are found by diffing against what was already on screen, because they usually
 * arrive through a **React portal** — rendered at the end of `<body>`, structurally nowhere near
 * the field they belong to. Looking inside the trigger's container finds nothing.
 */
export async function pickFromWidget(
  spec: FieldSpec,
  el: HTMLElement,
  /**
   * The option we already know we want, when the choices were read in advance — or `null`, when
   * they were not, in which case the spoken words are matched against whatever the widget shows
   * once it opens. The second case covers dropdowns that load their choices on demand, and it is
   * the difference between such a field being fillable and being permanently unanswerable.
   */
  want: Choice | null,
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

// ── Lists that fill as you type ────────────────────────────────────────────────────────

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

// ── The adapters ────────────────────────────────────────────────────────────────────────

/** The one answer a single-choice list is given — the value as said, before any matching. */
const said = (spoken: SpokenValue) => String(Array.isArray(spoken.value) ? spoken.value[0] : spoken.value);

/** A dropdown's option: the value as said, or else the one option their own words name. */
const wantOf = (spec: FieldSpec, spoken: SpokenValue) => matchOption(spec, said(spoken)) ?? optionNamedIn(spec, spoken.evidence);

/** How every single-choice list reads and empties: a real `<select>` by its value, a component by what it shows. */
function readDropdown(spec: FieldSpec, el: HTMLElement): FieldValue {
  if (el.tagName.toLowerCase() === "select") {
    const select = el as HTMLSelectElement;
    if (!select.value) return null;
    return (select.selectedOptions[0]?.textContent ?? "").trim() || select.value;
  }
  return spec.custom ? readShown(spec, el) : readText(el);
}

async function clearDropdown(spec: FieldSpec, el: HTMLElement): Promise<ClearOutcome> {
  if (el.tagName.toLowerCase() === "select") {
    const select = el as HTMLSelectElement;
    const blank = Array.from(select.options).find((option) => option.value === "");
    if (!blank) return cannot(spec, "This dropdown has no empty choice, so one of its options has to stay picked.");
    setNativeValue(select, "");
    announce(select, ["input", "change"]);
    return select.value === "" ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The form put the choice back.");
  }
  return spec.custom ? clearShown(spec, el) : clearText(spec, el);
}

/** A real `<select>`: assigned, and read back. */
export const nativeSelect: WidgetAdapter = {
  name: "native-select",
  matches: (spec) => spec.kind === "select" && !spec.custom && !spec.searchable,
  async write(spec, el, spoken) {
    const want = wantOf(spec, spoken);
    if (!want) return notAChoice(spec, said(spoken), ", and its choices could not be read. Ask the person to fill this one in themselves.");
    setNativeValue(el, want.value);
    announce(el, ["input", "change"]);
    const found = readBack(el);
    return found === want.value
      ? { fieldId: spec.id, status: "written", wrote: want.label }
      : { fieldId: spec.id, status: "rejected-by-page", wrote: want.label, found };
  },
  read: readDropdown,
  clear: clearDropdown,
};

/** A component dropdown: opened, and the option pressed — even with no options known in advance. */
export const customDropdown: WidgetAdapter = {
  name: "custom-dropdown",
  matches: (spec) => spec.kind === "select" && Boolean(spec.custom) && !spec.searchable,
  async write(spec, el, spoken) {
    const want = wantOf(spec, spoken);
    // Worth opening even when we have no options for it. Some load their choices only when
    // asked, so the alternative is a field nobody can ever answer.
    if (!want && !spec.options?.length) return pickFromWidget(spec, el, null, said(spoken));
    if (!want) return notAChoice(spec, said(spoken), ", and its choices could not be read. Ask the person to fill this one in themselves.");
    return pickFromWidget(spec, el, want, said(spoken));
  },
  read: readDropdown,
  clear: clearDropdown,
};

/**
 * A list that fills in as you type: the answer is typed and a result picked. When it did show
 * choices on opening and the search finds nothing, the list is tried as any other — and a refusal
 * still names its choices: "Kolkata" typed into a Country search is still a city, not a country.
 */
export const searchableCombobox: WidgetAdapter = {
  name: "searchable-combobox",
  matches: (spec) => spec.kind === "select" && Boolean(spec.searchable),
  async write(spec, el, spoken) {
    const searched = await typeAndPick(spec, el, said(spoken));
    if (searched.status !== "rejected-by-page" || !spec.options?.length || searched.wrote !== said(spoken)) return searched;
    return (spec.custom ? customDropdown : nativeSelect).write(spec, el, spoken);
  },
  read: readDropdown,
  clear: clearDropdown,
};

/**
 * A native `<select multiple>`: each choice is selected on the element itself. It used to fall
 * into the checkbox-group path, find no checkboxes, and report "written" with nothing chosen —
 * the agent told the person it was in; the page held nothing.
 */
export const nativeSelectMultiple: WidgetAdapter = {
  name: "native-select-multiple",
  matches: (spec, el) => spec.kind === "multiselect" && Boolean(spec.options) && el.tagName.toLowerCase() === "select" && (el as HTMLSelectElement).multiple,
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    const select = el as HTMLSelectElement;
    const wantedValues = new Set(decided.chosen.map((c) => c.value));
    for (const option of Array.from(select.options)) option.selected = wantedValues.has(option.value);
    announce(select, ["input", "change"]);
    const now = Array.from(select.selectedOptions);
    const wrote = decided.chosen.map((c) => c.label).join(", ");
    return now.length === wantedValues.size && now.every((option) => wantedValues.has(option.value))
      ? { fieldId: spec.id, status: "written", wrote }
      : { fieldId: spec.id, status: "rejected-by-page", wrote, found: now.map((option) => option.textContent?.trim() ?? "").join(", ") };
  },
  read(_spec, el) {
    const picked = Array.from((el as HTMLSelectElement).selectedOptions).map((option) => option.textContent?.trim() || option.value);
    return picked.length > 0 ? picked : null;
  },
  async clear(spec, el) {
    const select = el as HTMLSelectElement;
    for (const option of Array.from(select.options)) option.selected = false;
    announce(select, ["input", "change"]);
    return select.selectedOptions.length === 0 ? { fieldId: spec.id, status: "cleared" } : cannot(spec, "The form put a choice back.");
  },
};

/**
 * A tag picker — several answers in one component box: one pick per answer, each confirmed.
 * Read the way any component is read, by the picks it shows. (It was read as a checkbox group,
 * found no boxes, and every Greenhouse multi-select read back empty after a good write.)
 */
export const tagPicker: WidgetAdapter = {
  name: "tag-picker",
  matches: (spec) => spec.kind === "multiselect" && Boolean(spec.options) && Boolean(spec.custom),
  async write(spec, el, spoken) {
    const decided = chosenFrom(spec, spoken);
    if ("status" in decided) return decided;
    // Already-picked ones are skipped — most pickers drop a chosen option from the menu, so
    // looking for it again would fail.
    const already = readShown(spec, el);
    const onShow = new Set(Array.isArray(already) ? already.map(normalise) : []);
    const picked: string[] = [];
    for (const option of decided.chosen) {
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
    return { fieldId: spec.id, status: "written", wrote: picked.join(", ") };
  },
  read: readShown,
  clear: clearShown,
};
