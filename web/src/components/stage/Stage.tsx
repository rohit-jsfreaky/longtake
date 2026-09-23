"use client";

import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Container, Eyebrow, Section } from "@/components/chrome";
import { RecordDot } from "@/components/RecordDot";
import { Reveal } from "@/components/motion";
import { Waveform } from "@/components/Waveform";
import { useLongtake } from "@/lib/use-longtake";
import { BrowserChrome } from "./BrowserChrome";
import { ActsafeMembership } from "./ActsafeMembership";
import { DiscordApplication } from "./DiscordApplication";
import { GleanApplication } from "./GleanApplication";
import { GoogleFormVolunteer } from "./GoogleFormVolunteer";

/**
 * The real forms on the page, and why each one is here.
 *
 * Greenhouse is the everyday case: a long job application with component dropdowns whose options
 * do not exist until opened. The Discord posting is Greenhouse's harder side: pickers that search
 * as you type, a phone number with its own country picker, and an Education block with "Add
 * another". The Google Form has three pages with Next between them, and a Submit that only the
 * person presses. Jotform is the hard one: a form that shows one question and grows
 * twenty more depending on the answer, with a different set for each answer.
 */
const FORMS = {
  glean: {
    tab: "Job application",
    source: "Greenhouse",
    url: "job-boards.greenhouse.io/gleanwork/jobs/4006731005",
    Form: GleanApplication,
  },
  discord: {
    tab: "Search + add another",
    source: "Greenhouse · searches as you type",
    url: "job-boards.greenhouse.io/discord/jobs/8571766002",
    Form: DiscordApplication,
  },
  google: {
    tab: "Google Form, 3 pages",
    source: "Google Forms · Next between pages",
    url: "docs.google.com/forms/d/e/1FAIpQLSe9YP7zfEu01jKJ8IxIa_tjd0GaCoHv9B-nDlX351D-JRnQ9g/viewform",
    Form: GoogleFormVolunteer,
  },
  actsafe: {
    tab: "Membership form",
    source: "Jotform · changes as you answer",
    url: "form.jotform.com/221326312365043",
    Form: ActsafeMembership,
  },
} as const;

type FormKey = keyof typeof FORMS;

/** The query string does not change under a mounted page, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * The demo the submission is judged on.
 *
 * It runs the same `useLongtake` hook the workbench at /fill runs — same reader, same binder,
 * same evidence check, same refusals. Nothing here is special-cased for this page, which is the
 * only reason the demo proves anything.
 *
 * Two things keep it honest:
 *
 *   · `root` scopes the reader to the form panel. The landing page has an FAQ, a nav and this
 *     panel's own controls on it; reading the whole document would build the agent a tool
 *     partly out of our own furniture.
 *   · `data-longtake-ignore` on the side panel, so even inside the scope our controls are
 *     invisible to the reader.
 */
export function Stage() {
  const formRef = useRef<HTMLDivElement | null>(null);
  const root = useCallback(() => formRef.current, []);

  const [which, setWhich] = useState<FormKey>("glean");
  const { Form, url } = FORMS[which];

  const {
    status,
    live,
    error,
    fieldCount,
    missing,
    optionalLeft,
    filledCount,
    needsYou,
    waiting,
    fromMemory,
    turns,
    partial,
    start,
    stop,
    forgetEverything,
    log,
  } = useLongtake({ root });

  /**
   * `?debug` on the page adds a button that copies the whole session — every frame, every tool
   * call and every tool result in full. A live run that goes wrong is otherwise only known by the
   * agent's own account of it, which is how "India is not an option" nearly got blamed on the form.
   * `false` on the server, so the page it draws matches the browser's first paint.
   */
  const debug = useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(location.search).has("debug"),
    () => false,
  );


  /**
   * Follow the conversation as it arrives.
   *
   * ⚠️ Deliberately `scrollTop`, not `scrollIntoView`. `scrollIntoView` scrolls every scrollable
   * ancestor up to and including the document, so asking it to reveal the newest line also moved
   * the whole page — once per turn, and again on every partial, while the person was talking.
   * Setting `scrollTop` on the box moves the box and nothing else.
   */
  const feedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [turns, partial]);

  // Off the page, not off this session's writes — answers brought back from an earlier form are
  // in the boxes too, and a counter that ignored them read "6 / 14" on a form with eleven filled.
  const filled = filledCount;
  const label =
    status === "reading"
      ? "Reading the form…"
      : status === "connecting"
        ? "Connecting…"
        : live
          ? "Stop"
          : "Hold to talk";

  return (
    <Section id="try">
      <Container>
        <Reveal>
          <Eyebrow n="04">Try it</Eyebrow>
          <h2 className="display mt-6 max-w-[18ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
            On a real application,
            <br />
            <span className="text-paper/45">not one we made up.</span>
          </h2>
          <p className="mt-6 max-w-[52ch] text-[16px] leading-relaxed text-dim" data-reveal>
            Two live forms, copied unchanged — a Greenhouse job application, and a Jotform that
            grows new questions as you answer. The labels, the order and every option are theirs.
            Press the microphone and it tells you what the form needs.
          </p>
        </Reveal>

        <Reveal className="mt-12">
          {/* Both columns are given the same explicit height rather than being
              left to stretch. The panel on the right holds a conversation that
              only ever gets longer, and with an auto height it pushed the whole
              section open turn by turn until the page was several screens tall.
              Fixed frame, scrolling contents — the same rule as the browser. */}
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]" data-reveal>
            <div className="flex flex-col gap-3">
              {/* Locked while a call is live: the agent is holding a tool built from the form on
                  screen, and swapping the form underneath it mid-sentence helps nobody. */}
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Choose a form">
                {(Object.keys(FORMS) as FormKey[]).map((key) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={which === key}
                    disabled={live && which !== key}
                    onClick={() => setWhich(key)}
                    className={`press rounded-full px-4 py-2 text-[13px] ${
                      which === key ? "btn-solid" : "btn-ghost"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {FORMS[key].tab}
                    <span className={which === key ? "text-ink/55" : "text-faint"}>
                      {" "}
                      · {FORMS[key].source}
                    </span>
                  </button>
                ))}
              </div>

              <div ref={formRef} className="h-[30rem] lg:h-[38rem]">
                <BrowserChrome url={url} live={live}>
                  <div className="p-5 sm:p-7">
                    {/* Keyed, so switching forms starts the new one empty rather than carrying
                        React state across two unrelated pages. */}
                    <Form key={which} />
                  </div>
                </BrowserChrome>
              </div>
            </div>

            <aside
              // Bottom-aligned with the browser window, which sits under the form tabs.
              className="panel flex h-[34rem] flex-col gap-4 sq p-6 lg:h-[38rem] lg:self-end"
              data-longtake-ignore
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-paper">What Longtake heard</span>
                <RecordDot live={status === "live"} />
              </div>

              <div className="shrink-0 rounded-xl border border-hair bg-ink px-4 py-2">
                <Waveform live={status === "live"} className="h-9" />
              </div>

              {/* What was actually said, newest last. Falls back to the instruction when
                  nothing has been said yet, so the panel is never an empty box.
                  `min-h-0` for the same reason as the browser window: without it this box
                  grows to fit the conversation instead of scrolling it. */}
              <div
                ref={feedRef}
                // A floor, not just `min-h-0`: the notices below used to squeeze this to two lines,
                // and the conversation is the thing a person is here to watch.
                className="min-h-[10rem] flex-1 space-y-3 overflow-y-auto text-[13.5px] leading-relaxed"
              >
                {turns.length === 0 && !partial ? (
                  <p className="text-dim">
                    Your words appear here as you speak. It tells you what the form needs, fills
                    what you say, and asks before it guesses.
                  </p>
                ) : (
                  <>
                    {turns.map((turn, i) => (
                      <p
                        key={i}
                        className={turn.who === "you" ? "text-paper" : "text-mint"}
                      >
                        {turn.who === "agent" && <span className="text-faint">Longtake: </span>}
                        {turn.text}
                      </p>
                    ))}
                    {partial && <p className="text-dim">{partial}</p>}
                  </>
                )}
              </div>

              {/* Everything the person may need to act on, in one strip with its own height
                  limit — so however many notices there are, they scroll here instead of eating
                  the conversation above. */}
              {(error || needsYou.length > 0 || waiting.length > 0 || fromMemory.length > 0 || filled > 0) && (
                <div className="max-h-[7.5rem] shrink-0 space-y-2 overflow-y-auto text-[12.5px] leading-snug">
                  {error && (
                    <p className="rounded-lg border border-hair px-3 py-2 text-dim">{error}</p>
                  )}

                  {/* The ones Longtake could not fill. Said out loud too, but a spoken sentence
                      is gone the moment it ends, and this is the thing to act on. */}
                  {needsYou.map((item) => (
                    <p key={item.fieldId} className="rounded-lg border border-hair bg-ink px-3 py-2 text-faint">
                      <span className="text-paper">Fill in yourself: </span>
                      <span className="text-dim">{item.question}</span> — {item.why}
                    </p>
                  ))}

                  {/* Held back until they say yes — "Twitter" is not on the list, "2.5 or 3" is not
                      an answer yet. On screen so it is clear why the box is still empty. */}
                  {waiting.map((item) => (
                    <p key={item.fieldId} className="rounded-lg border border-hair bg-ink px-3 py-2 text-faint">
                      <span className="text-paper">Waiting for your yes: </span>
                      <span className="text-dim">{item.question}</span> → {item.suggestion}
                    </p>
                  ))}

                  {/* Answers that arrived before anyone spoke. Said plainly, because a form that
                      fills itself unasked looks like a bug unless it says where the answers came
                      from — and forgetting them has to be one click. */}
                  {fromMemory.length > 0 && (
                    <p className="text-faint">
                      <span className="text-dim">From last time: </span>
                      {fromMemory
                        .slice(0, 4)
                        .map((item) => item.question)
                        .join(", ")}
                      {fromMemory.length > 4 && ` and ${fromMemory.length - 4} more`}
                      {" · "}
                      <button
                        onClick={forgetEverything}
                        className="text-dim underline decoration-dotted underline-offset-2 hover:text-paper"
                      >
                        forget them
                      </button>
                    </p>
                  )}

                  {missing.length > 0 && filled > 0 && (
                    <p className="text-faint">
                      Still empty: {missing.slice(0, 3).join(", ")}
                      {missing.length > 3 && ` and ${missing.length - 3} more`}
                    </p>
                  )}

                  {/* The checkpoint the agent also says out loud. */}
                  {missing.length === 0 && filled > 0 && (
                    <p className="text-faint">
                      <span className="text-mint">Required done</span>
                      {optionalLeft > 0 && ` · ${optionalLeft} optional left`}
                    </p>
                  )}
                </div>
              )}

              <div className="shrink-0">
                <div className="flex items-baseline justify-between">
                  <span className="tag text-faint">Filled</span>
                  <span className="font-mono text-[13px] text-paper">
                    {filled} / {fieldCount || "—"}
                  </span>
                </div>
                <div className="mt-2 h-px w-full bg-hair">
                  <div
                    className="h-px bg-mint transition-[width] duration-300 ease-out"
                    style={{ width: fieldCount ? `${(filled / fieldCount) * 100}%` : "0%" }}
                  />
                </div>

                <button
                  onClick={() => void (live ? stop() : start())}
                  className={`press mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-medium ${
                    live ? "btn-ghost" : "btn-solid"
                  }`}
                >
                  {live ? <StopIcon size={16} weight="fill" /> : <MicrophoneIcon size={17} weight="fill" />}
                  {label}
                </button>
                <p className="mt-2 text-center text-[12px] text-faint">
                  Your browser will ask for the microphone. Nothing is ever submitted.
                </p>
                {debug && (
                  <button
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify({ turns, log }, null, 2))}
                    className="mt-2 w-full text-center text-[11px] text-faint underline decoration-dotted"
                  >
                    Copy session log ({log.length} lines)
                  </button>
                )}
              </div>
            </aside>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
