/**
 * What the page cannot tell us about its own answers.
 *
 * The page is the truth for what is IN each box — `readValue` reads it, for every kind of field.
 * But the page cannot say where an answer came from, which words it was spoken in, that the
 * person asked for a box to stay empty, or that an answer is waiting for their yes. That is this.
 *
 * It replaces seven separate lists that used to live in the React hook (`filledRef`,
 * `writtenRef`, `declinedRef`, `rememberedRef`, `receiptsRef`, `fromMemory`, outcomes-as-state),
 * each maintained by hand at every place that touched the form — which is how the counter, the
 * opening line and "still empty" came to disagree with each other and with the page.
 *
 * Keyed by `FieldRegistry` ids, which stay stable for the whole session.
 */

import type { FieldSpec, SpokenValue } from "./types";

/** Something we put into the form, and the words it came from. */
export type LedgerEntry = {
  source: "spoken" | "memory";
  value: SpokenValue["value"];
  evidence: string;
  /** The field as it was when written — its wording survives the field being hidden. */
  spec: FieldSpec;
  at: number;
};

/** An answer held back until the person says yes. See `gate.ts`. */
export type Pending = {
  /** What would go in. */
  suggestion: string;
  /** What they actually said. */
  heard: string;
  /** Not named: they said something the form does not offer. Hedged: they were not sure. */
  reason: "not_named" | "hedged";
};

export class Ledger {
  private written = new Map<string, LedgerEntry>();
  private declined = new Set<string>();
  /** Put off by the person: asked again only once everything else is done. */
  private later = new Set<string>();
  private pending = new Map<string, Pending>();
  /** Fields that already had something in them when the session opened. */
  private atOpen = new Set<string>();

  /** Record something we wrote. A later write to the same field replaces it — they corrected it. */
  wrote(id: string, entry: Omit<LedgerEntry, "at">, now = Date.now()): void {
    this.written.set(id, { ...entry, at: now });
    this.declined.delete(id);
    this.pending.delete(id);
  }

  entry(id: string): LedgerEntry | undefined {
    return this.written.get(id);
  }

  /** Every answer we put in, including ones whose field is currently hidden. */
  entries(): [string, LedgerEntry][] {
    return [...this.written.entries()];
  }

  /** The person asked for this to be empty. It is not asked for again. */
  decline(id: string): void {
    this.written.delete(id);
    this.pending.delete(id);
    this.declined.add(id);
  }

  isDeclined(id: string): boolean {
    return this.declined.has(id);
  }

  /**
   * "Skip this, we'll do it at the end." Not declined — it will be asked again — just not now.
   * Nothing is written or cleared; the field keeps whatever it has.
   */
  setAside(id: string): void {
    this.later.add(id);
  }

  isSetAside(id: string): boolean {
    return this.later.has(id);
  }

  hold(id: string, pending: Pending): void {
    this.pending.set(id, pending);
  }

  pendingFor(id: string): Pending | undefined {
    return this.pending.get(id);
  }

  release(id: string): void {
    this.pending.delete(id);
  }

  /** Mark what was already on the form before anybody spoke — autofill, the page's own defaults. */
  markAtOpen(ids: Iterable<string>): void {
    for (const id of ids) this.atOpen.add(id);
  }

  wasThereAtOpen(id: string): boolean {
    return this.atOpen.has(id);
  }
}
