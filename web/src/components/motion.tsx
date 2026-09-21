"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Motion, kept in one file.
 *
 * None of this is UI. It only decides when a thing arrives on screen, and how
 * the page moves under the scroll.
 */

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Lifts every `[data-reveal]` child into place once, when the group scrolls in.
 *
 * The query is scoped to this subtree, never the document — `gsap.utils.toArray`
 * is not scoped by `useGSAP`, so a page-wide selector lets one section hide
 * every other section's content and most of the page never appears.
 */
export function Reveal({
  children,
  className = "",
  stagger = 0.07,
  y = 24,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  y?: number;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;

      const targets = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
      if (!targets.length) return;

      if (reduced()) {
        gsap.set(targets, { autoAlpha: 1, y: 0 });
        return;
      }

      gsap.set(targets, { autoAlpha: 0, y });
      gsap.to(targets, {
        autoAlpha: 1,
        y: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger,
        scrollTrigger: {
          trigger: el,
          // Anything already on screen at load reveals straight away; anything
          // below reveals as it comes up.
          start: "top 92%",
          once: true,
        },
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

/** The hero settles in on load rather than snapping in finished. */
export function HeroMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (reduced()) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      tl.from("[data-hero-art]", { scale: 1.12, autoAlpha: 0, duration: 1.4 })
        .from("[data-hero-line]", { y: 26, autoAlpha: 0, duration: 0.9, stagger: 0.11 }, 0.25)
        .from("[data-hero-panel]", { y: 44, autoAlpha: 0, duration: 1.1 }, 0.6);
    },
    { scope: root },
  );

  return <div ref={root}>{children}</div>;
}

/**
 * Smooth scrolling, so a long page reads as one movement.
 *
 * Lenis drives the scroll position itself, so ScrollTrigger has to be told
 * about it — otherwise every reveal below the fold fires at the wrong moment,
 * or never fires at all.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (reduced()) return;

    const lenis = new Lenis({ duration: 1.05 });

    lenis.on("scroll", ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Web fonts land after first paint and change every measurement with them.
    document.fonts?.ready.then(() => ScrollTrigger.refresh());

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  return null;
}
