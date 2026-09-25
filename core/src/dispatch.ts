/**
 * When it is safe to hand a tool result back to the agent.
 *
 * ## Why this is a file and not four lines inside the socket
 *
 * It was four lines inside the socket, and those four lines deadlocked a live session.
 *
 * AssemblyAI's Client-side tools page is precise about the timing: *"Send `tool.result` when
 * `reply.done` is the latest event you've received. Not earlier (agent is still mid-transition-
 * phrase), not later (a new turn has started)."* Implemented literally — "only send if the last
 * event I saw was `reply.done`" — that reads as a rule about a moment, and the moment can pass
 * while the tool is still running:
 *
 * ```
 * tool.call             the agent asks; filling a dropdown takes ~600 ms
 * reply.started         "let me get that in for you"
 * reply.done            ← the only moment the literal rule allows. Queue is empty; nothing sent.
 * input.speech.started  the person says something
 * (tool returns)        ← too late. The rule says no, and nothing ever asks again.
 * ```
 *
 * The agent then waits for a result that was computed and thrown away. It never speaks again,
 * and the session dies silently — which is what it did, on camera, on the one field that failed.
 *
 * The second was quieter and worse. An interrupted reply used to throw the queue away, on the
 * reasoning that the agent had moved on. But `interrupt_response` is on, so *any noise in the
 * room* while the agent says "one moment, putting that in" counts as a barge-in — and an
 * interruption stops the agent TALKING without cancelling the tool call it is still holding a
 * `call_id` for. The answer was destroyed while the thing waiting for it kept waiting.
 *
 * ## The rule that came out of both
 *
 * **A tool result may be late. It may never be lost.**
 *
 * So this holds a result for the one reason the docs actually give — *the agent is mid-sentence*
 * — and for nothing else. `reply.started` opens that window, `reply.done` closes it whatever its
 * status, and every other event is a fine time to send. A reply whose `reply.done` never arrives
 * releases the queue after `MAX_HOLD_MS`.
 *
 * A result the agent no longer wants is ignored by it. A result it never receives hangs it.
 * Those are not close enough to trade.
 *
 * Pure, with time passed in, so every one of those orderings is a test rather than a thing we
 * hope about.
 */

export type QueuedResult = { call_id: string; result: unknown };

/**
 * The longest a finished result will sit waiting for a `reply.done` that may never come.
 *
 * Short enough that a person does not notice the pause, long enough to cover an ordinary
 * transition phrase ("one moment, putting that in") which runs well under two seconds.
 */
export const MAX_HOLD_MS = 2500;

/**
 * The agent's speaking state, and the results waiting on it.
 *
 * One instance per session. Feed it every event with `note`, add finished results with `add`,
 * and ask `due` what should go on the wire. `due` removes what it returns.
 */
export class ToolResultQueue {
  private waiting: QueuedResult[] = [];
  /** True between `reply.started` and `reply.done` — the one window we must not send in. */
  private speaking = false;
  /** When the oldest waiting result arrived, for the deadline. */
  private since: number | null = null;

  /**
   * Tell the queue what the agent just did.
   *
   * Only the two reply events change anything. Everything else — a transcript, a new turn, an
   * audio frame — is deliberately ignored, because reacting to those is what shut the window
   * before the tool could reach it.
   */
  note(type: string): void {
    if (type === "reply.started") {
      this.speaking = true;
      return;
    }

    // ⚠️ `reply.done` ends the speaking window whatever its status, INCLUDING `interrupted`.
    //
    // The old code threw the queue away on an interrupted reply, reasoning that the agent had
    // moved on and a stale answer would confuse it. That reasoning is wrong, and it is the
    // second deadlock this file exists because of.
    //
    // An interruption stops the agent TALKING. It does not cancel the tool call: the agent is
    // still holding that `call_id` and still waiting for it, and it will wait for ever. And the
    // trigger is the most ordinary thing in the world — `interrupt_response` is on, so any noise
    // in the room while the agent says "one moment, putting that in" barges in and, under the
    // old rule, destroyed the answer it was about to be given. On a live run, in a slightly
    // noisy room, that killed the session on the first field that needed a follow-up.
    //
    // A result the agent no longer wants is ignored by it. A result it never receives hangs it.
    // Those are not close enough to trade.
    if (type === "reply.done") this.speaking = false;
  }

  /** A tool has finished. `now` is only read to start the deadline. */
  add(item: QueuedResult, now: number): void {
    this.waiting.push(item);
    if (this.since === null) this.since = now;
  }

  /**
   * What should be sent right now, removed from the queue.
   *
   * Empty while the agent is mid-reply — unless it has been mid-reply for longer than a reply
   * can plausibly last, in which case the events we were waiting on are not coming.
   */
  due(now: number): QueuedResult[] {
    if (this.waiting.length === 0) return [];
    if (this.speaking && !this.overdue(now)) return [];

    const ready = this.waiting;
    this.waiting = [];
    this.since = null;
    return ready;
  }

  /** Has the oldest waiting result been held past the point of trusting the protocol? */
  overdue(now: number): boolean {
    return this.since !== null && now - this.since >= MAX_HOLD_MS;
  }

  /**
   * Throw away everything waiting, without sending it.
   *
   * Deliberately not called by `note`. The only safe time to use this is when the socket itself
   * is gone and there is nobody left to answer — see the note on `reply.done`.
   */
  clear(): void {
    this.waiting = [];
    this.since = null;
  }

  /** How many results are waiting. */
  get size(): number {
    return this.waiting.length;
  }

  /** Whether the agent is believed to be mid-reply. Exposed for tests and the on-screen log. */
  get isSpeaking(): boolean {
    return this.speaking;
  }
}

/**
 * How long a finished tool result may go without the reply it fires, before we stop waiting for it.
 * The docs: `tool.result` auto-fires the next reply — and a `reply.create` after it is not to be sent.
 */
export const REPLY_AFTER_RESULT_MS = 3000;

/** A request older than this is about a moment that has passed, and is dropped unsent. */
export const REPLY_REQUEST_TTL_MS = 20_000;

/**
 * When the agent may be asked to speak on our cue (`reply.create`) — the trust layer's correction.
 *
 * Never over its own reply (`reply.started` … `reply.done`), never while the person is speaking,
 * never while a tool call waits for its result, and never in the gap between a result going out and
 * the reply it fires: the docs say `tool.result` auto-fires the next reply and not to send
 * `reply.create` after it. One request at a time; a newer one replaces an older.
 *
 * Pure, with time passed in, like `ToolResultQueue`.
 */
export class ReplyRequestQueue {
  private speaking = false;
  private listening = false;
  private calls = new Set<string>();
  /** A tool result went out: its reply is coming. Since when. */
  private expecting: number | null = null;
  private pending: { instructions: string; at: number } | null = null;

  /** Tell it what happened: every incoming event, and our own `tool.result` sends. */
  note(type: string, now: number, callId?: string): void {
    if (type === "reply.started") {
      this.speaking = true;
      this.expecting = null;
    } else if (type === "reply.done") {
      this.speaking = false;
    } else if (type === "input.speech.started") {
      this.listening = true;
    } else if (type === "transcript.user") {
      this.listening = false;
    } else if (type === "tool.call" && callId) {
      this.calls.add(callId);
    } else if (type === "tool.result" && callId) {
      this.calls.delete(callId);
      this.expecting = now;
    }
  }

  add(instructions: string, now: number): void {
    this.pending = { instructions, at: now };
  }

  /** The instructions to send now, removed — or null while it is not the moment. */
  due(now: number): string | null {
    if (!this.pending) return null;
    if (now - this.pending.at > REPLY_REQUEST_TTL_MS) {
      this.pending = null;
      return null;
    }
    if (this.expecting !== null && now - this.expecting > REPLY_AFTER_RESULT_MS) this.expecting = null;
    if (this.speaking || this.listening || this.calls.size > 0 || this.expecting !== null) return null;
    const { instructions } = this.pending;
    this.pending = null;
    return instructions;
  }

  get waiting(): boolean {
    return this.pending !== null;
  }
}
