/**
 * The shared vocabulary between the three files that matter.
 *
 *   reader.ts   someone else's DOM  →  FieldSpec[] + FieldHandles
 *   binder.ts   FieldSpec[]         →  a JSON-Schema tool the Voice Agent can call
 *   writer.ts   values + handles    →  live inputs, without the site noticing anything odd
 *
 * The split below is deliberate. `FieldSpec` is plain data and must stay JSON-serialisable,
 * because it is what gets turned into a tool schema and sent over a WebSocket. The live DOM
 * element cannot go there, so it lives beside it in `FieldHandles`, keyed by the same id.
 */

/** What kind of control this is, in terms the binder can turn into a JSON Schema type. */
export type FieldKind =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "checkbox"
  | "multiselect"
  | "file";

/** One choice on a select, radio group or checkbox group, as the site itself words it. */
export type FieldOption = {
  /** The value the form submits. */
  value: string;
  /** What the human sees. This is what the speaker will actually say out loud. */
  label: string;
};

/**
 * One field on a form we do not own and cannot change.
 *
 * Plain data only — no DOM references. See `FieldHandles` for the live elements.
 */
export type FieldSpec = {
  /**
   * Stable within one read of one page, and used as the JSON-Schema property name.
   *
   * A readable slug — `first_name`, `cover_letter` — not a CSS selector. The language model
   * reads these names when it decides what goes where, so `desired_salary` earns its keep and
   * `div > div:nth-of-type(3) > input` does not.
   */
  id: string;
  /**
   * The shortest CSS selector that matches this element and nothing else, or absent when no
   * unambiguous one exists. Used to find the field again after the page re-renders.
   *
   * Absent is a real answer, not a failure to try. An ambiguous selector would eventually
   * write one person's answer into a different person's field.
   */
  selector?: string;
  /** Best available human label: `<label for>`, aria-label, placeholder, or nearest text. */
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Present for select, radio, checkbox and multiselect. The real options, never invented. */
  options?: FieldOption[];
  maxLength?: number;
  /** The site's own `pattern` attribute, if it set one. */
  pattern?: string;
  placeholder?: string;
  /**
   * A long free-text answer — cover letter, "what excites you about…". These are the fields
   * that earn a Dictation pass of their own in Phase 3; short ones never do.
   */
  longForm?: boolean;
  /**
   * This control is a component, not a form element, so its value cannot be assigned.
   *
   * True for every dropdown that is not a real `<select>` — which, on a live Greenhouse page,
   * is all of them. Such a widget keeps its selection in component state and ignores the DOM
   * entirely: setting `.value` changes what the box *looks* like and submits nothing.
   * `writer.ts` has to open it and press an option instead, the way a person does.
   */
  custom?: boolean;
  /**
   * True when we believe the field exists to catch bots rather than to be answered.
   * AssemblyAI's own Greenhouse form carries one. Never write to these — not even when the
   * speaker appears to have answered it.
   */
  suspectedHoneypot?: boolean;
  /**
   * The heading this field sits under — "Alternate Designated Representative", "Emergency
   * contact" — when there is one.
   *
   * Real forms reuse labels. A live Jotform membership application has two fields whose only
   * accessible name is "First Name": one for the person applying and one for somebody else
   * entirely, told apart by nothing but the heading above them. Without this the model sees
   * two identical questions and has to guess which is theirs — and a wrong guess puts a
   * person's own name in the box meant for their stand-in.
   */
  section?: string;
  /**
   * A dropdown whose choices only appear once you type — a location or a college picker that asks a
   * server as you go. Opening it shows nothing to read, so it cannot be answered from a list: the
   * spoken answer is typed in, and one of the results has to match it clearly.
   */
  searchable?: boolean;
  /** A slider's range, as the page declares it. */
  range?: { min: number; max: number; step: number };
  /**
   * The piece of the answer this box takes, when one question is split across boxes — "Month" of
   * "What is your date of birth?". `label` is then the whole question. IRCC labels its three
   * date boxes "Year", "Month", "Day" for screen readers only; read alone, two of them had no
   * question at all, and with the question alone, three boxes would have had the same name.
   * Show a field to a person or the model through `fieldName`, which carries both.
   */
  part?: string;
};

/** What to call a field to a person or the model: its question, and the piece it takes, if any. */
export function fieldName(spec: Pick<FieldSpec, "id" | "label" | "part">): string {
  const question = (spec.label || spec.id).replace(/\s*\*\s*$/, "").trim();
  return spec.part ? `${question} — ${spec.part}` : question;
}

/** Live elements, keyed by `FieldSpec.id`. Never serialised, never leaves the page. */
export type FieldHandles = Map<string, HTMLElement>;

/** A field we found and deliberately left out of the spec list, and why. */
export type SkippedField = {
  label: string;
  reason: string;
};

/** What one read of a page produces. */
export type FormRead = {
  specs: FieldSpec[];
  handles: FieldHandles;
  /**
   * Fields found but kept out of `specs` — invisible ones, file uploads, password boxes.
   *
   * They are excluded rather than flagged because `specs` becomes the tool schema, and a field
   * that reaches the schema is a field a language model can decide to fill. A honeypot is
   * invisible by design, so the safest place for it is outside the schema entirely.
   * Kept here so the agent can still say "you will need to attach your CV yourself".
   */
  skipped: SkippedField[];
  /** Where this was read from, for the answer memory in Phase 7. */
  url: string;
  readAt: number;
};

/**
 * A value the speaker actually spoke to, ready to be written.
 *
 * `evidence` is not decoration. Rule 2 of the build: a field with no spoken evidence cannot be
 * written, and that has to be enforced by the type system and the code, not by the prompt.
 * Every value that reaches `writer.ts` must be able to point at the words that produced it.
 */
export type SpokenValue = {
  fieldId: string;
  value: string | string[] | boolean;
  /** The speaker's own words that this value came from. Required, deliberately. */
  evidence: string;
};
