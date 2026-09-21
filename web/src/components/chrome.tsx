import type { ReactNode } from "react";

/**
 * The page furniture — container, section, eyebrow, doodle.
 *
 * Deliberately the same shapes Outwait uses: one max width, one section rhythm,
 * every section numbered, and doodles as faint background marks rather than
 * illustrations you are meant to look at.
 */

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-[1180px] px-6 ${className}`}>{children}</div>;
}

export function Section({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`border-t border-hair py-24 sm:py-32 ${className}`}>
      {children}
    </section>
  );
}

/** Every section is numbered. The page reads like a case file, not a pitch. */
export function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="tag flex items-baseline gap-3 text-dim" data-reveal>
      <span className="text-paper/30">{n}</span>
      {children}
    </p>
  );
}

/**
 * A doodle. Hand-drawn white line art, dropped in at low opacity as texture.
 *
 * They are decoration in the strict sense — nothing depends on them — so they
 * are `aria-hidden` and lazy, and they must never sit where they can compete
 * with a headline.
 */
export function Doodle({
  name,
  className = "",
}: {
  name: "form" | "mic";
  className?: string;
}) {
  return (
    <img
      src={`/brand/doodle-${name}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      className={`pointer-events-none select-none opacity-70 ${className}`}
    />
  );
}
