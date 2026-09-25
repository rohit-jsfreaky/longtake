"use client";

/**
 * The workbench — the whole loop, end to end, with every internal laid out beside it.
 *
 *   read the page  →  learn every dropdown  →  build a tool from what is there
 *                  →  hand it to the agent  →  the agent calls it while you talk
 *                  →  write only what you actually said  →  tell the agent what is left
 *
 * The form beside this code is a stand-in, and it is ours, which is exactly why it proves
 * nothing on its own. The proof is that **none of the code below mentions it**: the same
 * functions, unchanged, filled a live Reddit application on Greenhouse.
 *
 * ## Why this page holds no logic any more
 *
 * It used to carry its own copy of the loop — 570 lines, identical to the landing page's, and
 * identical is not a thing two files stay. Within a day of the second copy existing, a fix for
 * a real bug (a tool call fired mid-sentence was checked against a transcript that did not yet
 * contain the sentence, and the longest answers were silently thrown away) landed in one of
 * them and not the other. So the two surfaces disagreed about what the product does, which is
 * the one thing a workbench must never do.
 *
 * Everything below `useLongtake` is display. If the demo is wrong here, it is wrong on the
 * landing page too, and that is the point of it.
 */

import { useEffect, useRef } from "react";
import { describeMarks } from "@longtake/core";

import { useLongtake } from "@/lib/use-longtake";
import { DemoForm } from "./DemoForm";

export default function FillPage() {
  const {
    status,
    live,
    error,
    fieldCount,
    written,
    refused,
    missing,
    needsYou,
    turns,
    partial,
    shaped,
    hesitations,
    known,
    fromMemory,
    log,
    start,
    stop,
    forgetOne,
    forgetEverything,
  } = useLongtake();

  // `scrollTop`, not `scrollIntoView` — the latter scrolls every ancestor including the page,
  // so keeping a log pinned to its newest line drags the whole document with it.
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

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
            onClick={() => void (live ? stop() : start())}
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
              {status === "reconnecting" && "line dropped, reconnecting — keep talking"}
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

        {/* The two failures that are the person's to fix — the page refused the value twice, or
            the answer was not one of the choices the field accepts. Kept apart from "left alone"
            because that list is mostly the rule working correctly and nobody reads it. */}
        {needsYou.length > 0 && (
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Needs you ({needsYou.length})
            </h2>
            <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
              {needsYou.map((item) => (
                <p key={item.fieldId} className="mb-1 text-amber-800 dark:text-amber-400">
                  <span className="font-medium">{item.question}</span>{" "}
                  <span className="text-amber-700 dark:text-amber-500">— {item.why}</span>
                </p>
              ))}
            </div>
          </section>
        )}

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

        {/*
          What an earlier telling already answered on this form. Shown rather than silent,
          because a pre-filled form gets skimmed, and somebody should be able to see at a glance
          which answers they gave just now and which arrived from last time.
        */}
        {fromMemory.length > 0 && (
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Brought from last time ({fromMemory.length})
            </h2>
            <div className="mt-1 rounded-md border border-sky-300 bg-sky-50 p-2 text-xs dark:border-sky-900 dark:bg-sky-950">
              {fromMemory.map((item) => (
                <p key={item.fieldId} className="truncate text-sky-800 dark:text-sky-300">
                  {item.fieldId}{" "}
                  <span className="text-sky-600 dark:text-sky-500">
                    — “{item.question}”, answered on an earlier form
                  </span>
                </p>
              ))}
            </div>
          </section>
        )}

        {/*
          Everything Longtake knows about the person, listed plainly, with a way to delete it.
          A product that keeps somebody's name, salary and immigration status should be able to
          show them the whole list on one screen and let them empty it in one click.
        */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Remembered about you ({known.length})
          </h2>
          <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {known.length === 0 && (
              <p className="text-neutral-400">
                Nothing yet. Answer once and the next form arrives filled in.
              </p>
            )}
            {known.map((answer) => (
              <div key={answer.id} className="mb-1 flex items-start gap-2">
                <button
                  onClick={() => forgetOne(answer.id)}
                  title="Forget this"
                  className="mt-0.5 shrink-0 rounded border border-neutral-300 px-1 text-[10px] leading-4 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  ✕
                </button>
                <span className="min-w-0">
                  <span className="font-medium">{answer.say}</span>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {answer.value}
                  </span>
                  {/* Where it came from — their words, or their own hand — so a saved answer is
                      never a mystery. */}
                  <span className="block truncate text-[10px] text-neutral-400">
                    {answer.source === "spoken" || answer.source === "confirmed"
                      ? `you said “${answer.evidence.length > 60 ? `${answer.evidence.slice(0, 60)}…` : answer.evidence}”`
                      : answer.source === "edited"
                        ? "edited by you"
                        : answer.source === "typed"
                          ? "typed by you"
                          : "kept from before"}
                    {answer.host && ` · ${answer.host}`}
                  </span>
                </span>
              </div>
            ))}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
              <p className="text-[10px] text-neutral-400">
                Stored in this browser only. Never uploaded.
              </p>
              {known.length > 0 && (
                <button
                  onClick={forgetEverything}
                  className="shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Forget everything
                </button>
              )}
            </div>
          </div>
        </section>

        {/*
          The nudge, and the only sentence this feature is allowed to say. It is an offer to
          re-read a box — never a claim about the person who filled it in.
        */}
        {Object.keys(hesitations).length > 0 && (
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Want another look? ({Object.keys(hesitations).length})
            </h2>
            <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
              {Object.values(hesitations).map((mark) => (
                <div key={mark.fieldId} className="mb-1">
                  <span className="font-medium text-amber-800 dark:text-amber-400">
                    {mark.fieldId}
                  </span>
                  <span className="text-amber-700 dark:text-amber-500">
                    {" "}
                    — {describeMarks(mark).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Kept verbatim ({Object.keys(shaped).length})
          </h2>
          <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            {Object.keys(shaped).length === 0 && (
              <p className="text-neutral-400">No long answers yet.</p>
            )}
            {Object.values(shaped).map((answer) => (
              <div key={answer.fieldId} className="mb-2">
                <p className="font-medium">{answer.fieldId}</p>
                <p className="text-neutral-600 dark:text-neutral-400">clean: {answer.clean}</p>
                <p className="text-amber-700 dark:text-amber-500">
                  said: {answer.verbatim}
                </p>
                {!answer.rewritten && (
                  <p className="text-neutral-500">{answer.note}</p>
                )}
              </div>
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
          <div
            ref={logRef}
            className="mt-1 h-40 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[10px] dark:border-neutral-800 dark:bg-neutral-950"
          >
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
          </div>
        </section>
      </aside>
    </main>
  );
}
