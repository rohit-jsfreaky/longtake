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
 * been to, or worked somewhere they never worked. (`choices.ts` holds that matching.)
 *
 * ## Why writing is async, and why "written" is checked against the page
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
 *
 * How each kind of widget is written, read and cleared lives in `adapters/` — one adapter per
 * kind, tried in order. This file holds the rules that apply to all of them.
 */

import { adapterFor } from "./adapters";
import { sleep, type ClearOutcome, type FieldValue, type WriteOutcome } from "./adapters/kit";
import { exclusively } from "./dom-path";
import type { FieldHandles, FieldSpec, SpokenValue } from "./types";

export type { ClearOutcome, FieldValue, WriteOutcome } from "./adapters/kit";
export { matchOption, optionNamedIn, realChoices } from "./choices";
export { asFieldDate } from "./adapters/typing";

/**
 * How long to wait before trying a rejected write once more.
 *
 * A form that re-renders while we are writing — a validation pass, a controlled component
 * catching up — drops the first value and keeps the second. One retry converts most of those
 * into successes, and the ones it does not are then reported as genuinely failed rather than
 * silently left empty.
 */
const RETRY_AFTER_MS = 250;

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
 */
export function readValue(spec: FieldSpec, el: HTMLElement): FieldValue {
  return adapterFor(spec, el).read(spec, el);
}

/** Does this field have an answer in it right now? Read off the page — see `readValue`. */
export function isFilled(spec: FieldSpec, el: HTMLElement): boolean {
  return readValue(spec, el) !== null;
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
    let outcome = await adapterFor(spec, el).write(spec, el, spoken);

    if (outcome.status === "rejected-by-page") {
      await sleep(RETRY_AFTER_MS);
      // Re-checked rather than reused: the re-render that ate the first write may also have
      // replaced the node, and writing to a detached element fails silently forever.
      const fresh = handles.get(spoken.fieldId);
      const target = fresh && fresh.isConnected ? fresh : el.isConnected ? el : null;

      outcome = target
        ? await adapterFor(spec, target).write(spec, target, spoken)
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
      outcomes.push(await adapterFor(spec, el).clear(spec, el));
    }
    return outcomes;
  });
}
