/**
 * One Voice Agent call in the browser: mic in, agent voice out, events in between.
 *
 * Everything here traces to
 * https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
 * and the gotcha list in `docs/assemblyai/AI-SYSTEM-PROMPT.md`. Nothing is from memory.
 *
 * Phase 0 uses this for the "say hello, get a transcript" test. Phase 2 adds `tools` to the
 * session config and a `tool.call` handler — the shape below already leaves room for both.
 */

import { ToolResultQueue, type TimelinePoint } from "@longtake/core";

const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const TARGET_SAMPLE_RATE = 24000;

/** The API wants ~50 ms per `input.audio` frame. A raw worklet quantum is ~2.7 ms, so we batch. */
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE / 20; // 1200 samples = 50 ms

export type TurnDetection = {
  vad_threshold: number;
  min_silence: number;
  max_silence: number;
  interrupt_response: boolean;
};

/**
 * Longtake is dictation, not chit-chat: one long breath with real pauses inside it.
 * AssemblyAI's guidance is 1800–2200 ms for this kind of speech, against a 1400 ms
 * conversational baseline.
 *
 * We run higher than their range, and it is measured rather than guessed. In the first live
 * test a single sentence — English, then a ~3.0 s pause, then Hindi — was split into two turns
 * at 2000 ms, and the agent began replying while the speaker was still mid-thought. A person
 * recalling their own address or last employer pauses for longer than a person chatting.
 *
 * ⚠️ This is still one number doing two jobs. The real answer is two modes, switched at
 * runtime: a long-form mode while the person gives their one take, and a conversational mode
 * for the ask-back afterwards. `input.turn_detection` is mutable, so `session.update` can flip
 * between them mid-call. That lands in Phase 2/4.
 */
export const LONG_TAKE_TURN_DETECTION: TurnDetection = {
  vad_threshold: 0.5,
  min_silence: 3500,
  max_silence: 6000,
  interrupt_response: true,
};

/**
 * Hinglish is the demo, so we steer speech-to-text toward English and Hindi.
 *
 * Universal-3.5 Pro code-switches across 18 languages on its own, but leaving this unset cost
 * us a real answer: "mera naam Rohit Kashyap hai" was recognised correctly in the partials and
 * then rewritten to "I'm, uh, now I'm going to shop here" in the final. Naming the languages
 * steers it instead of letting it guess.
 *
 * ⚠️ Applied when the speech-to-text connection opens. Changing it mid-session takes effect on
 * the next reconnect, not the current turn.
 */
export const HINGLISH_LANGUAGES = ["en", "hi"];

export type AgentMessage = {
  type: string;
  [key: string]: unknown;
};

export type VoiceSessionOptions = {
  systemPrompt: string;
  greeting: string;
  voice?: string;
  turnDetection?: TurnDetection;
  /** Languages to steer transcription toward. Omit for automatic detection across all 18. */
  languageCodes?: string[];
  /** Tools the agent may call, built at runtime by `binder.ts` from the form on screen. */
  tools?: unknown[];
  /**
   * Runs a tool the agent asked for, and returns whatever should go back to it.
   *
   * Returning an object is enough — it is stringified before it is sent, as the API requires.
   * Throwing is also fine: the message becomes an `error` the agent reads verbatim, so make it
   * specific. The docs are blunt that a vague error causes guessing loops, while one naming the
   * field that failed gets a clean recovery.
   */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Every frame in both directions, for the on-screen log. */
  onEvent?: (direction: "in" | "out", message: AgentMessage) => void;
  onReady?: (sessionId: string) => void;
  /** The full running text of the turn so far, not an increment. Replace, do not append. */
  onUserPartial?: (runningText: string) => void;
  /**
   * A finished turn: the words, and the audio they were spoken in.
   *
   * The audio is PCM16 at 24 kHz mono — exactly what the Dictation API wants — or null when the
   * turn produced none. Keeping it is what makes the verbatim recoverable afterwards.
   */
  onUserTranscript?: (text: string, audio: Int16Array | null, timeline: TimelinePoint[]) => void;
  onAgentTranscript?: (text: string) => void;
  /** Fired the moment the person starts speaking a turn. */
  onSpeechStart?: () => void;
  onError?: (message: string) => void;
  onClosed?: () => void;
  /**
   * Tool results have just gone out.
   *
   * The moment to update the agent's prompt with the form as it now is. AssemblyAI's own pattern
   * for changing an agent mid-call is exactly this order — "after each successful tool.result,
   * send session.update" — rather than changing it while a tool call is still outstanding.
   */
  onResultsSent?: () => void;
};

export type VoiceSession = {
  /** Sends `session.end` first so we don't pay for the 30-second resume grace window. */
  stop: () => Promise<void>;
  /**
   * Switch turn detection mid-call.
   *
   * Longtake has two modes and one number cannot serve both. While the person is giving their
   * one long take, a three-second pause is them thinking; during the ask-back afterwards, the
   * same pause is them waiting for the agent. `input.turn_detection` is mutable, so the mode
   * changes rather than the value being compromised.
   */
  setTurnDetection: (turnDetection: TurnDetection) => void;
  /** Replace the tool list — `session.tools` replaces, it does not merge. */
  setTools: (tools: unknown[]) => void;
  /**
   * Replace the system prompt mid-call.
   *
   * Mutable, unlike `greeting`. Used when the form changes shape: the prompt carries a description
   * of the form, and one that still says "this form has one question" after twenty have appeared
   * contradicts the tool the agent is holding.
   */
  setSystemPrompt: (prompt: string) => void;
};

/**
 * How long the tool handler gets before we answer on its behalf.
 *
 * Writing twenty fields, dropdowns included, runs to about two seconds. Twelve is far outside
 * anything legitimate and far inside the API's own 60-second tool timeout, which is the length
 * of silence a person would otherwise sit through.
 */
const TOOL_DEADLINE_MS = 12000;

/**
 * The last of the three ways this session found to leave an agent waiting for ever.
 *
 * `ToolResultQueue` guarantees a result that exists is delivered. It cannot help if the handler
 * never returns one — an await that never settles produces no result to queue, no error to
 * catch, and no event to recover on. So the promise races a clock, and a handler that misses it
 * gets answered without it. Saying "that did not work, ask them again" is recoverable; saying
 * nothing at all is the failure this whole file is about.
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
    systemPrompt,
    greeting,
    voice = "alba",
    turnDetection = LONG_TAKE_TURN_DETECTION,
    languageCodes = HINGLISH_LANGUAGES,
    onEvent,
    onReady,
    onUserPartial,
    onUserTranscript,
    onAgentTranscript,
    onSpeechStart,
    onError,
    onClosed,
    onResultsSent,
    tools,
    onToolCall,
  } = options;

  // 1 — Audio and token, started together rather than one after the other.
  //
  // Measured on a real run: four seconds from click to `session.ready`, three of them spent
  // before the socket even opened. Nothing about the token depends on the microphone, so the
  // two now overlap.
  //
  // The audio side is kicked off FIRST and without awaiting anything before it, because Safari
  // only grants `AudioContext.resume()` and `getUserMedia()` inside the user gesture that led
  // to them. An `await` on the network first would throw that gesture away.
  const audioReady = (async () => {
    // Let the context keep the device rate and resample in the worklet, so Firefox keeps its
    // echo canceller and Safari does not silently run at the wrong rate.
    const audioCtx = new AudioContext();
    await audioCtx.resume();
    await audioCtx.audioWorklet.addModule("/pcm-processor.js");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // stops the agent interrupting itself
        noiseSuppression: false, // server-side Voice Focus already does this; stacking hurts ASR
        autoGainControl: true,
      },
    });

    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, "pcm-processor", {
      processorOptions: {
        inputSampleRate: audioCtx.sampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
      },
    });
    source.connect(worklet).connect(audioCtx.destination);
    return { audioCtx, stream, source, worklet };
  })();

  const tokenReady = (async () => {
    // Single-use, so it is minted immediately before the socket opens.
    const response = await fetch("/api/voice-token", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error ?? `Token request failed (${response.status})`);
    }
    return body.token as string;
  })();

  const [audio, token] = await Promise.all([
    audioReady,
    // If the token fails we still have to release the microphone, or the browser keeps showing
    // a recording indicator for a session that never happened.
    tokenReady.catch(async (cause) => {
      const { audioCtx, stream } = await audioReady;
      for (const track of stream.getTracks()) track.stop();
      void audioCtx.close();
      throw cause;
    }),
  ]);
  const { audioCtx, stream, source, worklet } = audio;

  // 3 — Playback queue, with the flush that makes barge-in feel instant.
  let nextStartTime = 0;
  const liveSources = new Set<AudioBufferSourceNode>();

  function playReplyAudio(base64: string) {
    const raw = atob(base64);
    const pcm16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm16.length; i++) {
      pcm16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    }
    const buffer = audioCtx.createBuffer(1, pcm16.length, TARGET_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    const startAt = Math.max(audioCtx.currentTime, nextStartTime);
    src.start(startAt);
    src.onended = () => liveSources.delete(src);
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
  }

  // 4 — Socket.
  const wsUrl = new URL(WS_URL);
  wsUrl.searchParams.set("token", token);
  const ws = new WebSocket(wsUrl);

  let ready = false;
  let closing = false;

  const send = (message: AgentMessage) => {
    if (ws.readyState !== WebSocket.OPEN) return;
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
   * Audio recorded before `session.ready` is discarded by the server, so we hold it rather than
   * drop it, and replay it the instant the session opens.
   *
   * This is not a nicety. Longtake's whole promise is "press the key and just talk" — and in
   * testing, a person who does exactly that loses their opening words to the connect delay.
   * The docs offer both options ("buffer or drop early frames"); dropping is the wrong one for
   * a product built around one unbroken take.
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
   * The audio of each turn, kept as well as sent.
   *
   * We are already capturing this PCM to stream it; holding on to it costs almost nothing and
   * buys two things nothing else can. Phase 3 re-runs a long answer through the Dictation API
   * with that field's own prompts, which is the only way to get the verbatim and the tidy
   * version from one call. Phase 5 plays it back so somebody can hear themselves say it.
   *
   * Capped, because a 120-second ceiling applies at the other end and memory is not free.
   */
  const MAX_TURN_SAMPLES = TARGET_SAMPLE_RATE * 110; // just inside the API's 120 s limit
  let turnAudio: Int16Array[] = [];
  let turnSamples = 0;
  /**
   * Each running transcript of this turn, with how much audio had been captured when it arrived.
   *
   * The API gives no word timings, but this bounds them: a word was spoken after the last delta
   * that lacked it and before the first that had it. `clipFor` in core cuts an answer's own few
   * seconds out of the turn with it, so playing back "First Name" plays the name, not the minute.
   */
  let timeline: TimelinePoint[] = [];

  const resetTurnAudio = () => {
    turnAudio = [];
    turnSamples = 0;
    timeline = [];
  };

  /** The current turn's audio as one block, or null when there is nothing worth sending. */
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

    // Kept from the moment the mic opens, so the words spoken before `session.ready` are in the
    // recording too — the same reason those frames are buffered rather than dropped.
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

  ws.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        system_prompt: systemPrompt,
        greeting,
        input: {
          format: { encoding: "audio/pcm" },
          turn_detection: turnDetection,
          ...(languageCodes.length > 0 ? { language_codes: languageCodes } : {}),
        },
        output: {
          voice,
          format: { encoding: "audio/pcm" },
          volume: 100,
        },
        ...(tools && tools.length > 0 ? { tools } : {}),
      },
    });
  });

  /**
   * Tool results are held until the agent has finished its current reply.
   *
   * ⚠️ The two places this is documented disagree. AssemblyAI's general coding-agent prompt says
   * to send `tool.result` "the moment your tool returns… no special timing dance". The
   * Client-side tools page — which carries the working code — is precise: *"Send `tool.result`
   * when `reply.done` is the latest event you've received. Not earlier (agent is still
   * mid-transition-phrase), not later (a new turn has started)."*
   *
   * We follow the page, but not its literal wording, because "latest event" implemented as a
   * single remembered string deadlocked a live session — the moment passed while a dropdown was
   * being filled and the finished result was silently dropped for ever. `ToolResultQueue` holds
   * for the reason the docs actually give (do not interrupt a transition phrase) and has a
   * deadline, so a result can be late but can never be lost. The full sequence is in
   * `core/src/dispatch.ts`, with the tests that pin it.
   */
  const results = new ToolResultQueue();

  const flushResults = () => {
    // Checked before draining, not inside `send`. `due` removes what it returns, so draining
    // into a socket that is not open would throw the results away as thoroughly as the bug this
    // replaces — just in a different place.
    if (ws.readyState !== WebSocket.OPEN) return;

    const due = results.due(Date.now());
    for (const pending of due) {
      send({
        type: "tool.result",
        call_id: pending.call_id,
        // The API wants a JSON string here, not an object.
        result: JSON.stringify(pending.result),
      });
    }
    if (due.length > 0) onResultsSent?.();
  };

  /**
   * A heartbeat, because the deadlock had no event to recover on.
   *
   * Every other flush is triggered by an incoming frame. The failure this guards against is the
   * one where nothing else arrives at all: the agent is waiting on a tool result, so it does not
   * speak, so no frame comes, so nothing calls the flush. Something has to tick on its own.
   */
  const heartbeat = setInterval(flushResults, 500);

  const runTool = async (message: AgentMessage) => {
    const callId = String(message.call_id ?? "");
    const name = String(message.name ?? "");
    const args = (message.arguments ?? {}) as Record<string, unknown>;

    let result: unknown;
    try {
      result = onToolCall
        ? await withDeadline(onToolCall(name, args), TOOL_DEADLINE_MS)
        : { error: `No handler for "${name}" in this client.` };
    } catch (cause) {
      // Read verbatim by the model, so it should name what failed and what to ask for next.
      result = { error: cause instanceof Error ? cause.message : String(cause) };
    }

    results.add({ call_id: callId, result }, Date.now());
    // The tool may well have finished after `reply.done` already fired, so try immediately.
    flushResults();
  };

  ws.addEventListener("message", (event) => {
    const message: AgentMessage = JSON.parse(event.data);
    if (message.type !== "reply.audio") onEvent?.("in", message);

    // Every frame, before the switch. The queue itself decides which ones matter, and any frame
    // arriving is a chance to notice that a held result can now go out.
    results.note(message.type);

    switch (message.type) {
      case "session.ready": {
        ready = true; // set before flushing, or the held audio has nowhere to go
        const heldSamples = flushPrebuffer();
        if (heldSamples > 0) {
          onEvent?.("out", {
            type: "longtake.prebuffer.flushed",
            seconds: Number((heldSamples / TARGET_SAMPLE_RATE).toFixed(2)),
          });
        }
        onReady?.(String(message.session_id ?? ""));
        break;
      }
      case "reply.audio":
        playReplyAudio(String(message.data));
        break;
      case "tool.call":
        void runTool(message);
        break;
      case "reply.started":
        break; // the queue already knows a reply is in flight
      case "input.speech.started":
        // The moment somebody starts answering. How long they waited before this is one of the
        // signals the hesitation map reads, and it is the only one not recoverable from text.
        onSpeechStart?.();
        // Flushing here rather than waiting for `reply.done` makes barge-in ~300 ms snappier.
        flushPlayback();
        // A new turn used to be the thing that shut the door on a finished tool result. It is
        // now just another moment the agent is not speaking, so anything waiting goes out.
        flushResults();
        break;
      case "reply.done":
        if (message.status === "interrupted") flushPlayback();
        // Not conditional on the status: the queue drops an interrupted turn's results itself,
        // so this sends whatever survived and nothing otherwise.
        flushResults();
        break;
      case "transcript.user.delta":
        // ⚠️ The docs example shows this event carrying an incremental `delta`. On the wire it
        // carries the full running text in `text` instead, and `delta` is absent. Verified
        // against a live session on 20 Sep 2026. Agent deltas really do use `delta`; only the
        // user ones differ. Reading `delta` here silently produced empty partials.
      {
        const running = String(message.text ?? message.delta ?? "");
        timeline.push({ text: running, sample: turnSamples });
        onUserPartial?.(running);
        break;
      }
      case "transcript.user": {
        // The turn is over, so its audio is complete. Handed over with the words that go with
        // it and the timeline of when they arrived, then cleared — the next turn starts afresh.
        const audio = takeTurnAudio();
        const heard = timeline;
        resetTurnAudio();
        onUserTranscript?.(String(message.text ?? ""), audio, heard);
        break;
      }
      case "transcript.agent":
        onAgentTranscript?.(String(message.text ?? ""));
        break;
      case "session.error":
      case "error":
        onError?.(String(message.message ?? JSON.stringify(message)));
        break;
    }
  });

  ws.addEventListener("error", () => {
    if (!closing) onError?.("WebSocket error. Check the browser console and the token route.");
  });

  ws.addEventListener("close", (event) => {
    ready = false;
    // The socket is gone; there is nothing left to flush into.
    clearInterval(heartbeat);
    if (!closing && event.code === 1008) {
      onError?.("Unauthorized (close 1008). The token was bad or already used.");
    }
    onClosed?.();
  });

  const teardown = () => {
    clearInterval(heartbeat);
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

  return {
    setTurnDetection: (next: TurnDetection) => {
      send({ type: "session.update", session: { input: { turn_detection: next } } });
    },
    setTools: (next: unknown[]) => {
      send({ type: "session.update", session: { tools: next } });
    },
    setSystemPrompt: (prompt: string) => {
      send({ type: "session.update", session: { system_prompt: prompt } });
    },
    stop: async () => {
      closing = true;
      if (ws.readyState === WebSocket.OPEN) {
        // Ends the session cleanly instead of leaving a billable 30-second resume window open.
        send({ type: "session.end" });
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          ws.addEventListener("close", done, { once: true });
          setTimeout(done, 1000);
        });
      }
      try {
        ws.close();
      } catch {
        // already closed
      }
      teardown();
    },
  };
}

/**
 * The other mode: an ordinary back-and-forth, for the questions after the long take.
 *
 * AssemblyAI's own recommended baseline. Once the agent is asking one short question at a time,
 * a three-and-a-half-second wait stops reading as thinking room and starts reading as a hang.
 */
export const CONVERSATION_TURN_DETECTION: TurnDetection = {
  vad_threshold: 0.5,
  min_silence: 1400,
  max_silence: 4000,
  interrupt_response: true,
};
