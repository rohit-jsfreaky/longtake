"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The waveform.
 *
 * When `live` is false it rests as a flat, quiet line of stubs — a microphone
 * that is not listening should look like one. When live, bars move on an
 * irregular pattern rather than a sine wave, because real speech has loud
 * stretches and quiet ones and a tidy sine reads as decoration immediately.
 *
 * `amplitude` is here so this can be driven by the real microphone once the
 * session is wired; until then it animates its own shape and never pretends to
 * be showing audio that does not exist.
 */
const BARS = 44;

/** A fixed irregular envelope — deterministic, so it never hydrates differently. */
const SHAPE = Array.from({ length: BARS }, (_, i) => {
  const a = Math.sin(i * 0.7) * 0.5 + 0.5;
  const b = Math.sin(i * 1.9 + 1.3) * 0.5 + 0.5;
  const c = Math.sin(i * 0.31 + 2.4) * 0.5 + 0.5;
  return 0.18 + (a * 0.45 + b * 0.3 + c * 0.25) * 0.82;
});

export function Waveform({
  live = false,
  className = "",
}: {
  live?: boolean;
  className?: string;
}) {
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!live) {
      setT(0);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const started = performance.now();
    const loop = (now: number) => {
      setT((now - started) / 1000);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [live]);

  return (
    <div
      className={`flex h-14 items-center justify-center gap-[3px] ${className}`}
      aria-hidden
    >
      {SHAPE.map((base, i) => {
        const wobble = live ? 0.55 + 0.45 * Math.sin(t * 6 + i * 0.55) : 0;
        const height = live ? Math.max(0.1, base * wobble) : 0.055;
        return (
          <span
            key={i}
            className="w-[3px] rounded-full bg-paper transition-[height,opacity] duration-150 ease-out"
            style={{
              height: `${height * 100}%`,
              opacity: live ? 0.35 + height * 0.65 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}
