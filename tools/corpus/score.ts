/**
 * How well `core/` read a real form, against a human-verified answer key. Pure: counts in, counts
 * out, so the numbers of many forms add up and the report can take ratios of the sums.
 *
 * Every number here is about one thing a person would notice: a question missing, a question
 * asked twice, a question under the wrong words, a required answer treated as optional, a choice
 * the agent does not know about, or a honeypot that became something the model can fill.
 */

import { comparable, setF1, tokenF1 } from "./text";
import type { AxCapture, Locator, TruthField } from "./types";

/** What `core/` produced for one field — the parts that are scored. */
export type ReadSpec = {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  options?: { label: string }[];
  searchable?: boolean;
  section?: string;
  /** The piece of a split answer this box takes — "Month"; `label` is then the whole question. */
  part?: string;
};

/** Truth joined to specs by element (see `joinTruth` in tests/corpus/load.ts). */
export type ReadJoin = {
  /** Per truth field, in order: the spec that IS that field, or null. */
  best: (string | null)[];
  /** Per spec id: the truth fields its element is, holds, or sits inside. */
  touches: Record<string, number[]>;
};

export type ReadCounts = {
  /** Truth fields a person answers (honeypots excluded). */
  fields: number;
  /** …of which `core/` read as a field. */
  found: number;
  /** Fields `core/` produced. */
  specs: number;
  /** Specs that are a second reading of a field already found — the question asked twice. */
  duplicates: number;
  /** Specs that are no field at all in the truth. */
  extras: number;
  /** Truth honeypots that became a spec. A hard gate: must stay 0. */
  honeypotLeaks: number;
  labelExact: number;
  labelF1: number;
  kindRight: number;
  requiredTP: number;
  requiredFP: number;
  requiredFN: number;
  /** Found fields the truth gives choices for. */
  choiceFields: number;
  optionsF1: number;
  searchableRight: number;
  /** Specs whose label and section another spec shares — the agent cannot tell them apart. */
  ambiguous: number;
};

export type ReadRow = { key: string; question: string; specId: string | null; problems: string[] };

export type ReadResult = { counts: ReadCounts; rows: ReadRow[]; extras: { id: string; label: string; duplicateOf?: string }[] };

const where = (locator: Locator) => [...locator.frames, ...locator.path].join(" | ");

/**
 * Every element that is part of a truth field: its own, plus the other choices of its group — a
 * radio group is one field whichever radio `core/` keeps its handle on.
 */
export function locatorsOf(field: TruthField, ax: AxCapture): Locator[] {
  const own = where(field.locator);
  const control = ax.controls.find((c) => where(c.locator) === own);
  if (!control) return [field.locator];
  let members = [control];
  if (control.role === "radiogroup") {
    const key = `rg:${control.locator.path.join(" >> ")}`;
    members = members.concat(ax.controls.filter((c) => c.group?.key === key));
  } else if (control.group) {
    members = ax.controls.filter((c) => c.group?.key === control.group!.key);
  }
  return [field.locator, ...members.map((m) => m.locator).filter((l) => where(l) !== own)];
}

export function scoreRead(fields: TruthField[], specs: ReadSpec[], join: ReadJoin): ReadResult {
  const counts: ReadCounts = {
    fields: 0, found: 0, specs: specs.length, duplicates: 0, extras: 0, honeypotLeaks: 0,
    labelExact: 0, labelF1: 0, kindRight: 0, requiredTP: 0, requiredFP: 0, requiredFN: 0,
    choiceFields: 0, optionsF1: 0, searchableRight: 0, ambiguous: 0,
  };
  const byId = new Map(specs.map((s) => [s.id, s]));
  const rows: ReadRow[] = [];

  fields.forEach((field, i) => {
    const specId = join.best[i] ?? null;
    const spec = specId ? byId.get(specId) : undefined;
    if (field.honeypot) {
      if (spec) {
        counts.honeypotLeaks++;
        rows.push({ key: field.key, question: field.question, specId, problems: ["a honeypot became a question"] });
      }
      return;
    }
    counts.fields++;
    const problems: string[] = [];
    if (!spec) {
      rows.push({ key: field.key, question: field.question, specId: null, problems: ["not read at all"] });
      return;
    }
    counts.found++;

    if (comparable(spec.label) === comparable(field.question)) counts.labelExact++;
    else problems.push(`label "${spec.label}"`);
    counts.labelF1 += tokenF1(spec.label, field.question);

    if (spec.kind === field.kind) counts.kindRight++;
    else problems.push(`kind ${spec.kind}, is ${field.kind}`);

    if (field.required && spec.required) counts.requiredTP++;
    else if (field.required) {
      counts.requiredFN++;
      problems.push("required, read as optional");
    } else if (spec.required) {
      counts.requiredFP++;
      problems.push("optional, read as required");
    }

    if (field.options && field.options.labels.length > 0) {
      counts.choiceFields++;
      const found = (spec.options ?? []).map((o) => o.label);
      const f1 = setF1(found, field.options.labels);
      counts.optionsF1 += f1;
      if (f1 < 1) problems.push(`choices ${found.length}/${field.options.labels.length}, F1 ${f1.toFixed(2)}`);
      // `searchable` in core means "answer it by typing". It is right for a list whose choices only
      // appear as you type, and a choice core makes on purpose for a long list it read in full
      // (Greenhouse's 244 country codes). It is wrong only when it leaves the agent with nothing:
      // a typed-for list taken as fixed, or a fixed list neither read nor marked for typing.
      const listRight = field.options.searchable ? Boolean(spec.searchable) : Boolean(spec.searchable) || found.length > 0;
      if (listRight) counts.searchableRight++;
      else problems.push(field.options.searchable ? "choices appear as you type, read as a fixed list" : "a fixed list, neither read nor typed into");
    }

    rows.push({ key: field.key, question: field.question, specId, problems });
  });

  // Specs that are not the best reading of any truth field.
  const bestIds = new Set(join.best.filter((id): id is string => Boolean(id)));
  const extras: ReadResult["extras"] = [];
  for (const spec of specs) {
    if (bestIds.has(spec.id)) continue;
    const touched = join.touches[spec.id] ?? [];
    const duplicateOf = touched.map((i) => join.best[i]).find((id): id is string => Boolean(id));
    if (duplicateOf) counts.duplicates++;
    else counts.extras++;
    extras.push({ id: spec.id, label: spec.label, ...(duplicateOf ? { duplicateOf } : {}) });
  }

  // Two questions the agent sees under the same words, in the same section. The three boxes of one
  // date of birth are told apart by their parts.
  const seen = new Map<string, number>();
  for (const spec of specs) {
    const key = `${comparable(spec.section ?? "")}\u0000${comparable(spec.label)}\u0000${spec.part ?? ""}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const count of seen.values()) if (count > 1) counts.ambiguous += count;

  return { counts, rows, extras };
}
