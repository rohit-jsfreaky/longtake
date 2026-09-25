/**
 * What each field of a form means — asked of a language model once per form, checked in code.
 *
 * The model reads a compact snapshot of the form (never a value anyone typed) and names, for each
 * field, a concept from `concepts.ts`, whose answer it is, and how long it may be kept. Language is
 * the model's job. Code's job is to hold it to the vocabulary and to rules it cannot argue with:
 * unknown fields are dropped, unknown concepts become "other", a scope may be narrowed but never
 * widened, a sensitive concept stays sensitive, and nobody else's answer is ever remembered.
 *
 * When the model cannot be reached — offline, rate-limited, too slow — `fallbackMeanings` reads
 * the few meanings the old memory keys can recognise, at low confidence, so nothing is prefilled on
 * the strength of a guess.
 */

import { LEGACY_KEY_TO_CONCEPT, conceptById, conceptList, type Scope, type Subject } from "./concepts";
import { canonicalKey } from "./memory";
import { fieldName, type FieldSpec } from "./types";

export type Confidence = "high" | "medium" | "low";

export type Meaning = {
  concept: string;
  subject: Subject;
  scope: Scope;
  /** The piece of a split answer this box takes, in the concept's terms ("country_code"). */
  part?: string;
  /** Which entry of a repeatable set: the second school is `{ set: "education", index: 1 }`. */
  entry?: { set: string; index: number };
  /** The question in a few words, for the person's profile: "notice period in weeks". */
  gist: string;
  confidence: Confidence;
  source: "model" | "fallback";
};

/** Spec id → meaning. A field with no entry has no meaning we trust. */
export type Meanings = Record<string, Meaning>;

// ── What the model is shown ───────────────────────────────────────────────────────────────

export type SnapshotField = {
  id: string;
  question: string;
  kind: string;
  required: boolean;
  section?: string;
  description?: string;
  placeholder?: string;
  /** The first few choices, enough to tell a country list from a yes/no. */
  options?: string[];
};

export type FormSnapshot = { host: string; title: string; fields: SnapshotField[] };

const FIRST_CHOICES = 12;

/** The form as the model sees it: questions and their shape — never a value anyone typed. */
export function snapshotOf(specs: FieldSpec[], page: { host: string; title: string }): FormSnapshot {
  return {
    host: page.host,
    title: page.title.slice(0, 120),
    fields: specs
      .filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file")
      .map((spec) => ({
        id: spec.id,
        question: fieldName(spec).slice(0, 240),
        kind: spec.kind,
        required: spec.required,
        ...(spec.section ? { section: spec.section.slice(0, 120) } : {}),
        ...(spec.description ? { description: spec.description.slice(0, 160) } : {}),
        ...(spec.placeholder ? { placeholder: spec.placeholder.slice(0, 60) } : {}),
        ...(spec.options?.length ? { options: spec.options.slice(0, FIRST_CHOICES).map((o) => o.label) } : {}),
      })),
  };
}

/**
 * Which form this is, by its structure: the host and a hash of its questions. Two visits to the
 * same form share a key, so its meanings are asked for once; a form that changed gets a new one.
 */
export async function structureKey(snapshot: FormSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot.fields));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${snapshot.host}#${hex.slice(0, 24)}`;
}

/**
 * The instructions, and the form. JSON only, because the model on this account rejects a response
 * format (RESEARCH.md §9b) — the gateway repairs the JSON, and `validateMeanings` checks it.
 */
export function understandPrompt(snapshot: FormSnapshot): { system: string; user: string } {
  const system = [
    "You read web forms and say what each field means. Answer with JSON only, no prose.",
    "",
    'Shape: {"fields":[{"id":"…","concept":"…","subject":"…","part":"…","gist":"…","confidence":"…"}]}',
    "- id: the field's id, exactly as given. One entry per field.",
    "- concept: one id from the list below, or \"other\" when none fits.",
    '- subject: "self" (the person filling the form), "other_person" (an emergency contact, a referee, a co-owner, a doctor), "organization" (a business the form is about), or "none" (not about anyone: a search box, a data filter).',
    "- part: only when the box takes a piece of a split answer (\"country_code\", \"day\"); otherwise leave it out.",
    "- gist: the question in at most eight words.",
    '- confidence: "high", "medium" or "low".',
    "Use the section and the description: a phone number under \"Emergency contact\" is contact.phone with subject other_person, and a street under \"Business Address\" is address.street with subject organization.",
    "Whose answer is it? Read the question itself: one that asks about another person — a co-owner, a referee, an emergency contact, a spouse, a doctor, \"that person\" — is other_person, even when it says \"you\".",
    "confidence is high only when the question and its section leave no doubt about both the concept and whose answer it is. A bare label that could be someone else's (\"Website\", \"Country\", \"Name\") with no section to say whose is medium.",
    "",
    "Concepts:",
    conceptList(),
  ].join("\n");
  const user = JSON.stringify(snapshot);
  return { system, user };
}

// ── What the model says, held to the rules ────────────────────────────────────────────────

const SUBJECTS: Subject[] = ["self", "other_person", "organization", "none"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/** How much may be kept: remember keeps, sensitive keeps if asked, this_form and never keep nothing. */
const KEEPS: Record<Scope, number> = { remember: 3, sensitive: 2, this_form: 1, never: 0 };

/** The narrower of two scopes. */
function narrower(a: Scope, b: Scope): Scope {
  return KEEPS[a] <= KEEPS[b] ? a : b;
}

const text = (value: unknown, cap: number) => (typeof value === "string" ? value.trim().slice(0, cap) : "");

/**
 * The model's answer, checked. Anything that does not fit is dropped or made safer, never trusted:
 *   - a field id the form does not have is dropped;
 *   - a concept not in the vocabulary becomes "other";
 *   - the scope is the concept's own, never the model's: which answers may be kept is a rule, not a
 *     reading of words — and a small model, asked, called every field "this_form" (RESEARCH.md §9d);
 *   - an organisation's own details (`organization.*`) are an organisation's, whatever it said;
 *   - someone else's or an organisation's answer is never kept for the person's next form;
 *   - a meaning with no stated confidence is low;
 *   - one person has one first name: a concept given as theirs to two boxes cannot be theirs both
 *     times, and code cannot tell which it is — so neither is trusted enough to fill unasked.
 */
export function validateMeanings(raw: unknown, specs: FieldSpec[]): Meanings {
  const ids = new Set(specs.map((spec) => spec.id));
  const list = (raw && typeof raw === "object" && Array.isArray((raw as { fields?: unknown }).fields) ? (raw as { fields: unknown[] }).fields : []) as Record<
    string,
    unknown
  >[];
  const meanings: Meanings = {};
  for (const item of list) {
    const id = text(item?.id, 120);
    if (!ids.has(id) || meanings[id]) continue;
    const concept = conceptById(text(item.concept, 80))?.id ?? "other";
    const defaults = conceptById(concept)!;
    const subject = concept.startsWith("organization.") ? "organization" : SUBJECTS.includes(item.subject as Subject) ? (item.subject as Subject) : "self";
    const scope = subject === "self" ? defaults.scope : narrower(defaults.scope, "this_form");
    const confidence = CONFIDENCES.includes(item.confidence as Confidence) ? (item.confidence as Confidence) : "low";
    const part = text(item.part, 40);
    const entry = item.entry as { set?: unknown; index?: unknown } | undefined;
    meanings[id] = {
      concept,
      subject,
      scope,
      ...(part ? { part } : {}),
      ...(entry && typeof entry.set === "string" && Number.isInteger(entry.index) ? { entry: { set: entry.set, index: entry.index as number } } : {}),
      gist: text(item.gist, 80),
      confidence,
      source: "model",
    };
  }

  // The same answer claimed as theirs twice — a patient's first name and their emergency contact's,
  // a business's street and their own. Two pieces of one answer (a date's day and month) and a
  // repeatable concept (a second school) are not the same answer twice.
  const partOf = new Map(specs.map((spec) => [spec.id, spec.part ?? ""]));
  const theirs = new Map<string, string[]>();
  for (const [id, meaning] of Object.entries(meanings)) {
    if (meaning.subject !== "self" || meaning.concept === "other" || conceptById(meaning.concept)?.repeatable) continue;
    const key = `${meaning.concept}|${partOf.get(id) || meaning.part || ""}`;
    theirs.set(key, [...(theirs.get(key) ?? []), id]);
  }
  for (const ids of theirs.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) if (meanings[id]!.confidence === "high") meanings[id]!.confidence = "medium";
  }
  return meanings;
}

/**
 * Meanings without the model: the few the old memory keys recognise, at low confidence. Low, so no
 * answer is prefilled on it — it only keeps the old behaviour alive while the model is away.
 */
export function fallbackMeanings(specs: FieldSpec[]): Meanings {
  const meanings: Meanings = {};
  for (const spec of specs) {
    if (spec.suspectedHoneypot || spec.kind === "file") continue;
    const key = canonicalKey(spec);
    const concept = (key && LEGACY_KEY_TO_CONCEPT[key]) || "other";
    const defaults = conceptById(concept)!;
    meanings[spec.id] = {
      concept,
      subject: "self",
      scope: defaults.scope,
      gist: fieldName(spec).slice(0, 80),
      confidence: "low",
      source: "fallback",
    };
  }
  return meanings;
}

