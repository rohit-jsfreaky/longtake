"use client";

import { useRef, type ReactNode } from "react";

/**
 * A bento cell with Linear's shine on its border.
 *
 * The overlay is nothing but a border, masked to a soft blob at
 * `--mask-x`/`--mask-y`; moving those with the pointer makes the edge appear to
 * catch light only where your hand is. See `.shine` in globals.css.
 *
 * Written straight to `style` rather than through React state on purpose. This
 * fires on every pointermove, and a setState per move would re-render the whole
 * grid sixty times a second. Writing the custom property on one element only
 * touches that element's style recalculation — and critically NOT the parent's,
 * because a variable set on a parent is inherited and invalidates every child.
 */
export function BentoCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className={`panel panel-hover shine-host overflow-hidden ${className}`}
      onPointerMove={(event) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const shine = el.querySelector<HTMLElement>("[data-shine]");
        if (!shine) return;
        shine.style.setProperty("--mask-x", `${event.clientX - rect.left}px`);
        shine.style.setProperty("--mask-y", `${event.clientY - rect.top}px`);
      }}
    >
      <span data-shine className="shine" aria-hidden />
      {children}
    </div>
  );
}
