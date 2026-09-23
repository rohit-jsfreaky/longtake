/**
 * What to do when the line drops mid-form.
 *
 * ## Why
 *
 * A call that dies halfway through a form used to be the end of the form: the page went quiet,
 * the status said idle, and the person had to press the button and start again. A Wi-Fi hiccup,
 * a laptop lid, or a token that ran out after fifteen minutes cost everything they had said.
 *
 * The Voice Agent API keeps a dropped session for 30 seconds. Reconnecting with a new token and
 * `session.resume` carries on the same conversation, context and all
 * (docs: voice-agent-api/events-reference#session-resume). After that — or when the server ended
 * the session itself — a new session starts, and since the form's state never lived in the
 * conversation (it is read off the page), nothing the person said is lost either way: the new
 * agent is handed FORM NOW and picks up at the next question.
 *
 * Pure: decides, does not connect. `voice.ts` does the connecting.
 */

export type Drop = {
  /** From the last `session.ready`; null once the server says it is gone. */
  sessionId: string | null;
  /** When the line first dropped, for the 30-second window. */
  droppedAt: number;
  /** Reconnects tried since the line last worked. */
  attempts: number;
  /** The server sent `session.ended` — a clean end, which cannot be resumed. */
  ended: boolean;
};

export type ReconnectStep =
  | { action: "resume"; delayMs: number }
  | { action: "fresh"; delayMs: number }
  | { action: "give-up"; reason: string };

/** The server keeps a dropped session for 30 s; we stop trying to resume a little before that. */
export const RESUME_WINDOW_MS = 25_000;

/** Back-off between tries. Its length is the number of tries. */
export const RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 8000];

export function nextReconnect(drop: Drop, now: number): ReconnectStep {
  if (drop.attempts >= RECONNECT_DELAYS_MS.length) {
    return { action: "give-up", reason: `Lost the connection and could not get it back after ${drop.attempts} tries.` };
  }
  const delayMs = RECONNECT_DELAYS_MS[drop.attempts]!;
  const resumable = drop.sessionId !== null && !drop.ended && now + delayMs - drop.droppedAt < RESUME_WINDOW_MS;
  return { action: resumable ? "resume" : "fresh", delayMs };
}

/** The `session.error` codes that mean a resume will never work and a fresh session is needed. */
export const RESUME_REFUSED = new Set(["session_not_found", "session_forbidden", "session_expired"]);
