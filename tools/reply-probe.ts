/**
 * `reply.create`, live. `npm run probe:reply`
 *
 * The trust layer (core/src/trust.ts) corrects the agent by asking it to speak again with one-shot
 * instructions — "you told them the phone went in; it did not: put it in now, quoting their words,
 * or say plainly it didn't go in". Two things decide whether that can work, and the docs do not say
 * either:
 *   1. how long after `reply.create` the agent starts speaking;
 *   2. whether a reply asked for that way can call a tool.
 *
 * This asks the real Voice Agent API both, with the product's own persona and fill tool, and prints
 * what came back. No audio is sent: nothing here depends on hearing anyone.
 */

import { readFileSync } from "node:fs";
import { buildFillTool, systemPrompt, type FieldSpec } from "@longtake/core";

const ENV_PATH = new URL("../web/.env.local", import.meta.url);
const WS_URL = "wss://agents.assemblyai.com/v1/ws";

function apiKey(): string {
  const line = readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
  const key = line?.slice("ASSEMBLYAI_API_KEY=".length).trim();
  if (!key) throw new Error("No ASSEMBLYAI_API_KEY in web/.env.local");
  return key;
}

const SPECS: FieldSpec[] = [
  { id: "full_name", label: "Full name", kind: "text", required: true },
  { id: "phone", label: "Phone", kind: "tel", required: true },
];

type Step = { name: string; instructions: string };
const STEPS: Step[] = [
  { name: "speak", instructions: "Say, in one short sentence, that you are ready for their answers." },
  {
    name: "correct-with-a-tool",
    instructions:
      'You told them their phone number went in, but it did not. Earlier they said, word for word: "my phone is 98765 43210". Put it in now: call fill_fields for phone with value "98765 43210", evidence "my phone is 98765 43210" and how "named". Then say in a few words that it is in now.',
  },
];

type Seen = { at: number; type: string; detail?: string };

async function main() {
  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey()}` } } as never);
  const send = (message: unknown) => ws.send(JSON.stringify(message));
  const report: Record<string, { sentAt: number; seen: Seen[] }> = {};
  let current: string | null = null;
  let step = 0;
  let greeted = false;
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => (finished = resolve));

  const next = () => {
    const s = STEPS[step++];
    if (!s) {
      send({ type: "session.end" });
      setTimeout(finished, 1500);
      return;
    }
    current = s.name;
    report[s.name] = { sentAt: Date.now(), seen: [] };
    send({ type: "reply.create", instructions: s.instructions });
  };

  ws.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        system_prompt: systemPrompt("FORM NOW: 0 of 2 answered.\n\nDO NEXT: Ask for their full name and phone."),
        greeting: "Hi.",
        input: { format: { encoding: "audio/pcm" } },
        output: { voice: "charles", format: { encoding: "audio/pcm" }, volume: 100 },
        tools: [buildFillTool(SPECS)],
      },
    });
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    const m = JSON.parse(String(event.data));
    if (m.type === "reply.audio" || String(m.type).endsWith(".delta")) return;
    const at = Date.now();
    const log = (detail?: string) => current && report[current]!.seen.push({ at: at - report[current]!.sentAt, type: m.type, ...(detail ? { detail } : {}) });

    switch (m.type) {
      case "session.ready":
        console.log("session.ready");
        break;
      case "reply.started":
        log(String(m.reply_id));
        break;
      case "transcript.agent":
        log(`${m.reply_id}: ${m.text}`);
        break;
      case "tool.call":
        log(`${m.name} ${JSON.stringify(m.arguments)}`);
        send({ type: "tool.result", call_id: m.call_id, result: JSON.stringify({ just_filled: [{ field: "phone", value: "98765 43210" }], submitted: false }) });
        break;
      case "reply.done":
        log(`${m.reply_id} ${m.status}`);
        if (!greeted) {
          greeted = true;
          setTimeout(next, 500);
        } else if (!String(m.reply_id).startsWith("fc-")) {
          // The step's own reply is over (a tool call's filler is not): the next step, after a beat.
          setTimeout(next, 1200);
        }
        break;
      case "session.error":
      case "error":
        console.log("error", JSON.stringify(m));
        break;
    }
  });

  setTimeout(finished, 60_000);
  await done;
  ws.close();
  console.log(JSON.stringify(report, null, 2));
}

void main();
