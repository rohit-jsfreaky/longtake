/**
 * The shape of the corpus on disk — shared by the capture tools and the scoring specs.
 *
 * One directory per form, in the private `longtake-corpus` repo (cloned as `corpus/`):
 *
 *   meta.json         what the form is and when it was captured
 *   har/              the page and its own JavaScript, replayed offline by Playwright:
 *                     capture.har plus one file per response body, sessions stripped
 *   page.mhtml        a static snapshot, for reading when the replay breaks
 *   ax.json           Chrome's accessibility tree at capture, with a DOM path per control
 *   truth.json        the verified answer key: what each field really is
 *   fill.json         what we try on it, and what must happen — verified separately
 *   conversation.json a whole conversation on it, through the real conductor — verified separately
 *   shots/page.png    full-page screenshot, for the human review
 */

import type { FieldKind } from "../../core/src/types";
import type { Step as TalkStep } from "../replay/run-script";

/** The recording: a HAR plus one file per response body beside it, so the JSON can be cleaned. */
export const HAR = "har/capture.har";

/**
 * Only network requests come from the HAR. Google Docs loads its fonts from `filesystem:` URLs —
 * routing those too leaves them pending forever, and the page never finishes loading.
 */
export const REPLAYED = /^https?:/;

export type Category =
  | "job"
  | "survey"
  | "government"
  | "insurance"
  | "education"
  | "healthcare"
  | "membership"
  | "legal"
  | "signup"
  | "checkout"
  | "other";

/** One thing a person does before the fields in question exist. */
export type Step = { click: { role: string; name: string } };

export type Meta = {
  id: string;
  url: string;
  /** Done after load, before reading: the answers that reveal a conditional form's fields. */
  before?: Step[];
  category: Category;
  platform: string;
  /** The browser the capture ran in — some sites turn one away and not another. */
  capturedWith?: string;
  capturedAt: string;
  reachableWithoutLogin: boolean;
  /** False when offline replay does not reproduce the page — reading is scored off the MHTML only. */
  fillable: boolean;
  notes?: string;
};

/** Where an element is: a CSS path per iframe hop, then per shadow-root hop. */
export type Locator = {
  frames: string[];
  path: string[];
  /** The same element by structure alone — for ids a framework makes afresh on every load. */
  plain?: { frames: string[]; path: string[] };
};

/** One interactive node of Chrome's accessibility tree, joined to the DOM it came from. */
export type AxControl = {
  role: string;
  name: string;
  /** Which rule Chrome named it by: aria-labelledby, label, placeholder, title, contents, … */
  nameSource?: string;
  description?: string;
  required: boolean;
  invalid?: boolean;
  expanded?: boolean;
  checked?: string;
  value?: string;
  /** For comboboxes and listboxes: the options seen when it was opened at capture. */
  options?: string[];
  locator: Locator;
  dom: { tag: string; type?: string; id?: string; name?: string; multiple?: boolean; visible: boolean };
  /** For radios and checkboxes: the group they answer together, and that group's question. */
  group?: { key: string; label: string };
  /**
   * False for a control Chrome's accessibility tree leaves out — hidden from everyone: a honeypot,
   * or a branch of a conditional form not taken. Named from its source, not by Chrome.
   */
  inAxTree?: false;
  /** Where it sits on the full-page screenshot, for the human review. */
  box?: { x: number; y: number; w: number; h: number };
};

export type AxCapture = { url: string; title: string; controls: AxControl[]; buttons: { name: string; locator: Locator }[] };

export type Subject = "self" | "other_person" | "organization" | "none";
export type Scope = "remember" | "this_form" | "sensitive" | "never";

export type TruthField = {
  /** Stable key within this form ("f07"). Scripts and fill plans use this, never our spec ids. */
  key: string;
  locator: Locator;
  /** The question a person reads, verified by a human. */
  question: string;
  axName: string;
  axRole: string;
  axNameSource?: string;
  kind: FieldKind;
  required: boolean;
  options?: { labels: string[]; complete: boolean; searchable: boolean; multi: boolean };
  section?: string;
  /** Ontology id (core/src/concepts.ts), or "other". Empty until the meaning pass. */
  concept: string;
  subject: Subject;
  role?: string;
  scope: Scope;
  part?: string;
  entry?: { set: string; index: number };
  longForm: boolean;
  honeypot: boolean;
};

/**
 * One answer, as the agent's `fill_fields` call would carry it, and what must happen to it.
 * Cases run in order on one page — like a person answering — so a conditional field can follow
 * the choice that reveals it.
 */
export type FillCase = {
  /** Truth key ("f07"). */
  field: string;
  value: string | string[] | boolean;
  /** Their words. Passed as everything they said, so the quote check sees it. */
  evidence: string;
  expect: {
    /** `held`: waiting for their yes (an answer the page does not offer, a hedge). */
    outcome: "written" | "refused" | "held";
    /** What the page must show afterwards, when not simply the value. */
    shows?: string;
    /** A framework's own hidden state, where a widget keeps it: the input and the value it must hold. */
    hidden?: { css: string; value: string };
    /** Other truth keys this answer rightly changes — a phone's country-code picker. */
    also?: string[];
  };
};

export type FillPlan = { cases: FillCase[]; verified: { by: string; at: string } | null };

/**
 * A whole conversation on one form: what the person said, what the agent called, what must come
 * back. Fields are `$f07` — truth keys, mapped to whatever ids the reader of the day gives them.
 * `also`: truth keys an answer rightly changes too (a phone's country-code picker).
 */
export type Conversation = { name: string; steps: TalkStep[]; also?: string[]; verified: { by: string; at: string } | null };

export type TruthPage = {
  page: number;
  fields: TruthField[];
  actions: { label: string; kind: "next" | "add-another" }[];
  submit?: string;
};

export type Truth = {
  id: string;
  pages: TruthPage[];
  pageContext?: { mustContain: string[] };
  verified: { by: string; at: string } | null;
};
