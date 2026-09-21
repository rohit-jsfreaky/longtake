import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { Container } from "@/components/chrome";
import { Mark } from "@/components/Mark";
import { Reveal } from "@/components/motion";

/**
 * The close.
 *
 * Rebuilt on resend.com's closing, which is the most confident version of this
 * section anywhere: one enormous statement, centred, with a vertical gradient
 * painted through the letterforms, a single small button, and an enormous
 * amount of nothing around it. No panel, no border, no card — the restraint is
 * what makes it land.
 *
 * The version before this was a bordered dark box with a paragraph inside it,
 * which read as one more card at the end of a page already full of cards.
 *
 * What is ours: the mark sits above the statement with its waveform live, so
 * the last thing on the page is the thing the whole product is about. And the
 * line is about the *second* form, because that is the part that turns a trick
 * into something you keep.
 */
export function Closing() {
  return (
    <section className="relative overflow-hidden py-32 sm:py-44">
      {/* A single soft pool of light behind the statement. Tonal, not a hue —
          the page has no gradients anywhere else and this one is invisible
          unless you look for it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(255,255,255,0.045), transparent 68%)",
        }}
      />

      <Container className="relative text-center">
        <Reveal stagger={0.09}>
          <div className="flex justify-center" data-reveal>
            <Mark className="size-11" live />
          </div>

          <h2
            className="display fade-text mx-auto mt-12 max-w-[14ch] text-[clamp(38px,7vw,88px)]"
            data-reveal
          >
            The next one takes no minutes.
          </h2>

          <p
            className="mx-auto mt-8 max-w-[44ch] text-[17px] leading-[1.55] text-dim"
            data-reveal
          >
            You answer once. Every application after that opens already filled — even when it
            words the questions differently, even on a site you have never opened.
          </p>

          <div className="mt-11 flex flex-wrap items-center justify-center gap-3" data-reveal>
            <Link
              href="#try"
              className="press btn-solid inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium"
            >
              Fill a real form
              <ArrowRightIcon size={16} weight="bold" />
            </Link>
            <Link
              href="#trust"
              className="press btn-ghost inline-flex h-12 items-center rounded-full px-7 text-[15px] font-medium"
            >
              What it will not do
            </Link>
          </div>

          <p className="tag mt-10 text-faint" data-reveal>
            No account · Runs in your browser · Never submits anything
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
