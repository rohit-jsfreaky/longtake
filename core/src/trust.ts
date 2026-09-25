/**
 * Did the agent say something went in that did not?
 *
 * ## The live failure this exists for
 *
 * "Why do you want to work at Discord?" was answered; the agent said "Got that in"; the box stayed
 * empty. No tool had been called. Nothing in the product noticed: every rule we have checks what
 * the agent WROTE, and here it wrote nothing — it only said it had. On a job application, a person
 * who trusts that sentence sends the form with an empty answer.
 *
 * ## How it is watched
 *
 * Each exchange is one turn of the person's and everything after it: the tool calls with their
 * results, and the agent's replies. After each real reply — not the filler the server speaks during
 * a tool call (`fc-…`), nor a reply that made a call (its words are "putting that in") — it decides:
 *
 *   A. an answer was expected, no tool was called, and the form did not change → ask the judge;
 *   B. some call's answer did not go in, or waits for a yes → ask the judge;
 *   C. every answer went in → nothing to ask.
 *
 * The judge (`/api/check`, a language model) says only what the agent CLAIMED, quoting its words.
 * Code checks every quote is in what the agent said, then holds each "put in" claim against the form
 * itself. A claim that does not match is a mismatch: the agent is asked, at once, to put it in —
 * quoting the person — or to say plainly it is not in (`createReply`), and the person sees it too.
 *
 * Pure, with time passed in. The judge is a service; this only decides when to ask it and what its
 * answer means.
 */

import { checkEvidence } from "./evidence";

/** What the agent claimed about one field, in its own words. */
export type Claim = {
  field: string;
  /** put_in: it said it went in. not_in: it said it did not. asked: it asked for it. */
  claim: "put_in" | "not_in" | "asked";
  quote: string;
};

/** One field the agent said went in, that did not. */
export type Mismatch = { field: string; question: string; said: string };

/** A move the person is expected to answer — after it, a reply with no call is worth a look. */
const ANSWERED_MOVES = new Set(["ask", "confirm", "confirm_recalled", "resolve", "optional", "update_profile"]);

type Call = { id: string; name: string; done: boolean; notIn: string[] };

type Exchange = {
  userText: string;
  expected: string;
  /** The fields the agent was asking about when they spoke. */
  asking: string[];
  calls: Call[];
  /** Replies during which a tool call was made: their words are the tool's filler. */
  calling: Set<string>;
  judged: boolean;
};

export type JudgeRequest = {
  /** Why: no call where an answer was expected, or answers that did not go in. */
  reason: "no_call" | "not_all_in";
  said: string;
  heard: string;
  /** The fields the agent was asking about when the person spoke — what "that" points at. */
  asking: string[];
  /** Fields the calls of this exchange reported as not in, or waiting. */
  notIn: string[];
};

/**
 * Follows the conversation and says when to ask the judge. One per call.
 */
export class TrustWatch {
  private exchange: Exchange | null = null;
  private replying = new Set<string>();

  /** The person finished a turn; `expected` is the move the agent was on, `asking` its fields. */
  userTurn(text: string, expected: string, asking: string[] = []): void {
    this.exchange = { userText: text, expected, asking, calls: [], calling: new Set(), judged: false };
  }

  replyStarted(id: string): void {
    this.replying.add(id);
  }

  toolCall(id: string, name: string): void {
    if (!this.exchange) return;
    this.exchange.calls.push({ id, name, done: false, notIn: [] });
    // Whatever reply is speaking while a tool runs is saying "one moment", not what went in.
    for (const reply of this.replying) this.exchange.calling.add(reply);
  }

  /** A tool's result: which fields it reports as not in, or waiting for a yes. */
  toolResult(id: string, result: unknown): void {
    const call = this.exchange?.calls.find((c) => c.id === id);
    if (!call) return;
    call.done = true;
    call.notIn = notInFrom(result);
  }

  /**
   * A reply is over and this is what it said. Returns what to ask the judge, or null. Asked at most
   * once per exchange, so a correction cannot set off another.
   */
  replyDone(id: string, said: string, formChanged: boolean): JudgeRequest | null {
    this.replying.delete(id);
    const exchange = this.exchange;
    if (!exchange || exchange.judged || !said.trim()) return null;
    if (id.startsWith("fc-") || exchange.calling.has(id)) return null;
    if (exchange.calls.some((call) => !call.done)) return null;

    const notIn = [...new Set(exchange.calls.flatMap((call) => call.notIn))];
    const fills = exchange.calls.filter((call) => call.name === "fill_fields" || call.name === "confirm_answer");
    let reason: JudgeRequest["reason"] | null = null;
    if (fills.length === 0 && exchange.calls.length === 0 && !formChanged && ANSWERED_MOVES.has(exchange.expected)) reason = "no_call";
    else if (notIn.length > 0) reason = "not_all_in";
    if (!reason) return null;

    exchange.judged = true;
    return { reason, said, heard: exchange.userText, asking: exchange.asking, notIn };
  }
}

/** The fields a tool result reports as not in: not filled, waiting for a yes, not confirmed. */
function notInFrom(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const ids = (list: unknown) => (Array.isArray(list) ? list.map((item) => String((item as { field?: unknown })?.field ?? "")).filter(Boolean) : []);
  const notConfirmed = r.not_confirmed && typeof r.not_confirmed === "object" ? [String((r.not_confirmed as { field?: unknown }).field ?? "")] : [];
  return [...ids(r.not_filled), ...ids(r.waiting_for_yes), ...notConfirmed].filter(Boolean);
}

// ── The judge's answer, held to what can be checked ──────────────────────────────────────

const CLAIMS = new Set(["put_in", "not_in", "asked"]);

/**
 * The judge's claims, checked: a field the form has, a claim we know, and a quote that is really in
 * what the agent said. Anything else is dropped — an invented quote proves nothing.
 */
export function validateClaims(raw: unknown, said: string, fieldIds: string[]): Claim[] {
  const known = new Set(fieldIds);
  const list = raw && typeof raw === "object" && Array.isArray((raw as { claims?: unknown }).claims) ? (raw as { claims: unknown[] }).claims : [];
  const claims: Claim[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const field = typeof item?.field === "string" ? item.field : "";
    const claim = typeof item?.claim === "string" ? item.claim : "";
    const quote = typeof item?.quote === "string" ? item.quote.trim() : "";
    if (!known.has(field) || !CLAIMS.has(claim) || !quote) continue;
    if (!checkEvidence(said, quote).ok) continue;
    // A question asks; it does not say anything went in. `"Female", right?` was read as "put in"
    // on a live recording — and the agent would have been told it lied when it only asked.
    const asks = /\?\s*["'”’)]*\s*$/.test(quote);
    claims.push({ field, claim: claim === "put_in" && asks ? "asked" : (claim as Claim["claim"]), quote });
  }
  return claims;
}

/**
 * Every "put in" claim held against the form: a field that is empty, or that a call reported as not
 * in, was not put in whatever the agent said.
 */
export function mismatches(claims: Claim[], isIn: (field: string) => boolean, questionOf: (field: string) => string): Mismatch[] {
  const seen = new Set<string>();
  const out: Mismatch[] = [];
  for (const claim of claims) {
    if (claim.claim !== "put_in" || seen.has(claim.field) || isIn(claim.field)) continue;
    seen.add(claim.field);
    out.push({ field: claim.field, question: questionOf(claim.field), said: claim.quote });
  }
  return out;
}

/** What the agent is asked to do, at once, about the answers it said went in. */
export function correction(found: Mismatch[]): string {
  const which = found.map((m) => `"${m.question}"`).join(" and ");
  return `You told them ${which} went in, but it did not — nothing was put in. If they said it, call fill_fields now for ${found
    .map((m) => m.field)
    .join(", ")}, quoting their exact words. If they did not, say plainly that it is not in yet and ask for it. Do not apologise at length.`;
}

// ── The judge's prompt ────────────────────────────────────────────────────────────────────

export type CheckInput = {
  /** What the agent just said, whole. */
  said: string;
  /** What the person had just said, and the fields they were being asked about. */
  heard: string;
  asking: string[];
  /** The form's fields, as the agent knows them. */
  fields: { id: string; question: string }[];
};

/** JSON only: the account's model rejects a response format; the gateway repairs, code checks. */
export function checkPrompt(input: CheckInput): { system: string; user: string } {
  const system = [
    "You read one thing a voice assistant said while filling in a web form for a person, and list what it claimed about the form's fields. Answer with JSON only, no prose.",
    'Shape: {"claims":[{"field":"…","claim":"…","quote":"…"}]}',
    '- field: the id of a field the assistant spoke about, exactly as given.',
    '- claim: "put_in" when it said that answer is in, filled, done or got ("Got that in", "Your email\'s in"); "not_in" when it said it is not in or could not go in; "asked" when it asked for it.',
    'One reply can make two claims: "Got that in. Anything else?" says the answer is in (put_in, quoting "Got that in") and asks something (asked). List each, with the words that make it — never let a question at the end hide a "got that in" before it.',
    "- quote: the assistant's own words that make the claim, copied exactly.",
    "Only claims about specific fields. A \"got that in\" with no field named points at the fields in asking — what the person was answering. No claims: {\"claims\":[]}.",
  ].join("\n");
  return { system, user: JSON.stringify(input) };
}
