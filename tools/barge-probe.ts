/**
 * Barge-in, live. `npm run probe:barge`
 *
 * A person tried to cut in while the agent was talking and it talked on; their words appeared only
 * after it finished. Before changing anything, this asks the real Voice Agent API what happens
 * when someone speaks over the agent, with timings — no browser, no echo canceller, no speakers,
 * so what is measured is the server and the protocol alone.
 *
 * It streams a microphone the way the product does: 50 ms of 24 kHz PCM at a time, in real time,
 * silence until the moment to speak, then a recorded sentence (Windows speech, made by
 * `.probe/barge-*.wav`), then silence again. The agent's audio is "played" on a clock: from its
 * first frame, for as long as the audio it has sent lasts — that is when a listener hears it.
 *
 *   WAV=.probe/barge-uh.wav MODE=max_accuracy AT=2000 npm run probe:barge
 *
 * AT is how far into the agent's greeting (ms of it heard) the person starts to speak.
 */

import { readFileSync } from "node:fs";
import { buildFillTool, systemPrompt, type FieldSpec } from "@longtake/core";

const ENV_PATH = new URL("../web/.env.local", import.meta.url);
const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const RATE = 24_000;
const CHUNK = RATE / 20; // 50 ms

function apiKey(): string {
  const line = readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
  const key = line?.slice("ASSEMBLYAI_API_KEY=".length).trim();
  if (!key) throw new Error("No ASSEMBLYAI_API_KEY in web/.env.local");
  return key;
}

/** 16-bit mono PCM samples from a WAV file (its `data` chunk). */
function readWav(path: string): Int16Array {
  const buf = readFileSync(path);
  let at = 12;
  while (at < buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + at + 8, buf.byteOffset + at + 8 + size));
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

const SPECS: FieldSpec[] = [
  { id: "full_name", label: "Full name", kind: "text", required: true },
  { id: "email", label: "Email", kind: "email", required: true },
  { id: "gender", label: "Gender", kind: "text", required: true },
  { id: "nationality", label: "Nationality", kind: "text", required: true },
  { id: "english_level", label: "Level of English", kind: "text", required: true },
];

const GREETING =
  "Right, this is the volunteer application — eleven questions. Easy ones first: your name, your email, your phone number and where you're based. Say them all at once, in any order — next time I'll remember them for you.";

async function main() {
  const wav = readWav(process.env.WAV ?? ".probe/barge-stop.wav");
  const mode = process.env.MODE ?? "max_accuracy";
  const speakAt = Number(process.env.AT ?? 2000);

  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey()}` } } as never);
  const send = (message: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message));
  const t0 = Date.now();
  const lines: string[] = [];
  const mark = (what: string) => lines.push(`${String(Date.now() - t0).padStart(6)} ms  ${what}`);

  // The agent's audio, on a listener's clock.
  let playStart = 0;
  let heardMs = 0;
  let audioFrames = 0;
  let greetingDone = false;
  const agentAudible = () => playStart > 0 && Date.now() < playStart + heardMs;

  // The microphone: silence, then the sentence once `speakAt` ms of the greeting have been heard.
  let speechAt = -1;
  let sent = 0;
  let spoke = false;
  let micTimer: ReturnType<typeof setInterval> | undefined;
  const startMic = () => {
    const micStart = Date.now();
    micTimer = setInterval(() => {
      const due = Math.floor(((Date.now() - micStart) / 1000) * RATE / CHUNK);
      while (sent < due) {
        const chunk = new Int16Array(CHUNK);
        if (speechAt < 0 && playStart > 0 && Date.now() >= playStart + speakAt) {
          speechAt = sent;
          mark(`▶ PERSON STARTS SPEAKING (agent audible: ${agentAudible()})`);
        }
        if (speechAt >= 0) {
          const from = (sent - speechAt) * CHUNK;
          if (from < wav.length) chunk.set(wav.subarray(from, Math.min(from + CHUNK, wav.length)));
          else if (!spoke) {
            spoke = true;
            mark(`■ PERSON STOPS SPEAKING (agent audible: ${agentAudible()})`);
          }
        }
        send({ type: "input.audio", audio: Buffer.from(chunk.buffer).toString("base64") });
        sent++;
      }
    }, 20);
  };

  ws.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        system_prompt: systemPrompt("FORM NOW: 0 of 5 answered.\n\nDO NEXT: Ask for everything at once."),
        greeting: GREETING,
        input: {
          format: { encoding: "audio/pcm" },
          transcription_mode: mode,
          ...(process.env.TD ? { turn_detection: JSON.parse(process.env.TD) } : {}),
        },
        output: { voice: "charles", format: { encoding: "audio/pcm" }, volume: 100 },
        tools: [buildFillTool(SPECS)],
      },
    });
  });

  let partials = 0;
  ws.addEventListener("message", (event: MessageEvent) => {
    const m = JSON.parse(String(event.data));
    switch (m.type) {
      case "session.ready":
        mark("session.ready");
        startMic();
        break;
      case "reply.audio": {
        const samples = Buffer.from(String(m.data ?? m.audio ?? ""), "base64").length / 2;
        if (playStart === 0) {
          playStart = Date.now();
          mark("first agent audio — playback starts");
        }
        // A listener hears it back to back; a gap (the queue ran dry) restarts the clock.
        if (Date.now() > playStart + heardMs) {
          playStart = Date.now();
          heardMs = 0;
        }
        heardMs += (samples / RATE) * 1000;
        audioFrames++;
        break;
      }
      case "transcript.user.delta":
        if (partials++ < 3) mark(`transcript.user.delta "${String(m.text).slice(0, 60)}"`);
        break;
      case "transcript.user":
        partials = 0;
        mark(`transcript.user "${m.text}"`);
        break;
      case "transcript.agent":
        mark(`transcript.agent interrupted=${m.interrupted} "${String(m.text).slice(0, 90)}"`);
        break;
      case "reply.started":
        mark(`reply.started ${m.reply_id} (agent audio so far heard until +${Math.round(playStart + heardMs - t0)} ms)`);
        break;
      case "reply.done":
        mark(`reply.done ${m.reply_id} status=${m.status} — audio sent would be heard until +${Math.round(playStart + heardMs - t0)} ms (${audioFrames} frames)`);
        if (!greetingDone) greetingDone = true;
        break;
      case "tool.call":
        mark(`tool.call ${m.name} ${JSON.stringify(m.arguments).slice(0, 120)}`);
        send({ type: "tool.result", call_id: m.call_id, result: JSON.stringify({ just_filled: [], submitted: false }) });
        break;
      default:
        mark(m.type);
    }
  });

  await new Promise((resolve) => setTimeout(resolve, Number(process.env.SECONDS ?? 35) * 1000));
  clearInterval(micTimer);
  send({ type: "session.end" });
  ws.close();
  console.log(`WAV=${process.env.WAV ?? ".probe/barge-stop.wav"} MODE=${mode} AT=${speakAt} TD=${process.env.TD ?? "-"}\n${lines.join("\n")}`);
}

void main();
