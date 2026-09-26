/**
 * The corpus report: every scorer's numbers, per form and in total, next to the baseline.
 *
 * The baseline lives in the corpus repo (`corpus/baseline.json`), so moving it is a visible diff
 * there. The ratchet is per form: a form already in the baseline may not get worse on any number,
 * and a gate (a honeypot leak, a field changed that nobody answered) fails whatever the baseline
 * says. A new form simply joins the baseline the next time it is moved (`CORPUS_UPDATE_BASELINE=1`).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Counts = Record<string, number>;
type Row = { key: string; question: string; problems: string[] };
type Stored = {
  id: string;
  at: string;
  counts: Counts;
  rows: Row[];
  extras?: { id: string; label: string; duplicateOf?: string }[];
  /** Truth fields inside another origin's frame — out of the page's reach, not scored. */
  elsewhere?: number;
  /** Who stamped what this form is scored against: the truth, and for filling the plan too. */
  checkedBy?: string[];
  /** How long the read and the harvest took. Tracked, never ratcheted: a busy machine is slow. */
  timing?: { readMs: number; harvestMs: number };
};

/** The p50 and p95 of some durations, as "12 / 40 ms". */
function percentiles(ms: number[]): string {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  return `${Math.round(at(50))} / ${Math.round(at(95))} ms`;
}

/**
 * Checked by Claude, not by a person. Such a key is a second opinion, not a person's: when one of
 * these forms gets worse, the key is the first suspect. The review tool stamps Claude as "claude …".
 */
const byClaude = (form: Stored) => (form.checkedBy ?? []).some((by) => by.startsWith("claude"));

type Metric = {
  key: string;
  /** Unique across scorers, so a failure line names its number without saying which scorer. */
  label: string;
  better: "higher" | "lower";
  /** Must be exactly 0, whatever the baseline says. */
  gate?: boolean;
  value: (c: Counts) => number | null;
};

type Scorer = { name: string; title: string; size: (total: Counts) => string; metrics: Metric[] };

const ratio = (a: number | undefined, b: number | undefined) => (b ? (a ?? 0) / b : null);

const READ: Metric[] = [
  { key: "found", label: "Found", better: "higher", value: (c) => ratio(c.found, c.fields) },
  { key: "notExtra", label: "Not extra", better: "higher", value: (c) => ratio(c.specs! - c.duplicates! - c.extras!, c.specs) },
  { key: "labelExact", label: "Label exact", better: "higher", value: (c) => ratio(c.labelExact, c.found) },
  { key: "labelWords", label: "Label words", better: "higher", value: (c) => ratio(c.labelF1, c.found) },
  { key: "kind", label: "Kind", better: "higher", value: (c) => ratio(c.kindRight, c.found) },
  { key: "requiredCaught", label: "Required caught", better: "higher", value: (c) => ratio(c.requiredTP, c.requiredTP! + c.requiredFN!) },
  { key: "requiredRight", label: "Required right", better: "higher", value: (c) => ratio(c.requiredTP, c.requiredTP! + c.requiredFP!) },
  { key: "choices", label: "Choices", better: "higher", value: (c) => ratio(c.optionsF1, c.choiceFields) },
  { key: "listType", label: "List type", better: "higher", value: (c) => ratio(c.searchableRight, c.choiceFields) },
  { key: "askedTwice", label: "Asked twice", better: "lower", value: (c) => c.duplicates ?? 0 },
  { key: "notAField", label: "Not a field", better: "lower", value: (c) => c.extras ?? 0 },
  { key: "sameWords", label: "Same words", better: "lower", value: (c) => c.ambiguous ?? 0 },
  { key: "honeypotLeaks", label: "Honeypot leaks", better: "lower", gate: true, value: (c) => c.honeypotLeaks ?? 0 },
];

const FILL: Metric[] = [
  { key: "outcome", label: "Right outcome", better: "higher", value: (c) => ratio(c.outcomeRight, c.cases) },
  { key: "shows", label: "Shows right", better: "higher", value: (c) => ratio(c.shownRight, c.written) },
  { key: "hidden", label: "Widget state", better: "higher", value: (c) => ratio(c.hiddenRight, c.hiddenChecked) },
  { key: "collateral", label: "Touched others", better: "lower", gate: true, value: (c) => c.collateral ?? 0 },
];

const TALK: Metric[] = [
  { key: "talkChecks", label: "Talk checks right", better: "higher", value: (c) => ratio(c.passed, c.checks) },
  { key: "touchedUnasked", label: "Changed unasked", better: "lower", gate: true, value: (c) => c.touched ?? 0 },
  { key: "falseAlarms", label: "False alarms", better: "lower", gate: true, value: (c) => c.alarms ?? 0 },
  { key: "liesCaught", label: "Lies caught", better: "higher", value: (c) => ratio(c.caught, c.lies) },
];

const MEANING: Metric[] = [
  { key: "meaningGiven", label: "Meaning given", better: "higher", value: (c) => ratio(c.given, c.fields) },
  { key: "conceptRight", label: "Concept right", better: "higher", value: (c) => ratio(c.conceptRight, c.fields) },
  { key: "subjectRight", label: "Subject right", better: "higher", value: (c) => ratio(c.subjectRight, c.fields) },
  { key: "scopeRight", label: "Scope right", better: "higher", value: (c) => ratio(c.scopeRight, c.fields) },
  { key: "dangerous", label: "Someone else's read as theirs", better: "lower", gate: true, value: (c) => c.dangerous ?? 0 },
];

const RETURNING: Metric[] = [
  { key: "putIn", label: "Known, put in", better: "higher", value: (c) => ratio(c.putIn, c.known) },
  { key: "offered", label: "Known, put in or offered", better: "higher", value: (c) => ratio(c.putIn! + c.waiting!, c.known) },
  { key: "askedAgain", label: "Known, asked again", better: "lower", gate: true, value: (c) => c.askedAgain ?? 0 },
  { key: "wrongRecall", label: "Wrong from last time", better: "lower", gate: true, value: (c) => c.wrong ?? 0 },
];

const CONTEXT: Metric[] = [
  { key: "contextText", label: "Page has context", better: "higher", value: (c) => ratio(c.withText, c.pages) },
  { key: "contextFound", label: "Who is asking, found", better: "higher", value: (c) => ratio(c.found, c.named) },
  { key: "contextLeaks", label: "Questions read as the page", better: "lower", gate: true, value: (c) => c.leaked ?? 0 },
];

export const SCORERS: Scorer[] = [
  { name: "read", title: "reading", size: (t) => `${t.fields ?? 0} fields`, metrics: READ },
  { name: "fill", title: "filling", size: (t) => `${t.cases ?? 0} answers`, metrics: FILL },
  { name: "talk", title: "talking", size: (t) => `${t.checks ?? 0} checks`, metrics: TALK },
  { name: "meaning", title: "meaning", size: (t) => `${t.fields ?? 0} fields`, metrics: MEANING },
  { name: "returning", title: "a returning person", size: (t) => `${t.known ?? 0} known answers`, metrics: RETURNING },
  { name: "context", title: "the page around the form", size: (t) => `${t.named ?? 0} named phrases`, metrics: CONTEXT },
];

/** Deterministic reads and writes: any move is a real move. Raise per metric here only if one turns out noisy. */
const EPSILON = 1e-9;

type Baseline = Record<string, Record<string, Record<string, number | null>>>;

function sum(all: Counts[]): Counts {
  const total: Counts = {};
  for (const counts of all) for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value;
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

function load(results: string, scorer: string): Stored[] {
  const dir = join(results, scorer);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Stored);
}

export type Report = { markdown: string; failures: string[] };

/**
 * `details: false` keeps the page's own words out — for CI logs, which are public on a public
 * repo. The numbers and form ids stay; the questions stay in the private corpus.
 *
 * `update: "better"` moves the baseline only when nothing got worse. A reader that loses a whole
 * group also loses that group's mistakes, so a broken run can look better on half its numbers —
 * locking that in would make the break the new normal. `"accept-worse"` is for the one honest
 * reason to move down: the truth itself was corrected.
 */
export function report(options: {
  results: string;
  corpus: string;
  update?: false | "better" | "accept-worse";
  details?: boolean;
}): Report {
  const baselinePath = join(options.corpus, "baseline.json");
  const baseline: Baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline) : {};

  const failures: string[] = [];
  const gateFailures: string[] = [];
  let improved = 0;
  const lines: string[] = [];
  const next: Baseline = {};

  for (const scorer of SCORERS) {
    const stored = load(options.results, scorer.name);
    const base = baseline[scorer.name] ?? {};
    const baseForms = Object.keys(base).filter((id) => id !== "__total__");
    if (stored.length === 0 && baseForms.length === 0) continue;

    const total = sum(stored.map((s) => s.counts));
    // The total moves only against a total over the very same forms; a new form is not a regression.
    const sameForms = stored.length === baseForms.length && stored.every((s) => base[s.id]);
    const baseTotal = (key: string) => (sameForms ? base.__total__?.[key] : undefined);

    if (lines.length > 0) lines.push("");
    lines.push(`### Corpus · ${scorer.title} — ${stored.length} forms, ${scorer.size(total)}`);
    lines.push("");
    lines.push(`| Form | ${scorer.metrics.map((m) => m.label).join(" | ")} |`);
    lines.push(`|---|${scorer.metrics.map(() => "---:").join("|")}|`);
    lines.push(`| **All** | ${scorer.metrics.map((m) => `**${show(m, stored.length ? m.value(total) : null, baseTotal(m.key))}**`).join(" | ")} |`);

    for (const form of stored) {
      const was = base[form.id];
      lines.push(`| ${form.id}${byClaude(form) ? " †" : ""} | ${scorer.metrics.map((m) => show(m, m.value(form.counts), was?.[m.key])).join(" | ")} |`);
      for (const metric of scorer.metrics) {
        const value = metric.value(form.counts);
        if (metric.gate && value !== null && value !== 0) gateFailures.push(`${form.id}: ${metric.label} is ${value}, must be 0`);
        const before = was?.[metric.key];
        if (before === undefined || before === null || value === null) continue;
        const worse = metric.better === "higher" ? value < before - EPSILON : value > before + EPSILON;
        if (worse) failures.push(`${form.id}: ${metric.label} got worse — ${show(metric, value, before)}`);
        else if (Math.abs(value - before) > EPSILON) improved++;
      }
    }
    for (const id of baseForms) {
      if (!stored.some((s) => s.id === id)) failures.push(`${id}: in the ${scorer.title} baseline, but no result this run`);
    }

    if (stored.some(byClaude)) {
      lines.push("");
      lines.push("† Answer key checked by Claude, not by a person — when one of these gets worse, suspect the key first.");
    }

    const timed = stored.filter((s) => s.timing);
    if (timed.length > 0) {
      lines.push("");
      lines.push(
        `Time (p50 / p95, tracked only): read ${percentiles(timed.map((s) => s.timing!.readMs))}, ` +
          `harvest ${percentiles(timed.map((s) => s.timing!.harvestMs))}.`,
      );
    }

    const elsewhere = stored.reduce((n, s) => n + (s.elsewhere ?? 0), 0);
    if (elsewhere > 0) {
      lines.push("");
      lines.push(`${elsewhere} field${elsewhere === 1 ? "" : "s"} sit inside other origins' frames — not scored until the corpus reads inside frames.`);
    }

    lines.push("");
    if (options.details === false) {
      lines.push("_Field-by-field details stay out of public logs — run `npm run corpus` with the corpus checked out._");
    } else {
      lines.push(...details(stored));
    }

    next[scorer.name] = Object.fromEntries(stored.map((form) => [form.id, Object.fromEntries(scorer.metrics.map((m) => [m.key, m.value(form.counts)]))]));
    next[scorer.name]!.__total__ = Object.fromEntries(scorer.metrics.map((m) => [m.key, m.value(total)]));
  }

  const all = [...gateFailures, ...failures];
  if (all.length > 0) {
    lines.push("");
    lines.push("**Worse than the baseline:**");
    for (const failure of all) lines.push(`- ${failure}`);
  }

  if (improved > 0 && all.length === 0 && !options.update) {
    lines.push("");
    lines.push(
      `${improved} number${improved === 1 ? "" : "s"} improved. Lock ${improved === 1 ? "it" : "them"} in: ` +
        "`CORPUS_UPDATE_BASELINE=1 npx playwright test --project=corpus`, then commit `baseline.json` in the corpus repo.",
    );
  }

  if (options.update === "better" && failures.length > 0) {
    lines.push("");
    lines.push(
      `Baseline NOT moved: ${failures.length} number${failures.length === 1 ? "" : "s"} got worse. ` +
        "If that is intended — the truth was corrected — run with `CORPUS_UPDATE_BASELINE=accept-worse`.",
    );
    return { markdown: lines.join("\n"), failures: all };
  }

  if (options.update) {
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
    lines.push("");
    lines.push(`Baseline updated: ${baselinePath}`);
    return { markdown: lines.join("\n"), failures: gateFailures };
  }
  return { markdown: lines.join("\n"), failures: all };
}

function details(stored: Stored[]): string[] {
  const lines = ["<details><summary>What is wrong, field by field</summary>", ""];
  for (const form of stored) {
    const wrong = (form.rows ?? []).filter((row) => row.problems.length > 0);
    const extras = form.extras ?? [];
    if (wrong.length === 0 && extras.length === 0) continue;
    lines.push(`**${form.id}**`);
    for (const row of wrong) lines.push(`- ${row.key} “${row.question}” — ${row.problems.join("; ")}`);
    for (const extra of extras) {
      lines.push(`- extra \`${extra.id}\` “${extra.label}” — ${extra.duplicateOf ? `a second reading of \`${extra.duplicateOf}\`` : "no such field in the truth"}`);
    }
    lines.push("");
  }
  lines.push("</details>");
  return lines;
}
