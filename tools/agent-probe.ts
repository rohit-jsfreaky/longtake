/**
 * The voice agent, without the voice. `npm run probe:agent`
 *
 * ## What it is good for
 *
 * - **Proving a tool was accepted.** `session.ready` echoes the resolved config, and this prints
 *   its `tools`. That is the only way to find out: the docs warn that a malformed `parameters`
 *   is taken silently at `session.update` and simply never called afterwards. This is how we
 *   learned our schema was fine all along, while a live session showed no tool call.
 * - **Proving the agent will call it at all**, and seeing the exact `tool.call` shape.
 * - **Exercising the evidence check** against whatever the model produces.
 *
 * ## ⚠️ What it is NOT good for, and why
 *
 * **It cannot test extraction quality.** `conversation.message` is documented as injecting a
 * message into the conversation "without the user speaking it", and the server accepts it
 * without complaint — no error, no `session.updated`, nothing. But the content never reaches
 * the model. Asked to reply after injecting *"My name is Rohit Kashyap and I live in Kolkata"*,
 * the agent confidently filled in **Rahul Sharma, rahul.sharma@gmail.com** — a person invented
 * whole, in English, from the system prompt alone.
 *
 * So a fabricated answer from this probe means nothing about the real thing: the model was
 * asked to speak with no input at all. Extraction has to be judged from a real spoken session.
 *
 * It did teach us one thing worth the trouble, though. **A model with no input will invent a
 * complete, plausible applicant rather than say it heard nothing** — which is precisely why
 * `evidence.ts` checks every quote against the transcript instead of trusting that one exists.
 */

import { readFileSync } from "node:fs";
import {
  buildFillTool,
  validateTool,
  describeForm,
  checkEvidence,
  type FieldSpec,
} from "@longtake/core";

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

/** The demo form's fields, as `reader.ts` returns them. Kept in step with `DemoForm.tsx`. */
const SPECS: FieldSpec[] = [
  { id: "first_name", label: "First name", kind: "text", required: true },
  { id: "last_name", label: "Last name", kind: "text", required: true },
  { id: "email", label: "Email", kind: "email", required: true },
  { id: "phone", label: "Phone", kind: "tel", required: false },
  { id: "current_city", label: "Current city", kind: "text", required: true },
  { id: "linkedin", label: "LinkedIn", kind: "url", required: false },
  {
    id: "country",
    label: "Country",
    kind: "select",
    required: true,
    options: [
      { value: "", label: "Select…" },
      { value: "in", label: "India" },
      { value: "us", label: "United States" },
      { value: "gb", label: "United Kingdom" },
      { value: "de", label: "Germany" },
    ],
  },
  {
    id: "notice_period",
    label: "Notice period",
    kind: "select",
    required: true,
    custom: true,
    options: ["Immediate", "15 days", "30 days", "60 days", "90 days"].map((l) => ({
      value: l,
      label: l,
    })),
  },
  { id: "current_employer", label: "Current employer", kind: "text", required: false },
  { id: "years_of_experience", label: "Years of experience", kind: "number", required: false },
  {
    id: "are_you_open_to_relocating",
    label: "Are you open to relocating?",
    kind: "radio",
    required: false,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "maybe", label: "Open to discussing" },
    ],
  },
  {
    id: "why_do_you_want_this_role",
    label: "Why do you want this role?",
    kind: "textarea",
    required: true,
    longForm: true,
  },
  {
    id: "i_agree_to_the_processing_of_my_application_data",
    label: "I agree to the processing of my application data.",
    kind: "checkbox",
    required: false,
  },
];

/** Exactly what the page says, so the probe tests the real prompt and not a paraphrase of it. */
function systemPrompt(): string {
  return [
    "You are Longtake. A person is looking at a form and is going to tell you the answers out loud, the way they would tell a friend. You put them in.",
    "",
    "Call fill_fields the moment you hear your first answer, and again every time you hear more. Do not wait for them to finish. A wasted call is fine.",
    "",
    "One sentence usually holds several answers. If they say their name, their city and their notice period in one breath, put all three in the same call. Do not ask about something they have already told you.",
    "",
    "Fill in only what they actually said. If they did not mention a field, leave it out — that is correct, not a failure, and it is true even for required fields. Never infer one answer from another.",
    "",
    "The evidence for every answer must be the person's own words, copied exactly from what they just said, in the language and script they said it in. Do not translate inside evidence. Do not write a sentence they did not say. If you cannot copy their words for a field, you did not hear that answer: leave the field out. An answer whose evidence is not found in the transcript is thrown away before it reaches the form, and you will be told so.",
    "",
    "They may speak English, Hindi, or both in the same sentence. The form is in English, so the VALUE goes in English. If they say their name in Hindi, write the value in the Latin alphabet the way they would write it themselves, and keep the evidence in Hindi. Never put Devanagari into a field value.",
    "",
    "After each call you are told what is still missing. Ask about one of those at a time, in a short sentence. Never read out a list. Never say Great question or Happy to help. No markdown, no bullet points, no asterisks.",
    "",
    "You never submit anything, and you must never say that you have. You are typing into a form the person is looking at; they read it and send it themselves. Do not say submitted, sent, applied, filed, or done for you. When nothing is left that you need, say that everything they told you is in, and that they should look it over before they send it.",
    "",
    "Keep every spoken reply under fifteen words.",
    "",
    describeForm(SPECS, "http://localhost:3000/fill"),
  ].join("\n");
}

/**
 * What Rohit actually said, transcribed the way the API actually transcribed it.
 *
 * Override with `PROBE_TEXT="one|two"` to try a different utterance without editing this file —
 * which is the whole point of having a harness rather than asking somebody to speak again.
 */
const UTTERANCES = [
  "मेरा नाम रोहित कृष्णप्प है, मैं कोलकाता से हूँ, इंडिया।",
  "ईमेल रोहित एट द रेड एग्जांपल डॉट कॉम दो साल का एक्सपीरियंस है तीस दिन का नोटिस पीरियड और हाँ मैं रिलोकेट कर सकता हूँ।",
];

const lines = process.env.PROBE_TEXT ? process.env.PROBE_TEXT.split("|") : UTTERANCES;

async function main() {
  const tool = buildFillTool(SPECS);
  const problems = validateTool(tool);
  console.log(`tool: ${tool.name}, ${Object.keys(tool.parameters.properties ?? {}).length} fields`);
  console.log(`local validation: ${problems.length === 0 ? "clean" : problems.join("; ")}`);

  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey()}` } } as never);
  const send = (message: unknown) => ws.send(JSON.stringify(message));

  let toolCalls = 0;
  let utterance = 0;
  let fields = 0;
  let invented = 0;
  /** Everything injected so far — what every quote is checked against. */
  let said = "";
  let done: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => (done = resolve));

  ws.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        system_prompt: systemPrompt(),
        greeting: "Go ahead.",
        input: { format: { encoding: "audio/pcm" }, language_codes: ["en", "hi"] },
        output: { voice: "alba", format: { encoding: "audio/pcm" }, volume: 100 },
        tools: [tool],
      },
    });
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    const m = JSON.parse(String(event.data));
    if (process.env.PROBE_RAW && m.type !== "reply.audio" && !String(m.type).includes(".delta")) {
      console.log("   raw ←", JSON.stringify(m).slice(0, 300));
    }

    switch (m.type) {
      case "session.ready": {
        // The one thing that cannot be checked any other way.
        const accepted = m.config?.tools;
        console.log(
          `\nsession.ready — tools in the resolved config: ${
            Array.isArray(accepted) ? `${accepted.length} → ${accepted.map((t: { name: string }) => t.name).join(", ")}` : JSON.stringify(accepted)
          }`,
        );
        // ⚠️ Deliberately NOT injecting here. The greeting's reply is still in flight at
        // `session.ready`, and a `reply.create` sent into an active turn collides with it —
        // which looked exactly like the model hallucinating, because the reply it produced
        // owed nothing to the message we thought we had sent. The first utterance goes in on
        // the greeting's `reply.done`, like every one after it.
        break;
      }

      case "tool.call": {
        toolCalls++;
        const args = m.arguments as Record<string, { value: unknown; evidence: string }>;
        console.log(`\n🔧 tool.call #${toolCalls} — ${m.name}`);
        for (const [field, answer] of Object.entries(args ?? {})) {
          // The same check the page runs, so the probe measures what would really happen.
          const verdict = checkEvidence(said, answer?.evidence ?? "");
          fields++;
          if (!verdict.ok) invented++;
          console.log(
            `   ${verdict.ok ? "✓" : "✗"} ${field} = ${JSON.stringify(answer?.value)}   ← "${answer?.evidence}"`,
          );
        }
        send({
          type: "tool.result",
          call_id: m.call_id,
          result: JSON.stringify({
            written: Object.keys(args ?? {}),
            still_missing: [{ field: "why_do_you_want_this_role", question: "Why do you want this role?" }],
          }),
        });
        break;
      }

      case "transcript.agent":
        console.log(`\n🗣  agent: ${m.text}`);
        break;

      case "reply.done":
        if (utterance < lines.length) say();
        else setTimeout(() => done?.(), 1500);
        break;

      case "session.error":
      case "error":
        console.log(`\n❌ ${JSON.stringify(m)}`);
        break;
    }
  });

  function say() {
    const text = lines[utterance++];
    if (!text) return;
    said = `${said}\n${text}`.trim();
    console.log(`\n👤 you: ${text}`);
    send({ type: "conversation.message", role: "user", content: text });
    // A beat before asking for the reply. Sent back to back, the reply was being composed
    // without the message in context, which reads exactly like the model hallucinating.
    setTimeout(() => send({ type: "reply.create" }), 400);
  }

  ws.addEventListener("error", (e: Event) => console.log("socket error", e));
  ws.addEventListener("close", (e: CloseEvent) => {
    console.log(`\nsocket closed (${e.code}) ${e.reason}`);
    done?.();
  });

  const timeout = setTimeout(() => done?.(), 60000);
  await finished;
  clearTimeout(timeout);
  try {
    send({ type: "session.end" });
  } catch {
    // already gone
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(toolCalls > 0 ? `tool calls: ${toolCalls}` : "❌ the agent NEVER called the tool");
  console.log(`fields offered: ${fields}   verified: ${fields - invented}   INVENTED: ${invented}`);
  setTimeout(() => process.exit(0), 500);
}

void main();
