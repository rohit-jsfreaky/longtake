/**
 * Records a short sample of every English voice, for the extension's voice picker.
 *
 * Each voice speaks its own greeting through the real Voice Agent API (the greeting is spoken
 * verbatim, so the sample is exactly what a call opens with), and the PCM it sends back is saved
 * as a WAV in `extension/voices/`. Recorded once and shipped, so previewing a voice costs nothing
 * and needs no network. Re-run only to refresh them: `node tools/voice-samples.mjs`.
 *
 * Uses ASSEMBLYAI_API_KEY from web/.env.local; the key is never printed. The server-side connection
 * authenticates with `Authorization: Bearer <key>` (docs: AI-SYSTEM-PROMPT, section 10).
 * Voices: docs/voice-agents/voice-agent-api/voices, "English voices".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const VOICES = [
  ["charles", "British"], ["anna", "British"], ["paul", "British"], ["vera", "British"],
  ["alba", "American"], ["eve", "American"], ["george", "American"], ["jane", "American"],
  ["jean", "American"], ["mary", "American"], ["michael", "American"],
];

const key = readFileSync("web/.env.local", "utf8").match(/^ASSEMBLYAI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("ASSEMBLYAI_API_KEY is not in web/.env.local");

function wav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function record(voice) {
  const name = voice[0].toUpperCase() + voice.slice(1);
  const greeting = `Hi, I'm ${name}. Tell me everything in one go, and I'll fill in the form for you.`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://agents.assemblyai.com/v1/ws", { headers: { Authorization: `Bearer ${key}` } });
    const chunks = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`${voice}: no reply within 20 s`));
    }, 20000);
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            system_prompt: "Say only your greeting, then stop.",
            greeting,
            input: { format: { encoding: "audio/pcm" } },
            output: { voice, format: { encoding: "audio/pcm" } },
          },
        }),
      ),
    );
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (m.type === "reply.audio") chunks.push(Buffer.from(m.data, "base64"));
      if (m.type === "reply.done") {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: "session.end" })); // no billable resume window
        setTimeout(() => ws.close(), 200);
        resolve(Buffer.concat(chunks));
      }
      if (m.type === "session.error" || m.type === "error") {
        clearTimeout(timer);
        ws.terminate();
        reject(new Error(`${voice}: ${m.message ?? m.code}`));
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

mkdirSync("extension/voices", { recursive: true });
for (const [voice] of VOICES) {
  const pcm = await record(voice);
  writeFileSync(`extension/voices/${voice}.wav`, wav(pcm));
  console.log(`${voice}: ${(pcm.length / 48000).toFixed(1)} s`);
}
writeFileSync("extension/voices/voices.json", JSON.stringify(VOICES.map(([id, accent]) => ({ id, accent })), null, 2) + "\n");
