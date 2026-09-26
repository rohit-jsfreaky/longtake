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

import type { FactKey, FactValue, Provenance } from "./profile";
import type { FieldSpec, SpokenValue } from "./types";

/** Something we put into the form, and the words it came from. */
export type LedgerEntry = {
  /** Said, from last time, or drafted from what they said and approved (draft.ts). */
  source: "spoken" | "memory" | "drafted";
  value: SpokenValue["value"];
  evidence: string;
  /** The field as it was when written — its wording survives the field being hidden. */
  spec: FieldSpec;
  /** The saved answer it came from, when it came from last time. */
  factId?: string;
  at: number;
};

/** An answer held back until the person says yes. See `gate.ts`. */
export type Pending = {
  /** What would go in. */
  suggestion: string;
  /** What they actually said. */
  heard: string;
  /**
   * Not named: they said something the form does not offer. Hedged: they were not sure. Inferred:
   * the agent worked it out rather than heard it. From last
   * time: an answer from an earlier form that is not certain enough to go in unasked. Draft: a long
   * answer written from their words (draft.ts), read to them, waiting for their yes.
   */
  reason: "not_named" | "hedged" | "inferred" | "from_last_time" | "draft";
  /** The exact value to write on a yes, when it is not just the suggestion (a list, a yes/no). */
  value?: SpokenValue["value"];
  /** From last time: the saved answer, and why it waits. */
  factId?: string;
  why?: string;
  /** A draft: its words they said, what the model saw missing, names found in no source. */
  draft?: { said: string[]; missing: string[]; flagged: string[] };
};

/**
 * Something to settle with the person about next time, not about this form:
 *   - changed: they just said something different from what was saved — keep the new one?
 *   - forget: they cleared an answer that came from last time — forget it for next time too?
 *   - sensitive: a personal answer (health, documents) — remember it? Asked once, at the end.
 */
export type ProfileAsk =
  | { kind: "changed"; factId: string; key: FactKey; gist: string; was: FactValue; now: FactValue; from: Provenance }
  | { kind: "forget"; factId: string; was: FactValue }
  | { kind: "sensitive"; key: FactKey; gist: string; value: FactValue; from: Provenance };

export class Ledger {
  private written = new Map<string, LedgerEntry>();
  private declined = new Set<string>();
  /** Put off by the person: asked again only once everything else is done. */
  private later = new Set<string>();
  private pending = new Map<string, Pending>();
  /** Fields that already had something in them when the session opened. */
  private atOpen = new Set<string>();
  private toSettle = new Map<string, ProfileAsk>();
  /** Fields the agent told them went in, that did not — with its words. */
  private claimed = new Map<string, string>();

  /** Record something we wrote. A later write to the same field replaces it — they corrected it. */
  wrote(id: string, entry: Omit<LedgerEntry, "at">, now = Date.now()): void {
    this.written.set(id, { ...entry, at: now });
    this.declined.delete(id);
    this.pending.delete(id);
    this.claimed.delete(id);
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

  /** The agent said this went in; it did not (trust.ts). Cleared once something is written to it. */
  claimedIn(id: string, said: string): void {
    this.claimed.set(id, said);
  }

  claimFor(id: string): string | undefined {
    return this.claimed.get(id);
  }

  /** Something to ask about next time, for this field. A newer one replaces it. */
  ask(id: string, ask: ProfileAsk): void {
    this.toSettle.set(id, ask);
  }

  askFor(id: string): ProfileAsk | undefined {
    return this.toSettle.get(id);
  }

  asks(): [string, ProfileAsk][] {
    return [...this.toSettle.entries()];
  }

  /** Asked and answered — or no longer true. */
  settle(id: string): void {
    this.toSettle.delete(id);
  }

  /** Mark what was already on the form before anybody spoke — autofill, the page's own defaults. */
  markAtOpen(ids: Iterable<string>): void {
    for (const id of ids) this.atOpen.add(id);
  }

  wasThereAtOpen(id: string): boolean {
    return this.atOpen.has(id);
  }
}
