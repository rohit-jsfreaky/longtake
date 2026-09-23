/**
 * The form as it is right now — the one thing everything else reads.
 *
 * ## Why
 *
 * Before this, "what is filled" was computed in five places — the counter, the opening line, the
 * still-empty list, the tool result, the memory note — each from its own bookkeeping. They drifted:
 * a form with eleven boxes full read "6 / 14", and the agent asked where someone was based with
 * India sitting in the Country box. A patch per mismatch cannot converge; one source can.
 *
 * So: **the page is the truth for values** (`readValue`, every field kind), **the ledger is the
 * truth for everything the page cannot say** (where a value came from, the words behind it, what
 * the person asked to leave empty, what is waiting for their yes). This joins the two. Every
 * number on screen and every word the agent is told comes from one `snapshot`.
 */

import type { ActionsRead, FormAction } from "./actions";
import { readError } from "./errors";
import type { Ledger, Pending } from "./ledger";
import type { FieldSpec, FormRead } from "./types";
import { readValue, type FieldValue } from "./writer";

/**
 * Where a value came from.
 *
 * `spoken` and `memory` are ours, and the value on the page still matches what we wrote. `typed`
 * is the person's own hand — including a value of ours they since changed. `page` was already there
 * when the session opened: autofill, or the site's own default.
 */
export type Source = "spoken" | "memory" | "typed" | "page" | "empty";

export type FieldState = {
  spec: FieldSpec;
  value: FieldValue;
  source: Source;
  /** The person's words behind it, when it came from them. */
  evidence?: string;
  /** They asked for this one to stay empty. */
  declined: boolean;
  /** They asked to come back to this one at the end. */
  later?: boolean;
  /** An answer waiting for their yes. */
  pending?: Pending;
  /** What the form itself says is wrong with this field, word for word. */
  error?: string;
};

export type FormState = {
  title: string;
  fields: FieldState[];
  /** Things on the page only the person can do: file uploads, signatures. */
  theirs: string[];
  /** Buttons Longtake may press when asked — "Add another", "Next". Never a submit button. */
  actions: FormAction[];
  /** The form's own submit button, by its words. Theirs to press, always. */
  submitLabel?: string;
  progress: {
    filled: number;
    total: number;
    requiredLeft: number;
    optionalLeft: number;
  };
};

/** Two values are the same answer if they read the same once case, spacing and punctuation go. */
function sameAnswer(written: unknown, onPage: FieldValue): boolean {
  if (onPage === null) return false;
  const flat = (v: unknown) =>
    (Array.isArray(v) ? v.join(" ") : String(v)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (typeof onPage === "boolean") return onPage === Boolean(written);
  const a = flat(written);
  const b = flat(onPage);
  // A page may trim what we wrote (maxlength) or format it (a phone mask): the same answer. Or
  // show only part of a choice — a phone country picker holding "India +91" shows "+91".
  return a === b || (a.length > 0 && (b.startsWith(a) || a.startsWith(b) || (b.length >= 2 && a.endsWith(b))));
}

/** Is this field empty and still worth asking about? */
export function isOpen(field: FieldState): boolean {
  return field.value === null && !field.declined;
}

export function snapshot(read: FormRead, ledger: Ledger, title = "", buttons?: ActionsRead): FormState {
  const fields: FieldState[] = [];

  for (const spec of read.specs) {
    if (spec.suspectedHoneypot || spec.kind === "file") continue;
    const el = read.handles.get(spec.id);
    const value = el && el.isConnected ? readValue(spec, el) : null;
    const entry = ledger.entry(spec.id);

    let source: Source;
    if (value === null) source = "empty";
    else if (entry && sameAnswer(entry.value, value)) source = entry.source;
    else if (!entry && ledger.wasThereAtOpen(spec.id)) source = "page";
    else source = "typed";

    const state: FieldState = { spec, value, source, declined: ledger.isDeclined(spec.id) };
    if (ledger.isSetAside(spec.id)) state.later = true;
    if ((source === "spoken" || source === "memory") && entry) state.evidence = entry.evidence;
    const pending = ledger.pendingFor(spec.id);
    if (pending && value === null) state.pending = pending;
    const error = el && el.isConnected ? readError(el) : null;
    if (error) state.error = error;
    fields.push(state);
  }

  const theirs = read.skipped
    .filter((skipped) => /file|upload/i.test(skipped.reason))
    .map((skipped) => skipped.label)
    .filter(Boolean);

  return {
    title,
    fields,
    theirs,
    actions: buttons?.actions ?? [],
    ...(buttons?.submitLabel ? { submitLabel: buttons.submitLabel } : {}),
    progress: {
      filled: fields.filter((f) => f.value !== null).length,
      total: fields.length,
      requiredLeft: fields.filter((f) => f.spec.required && isOpen(f)).length,
      optionalLeft: fields.filter((f) => !f.spec.required && isOpen(f)).length,
    },
  };
}
