/**
 * What Longtake knows about the person — learned while they fill, kept on their device, and only
 * ever offered back to a form that asks the same thing of the same person.
 *
 * ## What changed from the first memory
 *
 * The first memory (`memory.ts`) kept 22 answers under regex keys, overwrote an answer silently
 * when a new form said something different, and forgot anything without a key. Two writers (a call
 * and the settings page) each saved the whole map, so the slower one undid the other's edit.
 *
 * Here:
 *   - an answer is kept under what the question MEANS (`concepts.ts`, named by the model and held
 *     to rules in `understand.ts`), and only when it is the person's own;
 *   - every answer keeps its history — the words it came from, on which form, and when;
 *   - a different answer to something already known changes nothing on its own: it becomes a
 *     question ("update it for next time?"), because a job form's address and a gift form's
 *     address are both "an address", and only the person knows which is theirs now;
 *   - nothing is written as a whole map. Every writer sends CHANGES, and the one owner of the
 *     profile applies them to what is stored at that moment (`profile-store.ts`).
 *
 * ## What is offered back, and how sure it has to be
 *
 * `recallFor` sorts every match into two: `sure` answers go straight in (it is their own words,
 * given to the same question, recently, on a meaning the model was certain of), and the rest are
 * held for a yes, each with the reason it could not simply go in.
 *
 * Pure. No storage, no DOM — the same file runs in the page, the extension's worker and Node.
 */

import { matchOption, normalise, optionNamedIn } from "./choices";
import { conceptById, LEGACY_KEY_TO_CONCEPT, RELATED_CONCEPTS } from "./concepts";
import { dialCodeIn, dialCodeOf, optionForDialCode, PHONE_CODE, PHONE_NUMBER, PHONE_WHOLE, withoutDialCode } from "./phones";
import type { Memory } from "./memory";
import type { FieldSpec } from "./types";
import type { Meaning, Meanings } from "./understand";

export type FactValue = string | string[] | boolean;

/** Where an answer came from. Only their own voice, or their own yes, is trusted to go in unasked. */
export type FactSource = "spoken" | "confirmed" | "typed" | "edited" | "migrated" | "imported";

/** One telling of an answer: the words, the form, the moment. */
export type Provenance = {
  value: FactValue;
  /** Their words, exactly as they said them. Empty only for an answer they typed or edited. */
  evidence: string;
  source: FactSource;
  host: string;
  url: string;
  /** How that form worded the question. */
  askedAs: string;
  formTitle: string;
  at: number;
  /** The call and the box it came from. A correction within one call replaces; it does not ask. */
  session?: string;
  field?: string;
};

export type Fact = {
  /** `factId(key)`: the concept, the piece of it, and which entry. */
  id: string;
  concept: string;
  /** The piece of a split answer this is: "day", "country_code". */
  part?: string;
  /** Which school, which job: 0 for the first. */
  entry?: number;
  /** The question in a few words, as the model put it. */
  gist: string;
  value: FactValue;
  /** Every telling, oldest first, capped. The last one is the one the value came from. */
  history: Provenance[];
  sensitive: boolean;
  createdAt: number;
  updatedAt: number;
  /** How many forms it has gone into. */
  useCount: number;
};

/** A long answer they gave, kept whole: "tell us about yourself". */
export type LongAnswer = {
  id: string;
  gist: string;
  question: string;
  text: string;
  /** Their own words behind it. */
  said: string[];
  host: string;
  at: number;
  uses: number;
};

export type ProfileSettings = {
  /** Keep sensitive answers (health, documents, equal-opportunity questions) without asking. Off. */
  rememberSensitive: boolean;
};

export type Profile = {
  version: 2;
  facts: Record<string, Fact>;
  answers: Record<string, LongAnswer>;
  settings: ProfileSettings;
};

export const PROFILE_VERSION = 2;

/** How many tellings of one answer are kept. */
const HISTORY = 12;

/** A slow-changing answer older than this is offered for a yes rather than put in. */
const VOLATILE_DAYS = 30;
const DAY_MS = 86_400_000;

export function emptyProfile(): Profile {
  return { version: 2, facts: {}, answers: {}, settings: { rememberSensitive: false } };
}

// ── Which fact a field is ─────────────────────────────────────────────────────────────

export type FactKey = { concept: string; part?: string; entry?: number };

export function factId(key: FactKey): string {
  return `${key.concept}${key.part ? `#${key.part}` : ""}${key.entry ? `@${key.entry}` : ""}`;
}

/** "Area Code" and "area_code" are the same piece. */
function asPart(text: string | undefined): string | undefined {
  const part = (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return part || undefined;
}

/**
 * Which fact each field would hold, for the person's own answers only.
 *
 * The piece comes from the model when it named one, else from the page's own sub-label. The entry
 * of a repeatable answer (a second school) comes from the model when it said, else from the
 * form's own order: the second "School" box on the page is the second school.
 */
export function factKeys(specs: FieldSpec[], meanings: Meanings): Map<string, FactKey> {
  const keys = new Map<string, FactKey>();
  const seen = new Map<string, number>();
  for (const spec of specs) {
    const meaning = meanings[spec.id];
    if (!meaning || meaning.subject !== "self" || meaning.concept === "other") continue;
    // A piece that only repeats the concept ("country_code" of contact.phone.country_code) is the
    // concept itself: the model says so often, and a fact must not split in two over it.
    const named = asPart(meaning.part) ?? asPart(spec.part);
    const part = named && !meaning.concept.endsWith(`.${named}`) ? named : undefined;
    const concept = conceptById(meaning.concept);
    let entry: number | undefined;
    if (concept?.repeatable) {
      const base = `${meaning.concept}#${part ?? ""}`;
      entry = meaning.entry?.index ?? seen.get(base) ?? 0;
      seen.set(base, entry + 1);
    }
    keys.set(spec.id, { concept: meaning.concept, ...(part ? { part } : {}), ...(entry ? { entry } : {}) });
  }
  return keys;
}

// ── Changes ───────────────────────────────────────────────────────────────────────────

export type ProfileChange =
  /** Something they said. New: kept. The same: counted. Different: a question, nothing changed. */
  | { type: "observe"; key: FactKey; gist: string; value: FactValue; from: Provenance; allowSensitive?: boolean }
  /** They said yes to the new answer, or edited it by hand. Creates it when `key` is given. */
  | { type: "replace"; id: string; value: FactValue; from: Provenance; key?: FactKey; gist?: string }
  /** Take back what one box of one call added — they cleared it in the same call. */
  | { type: "unobserve"; id: string; session: string; field: string }
  | { type: "used"; ids: string[] }
  | { type: "delete"; id: string }
  | { type: "deleteAll" }
  | { type: "saveAnswer"; answer: LongAnswer }
  | { type: "deleteAnswer"; id: string }
  | { type: "settings"; settings: Partial<ProfileSettings> }
  /** A profile from a file they chose. Newer answers win, one by one. */
  | { type: "import"; profile: Profile };

/** Something already known, told differently. Asked, never assumed. */
export type ProfileQuestion = {
  id: string;
  key: FactKey;
  gist: string;
  was: FactValue;
  now: FactValue;
  from: Provenance;
};

export type Applied = { profile: Profile; questions: ProfileQuestion[]; changed: boolean };

/** Two answers are the same if they read the same once case, spacing and punctuation go. */
export function sameValue(a: FactValue, b: FactValue): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  const flat = (v: string | string[]) =>
    (Array.isArray(v) ? [...v].map((x) => normalise(String(x))).sort() : [normalise(v)]).join("|");
  return flat(a) === flat(b);
}

function isEmpty(value: FactValue): boolean {
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

/** Which answers may be kept at all: the concept's own rule, never anything asked fresh each time. */
function keepable(concept: string): "yes" | "sensitive" | "no" {
  const known = conceptById(concept);
  if (!known || concept === "other") return "no";
  if (known.scope === "remember") return "yes";
  if (known.scope === "sensitive") return "sensitive";
  return "no";
}

function withTelling(fact: Fact, from: Provenance, value: FactValue, now: number): Fact {
  return {
    ...fact,
    value,
    history: [...fact.history, { ...from, value }].slice(-HISTORY),
    updatedAt: now,
  };
}

/**
 * Apply changes to a profile. Returns the new profile, and a question for every answer that was
 * told differently from what is known — the only way a known answer ever changes without the
 * person saying so is a correction they made within the same call, to the same box.
 */
export function applyChanges(profile: Profile, changes: ProfileChange[], now = Date.now()): Applied {
  let next: Profile = { ...profile, facts: { ...profile.facts }, answers: { ...profile.answers }, settings: { ...profile.settings } };
  const questions: ProfileQuestion[] = [];
  let changed = false;

  for (const change of changes) {
    switch (change.type) {
      case "observe": {
        const kept = keepable(change.key.concept);
        if (kept === "no" || isEmpty(change.value)) break;
        if (kept === "sensitive" && !next.settings.rememberSensitive && !change.allowSensitive) break;
        const trusted = change.from.source === "spoken" || change.from.source === "confirmed";
        if (trusted && !change.from.evidence.trim()) break;

        const id = factId(change.key);
        const known = next.facts[id];
        if (!known) {
          next.facts[id] = {
            id,
            ...change.key,
            gist: change.gist,
            value: change.value,
            history: [{ ...change.from, value: change.value }],
            sensitive: kept === "sensitive",
            createdAt: now,
            updatedAt: now,
            useCount: 1,
          };
          changed = true;
          break;
        }
        if (sameValue(known.value, change.value)) {
          next.facts[id] = { ...withTelling(known, change.from, known.value, now), useCount: known.useCount + 1 };
          changed = true;
          break;
        }
        const last = known.history[known.history.length - 1];
        const correction = !!change.from.session && last?.session === change.from.session && last.field === change.from.field;
        if (correction) {
          next.facts[id] = withTelling(known, change.from, change.value, now);
          changed = true;
          break;
        }
        questions.push({ id, key: change.key, gist: known.gist || change.gist, was: known.value, now: change.value, from: change.from });
        break;
      }
      case "replace": {
        const known = next.facts[change.id];
        if (known) {
          next.facts[change.id] = withTelling(known, change.from, change.value, now);
          changed = true;
        } else if (change.key && keepable(change.key.concept) !== "no") {
          next.facts[change.id] = {
            id: change.id,
            ...change.key,
            gist: change.gist ?? "",
            value: change.value,
            history: [{ ...change.from, value: change.value }],
            sensitive: keepable(change.key.concept) === "sensitive",
            createdAt: now,
            updatedAt: now,
            useCount: 1,
          };
          changed = true;
        }
        break;
      }
      case "unobserve": {
        const known = next.facts[change.id];
        if (!known) break;
        const history = known.history.filter((h) => !(h.session === change.session && h.field === change.field));
        if (history.length === known.history.length) break;
        if (history.length === 0) delete next.facts[change.id];
        else next.facts[change.id] = { ...known, history, value: history[history.length - 1]!.value, updatedAt: now };
        changed = true;
        break;
      }
      case "used":
        for (const id of change.ids) {
          const known = next.facts[id];
          if (known) next.facts[id] = { ...known, useCount: known.useCount + 1 };
        }
        changed = change.ids.length > 0 || changed;
        break;
      case "delete":
        if (next.facts[change.id]) {
          delete next.facts[change.id];
          changed = true;
        }
        break;
      case "deleteAll":
        next = { ...emptyProfile(), settings: next.settings };
        changed = true;
        break;
      case "saveAnswer":
        next.answers[change.answer.id] = change.answer;
        changed = true;
        break;
      case "deleteAnswer":
        if (next.answers[change.id]) {
          delete next.answers[change.id];
          changed = true;
        }
        break;
      case "settings":
        next.settings = { ...next.settings, ...change.settings };
        changed = true;
        break;
      case "import":
        for (const fact of Object.values(change.profile.facts)) {
          const known = next.facts[fact.id];
          if (!known || fact.updatedAt > known.updatedAt) next.facts[fact.id] = fact;
        }
        for (const answer of Object.values(change.profile.answers)) {
          const known = next.answers[answer.id];
          if (!known || answer.at > known.at) next.answers[answer.id] = answer;
        }
        changed = true;
        break;
    }
  }
  return { profile: next, questions, changed };
}

// ── Offering answers back ─────────────────────────────────────────────────────────────

/** Why an answer from last time waits for a yes instead of going in. */
export type RecallWhy =
  | "sensitive"
  | "typed_last_time"
  | "not_sure_same_question"
  | "from_a_while_ago"
  | "carried_over"
  | "closest_choice"
  | "put_together";

export type Recollection = {
  fieldId: string;
  factId: string;
  value: FactValue;
  /** The words it came from, carried onto this form with it. */
  evidence: string;
  /** Goes straight in. Otherwise it waits for their yes, for `why`. */
  sure: boolean;
  why?: RecallWhy;
};

const CHOICE_KINDS = new Set(["select", "radio", "multiselect", "checkbox"]);

/**
 * The telling behind the value as it is now: the latest one in their own voice, their yes, or their
 * own edit — or, failing that, the latest of any kind. Never an older telling of a different value.
 */
function bestTelling(fact: Fact): Provenance {
  const same = fact.history.filter((h) => sameValue(h.value, fact.value));
  const trusted = [...same].reverse().find((h) => h.source === "spoken" || h.source === "confirmed" || h.source === "edited");
  return trusted ?? same[same.length - 1] ?? fact.history[fact.history.length - 1]!;
}

function evidenceOf(fact: Fact): string {
  const telling = bestTelling(fact);
  if (telling.evidence.trim()) return telling.evidence;
  const where = telling.host ? ` on ${telling.host}` : "";
  return telling.source === "edited" ? `saved by you in Longtake: ${shownValue(fact.value)}` : `typed by you${where}: ${shownValue(fact.value)}`;
}

export function shownValue(value: FactValue): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Would this answer go into this field as its own option, named? A choice field takes a known
 * answer only when the words it came from name one of its options — the same test a spoken answer
 * passes (`gate.ts`). A near miss ("India" for "India (+91)") is offered, not written.
 */
function fitsChoices(spec: FieldSpec, value: FactValue, evidence: string): "fits" | "closest" | "no" {
  if (!CHOICE_KINDS.has(spec.kind) || !spec.options?.length) return "fits";
  if (typeof value === "boolean") return "fits";
  const wanted = Array.isArray(value) ? value : [value];
  let closest = false;
  for (const item of wanted) {
    const option = matchOption(spec, item);
    if (!option) return "no";
    const exact = normalise(option.label) === normalise(item) || optionNamedIn(spec, evidence)?.label === option.label;
    if (!exact) closest = true;
  }
  return closest ? "closest" : "fits";
}

/**
 * What this form can be offered from what is known, and how sure each offer is.
 *
 * `sure` needs all of: the model certain what the question means and that it is theirs; an answer
 * that may be remembered at all; given in their own voice or confirmed by them (or edited by them
 * in settings); not a fast-changing answer from weeks ago; and, for a choice, one of this form's
 * own options named. Everything else waits for a yes, with its reason.
 */
export function recallFor(specs: FieldSpec[], meanings: Meanings, profile: Profile, now = Date.now()): Recollection[] {
  const keys = factKeys(specs, meanings);
  const found: Recollection[] = [];

  for (const spec of specs) {
    if (spec.suspectedHoneypot || spec.kind === "file") continue;
    const meaning = meanings[spec.id];
    const key = keys.get(spec.id);
    if (!meaning || !key) continue;
    const concept = conceptById(meaning.concept);
    if (!concept || (concept.scope !== "remember" && concept.scope !== "sensitive")) continue;

    const answer = answerFor(key, spec, profile);
    if (!answer) continue;
    const { fact, value, evidence } = answer;
    let why = answer.why;

    const fit = fitsChoices(spec, value, evidence);
    if (fit === "no") continue;

    const telling = bestTelling(fact);
    if (!why) why = reasonToAsk(meaning, fact, telling, fit, now);
    found.push({
      fieldId: spec.id,
      factId: answer.id,
      value,
      evidence,
      sure: !why,
      ...(why ? { why } : {}),
    });
  }
  return found;
}

type Answer = { id: string; fact: Fact; value: FactValue; evidence: string; why?: RecallWhy };

/**
 * What is known for this fact — the fact itself, or failing that, what can be worked out from what
 * is known without guessing:
 *   - a phone's pieces from the whole number, and the whole from its pieces (digits, not words);
 *   - a full name from a first and a last, offered for a yes;
 *   - a close neighbour in the vocabulary (a city for "where are you based"), offered for a yes.
 */
function answerFor(key: FactKey, spec: FieldSpec, profile: Profile): Answer | null {
  const get = (concept: string) => profile.facts[factId({ concept })];
  const own = profile.facts[factId(key)];

  // A dialling-code picker is matched by its code, not its wording: one form says "India (+91)",
  // the next "+91 India". The code comes from the code they gave, or the whole number they gave.
  if (key.concept === PHONE_CODE && !key.part && !key.entry) {
    for (const fact of [own, get(PHONE_WHOLE)]) {
      const code = typeof fact?.value === "string" ? dialCodeIn(fact.value) : null;
      const option = code ? optionForDialCode(spec, code) : null;
      if (fact && option) return { id: fact.id, fact, value: option, evidence: evidenceOf(fact) };
    }
  }
  if (own) return { id: own.id, fact: own, value: own.value, evidence: evidenceOf(own) };
  if (key.part || key.entry) return null;

  if (key.concept === PHONE_NUMBER || key.concept === PHONE_CODE) {
    const whole = get(PHONE_WHOLE);
    if (!whole || typeof whole.value !== "string") return null;
    if (key.concept === PHONE_NUMBER) return { id: whole.id, fact: whole, value: withoutDialCode(whole.value), evidence: evidenceOf(whole) };
    const code = dialCodeOf(whole.value);
    const option = code ? optionForDialCode(spec, code) : null;
    return option ? { id: whole.id, fact: whole, value: option, evidence: evidenceOf(whole) } : null;
  }
  if (key.concept === PHONE_WHOLE) {
    const number = get(PHONE_NUMBER);
    if (!number || typeof number.value !== "string") return null;
    const code = get(PHONE_CODE);
    const dial = typeof code?.value === "string" ? dialCodeIn(code.value) : null;
    return {
      id: number.id,
      fact: number,
      value: dial ? `+${dial} ${number.value}` : number.value,
      evidence: code ? `${evidenceOf(code)} — ${evidenceOf(number)}` : evidenceOf(number),
      why: "put_together",
    };
  }
  if (key.concept === "identity.full_name") {
    // A full name from a first and a last, said separately: put together, never assumed.
    const first = get("identity.first_name");
    const last = get("identity.last_name");
    if (!first || !last || typeof first.value !== "string" || typeof last.value !== "string") return null;
    return { id: factId({ concept: "identity.full_name" }), fact: first, value: `${first.value} ${last.value}`, evidence: `${evidenceOf(first)} — ${evidenceOf(last)}`, why: "put_together" };
  }
  for (const near of RELATED_CONCEPTS[key.concept] ?? []) {
    const fact = get(near);
    if (fact) return { id: fact.id, fact, value: fact.value, evidence: evidenceOf(fact), why: "not_sure_same_question" };
  }
  return null;
}

function reasonToAsk(meaning: Meaning, fact: Fact, telling: Provenance, fit: "fits" | "closest", now: number): RecallWhy | undefined {
  if (fact.sensitive || meaning.scope === "sensitive") return "sensitive";
  if (meaning.source !== "model" || meaning.confidence !== "high") return "not_sure_same_question";
  if (telling.source === "typed") return "typed_last_time";
  if (telling.source === "migrated" || telling.source === "imported") return "carried_over";
  const concept = conceptById(fact.concept);
  if (concept?.volatility === "volatile" && now - fact.updatedAt > VOLATILE_DAYS * DAY_MS) return "from_a_while_ago";
  if (fit === "closest") return "closest_choice";
  return undefined;
}

/** Why it is waiting, in words the agent can use. */
export const RECALL_WHY_WORDS: Record<RecallWhy, string> = {
  sensitive: "a personal detail, so it's checked every time",
  typed_last_time: "they typed it last time rather than said it",
  not_sure_same_question: "this question may not be quite the same one",
  from_a_while_ago: "it was a while ago and may have changed",
  carried_over: "saved by an older version of Longtake",
  closest_choice: "the closest of this form's choices",
  put_together: "put together from their first and last name",
};

// ── Moving the first memory over ──────────────────────────────────────────────────────

/**
 * The 22-key memory as changes to a new profile. Only answers the rules allow to be kept come
 * over: an expected salary was "remembered" before, and is now asked fresh on every form.
 */
export function migrateV1(memory: Memory): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const answer of Object.values(memory)) {
    const concept = LEGACY_KEY_TO_CONCEPT[answer.key];
    if (!concept) continue;
    let host = "";
    try {
      host = new URL(answer.sourceUrl).host;
    } catch {
      // no page recorded
    }
    changes.push({
      type: "observe",
      key: { concept },
      gist: answer.askedAs,
      value: answer.value,
      allowSensitive: true,
      from: {
        value: answer.value,
        evidence: answer.evidence,
        source: "migrated",
        host,
        url: answer.sourceUrl,
        askedAs: answer.askedAs,
        formTitle: "",
        at: answer.savedAt,
      },
    });
  }
  return changes;
}

// ── A file they can keep, and bring back ──────────────────────────────────────────────

export function exportProfile(profile: Profile): string {
  return JSON.stringify({ longtake: "profile", version: PROFILE_VERSION, exportedAt: new Date().toISOString(), facts: profile.facts, answers: profile.answers }, null, 2);
}

const isValue = (v: unknown): v is FactValue =>
  typeof v === "string" || typeof v === "boolean" || (Array.isArray(v) && v.every((x) => typeof x === "string"));

/**
 * A profile file, checked. Anything that is not a fact about a known concept is left out — a file
 * is data from outside, and nothing in it is trusted more than the rules allow.
 */
export function parseProfile(text: string): Profile | null {
  let raw: { longtake?: unknown; version?: unknown; facts?: unknown; answers?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || raw.longtake !== "profile" || raw.version !== PROFILE_VERSION) return null;
  const profile = emptyProfile();
  for (const item of Object.values((raw.facts ?? {}) as Record<string, Partial<Fact>>)) {
    if (!item || typeof item.concept !== "string" || keepable(item.concept) === "no" || !isValue(item.value)) continue;
    const key: FactKey = {
      concept: item.concept,
      ...(typeof item.part === "string" && item.part ? { part: asPart(item.part)! } : {}),
      ...(Number.isInteger(item.entry) && item.entry! > 0 ? { entry: item.entry! } : {}),
    };
    const id = factId(key);
    const history = (Array.isArray(item.history) ? item.history : [])
      .filter((h): h is Provenance => !!h && isValue(h.value) && typeof h.evidence === "string")
      .map((h) => ({
        value: h.value,
        evidence: h.evidence.slice(0, 2000),
        source: (["spoken", "confirmed", "typed", "edited", "migrated", "imported"] as const).includes(h.source) ? h.source : ("imported" as const),
        host: String(h.host ?? "").slice(0, 200),
        url: String(h.url ?? "").slice(0, 500),
        askedAs: String(h.askedAs ?? "").slice(0, 300),
        formTitle: String(h.formTitle ?? "").slice(0, 200),
        at: Number(h.at) || 0,
      }))
      .slice(-HISTORY);
    const at = Number(item.updatedAt) || Date.now();
    profile.facts[id] = {
      id,
      ...key,
      gist: String(item.gist ?? "").slice(0, 120),
      value: item.value,
      history: history.length ? history : [{ value: item.value, evidence: "", source: "imported", host: "", url: "", askedAs: "", formTitle: "", at }],
      sensitive: keepable(item.concept) === "sensitive",
      createdAt: Number(item.createdAt) || at,
      updatedAt: at,
      useCount: Number(item.useCount) || 0,
    };
  }
  for (const item of Object.values((raw.answers ?? {}) as Record<string, Partial<LongAnswer>>)) {
    if (!item || typeof item.id !== "string" || typeof item.text !== "string") continue;
    profile.answers[item.id] = {
      id: item.id.slice(0, 120),
      gist: String(item.gist ?? "").slice(0, 120),
      question: String(item.question ?? "").slice(0, 300),
      text: item.text.slice(0, 10_000),
      said: Array.isArray(item.said) ? item.said.filter((s): s is string => typeof s === "string").slice(0, 20) : [],
      host: String(item.host ?? "").slice(0, 200),
      at: Number(item.at) || 0,
      uses: Number(item.uses) || 0,
    };
  }
  return profile;
}

// ── For a person to read ──────────────────────────────────────────────────────────────

const CATEGORY_NAMES: Record<string, string> = {
  identity: "About you",
  contact: "Contact",
  address: "Address",
  links: "Links",
  document: "Documents",
  education: "Education",
  employment: "Work history",
  work: "Work",
  eeo: "Equal-opportunity questions",
  health: "Health",
  text: "In your own words",
};

const ORDINALS = ["", "second", "third", "fourth", "fifth", "sixth"];

/** What a fact is, in words: "phone country code", "school (second)". */
export function sayFact(fact: Pick<Fact, "concept" | "part" | "entry" | "gist">): string {
  const concept = conceptById(fact.concept);
  const base = concept?.say ?? fact.gist ?? fact.concept;
  const part = fact.part ? ` — ${fact.part.replace(/_/g, " ")}` : "";
  const entry = fact.entry ? ` (${ORDINALS[fact.entry] ?? `#${fact.entry + 1}`})` : "";
  return `${base}${part}${entry}`;
}

export type FactGroup = { category: string; name: string; facts: Fact[] };

/** Everything known, grouped the way a person thinks of it, in the vocabulary's own order. */
export function groupFacts(profile: Profile): FactGroup[] {
  const groups = new Map<string, Fact[]>();
  for (const fact of Object.values(profile.facts)) {
    const category = fact.concept.split(".")[0]!;
    groups.set(category, [...(groups.get(category) ?? []), fact]);
  }
  const order = Object.keys(CATEGORY_NAMES);
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([category, facts]) => ({
      category,
      name: CATEGORY_NAMES[category] ?? category,
      facts: facts.sort((a, b) => a.id.localeCompare(b.id)),
    }));
}

/** A fact as a surface lists it. */
export type KnownFact = {
  id: string;
  say: string;
  value: string;
  evidence: string;
  source: FactSource;
  host: string;
  at: number;
  sensitive: boolean;
};

export function knownFacts(profile: Profile): KnownFact[] {
  return Object.values(profile.facts)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((fact) => {
      const telling = fact.history[fact.history.length - 1]!;
      return {
        id: fact.id,
        say: sayFact(fact),
        value: shownValue(fact.value),
        evidence: telling.evidence,
        source: telling.source,
        host: telling.host,
        at: telling.at,
        sensitive: fact.sensitive,
      };
    });
}
