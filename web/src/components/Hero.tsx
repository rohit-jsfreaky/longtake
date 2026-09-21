"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";

import { Container, Doodle } from "./chrome";
import DotGrid from "./DotGrid";
import { HeroMotion } from "./motion";
import { SiteNav } from "./SiteNav";

/**
 * The fold.
 *
 * A field of dots that only wakes up where the cursor is, a headline split
 * across two tones, and two pill CTAs. Nothing else.
 *
 * There was a product panel under the fold showing the Greenhouse form filling
 * itself — the same form the "try it" section further down shows for real. Two
 * of the same thing, and the fake one came first. It is gone; the real demo
 * makes the point better and only needs making once.
 *
 * The dots are not decoration here: the product is about speaking into empty
 * space and having something answer, and a field that responds to you before
 * you have clicked anything says that before a word is read.
 */
export function Hero() {
  return (
    <HeroMotion>
      <div className="relative isolate min-h-[100svh] overflow-hidden">
        <div className="absolute inset-0 opacity-90">
          <DotGrid
            dotSize={3}
            gap={30}
            baseColor="#1F1F22"
            activeColor="#FAFAFA"
            proximity={130}
            shockRadius={230}
            shockStrength={4}
            returnDuration={1.4}
          />
        </div>

        {/* Anchored to the content column rather than the viewport edge.
            Positioned off `right-*` alone it hung past the right edge of the
            page on wide screens and read as a clipping bug. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          <Container className="relative h-full">
            <Doodle name="mic" className="absolute right-0 top-1/2 w-[440px] -translate-y-1/2" />
          </Container>
        </div>

        <div className="pointer-events-none relative flex min-h-[100svh] flex-col">
          <div className="pointer-events-auto">
            <SiteNav />
          </div>

          <Container className="flex flex-1 flex-col justify-center py-16">
            <div className="pointer-events-auto max-w-[920px]">
              <h1
                className="display text-[clamp(44px,7.4vw,92px)]"
                data-hero-line
              >
                Say it once.
                <br />
                <span className="text-paper/45">The form fills itself.</span>
              </h1>

              <p
                className="mt-8 max-w-[52ch] text-[18px] leading-[1.5] text-dim"
                data-hero-line
              >
                Nobody remembers their own LinkedIn URL by heart, and nobody wants to type the same
                forty answers again. Talk for about a minute and every field lands at once — on a
                form nobody built this for.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-3" data-hero-line>
                <a
                  href="#try"
                  className="press btn-solid inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium"
                >
                  Fill a real form
                  <ArrowRightIcon size={16} weight="bold" />
                </a>
                <a
                  href="#how"
                  className="press btn-ghost inline-flex h-12 items-center rounded-full px-7 text-[15px] font-medium"
                >
                  See how it works
                </a>
              </div>

              <p className="tag mt-8 text-faint" data-hero-line>
                No account · Runs in your browser · Never submits anything
              </p>
            </div>
          </Container>
        </div>
      </div>
    </HeroMotion>
  );
}
