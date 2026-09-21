"use client";

/**
 * Phase 2 — the whole loop, end to end.
 *
 *   read the page  →  learn every dropdown  →  build a tool from what is there
 *                  →  hand it to the agent  →  the agent calls it while you talk
 *                  →  write only what you actually said  →  tell the agent what is left
 *
 * The form beside this code is a stand-in, and it is ours, which is exactly why it proves
 * nothing on its own. The proof is that **none of the code below mentions it**: the same
 * functions, unchanged, filled a live Reddit application on Greenhouse.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildFillTool,
  describeForm,
  FILL_TOOL_NAME,
  harvestOptions,
  readForm,
  keepOnlyWhatWasSaid,
  stillMissing,
  validateTool,
  waitForForm,
  writeValues,
  type FieldSpec,
  type FormRead,
  type SpokenValue,
  type WriteOutcome,
} from "@longtake/core";
import {
  CONVERSATION_TURN_DETECTION,
  startVoiceSession,
  type VoiceSession,
} from "@/lib/voice-session";
import { DemoForm } from "./DemoForm";

type LogLine = { at: string; kind: "in" | "out" | "app"; text: string };

/**
 * What the agent is told.
 *
 * Written to the voice-prompt rules rather than the chat ones: identity first, no markdown,
 * exact phrases to avoid rather than "be casual", and short — a long prompt dilutes attention.
 * The form's own description is appended, so this grows with whatever page it lands on.
 */
function buildSystemPrompt(specs: FieldSpec[], url: string): string {
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
    describeForm(specs, url),
  ].join("\n");
}

const GREETING = "Go ahead, tell me about yourself and I will fill this in.";

/**
 * Longtake's own panel, and the Next.js dev overlay, are not part of anybody's form.
 *
 * The dev overlay earns its place here: its button declares `aria-haspopup="menu"` exactly like
 * a real dropdown, so without naming it the schema gains a question called "Open Next.js Dev
 * Tools" with a three-option enum. Other people's furniture looks just like a form field.
 */
const IGNORE = "[data-longtake-ignore], nextjs-portal, [data-nextjs-dev-tools-button]";

export default function FillPage() {
  const [status, setStatus] = useState<"idle" | "reading" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldCount, setFieldCount] = useState(0);
  const [outcomes, setOutcomes] = useState<WriteOutcome[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [turns, setTurns] = useState<{ who: "you" | "agent"; text: string }[]>([]);
  const [partial, setPartial] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);

  const sessionRef = useRef<VoiceSession | null>(null);
  const readRef = useRef<FormRead | null>(null);
  const filledRef = useRef<Set<string>>(new Set());
  const switchedModeRef = useRef(false);
  /** Everything the person has actually said, which is what every quote gets checked against. */
  const transcriptRef = useRef("");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((lines) => [...lines.slice(-200), { at: new Date().toLocaleTimeString(), kind, text }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  /**
   * The tool handler. Everything the agent decides arrives here, and everything this returns is
   * read back by the agent — including the refusals, which are what it asks about next.
   */
  const handleFill = useCallback(
    async (args: Record<string, unknown>) => {
      const read = readRef.current;
      if (!read) return { error: "The form has not been read yet." };

      // The schema shape is `{ field_id: { value, evidence } }`.
      const claimed: SpokenValue[] = [];
      for (const [fieldId, raw] of Object.entries(args)) {
        if (!raw || typeof raw !== "object") continue;
        const { value, evidence } = raw as { value?: unknown; evidence?: unknown };
        if (value === undefined || value === null) continue;
        claimed.push({
          fieldId,
          value: value as SpokenValue["value"],
          evidence: typeof evidence === "string" ? evidence : "",
        });
      }

      // ── Every quote is checked against what was actually said ───────────────────────
      //
      // Requiring evidence stops a model filling blanks it was never told about. It does not
      // stop it inventing the quote, and on the first live run that is exactly what happened:
      // "मेरा नाम रोहित कृष्णप्प है" came back as `first_name = "Arjun"`, evidence
      // "My name is Arjun". Neither existed. So the quote is matched against the transcript,
      // which we have, and an answer that cannot be found in it never reaches the page.
      const { spoken, unsupported } = keepOnlyWhatWasSaid(transcriptRef.current, claimed);

      const results = await writeValues(read.specs, read.handles, spoken);
      const invented: WriteOutcome[] = unsupported.map((item) => ({
        fieldId: item.fieldId,
        status: "refused" as const,
        reason: item.reason,
      }));
      setOutcomes((previous) => [...previous, ...results, ...invented]);
      if (invented.length > 0) {
        push("app", `held back ${invented.length} answer(s) that were not in the transcript`);
      }

      for (const result of results) {
        if (result.status === "written") filledRef.current.add(result.fieldId);
      }

      // The long take is over the moment the first answers land. Switch to conversational
      // timing so the questions afterwards do not sit in a three-second silence.
      if (!switchedModeRef.current && results.some((r) => r.status === "written")) {
        switchedModeRef.current = true;
        sessionRef.current?.setTurnDetection(CONVERSATION_TURN_DETECTION);
        push("app", "switched to conversation timing");
      }

      const left = stillMissing(read.specs, filledRef.current);
      setMissing(left.map((spec) => spec.label || spec.id));

      return {
        written: results.filter((r) => r.status === "written").map((r) => r.fieldId),
        // Named individually, with the reason, because a specific message gets a clean recovery
        // from the agent and a vague one causes a guessing loop.
        not_written: [...invented, ...results]
          .filter((r) => r.status !== "written")
          .map((r) => ({
            field: r.fieldId,
            why: r.status === "refused" ? r.reason : `the page did not keep it (${r.found})`,
          })),
        still_missing: left.map((spec) => ({ field: spec.id, question: spec.label })),
        // Stated in the result, not only in the prompt, because this is the moment the model is
        // deciding how to announce the outcome — and on the first successful run it announced
        // "All done, I have submitted your application." Nothing was submitted. Longtake types
        // into a form; the person reads it and sends it. Saying otherwise is a lie about an
        // action, on a job application, in front of a sponsor who blocks auto-appliers.
        submitted: false,
        the_person_must_review_and_send_it_themselves: true,
      };
    },
    [push],
  );

  const start = useCallback(async () => {
    setStatus("reading");
    setError(null);
    setOutcomes([]);
    setTurns([]);
    setLog([]);
    filledRef.current = new Set();
    switchedModeRef.current = false;
    transcriptRef.current = "";

    try {
      // 1 — Read the page, and open every dropdown so the schema carries real options.
      await waitForForm();
      const read = await harvestOptions(readForm(document, location.href, IGNORE));
      readRef.current = read;
      setFieldCount(read.specs.length);
      setMissing(stillMissing(read.specs, []).map((spec) => spec.label || spec.id));
      push("app", `read ${read.specs.length} fields, ${read.skipped.length} skipped`);

      // 2 — Build the tool, and check it ourselves. A malformed schema is accepted silently by
      //     the API and then simply never called, which is close to undebuggable from outside.
      const tool = buildFillTool(read.specs);
      const problems = validateTool(tool);
      if (problems.length > 0) throw new Error(`The generated tool is invalid: ${problems.join("; ")}`);
      push("app", `built ${FILL_TOOL_NAME} with ${Object.keys(tool.parameters.properties ?? {}).length} fields`);

      // 3 — Talk.
      setStatus("connecting");
      sessionRef.current = await startVoiceSession({
        systemPrompt: buildSystemPrompt(read.specs, read.url),
        greeting: GREETING,
        tools: [tool],
        onToolCall: async (name, args) => {
          if (name !== FILL_TOOL_NAME) return { error: `Unknown tool "${name}".` };
          return handleFill(args);
        },
        onEvent: (direction, message) => push(direction, JSON.stringify(message).slice(0, 260)),
        onReady: () => {
          setStatus("live");
          push("app", "session.ready — speak now");
        },
        onUserPartial: setPartial,
        onUserTranscript: (text) => {
          setPartial("");
          // Accumulated, not replaced: a quote may span two turns of one long take.
          transcriptRef.current = `${transcriptRef.current}
${text}`.trim();
          setTurns((t) => [...t, { who: "you", text }]);
        },
        onAgentTranscript: (text) => setTurns((t) => [...t, { who: "agent", text }]),
        onError: (message) => {
          setError(message);
          setStatus("error");
        },
        onClosed: () => setStatus((s) => (s === "error" ? s : "idle")),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, [handleFill, push]);

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("idle");
    setPartial("");
  }, []);

  useEffect(() => () => void sessionRef.current?.stop(), []);

  const live = status !== "idle" && status !== "error";
  const written = outcomes.filter((o) => o.status === "written");
  const refused = outcomes.filter((o) => o.status !== "written");

  return (
    <main className="mx-auto grid max-w-6xl gap-8 p-6 lg:grid-cols-[1fr_380px]">
      <section>
        <header className="mb-4">
          <h1 className="text-2xl font-semibold">Longtake — Phase 2</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Press start and just talk. The tool below is built from this form at runtime, and the
            same code filled a live Reddit application without a line of it knowing about either.
          </p>
        </header>
        <DemoForm />
      </section>

      {/* Marked so the reader never mistakes Longtake's own controls for the person's form. */}
      <aside className="flex flex-col gap-4" data-longtake-ignore>
        <div className="flex items-center gap-3">
          <button
            onClick={live ? stop : start}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {status === "reading" ? "Reading the form…" : status === "connecting" ? "Connecting…" : live ? "Stop" : "Start talking"}
          </button>
          {status === "live" ? (
            <span className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-500">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
              </span>
              Listening
            </span>
          ) : (
            <span className="text-sm text-neutral-500">
              {status === "idle" && `${fieldCount || "—"} fields`}
              {status === "connecting" && "talk anyway, nothing is lost"}
              {status === "error" && "Failed"}
            </span>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Filled ({written.length})
          </h2>
          <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {written.length === 0 && <p className="text-neutral-400">Nothing yet.</p>}
            {written.map((outcome, i) => (
              <p key={i} className="truncate">
                <span className="text-green-700 dark:text-green-500">✓</span> {outcome.fieldId} —{" "}
                <span className="text-neutral-500">{outcome.wrote}</span>
              </p>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Left alone ({refused.length})
          </h2>
          <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {refused.length === 0 && <p className="text-neutral-400">Nothing refused.</p>}
            {refused.map((outcome, i) => (
              <p key={i} className="text-amber-700 dark:text-amber-500">
                ○ {outcome.fieldId} — {outcome.status === "refused" ? outcome.reason : outcome.found}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Still required ({missing.length})
          </h2>
          <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {missing.length === 0 && <p className="text-neutral-400">Nothing outstanding.</p>}
            {missing.map((label) => (
              <p key={label} className="truncate text-neutral-600 dark:text-neutral-400">
                • {label}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Said</h2>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {turns.length === 0 && !partial && <p className="text-neutral-400">Nothing yet.</p>}
            {turns.map((turn, i) => (
              <p key={i} className="mb-1">
                <span className="font-medium">{turn.who === "you" ? "You" : "Agent"}: </span>
                {turn.text}
              </p>
            ))}
            {partial && <p className="text-neutral-400">You: {partial}…</p>}
          </div>
        </section>

        <section className="flex flex-1 flex-col">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Frames</h2>
          <div className="mt-1 h-40 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[10px] dark:border-neutral-800 dark:bg-neutral-950">
            {log.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                <span className="text-neutral-400">{line.at} </span>
                <span
                  className={
                    line.kind === "in"
                      ? "text-blue-600 dark:text-blue-400"
                      : line.kind === "out"
                        ? "text-green-600 dark:text-green-400"
                        : "text-neutral-500"
                  }
                >
                  {line.kind === "app" ? "··" : line.kind === "in" ? "←" : "→"}{" "}
                </span>
                {line.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      </aside>
    </main>
  );
}
