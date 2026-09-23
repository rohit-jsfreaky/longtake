/**
 * The voice call, as this site runs it.
 *
 * The call itself lives in `core/src/voice.ts`, because the extension runs the same one from
 * inside other people's pages. What is particular to the site is only where its two resources
 * are: the token route and the audio worklet, both served from here.
 */

import {
  startVoiceSession as startCall,
  type VoiceSession,
  type VoiceSessionOptions,
} from "@longtake/core";

export {
  CONVERSATION_MODE,
  HINGLISH_LANGUAGES,
  LONG_TAKE_MODE,
  VoiceStartError,
  type AgentMessage,
  type TranscriptionMode,
  type VoiceSession,
} from "@longtake/core";

/** A single-use token from our own route. Fetched fresh for every connect, reconnects included. */
export async function siteToken(): Promise<string> {
  const response = await fetch("/api/voice-token", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Token request failed (${response.status})`);
  return body.token as string;
}

export function startVoiceSession(
  options: Omit<VoiceSessionOptions, "getToken" | "workletUrl"> & Partial<Pick<VoiceSessionOptions, "getToken" | "workletUrl">>,
): Promise<VoiceSession> {
  return startCall({ getToken: siteToken, workletUrl: "/pcm-processor.js", ...options });
}
