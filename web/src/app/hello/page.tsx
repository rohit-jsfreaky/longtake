"use client";

/**
 * Phase 0 exit test: say something in a browser tab and get a transcript back.
 *
 * This page is a workbench, not product UI. It stays in the repo because it is the fastest way
 * to prove the mic, the token route, the socket and turn detection all still work after a change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceSession, type VoiceSession } from "@/lib/voice-session";
import { CORE_VERSION } from "@longtake/core";

type LogLine = { at: string; direction: "in" | "out" | "app"; text: string };

/**
 * `overwritten` holds the last live partial when the final transcript disagreed with it.
 *
 * This is not a debug nicety. In the first live test the partial had "my name Rohit Kashyap"
 * right and the final replaced it with "I'm, uh, now I'm going to shop here". If the committed
 * text can be worse than what the model already had, Longtake needs to see that happening.
 */
type Turn = { who: "you" | "agent"; text: string; overwritten?: string };

const SYSTEM_PROMPT = [
  "You are the connection test for Longtake.",
  "Repeat back what you heard in a few words, then stop.",
  "Never go past fifteen words.",
  "If the person mixes Hindi and English, reply the same way they spoke.",
].join(" ");

const GREETING = "Longtake is listening. Say anything.";

export default function HelloPage() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const sessionRef = useRef<VoiceSession | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  /** The last thing the model thought it heard before it committed. Kept on purpose — see below. */
  const lastPartialRef = useRef("");

  const push = useCallback((direction: LogLine["direction"], text: string) => {
    setLog((lines) => [
      ...lines.slice(-200),
      { at: new Date().toLocaleTimeString(), direction, text },
    ]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    setTurns([]);
    setLog([]);
    push("app", "Minting token and asking for the mic…");

    try {
      sessionRef.current = await startVoiceSession({
        systemPrompt: SYSTEM_PROMPT,
        greeting: GREETING,
        onEvent: (direction, message) => push(direction, JSON.stringify(message).slice(0, 300)),
        onReady: (sessionId) => {
          setStatus("live");
          push("app", `session.ready — ${sessionId}`);
        },
        onUserPartial: (runningText) => {
          lastPartialRef.current = runningText;
          setPartial(runningText); // cumulative, so replace rather than append
        },
        onUserTranscript: (text) => {
          const partialBefore = lastPartialRef.current;
          lastPartialRef.current = "";
          setPartial("");
          setTurns((t) => [
            ...t,
            {
              who: "you",
              text,
              overwritten: partialBefore && partialBefore !== text ? partialBefore : undefined,
            },
          ]);
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
  }, [push]);

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("idle");
    setPartial("");
  }, []);

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  const live = status === "live" || status === "connecting";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Longtake — Phase 0 check</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Talk. If a transcript comes back, the mic, the token route and the Voice Agent socket all
          work. Try it in Hinglish too.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <button
          onClick={live ? stop : start}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {status === "connecting" ? "Connecting…" : live ? "Stop" : "Start talking"}
        </button>

        {/* Connecting takes a couple of seconds. Say so loudly — but keep talking anyway: the
            session holds whatever is said before it opens and replays it. */}
        <span className="flex items-center gap-2 text-sm">
          {status === "live" ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
              </span>
              <span className="font-medium text-green-700 dark:text-green-500">
                Listening — speak now
              </span>
            </>
          ) : (
            <span className="text-neutral-500">
              {status === "idle" && "Not connected"}
              {status === "connecting" && "Opening the session — talk anyway, nothing is lost"}
              {status === "error" && "Failed"}
            </span>
          )}
        </span>
      </div>

      {error && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Transcript</h2>
        <div className="min-h-24 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          {turns.length === 0 && !partial && (
            <p className="text-neutral-400">Nothing yet.</p>
          )}
          {turns.map((turn, i) => (
            <div key={i} className="mb-2">
              <p>
                <span className="font-medium">{turn.who === "you" ? "You" : "Agent"}: </span>
                {turn.text}
              </p>
              {turn.overwritten && (
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                  live partial said: &ldquo;{turn.overwritten}&rdquo;
                </p>
              )}
            </div>
          ))}
          {partial && <p className="text-neutral-400">You: {partial}…</p>}
        </div>
      </section>

      <section className="flex flex-1 flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Every frame, both directions
        </h2>
        <div className="h-64 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-950">
          {log.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className="text-neutral-400">{line.at} </span>
              <span
                className={
                  line.direction === "in"
                    ? "text-blue-600 dark:text-blue-400"
                    : line.direction === "out"
                      ? "text-green-600 dark:text-green-400"
                      : "text-neutral-500"
                }
              >
                {line.direction === "app" ? "··" : line.direction === "in" ? "←" : "→"}{" "}
              </span>
              {line.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
        <p className="text-xs text-neutral-400">
          `input.audio` and `reply.audio` frames are hidden — there are hundreds of them. Shared{" "}
          <code>core/</code> is linked at v{CORE_VERSION}.
        </p>
      </section>
    </main>
  );
}
