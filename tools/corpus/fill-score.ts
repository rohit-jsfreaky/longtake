/**
 * How well an answer went in, against what must happen. Pure, like `score.ts`: counts add up
 * across forms, and the report takes ratios of the sums.
 *
 * One number is a hard gate: an answer that changed a field nobody answered. That is the product
 * writing where a person did not speak (rule 2), and no baseline makes it acceptable.
 */

import { comparable } from "./text";
import type { FillCase } from "./types";

export type FillOutcome = "written" | "refused" | "held" | "not read";

/** What happened to one case on the page, as the spec observed it. */
export type FillRun = {
  outcome: FillOutcome;
  /** What the page shows in that field afterwards (arrays joined, see `shown`). */
  shows: string | null;
  /** The hidden input's value, when the case names one; undefined when it does not. */
  hidden?: string | null;
  /** Fields other than this one (and its `also`) whose value changed — by label. */
  touched: string[];
  /** What the fill call reported for every field it wrote — shown when the case went wrong. */
  call?: string[];
};

export type FillCounts = {
  cases: number;
  outcomeRight: number;
  /** Cases that were meant to go in and did. */
  written: number;
  shownRight: number;
  hiddenChecked: number;
  hiddenRight: number;
  /** Other fields changed by an answer that was not theirs. Hard gate: 0. */
  collateral: number;
};

export type FillRow = { key: string; question: string; specId: null; problems: string[] };

/** A value as a person reads it back: several choices in a stable order, a tick as yes or no. */
export function shown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).sort((a, b) => a.localeCompare(b)).join("; ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function scoreFill(cases: FillCase[], runs: FillRun[], questionOf: (key: string) => string) {
  const counts: FillCounts = { cases: 0, outcomeRight: 0, written: 0, shownRight: 0, hiddenChecked: 0, hiddenRight: 0, collateral: 0 };
  const rows: FillRow[] = [];

  cases.forEach((plan, i) => {
    const run = runs[i]!;
    const problems: string[] = [];
    counts.cases++;
    if (run.outcome === plan.expect.outcome) counts.outcomeRight++;
    else problems.push(`${run.outcome}, should be ${plan.expect.outcome}`);

    if (plan.expect.outcome === "written" && run.outcome === "written") {
      counts.written++;
      const want = plan.expect.shows ?? shown(plan.value);
      if (comparable(run.shows ?? "") === comparable(want)) counts.shownRight++;
      else problems.push(`shows "${run.shows ?? ""}", should show "${want}"`);
    }

    if (plan.expect.hidden) {
      counts.hiddenChecked++;
      if (run.hidden === plan.expect.hidden.value) counts.hiddenRight++;
      else problems.push(`hidden ${plan.expect.hidden.css} is "${run.hidden ?? ""}", should be "${plan.expect.hidden.value}"`);
    }

    if (run.touched.length > 0) {
      counts.collateral += run.touched.length;
      problems.push(`also changed: ${run.touched.join(", ")}`);
    }

    if (problems.length > 0 && run.call?.length) problems.push(`the call said: ${run.call.join("; ")}`);
    rows.push({ key: plan.field, question: `${questionOf(plan.field)} ← ${shown(plan.value)}`, specId: null, problems });
  });

  return { counts, rows };
}
