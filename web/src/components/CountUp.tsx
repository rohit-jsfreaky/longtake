"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The counter that climbs as fields land — `0 / 22` → `20 / 22`.
 *
 * This is the wow moment given a number. It counts rather than jumps because a
 * number that changes in front of you reads as *twenty things happening*, while
 * one that snaps reads as a page re-render.
 *
 * Honest by construction: it only ever animates toward the real `value` it is
 * given. It never runs ahead of what actually landed on the form.
 */
export function CountUp({
  value,
  durationMs = 700,
  className = "",
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    // Reduced motion: no tween, just tell the truth immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setShown(value);
      return;
    }

    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      // Same curve as every other transition on the site.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  // `tabular-nums` so the counter does not jitter as digits change width.
  return <span className={`tabular-nums ${className}`}>{shown}</span>;
}
