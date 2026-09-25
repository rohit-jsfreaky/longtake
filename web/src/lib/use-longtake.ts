"use client";

/**
 * The call, for React.
 *
 * Everything about a call — the form, the voice, the tools, watching the page, the Dictation pass,
 * what did not go in — lives in `Conductor` (core/src/conductor.ts), the same one the extension
 * runs. This hook only builds it with the site's own services (its token route, its worklet, its
 * Dictation route) and hands React the conductor's view to draw.
 *
 * It used to hold all of that itself, and a copy of it lived in the extension. The two drifted, and
 * no replay could prove both. Now there is one.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  Conductor,
  type ConductorView,
  type DictationConfig,
  type DictationResult,
  type FormState,
  type FormSnapshot,
  type Hesitation,
  type KnownFact,
  type LogEntry,
  type ShapedAnswer,
  type StartProblem,
  type WriteOutcome,
} from "@longtake/core";

import { siteProfileStore } from "@/lib/profile-store";
import { siteToken } from "@/lib/voice-session";

export type LogLine = LogEntry;

export type Written = Extract<WriteOutcome, { status: "written" }>;
export type NotWritten = Exclude<WriteOutcome, { status: "written" }>;

export type Status = "idle" | "reading" | "connecting" | "live" | "reconnecting" | "error";

/**
 * Longtake's own controls, and the Next.js dev overlay, are not part of anybody's form.
 *
 * The dev overlay earns its place here: its button declares `aria-haspopup="menu"` exactly like
 * a real dropdown, so without naming it the schema gains a question called "Open Next.js Dev
 * Tools" with a three-option enum. Other people's furniture looks just like a form field.
 */
export const IGNORE = "[data-longtake-ignore], nextjs-portal, [data-nextjs-dev-tools-button]";

/**
 * The agent's voice.
 *
 * British, because the brief is closer to JARVIS than to a call centre, and the Voice Agent API
 * has four British English voices. `?voice=paul` on the page swaps it, so they can be compared by
 * ear on the real demo rather than chosen from a table. Anything not on the list is ignored.
 */
const DEFAULT_VOICE = "charles";
const VOICES = new Set(["charles", "paul", "anna", "vera", "alba", "eve", "george", "jane", "jean", "mary", "michael"]);

function chooseVoice(): string {
  const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("voice");
  return asked && VOICES.has(asked) ? asked : DEFAULT_VOICE;
}

/** One Dictation pass through our own route — the key never reaches the browser. */
async function dictate(config: DictationConfig, audio: string): Promise<DictationResult> {
  const response = await fetch("/api/dictate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config, audio }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `dictation failed (${response.status})`);
  return payload as DictationResult;
}

/**
 * What each field means, from our own route — the model is reached from the server, with the key
 * that never leaves it. A failure here only means nothing from last time goes in unasked.
 */
async function understand(snapshot: FormSnapshot): Promise<unknown> {
  const response = await fetch("/api/understand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `understanding failed (${response.status})`);
  return payload;
}

export type UseLongtake = {
  status: Status;
  live: boolean;
  error: string | null;
  /** What kind of problem stopped the call starting — the microphone, most often — or null. */
  problem: StartProblem | null;
  /** The form as it is right now — the one source for everything below. */
  form: FormState;
  /** How many fields the reader found on the page. */
  fieldCount: number;
  /** How many have an answer in them, read off the page. */
  filledCount: number;
  /** Every write this session, in order. */
  outcomes: WriteOutcome[];
  written: Written[];
  refused: NotWritten[];
  /** Labels of required fields still empty. */
  missing: string[];
  optionalLeft: number;
  /** Answers waiting for the person's yes. */
  waiting: { fieldId: string; question: string; suggestion: string; heard: string }[];
  /** Fields the person spoke to that did not land — kept on screen until they have something in them. */
  needsYou: { fieldId: string; question: string; why: string }[];
  turns: { who: "you" | "agent"; text: string }[];
  /** The running text of the turn in progress. Replace, never append. */
  partial: string;
  shaped: Record<string, ShapedAnswer>;
  hesitations: Record<string, Hesitation>;
  /** Everything known about the person, newest first. */
  known: KnownFact[];
  /** Answers that came from an earlier form. */
  fromMemory: { fieldId: string; question: string }[];
  log: LogLine[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  forgetOne: (id: string) => void;
  forgetEverything: () => void;
};

const noop = () => () => {};

export function useLongtake({
  ignore = IGNORE,
  root,
}: {
  ignore?: string;
  /**
   * Where to look for the form. Defaults to the whole document.
   *
   * The landing page needs this: it has an FAQ, a nav and its own controls on it, and reading the
   * whole document there would hand the agent a tool built partly out of our own furniture.
   */
  root?: () => Element | null;
} = {}): UseLongtake {
  /**
   * One conductor per mounted page, created on first use so the root function is read after mount,
   * and kept for the life of the component so remembered answers and the ledger survive stopping
   * and starting the microphone.
   */
  const conductorRef = useRef<Conductor | null>(null);
  const conductor = useCallback((): Conductor => {
    conductorRef.current ??= new Conductor({
      root: () => root?.() ?? document,
      ignore,
      profile: siteProfileStore(),
      logFrames: true,
      services: { getToken: siteToken, workletUrl: "/pcm-processor.js", voice: chooseVoice(), dictate, understand },
    });
    return conductorRef.current;
  }, [ignore, root]);

  const subscribe = useCallback((listener: () => void) => conductor().subscribe(listener), [conductor]);
  const view: ConductorView | null = useSyncExternalStore(
    typeof window === "undefined" ? noop : subscribe,
    () => conductor().view(),
    () => null,
  );

  /** Remembered answers go in at page load, before anybody presses anything. */
  useEffect(() => {
    void conductor().prepare();
  }, [conductor]);

  useEffect(() => () => void conductorRef.current?.stop(), []);

  /**
   * Mark the fields worth a second look, softly — a thin amber ring. An offer, not a verdict.
   */
  const hesitations = view?.hesitations;
  useEffect(() => {
    const read = conductorRef.current?.session.read;
    if (!read || !hesitations) return;
    const touched: HTMLElement[] = [];
    for (const fieldId of Object.keys(hesitations)) {
      const element = read.handles.get(fieldId);
      if (!element) continue;
      element.style.boxShadow = "0 0 0 2px rgba(217, 119, 6, 0.45)";
      element.style.borderRadius = element.style.borderRadius || "6px";
      touched.push(element);
    }
    return () => {
      for (const element of touched) element.style.boxShadow = "";
    };
  }, [hesitations]);

  const start = useCallback(() => conductor().start(), [conductor]);
  const stop = useCallback(() => conductor().stop(), [conductor]);
  const forgetOne = useCallback((id: string) => void conductor().forgetOne(id), [conductor]);
  const forgetEverything = useCallback(() => void conductor().forgetEverything(), [conductor]);

  // ── What the page draws — all of it derived from the one view ─────────────────────────

  const derived = useMemo(() => {
    const form = view?.form ?? EMPTY_FORM;
    const outcomes = view?.outcomes ?? [];
    const label = (id: string) =>
      (form.fields.find((f) => f.spec.id === id)?.spec.label || id).replace(/\s*\*\s*$/, "").trim();

    const latest = new Map<string, WriteOutcome>();
    for (const outcome of outcomes) latest.set(outcome.fieldId, outcome);

    return {
      written: [...latest.values()].filter((o): o is Written => o.status === "written"),
      refused: [...latest.values()].filter((o): o is NotWritten => o.status !== "written"),
      missing: form.fields.filter((f) => f.spec.required && f.value === null && !f.declined).map((f) => label(f.spec.id)),
      waiting: form.fields
        .filter((f) => f.pending)
        .map((f) => ({ fieldId: f.spec.id, question: label(f.spec.id), suggestion: f.pending!.suggestion, heard: f.pending!.heard })),
      fromMemory: form.fields.filter((f) => f.source === "memory").map((f) => ({ fieldId: f.spec.id, question: label(f.spec.id) })),
    };
  }, [view?.form, view?.outcomes]);

  const status: Status = !view || view.status === "stopped" ? "idle" : view.status;
  const form = view?.form ?? EMPTY_FORM;

  return {
    status,
    live: status !== "idle" && status !== "error",
    error: view?.error ?? null,
    problem: view?.problem ?? null,
    form,
    fieldCount: form.progress.total,
    filledCount: form.progress.filled,
    outcomes: view?.outcomes ?? [],
    optionalLeft: form.progress.optionalLeft,
    ...derived,
    needsYou: view?.missed ?? [],
    turns: view?.turns ?? [],
    partial: view?.partial ?? "",
    shaped: view?.shaped ?? {},
    hesitations: view?.hesitations ?? {},
    known: view?.known ?? [],
    log: view?.log ?? [],
    start,
    stop,
    forgetOne,
    forgetEverything,
  };
}

const EMPTY_FORM: FormState = {
  title: "",
  fields: [],
  theirs: [],
  asks: [],
  actions: [],
  progress: { filled: 0, total: 0, requiredLeft: 0, optionalLeft: 0 },
};
