/**
 * A stand-in for the Voice Agent call, driven step by step by a test.
 *
 * The conductor is given `fake.start` in place of `startVoiceSession`. Everything the conductor
 * sends to the agent is recorded (`sent`), and the test plays the other side: the person speaking,
 * the agent calling a tool, the agent speaking, the line dropping. Nothing touches the network or
 * the microphone, so a whole conversation replays in milliseconds, in any page.
 */

import type { VoiceSession, VoiceSessionOptions } from "../../core/src/voice";

export type Sent =
  | { kind: "systemPrompt"; value: string }
  | { kind: "tools"; value: unknown[] }
  | { kind: "transcriptionMode"; value: string }
  | { kind: "stop" };

export class FakeVoice {
  options: VoiceSessionOptions | null = null;
  sent: Sent[] = [];
  /** The opening config the call was started with. */
  opening: { systemPrompt: string; greeting: string; tools: unknown[]; voice?: string } | null = null;

  start = async (options: VoiceSessionOptions): Promise<VoiceSession> => {
    this.options = options;
    this.opening = { systemPrompt: options.systemPrompt, greeting: options.greeting, tools: options.tools ?? [], voice: options.voice };
    // Ready on the next tick, as a real session is: after the caller has the handle.
    setTimeout(() => options.onReady?.("fake-session"), 0);
    return {
      stop: async () => {
        this.sent.push({ kind: "stop" });
      },
      setSystemPrompt: (value) => this.sent.push({ kind: "systemPrompt", value }),
      setTools: (value) => this.sent.push({ kind: "tools", value }),
      setTranscriptionMode: (value) => this.sent.push({ kind: "transcriptionMode", value }),
    };
  };

  private get o(): VoiceSessionOptions {
    if (!this.options) throw new Error("FakeVoice: the call has not started");
    return this.options;
  }

  /** The person finished a turn. */
  userSays(text: string): void {
    this.o.onSpeechStart?.();
    this.o.onUserPartial?.(text);
    this.o.onUserTranscript?.(text, null, [{ text, sample: 0 }]);
  }

  /** The person is mid-sentence: a running partial, not yet final. */
  partial(text: string): void {
    this.o.onUserPartial?.(text);
  }

  /** The agent calls a tool; resolves with what would go back to it. */
  async toolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.o.onToolCall) throw new Error("FakeVoice: no tool handler");
    const result = await this.o.onToolCall(name, args);
    this.o.onResultsSent?.();
    return result;
  }

  /** The agent said something. */
  agentSays(text: string): void {
    this.o.onAgentTranscript?.(text);
  }

  /** The latest system prompt the agent has — the opening one until something replaced it. */
  get prompt(): string {
    const last = [...this.sent].reverse().find((s) => s.kind === "systemPrompt");
    return last?.kind === "systemPrompt" ? last.value : (this.opening?.systemPrompt ?? "");
  }
}
