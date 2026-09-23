/**
 * The corpus report: every scorer's numbers, per form and in total, next to the baseline.
 *
 * The baseline lives in the corpus repo (`corpus/baseline.json`), so moving it is a visible diff
 * there. The ratchet is per form: a form already in the baseline may not get worse on any number,
 * and a honeypot leak fails whatever the baseline says. A new form simply joins the baseline on
 * the next `--update-baseline`.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReadCounts, ReadRow } from "./score";

type Stored = { id: string; at: string; counts: ReadCounts; rows: ReadRow[]; extras: { id: string; label: string; duplicateOf?: string }[] };

type Metric = {
  key: string;
  label: string;
  better: "higher" | "lower";
  /** Must be exactly 0, whatever the baseline says. */
  gate?: boolean;
  value: (c: ReadCounts) => number | null;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const READ: Metric[] = [
  { key: "found", label: "Found", better: "higher", value: (c) => ratio(c.found, c.fields) },
  { key: "notExtra", label: "Not extra", better: "higher", value: (c) => ratio(c.specs - c.duplicates - c.extras, c.specs) },
  { key: "labelExact", label: "Label exact", better: "higher", value: (c) => ratio(c.labelExact, c.found) },
  { key: "labelWords", label: "Label words", better: "higher", value: (c) => ratio(c.labelF1, c.found) },
  { key: "kind", label: "Kind", better: "higher", value: (c) => ratio(c.kindRight, c.found) },
  { key: "requiredCaught", label: "Required caught", better: "higher", value: (c) => ratio(c.requiredTP, c.requiredTP + c.requiredFN) },
  { key: "requiredRight", label: "Required right", better: "higher", value: (c) => ratio(c.requiredTP, c.requiredTP + c.requiredFP) },
  { key: "choices", label: "Choices", better: "higher", value: (c) => ratio(c.optionsF1, c.choiceFields) },
  { key: "listType", label: "List type", better: "higher", value: (c) => ratio(c.searchableRight, c.choiceFields) },
  { key: "askedTwice", label: "Asked twice", better: "lower", value: (c) => c.duplicates },
  { key: "notAField", label: "Not a field", better: "lower", value: (c) => c.extras },
  { key: "sameWords", label: "Same words", better: "lower", value: (c) => c.ambiguous },
  { key: "honeypotLeaks", label: "Honeypot leaks", better: "lower", gate: true, value: (c) => c.honeypotLeaks },
];

/** Deterministic reads: any move is a real move. Raise per metric here only if one turns out noisy. */
const EPSILON = 1e-9;

type Baseline = { read: Record<string, Record<string, number | null>> };

function sum(all: ReadCounts[]): ReadCounts {
  const total = {} as ReadCounts;
  for (const counts of all) {
    for (const [key, value] of Object.entries(counts) as [keyof ReadCounts, number][]) total[key] = (total[key] ?? 0) + value;
  }
  return total;
}

const isCount = (metric: Metric) => metric.better === "lower";

function show(metric: Metric, value: number | null, base: number | null | undefined): string {
  if (value === null) return "–";
  const text = isCount(metric) ? String(value) : `${(value * 100).toFixed(1)}%`;
  if (base === undefined || base === null) return text;
  const moved = value - base;
  if (Math.abs(moved) <= EPSILON) return text;
  const better = metric.better === "higher" ? moved > 0 : moved < 0;
  const size = isCount(metric) ? `${moved > 0 ? "+" : ""}${moved}` : `${moved > 0 ? "+" : ""}${(moved * 100).toFixed(1)}`;
  return `${text} ${better ? "▲" : "▼"}${size}`;
}

export type Report = { markdown: string; failures: string[] };

export function report(options: { results: string; corpus: string; update?: boolean }): Report {
  const dir = join(options.results, "read");
  const stored: Stored[] = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Stored)
    : [];
  const baselinePath = join(options.corpus, "baseline.json");
  const baseline: Baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline) : { read: {} };

  const failures: string[] = [];
  const lines: string[] = [];
  const total = sum(stored.map((s) => s.counts));
  // The total moves only against a total over the very same forms; a new form is not a regression.
  const baseForms = Object.keys(baseline.read).filter((id) => id !== "__total__");
  const sameForms = stored.length === baseForms.length && stored.every((s) => baseline.read[s.id]);
  const baseTotal = (key: string) => (sameForms ? baseline.read.__total__?.[key] : undefined);

  lines.push(`### Corpus · reading — ${stored.length} forms, ${total.fields ?? 0} fields`);
  lines.push("");
  lines.push(`| Form | ${READ.map((m) => m.label).join(" | ")} |`);
  lines.push(`|---|${READ.map(() => "---:").join("|")}|`);
  lines.push(`| **All** | ${READ.map((m) => `**${show(m, stored.length ? m.value(total) : null, baseTotal(m.key))}**`).join(" | ")} |`);
  for (const form of stored) {
    const base = baseline.read[form.id];
    lines.push(`| ${form.id} | ${READ.map((m) => show(m, m.value(form.counts), base?.[m.key])).join(" | ")} |`);

    for (const metric of READ) {
      const value = metric.value(form.counts);
      if (metric.gate && value !== null && value !== 0) failures.push(`${form.id}: ${metric.label} is ${value}, must be 0`);
      const was = base?.[metric.key];
      if (was === undefined || was === null || value === null) continue;
      const worse = metric.better === "higher" ? value < was - EPSILON : value > was + EPSILON;
      if (worse) failures.push(`${form.id}: ${metric.label} got worse — ${show(metric, value, was)}`);
    }
  }
  for (const id of Object.keys(baseline.read)) {
    if (id !== "__total__" && !stored.some((s) => s.id === id)) failures.push(`${id}: in the baseline, but no result this run`);
  }

  lines.push("");
  lines.push("<details><summary>What is wrong, field by field</summary>");
  lines.push("");
  for (const form of stored) {
    const wrong = form.rows.filter((row) => row.problems.length > 0);
    if (wrong.length === 0 && form.extras.length === 0) continue;
    lines.push(`**${form.id}**`);
    for (const row of wrong) lines.push(`- ${row.key} “${row.question}” — ${row.problems.join("; ")}`);
    for (const extra of form.extras) {
      lines.push(`- extra \`${extra.id}\` “${extra.label}” — ${extra.duplicateOf ? `a second reading of \`${extra.duplicateOf}\`` : "no such field in the truth"}`);
    }
    lines.push("");
  }
  lines.push("</details>");

  if (failures.length > 0) {
    lines.push("");
    lines.push("**Worse than the baseline:**");
    for (const failure of failures) lines.push(`- ${failure}`);
  }

  if (options.update) {
    const next: Baseline = { read: {} };
    for (const form of stored) next.read[form.id] = Object.fromEntries(READ.map((m) => [m.key, m.value(form.counts)]));
    next.read.__total__ = Object.fromEntries(READ.map((m) => [m.key, m.value(total)]));
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
    lines.push("");
    lines.push(`Baseline updated: ${baselinePath}`);
    return { markdown: lines.join("\n"), failures: failures.filter((f) => f.includes("must be 0")) };
  }
  return { markdown: lines.join("\n"), failures };
}
