/**
 * One Voice Agent call in the browser: mic in, agent voice out, events in between — and a line
 * that survives dropping.
 *
 * Everything here traces to
 * https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
 * and the gotcha list in `docs/assemblyai/AI-SYSTEM-PROMPT.md`. Nothing is from memory.
 *
 * Lives in `core/` rather than `web/` because the extension needs exactly the same call from
 * inside somebody else's page. So nothing here assumes where it runs: the token and the audio
 * worklet are passed in, not fetched from our own paths.
 */

import { levelOf, LocalSpeech } from "./barge";
import { ReplyRequestQueue, ToolResultQueue } from "./dispatch";
import { nextReconnect, RESUME_REFUSED, type Drop } from "./reconnect";
import type { TimelinePoint } from "./clip";

const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const TARGET_SAMPLE_RATE = 24000;

/** The API wants ~50 ms per `input.audio` frame. A raw worklet quantum is ~2.7 ms, so we batch. */
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE / 20; // 1200 samples = 50 ms

/**
 * How patient the agent is before deciding a turn is over — the one knob AssemblyAI says to reach
 * for (docs: voice-agent-api/turn-detection-and-interruptions, "Transcription mode").
 *
 * We used to set the raw VAD thresholds instead (3.5 s of silence, a 0.5 threshold) and switch
 * them mid-call. The docs call those a last resort, and say to leave turn detection on its
 * default: semantic end-of-turn, and semantic barge-in — "wait, stop" interrupts, "uh-huh" does
 * not. Overriding it is why stopping the agent mid-sentence did not work well: live, a person
 * could not cut in to say something.
 */
export type TranscriptionMode = "min_latency" | "balanced" | "max_accuracy";

/**
 * While the person gives their one long take: the most patient mode. A person recalling their
 * last employer pauses longer than a person chatting, and "waits longest to confirm the end of a
 * turn" is exactly that.
 */
export const LONG_TAKE_MODE: TranscriptionMode = "max_accuracy";

/** Once the questions are short: the default middle ground, so answers come back quickly. */
export const CONVERSATION_MODE: TranscriptionMode = "balanced";


/**
 * Hinglish is the demo, so we steer speech-to-text toward English and Hindi.
 *
 * Universal-3.5 Pro code-switches across 18 languages on its own, but leaving this unset cost
 * us a real answer: "mera naam Rohit Kashyap hai" was recognised correctly in the partials and
 * then rewritten to "I'm, uh, now I'm going to shop here" in the final. Naming the languages
 * steers it instead of letting it guess.
 */
export const HINGLISH_LANGUAGES = ["en", "hi"];

export type AgentMessage = {
  type: string;
  [key: string]: unknown;
};

// ═══════════════════════════════════════════════════════════════════════════════════════
// Why a call could not start, in words a person can act on
// ═══════════════════════════════════════════════════════════════════════════════════════

export type StartProblem = "mic-denied" | "no-mic" | "mic-busy" | "insecure" | "unsupported" | "token" | "other";

/**
 * A call that could not start, with what kind of problem it was.
 *
 * `getUserMedia` fails in four very different ways that all used to surface as the same raw
 * "NotAllowedError: Permission denied" in red. Each has a different fix — allow the microphone,
 * plug one in, close the app holding it, open the page over https — and a person can only take
 * it if they are told which.
 */
export class VoiceStartError extends Error {
  constructor(
    readonly problem: StartProblem,
    message: string,
  ) {
    super(message);
    this.name = "VoiceStartError";
  }
}

const PROBLEM_WORDS: Record<StartProblem, string> = {
  "mic-denied":
    "The microphone is blocked for this page. Click the icon at the left of the address bar, allow the microphone, and try again.",
  "no-mic": "No microphone was found. Plug one in or turn it on, then try again.",
  "mic-busy": "Another app is using the microphone. Close it (a call, a recorder), then try again.",
  insecure: "The microphone only works on a secure page. Open this page over https.",
  unsupported: "This browser cannot record audio here. Try a recent Chrome, Edge, Firefox or Safari.",
  token: "Could not start a voice session.",
  other: "The microphone could not be started.",
};

/**
 * Turn whatever `getUserMedia` / `AudioContext` threw into a problem a person can fix.
 *
 * `secure` is false only when the page is known to be plain http — browsers hide `mediaDevices`
 * there, which is checked before anything is opened. It is not read off `isSecureContext` here:
 * that is false on plenty of pages that record fine, and it turned every failure into "use https".
 */
export function explainMicFailure(cause: unknown, secure = true): VoiceStartError {
  if (cause instanceof VoiceStartError) return cause;
  const name = (cause as { name?: string } | null)?.name ?? "";
  const problem: StartProblem = !secure
    ? "insecure"
    : name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
      ? "mic-denied"
      : name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError"
        ? "no-mic"
        : name === "NotReadableError" || name === "TrackStartError" || name === "AbortError"
          ? "mic-busy"
          : "other";
  const detail = problem === "other" && cause instanceof Error ? ` (${cause.message})` : "";
  return new VoiceStartError(problem, `${PROBLEM_WORDS[problem]}${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════

/** What a brand-new session needs — asked for at the moment it is needed, so it is current. */
export type FreshConfig = { systemPrompt: string; greeting: string; tools: unknown[] };

export type VoiceSessionOptions = {
  systemPrompt: string;
  greeting: string;
  voice?: string;
  /** How patient to be before a turn ends. Defaults to the long-take mode. */
  transcriptionMode?: TranscriptionMode;
  /** Languages to steer transcription toward. Omit for automatic detection across all 18. */
  languageCodes?: string[];
  /** Tools the agent may call, built at runtime by `binder.ts` from the form on screen. */
  tools?: unknown[];
  /**
   * A fresh single-use token, every time one is needed — the first connect and every reconnect.
   * The web page fetches its own `/api/voice-token`; the extension asks the deployed site.
   */
  getToken: () => Promise<string>;
  /** Where the PCM worklet is served: `/pcm-processor.js` on the site, an extension URL elsewhere. */
  workletUrl: string;
  /** The Voice Agent endpoint. Only ever changed to point a test at a fake server. */
  wsUrl?: string;
  /**
   * The line dropped and could not be resumed, so a new session is starting: what it should be
   * told. Called at that moment, so the prompt carries the form as it is now and the greeting says
   * where things stand. Without it, a drop that cannot be resumed ends the call.
   */
  freshStart?: () => FreshConfig;
  /**
   * Runs a tool the agent asked for, and returns whatever should go back to it.
   *
   * Returning an object is enough — it is stringified before it is sent, as the API requires.
   * Throwing is also fine: the message becomes an `error` the agent reads verbatim.
   */
  onToolCall?: (name: string, args: Record<string, unknown>, callId?: string) => Promise<unknown>;
  /** Every frame in both directions, for the on-screen log. */
  onEvent?: (direction: "in" | "out", message: AgentMessage) => void;
  onReady?: (sessionId: string) => void;
  /** The full running text of the turn so far, not an increment. Replace, do not append. */
  onUserPartial?: (runningText: string) => void;
  /** A finished turn: the words, its PCM16 24 kHz audio (or null), and when each word arrived. */
  onUserTranscript?: (text: string, audio: Int16Array | null, timeline: TimelinePoint[]) => void;
  /** What the agent said, whole, with the reply it belongs to and whether it was cut off. */
  onAgentTranscript?: (text: string, reply?: { id: string; interrupted: boolean }) => void;
  /** Every reply's start and end — the trust layer's clock. */
  onReply?: (event: { type: "started" | "done"; id: string; status?: string }) => void;
  /** A tool call arrived, before its handler runs. */
  onToolCallStarted?: (callId: string, name: string) => void;
  /** Fired the moment the person starts speaking a turn. */
  onSpeechStart?: () => void;
  /**
   * The person started (true) or stopped (false) talking, as heard here from the microphone's level
   * — before the server says anything (barge.ts). Over the agent, its voice is lowered at once.
   */
  onLocalSpeech?: (speaking: boolean) => void;
  onError?: (message: string) => void;
  onClosed?: () => void;
  /** The line dropped; trying again. The microphone stays open and what is said meanwhile is kept. */
  onReconnecting?: (attempt: number) => void;
  /** Back: the same conversation (`resumed`), or a new one briefed from the form (`fresh`). */
  onReconnected?: (how: "resumed" | "fresh") => void;
  /** Tool results have just gone out — the moment to update the agent's prompt. */
  onResultsSent?: () => void;
};

export type VoiceSession = {
  /** Sends `session.end` first so we don't pay for the 30-second resume grace window. */
  stop: () => Promise<void>;
  /** Switch how patient the agent is, mid-call (`input.transcription_mode` is mutable). */
  setTranscriptionMode: (mode: TranscriptionMode) => void;
  /** Replace the tool list — `session.tools` replaces, it does not merge. */
  setTools: (tools: unknown[]) => void;
  /** Replace the system prompt mid-call. */
  setSystemPrompt: (prompt: string) => void;
  /**
   * Ask the agent to speak now, with one-shot instructions (`reply.create`) — sent only when it is
   * not mid-reply, the person is not mid-sentence, and no tool result is out or owed (dispatch.ts).
   */
  createReply: (instructions: string) => void;
};

/**
 * How long the tool handler gets before we answer on its behalf.
 *
 * Writing twenty fields, dropdowns included, runs to about two seconds. Twelve is far outside
 * anything legitimate and far inside the API's own 60-second tool timeout.
 */
const TOOL_DEADLINE_MS = 12000;

/**
 * An await that never settles produces no result to queue, no error to catch, and no event to
 * recover on. So the handler races a clock, and one that misses it gets answered without it.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | { error: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        resolve({
          error:
            "Filling the form took too long and was abandoned. Tell the person that one did not go in and ask them to type it themselves.",
        }),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function toBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const CHUNK = 0x8000; // stay well under the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function startVoiceSession(options: VoiceSessionOptions): Promise<VoiceSession> {
  const {
    voice = "alba",
    languageCodes = HINGLISH_LANGUAGES,
    getToken,
    workletUrl,
    wsUrl = WS_URL,
    freshStart,
    onEvent,
    onReady,
    onUserPartial,
    onUserTranscript,
    onAgentTranscript,
    onReply,
    onToolCallStarted,
    onSpeechStart,
    onLocalSpeech,
    onError,
    onClosed,
    onReconnecting,
    onReconnected,
    onResultsSent,
    onToolCall,
  } = options;
  let transcriptionMode = options.transcriptionMode ?? LONG_TAKE_MODE;

  // No `mediaDevices` at all: either a page served over plain http (browsers hide it there) or a
  // browser that cannot record. Said before anything is opened.
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const secure = typeof isSecureContext === "undefined" || isSecureContext;
    throw secure ? new VoiceStartError("unsupported", PROBLEM_WORDS.unsupported) : explainMicFailure(null, false);
  }

  // 1 — Audio and token, started together rather than one after the other.
  //
  // The audio side is kicked off FIRST and without awaiting anything before it, because Safari
  // only grants `AudioContext.resume()` and `getUserMedia()` inside the user gesture that led
  // to them. An `await` on the network first would throw that gesture away.
  const audioReady = (async () => {
    let audioCtx: AudioContext | null = null;
    try {
      // The context keeps the device rate and the worklet resamples, so Firefox keeps its echo
      // canceller and Safari does not silently run at the wrong rate.
      audioCtx = new AudioContext();
      await audioCtx.resume();
      await audioCtx.audioWorklet.addModule(workletUrl);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, // stops the agent interrupting itself
          noiseSuppression: false, // server-side Voice Focus already does this; stacking hurts ASR
          autoGainControl: true,
        },
      });

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
        processorOptions: { inputSampleRate: audioCtx.sampleRate, targetSampleRate: TARGET_SAMPLE_RATE },
      });
      source.connect(worklet).connect(audioCtx.destination);
      return { audioCtx, stream, source, worklet };
    } catch (cause) {
      void audioCtx?.close();
      throw explainMicFailure(cause);
    }
  })();

  const firstToken = getToken().catch((cause) => {
    throw new VoiceStartError("token", `${PROBLEM_WORDS.token} ${cause instanceof Error ? cause.message : String(cause)}`);
  });

  const [audio, token] = await Promise.all([
    audioReady,
    // If the token fails we still have to release the microphone, or the browser keeps showing
    // a recording indicator for a session that never happened.
    firstToken.catch(async (cause) => {
      const held = await audioReady.catch(() => null);
      if (held) {
        for (const track of held.stream.getTracks()) track.stop();
        void held.audioCtx.close();
      }
      throw cause;
    }),
  ]).catch(async (cause) => {
    // And a failed microphone leaves nothing to release, but the token's promise must not dangle.
    firstToken.catch(() => undefined);
    throw cause;
  });
  const { audioCtx, stream, source, worklet } = audio;

  // 2 — Playback queue, with the flush that makes barge-in feel instant.
  let nextStartTime = 0;
  const liveSources = new Set<AudioBufferSourceNode>();
  /** Everything the agent says goes through this, so its voice can be lowered when they speak over it. */
  const outputGain = audioCtx.createGain();
  outputGain.connect(audioCtx.destination);
  /** When the agent last became audible — the echo canceller's settling time is counted from here. */
  let playingSince = 0;
  /** When its audio last ran out. A gap shorter than a moment is the network, not a new reply. */
  let quietSince = -Infinity;

  function playReplyAudio(base64: string) {
    const raw = atob(base64);
    const pcm16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm16.length; i++) {
      pcm16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }
    const buffer = audioCtx.createBuffer(1, pcm16.length, TARGET_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i]! / 32768;

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outputGain);
    const startAt = Math.max(audioCtx.currentTime, nextStartTime);
    src.start(startAt);
    src.onended = () => {
      liveSources.delete(src);
      if (liveSources.size === 0) quietSince = performance.now();
    };
    const now = performance.now();
    if (liveSources.size === 0 && now - quietSince > 500) {
      // A new stretch of the agent's voice — starting at full voice unless they are still talking.
      playingSince = now;
      if (!localSpeech.isSpeaking) fullVoice();
    }
    liveSources.add(src);
    nextStartTime = startAt + buffer.duration;
  }

  function flushPlayback() {
    for (const src of liveSources) {
      try {
        src.onended = null;
        src.stop(0);
        src.disconnect();
      } catch {
        // already finished
      }
    }
    liveSources.clear();
    nextStartTime = audioCtx.currentTime;
    fullVoice();
  }

  // 2b — Hearing them over the agent. The server's barge-in is semantic: it waits to understand
  // what they said before it stops the agent — 1.5 s for "wait, stop", over 3 s for "uh, my gender
  // is…" (RESEARCH.md §9i) — and until then it talks on at full voice, as if it had not heard. So
  // the moment the microphone hears them over it, its voice drops; the server still decides whether
  // that was an interruption (flushPlayback) or an "mm-hm" (the voice comes back when they stop).
  const DUCKED = 0.15;
  const LEVEL_FRAME = TARGET_SAMPLE_RATE / 50; // 20 ms
  const localSpeech = new LocalSpeech();
  const levelBlock = new Int16Array(LEVEL_FRAME);
  let levelFill = 0;
  let ducked = false;

  function lowerVoice() {
    if (ducked) return;
    ducked = true;
    const t = audioCtx.currentTime;
    outputGain.gain.cancelScheduledValues(t);
    outputGain.gain.setTargetAtTime(DUCKED, t, 0.03);
  }

  function fullVoice(slowly = false) {
    if (!ducked) return;
    ducked = false;
    const t = audioCtx.currentTime;
    outputGain.gain.cancelScheduledValues(t);
    if (slowly) outputGain.gain.setTargetAtTime(1, t, 0.15);
    else outputGain.gain.setValueAtTime(1, t);
  }

  function listenForThem(incoming: Int16Array) {
    let at = 0;
    while (at < incoming.length) {
      const take = Math.min(LEVEL_FRAME - levelFill, incoming.length - at);
      levelBlock.set(incoming.subarray(at, at + take), levelFill);
      levelFill += take;
      at += take;
      if (levelFill < LEVEL_FRAME) continue;
      levelFill = 0;
      const now = performance.now();
      const agentFor = liveSources.size > 0 ? now - playingSince : -1;
      const change = localSpeech.frame(levelOf(levelBlock), now, agentFor);
      if (change === "start") {
        const over = liveSources.size > 0;
        if (over) lowerVoice();
        onEvent?.("in", { type: "longtake.heard_them", over_the_agent: over });
        onLocalSpeech?.(true);
      } else if (change === "end") {
        fullVoice(true);
        onEvent?.("in", { type: "longtake.they_stopped" });
        onLocalSpeech?.(false);
      }
    }
  }

  // 3 — The socket, which may be replaced: `ws` is whichever connection is current.
  let ws: WebSocket | null = null;
  let ready = false;
  let closing = false;
  /** From the last `session.ready`, for `session.resume`. Null once the server says it is gone. */
  let sessionId: string | null = null;
  /** The server ended the session itself (`session.ended`): it cannot be resumed. */
  let ended = false;
  /** Set while reconnecting: when the line went, and how many tries since. */
  let drop: Drop | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** How the connection being opened now should start, for `onReconnected`. */
  let opening: "first" | "resumed" | "fresh" = "first";

  const send = (message: AgentMessage) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
    // Audio frames are far too noisy to log every one.
    if (message.type !== "input.audio") onEvent?.("out", message);
  };

  // Batch worklet output up to ~50 ms before sending.
  let pending = new Int16Array(0);

  function enqueue(samples: Int16Array) {
    const merged = new Int16Array(pending.length + samples.length);
    merged.set(pending, 0);
    merged.set(samples, pending.length);
    pending = merged;

    while (pending.length >= SAMPLES_PER_CHUNK) {
      const chunk = pending.slice(0, SAMPLES_PER_CHUNK);
      pending = pending.slice(SAMPLES_PER_CHUNK);
      send({ type: "input.audio", audio: toBase64(chunk) });
    }
  }

  /**
   * Audio recorded while there is no session to take it — before the first `session.ready`, and
   * while the line is down — is held, not dropped, and replayed the moment a session opens.
   *
   * Longtake's whole promise is "press the key and just talk", and a person who does exactly that
   * loses their opening words to the connect delay. The same goes for a drop mid-sentence: the
   * microphone never stops, so neither do they.
   */
  const PREBUFFER_MAX_SAMPLES = TARGET_SAMPLE_RATE * 20; // 20 s ceiling, so a stalled connect cannot grow forever
  let prebuffer: Int16Array[] = [];
  let prebufferedSamples = 0;

  function flushPrebuffer() {
    if (prebuffer.length === 0) return 0;
    const held = prebuffer;
    const heldSamples = prebufferedSamples;
    prebuffer = [];
    prebufferedSamples = 0;
    for (const block of held) enqueue(block);
    return heldSamples;
  }

  /**
   * The audio of each turn, kept as well as sent — the Dictation pass re-shapes a long answer from
   * its own audio. Capped, because a 120-second ceiling applies at the other end.
   */
  const MAX_TURN_SAMPLES = TARGET_SAMPLE_RATE * 110;
  let turnAudio: Int16Array[] = [];
  let turnSamples = 0;
  /** Each running transcript of this turn, with how much audio had been captured when it arrived. */
  let timeline: TimelinePoint[] = [];

  const resetTurnAudio = () => {
    turnAudio = [];
    turnSamples = 0;
    timeline = [];
  };

  const takeTurnAudio = (): Int16Array | null => {
    if (turnSamples === 0) return null;
    const joined = new Int16Array(turnSamples);
    let at = 0;
    for (const block of turnAudio) {
      joined.set(block, at);
      at += block.length;
    }
    return joined;
  };

  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    const incoming = new Int16Array(event.data);
    listenForThem(incoming);

    if (turnSamples < MAX_TURN_SAMPLES) {
      turnAudio.push(incoming);
      turnSamples += incoming.length;
    }

    if (!ready) {
      prebuffer.push(incoming);
      prebufferedSamples += incoming.length;
      while (prebufferedSamples > PREBUFFER_MAX_SAMPLES && prebuffer.length > 1) {
        prebufferedSamples -= prebuffer.shift()!.length;
      }
      return;
    }

    enqueue(incoming);
  };

  /**
   * Tool results are held until the agent has finished its current reply — see
   * `core/src/dispatch.ts`. A result may be late; it may never be lost. A result for a session
   * that could not be resumed has nobody left to read it, so a fresh session starts a fresh queue.
   */
  let results = new ToolResultQueue();
  /** Replies we ask for (`reply.create`), held for a moment the agent is free — see dispatch.ts. */
  const replies = new ReplyRequestQueue();

  const flushReplies = () => {
    if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    const instructions = replies.due(Date.now());
    if (instructions !== null) send({ type: "reply.create", instructions });
  };

  const flushResults = () => {
    // Checked before draining: `due` removes what it returns, and a closed socket would lose it.
    if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;

    const due = results.due(Date.now());
    for (const held of due) {
      send({ type: "tool.result", call_id: held.call_id, result: JSON.stringify(held.result) });
      replies.note("tool.result", Date.now(), held.call_id);
    }
    if (due.length > 0) onResultsSent?.();
    flushReplies();
  };

  /** A heartbeat, because a deadlock has no event to recover on. One for the whole call. */
  const heartbeat = setInterval(flushResults, 500);

  const runTool = async (message: AgentMessage) => {
    const callId = String(message.call_id ?? "");
    const name = String(message.name ?? "");
    const args = (message.arguments ?? {}) as Record<string, unknown>;

    let result: unknown;
    try {
      result = onToolCall
        ? await withDeadline(onToolCall(name, args, callId), TOOL_DEADLINE_MS)
        : { error: `No handler for "${name}" in this client.` };
    } catch (cause) {
      result = { error: cause instanceof Error ? cause.message : String(cause) };
    }

    results.add({ call_id: callId, result }, Date.now());
    flushResults();
  };

  const sessionConfig = (config: FreshConfig) => ({
    system_prompt: config.systemPrompt,
    greeting: config.greeting,
    input: {
      format: { encoding: "audio/pcm" },
      // No `turn_detection`: its defaults are the semantic end-of-turn and barge-in.
      transcription_mode: transcriptionMode,
      ...(languageCodes.length > 0 ? { language_codes: languageCodes } : {}),
    },
    output: { voice, format: { encoding: "audio/pcm" }, volume: 100 },
    ...(config.tools.length > 0 ? { tools: config.tools } : {}),
  });

  const onMessage = (event: MessageEvent) => {
    const message: AgentMessage = JSON.parse(String(event.data));
    if (message.type !== "reply.audio") onEvent?.("in", message);

    // Every frame, before the switch: any frame is a chance to send a held result.
    results.note(message.type);
    replies.note(message.type, Date.now(), typeof message.call_id === "string" ? message.call_id : undefined);
    if (message.type === "reply.started") onReply?.({ type: "started", id: String(message.reply_id ?? "") });
    if (message.type === "reply.done") onReply?.({ type: "done", id: String(message.reply_id ?? ""), status: String(message.status ?? "") });

    switch (message.type) {
      case "session.ready": {
        ready = true; // set before flushing, or the held audio has nowhere to go
        sessionId = String(message.session_id ?? "") || sessionId;
        ended = false;
        const how = opening;
        drop = null;

        // Whatever the agent was saying when the line went is not carrying on. A result held back
        // for the end of that reply would otherwise wait out the queue's whole deadline.
        if (how !== "first") results.note("reply.done");

        if (how === "resumed" && freshStart) {
          // The same conversation — but the form may have moved while the line was down, and
          // anything sent to a dead socket went nowhere. Catch the agent up.
          const now = freshStart();
          send({ type: "session.update", session: { system_prompt: now.systemPrompt, tools: now.tools } });
        }

        const heldSamples = flushPrebuffer();
        if (heldSamples > 0) {
          onEvent?.("out", {
            type: "longtake.prebuffer.flushed",
            seconds: Number((heldSamples / TARGET_SAMPLE_RATE).toFixed(2)),
          });
        }
        flushResults();
        if (how === "first") onReady?.(sessionId ?? "");
        else onReconnected?.(how);
        break;
      }
      case "reply.audio":
        playReplyAudio(String(message.data));
        break;
      case "tool.call":
        onToolCallStarted?.(String(message.call_id ?? ""), String(message.name ?? ""));
        void runTool(message);
        break;
      case "input.speech.started":
        onSpeechStart?.();
        // Flushing here rather than waiting for `reply.done` makes barge-in ~300 ms snappier.
        flushPlayback();
        flushResults();
        break;
      case "reply.done":
        if (message.status === "interrupted") flushPlayback();
        flushResults();
        break;
      case "transcript.user.delta": {
        // ⚠️ On the wire this carries the full running text in `text`, and `delta` is absent —
        // verified against a live session on 20 Sep 2026, whatever the docs example shows.
        const running = String(message.text ?? message.delta ?? "");
        timeline.push({ text: running, sample: turnSamples });
        onUserPartial?.(running);
        break;
      }
      case "transcript.user": {
        const turn = takeTurnAudio();
        const heard = timeline;
        resetTurnAudio();
        onUserTranscript?.(String(message.text ?? ""), turn, heard);
        break;
      }
      case "transcript.agent":
        onAgentTranscript?.(String(message.text ?? ""), { id: String(message.reply_id ?? ""), interrupted: message.interrupted === true });
        break;
      case "session.ended":
        // A clean end from the server — its maximum duration, or our own `session.end`.
        ended = true;
        break;
      case "session.error":
      case "error": {
        const code = String(message.code ?? "");
        if (drop && RESUME_REFUSED.has(code)) {
          // The session is gone. Not an error for the person: the next try starts a new one.
          sessionId = null;
          break;
        }
        onError?.(String(message.message ?? JSON.stringify(message)));
        break;
      }
    }
  };

  /** Open a connection: the first one, a resume of the same session, or a brand-new one. */
  const connect = async (how: "first" | "resumed" | "fresh", firstToken?: string) => {
    const socketToken = firstToken ?? (await getToken());
    if (closing) return;
    opening = how;

    const url = new URL(wsUrl);
    url.searchParams.set("token", socketToken);
    const socket = new WebSocket(url);
    ws = socket;

    socket.addEventListener("open", () => {
      if (how === "resumed" && sessionId) {
        send({ type: "session.resume", session_id: sessionId });
        return;
      }
      if (how === "fresh") results = new ToolResultQueue();
      const config: FreshConfig =
        how === "fresh" && freshStart
          ? freshStart()
          : { systemPrompt: options.systemPrompt, greeting: options.greeting, tools: options.tools ?? [] };
      send({ type: "session.update", session: sessionConfig(config) });
    });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", () => {
      // The close that always follows decides what to do; a first connect that never opened is
      // the only case worth saying anything about here.
      if (!closing && how === "first" && !sessionId) onError?.("Could not connect to the voice service. Check the network and try again.");
    });
    socket.addEventListener("close", (event) => {
      if (socket !== ws) return; // an older connection closing late
      ready = false;
      flushPlayback();
      if (closing) {
        onClosed?.();
        return;
      }
      // Never worked at all: a bad token or a refused handshake. Retrying would fail the same way.
      if (how === "first" && !sessionId) {
        if (event.code === 1008) onError?.("Unauthorized (close 1008). The token was bad or already used.");
        onClosed?.();
        return;
      }
      lineDropped();
    });
  };

  /** The line went without us asking. Try to get it back; the microphone keeps listening. */
  const lineDropped = () => {
    if (!freshStart && (ended || !sessionId)) {
      onClosed?.();
      return;
    }
    drop = drop ?? { sessionId, droppedAt: Date.now(), attempts: 0, ended };
    drop.sessionId = sessionId;
    drop.ended = ended;

    const step = nextReconnect(drop, Date.now());
    if (step.action === "give-up" || (step.action === "fresh" && !freshStart)) {
      onError?.(step.action === "give-up" ? step.reason : "The connection dropped and the session could not be resumed.");
      closing = true;
      teardown();
      onClosed?.();
      return;
    }

    drop.attempts += 1;
    onReconnecting?.(drop.attempts);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect(step.action === "resume" ? "resumed" : "fresh").catch(() => lineDropped());
    }, step.delayMs);
  };

  const teardown = () => {
    clearInterval(heartbeat);
    clearTimeout(reconnectTimer);
    flushPlayback();
    worklet.port.onmessage = null;
    try {
      worklet.disconnect();
      source.disconnect();
    } catch {
      // already torn down
    }
    for (const track of stream.getTracks()) track.stop();
    void audioCtx.close();
  };

  await connect("first", token);

  return {
    setTranscriptionMode: (next: TranscriptionMode) => {
      transcriptionMode = next; // remembered, so a new session after a drop keeps the same pace
      send({ type: "session.update", session: { input: { transcription_mode: next } } });
    },
    setTools: (next: unknown[]) => {
      send({ type: "session.update", session: { tools: next } });
    },
    setSystemPrompt: (prompt: string) => {
      send({ type: "session.update", session: { system_prompt: prompt } });
    },
    createReply: (instructions: string) => {
      replies.add(instructions, Date.now());
      flushReplies();
    },
    stop: async () => {
      closing = true;
      clearTimeout(reconnectTimer);
      const socket = ws;
      if (socket && socket.readyState === WebSocket.OPEN) {
        // Ends the session cleanly instead of leaving a billable 30-second resume window open.
        send({ type: "session.end" });
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          socket.addEventListener("close", done, { once: true });
          setTimeout(done, 1000);
        });
      }
      try {
        socket?.close();
      } catch {
        // already closed
      }
      teardown();
    },
  };
}
