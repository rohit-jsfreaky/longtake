"use client";

import { useState } from "react";

import { Container, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * The questions people actually ask, answered without hedging.
 *
 * Built on <details>-style state rather than a library, and animated with a
 * grid-rows trick: `grid-template-rows: 0fr → 1fr` is the only way to
 * transition to a content's natural height in CSS without measuring it in
 * JavaScript. `height: auto` is not animatable; this is.
 *
 * Deliberately blunt answers. An FAQ that dodges is worse than no FAQ, and on
 * a product whose entire pitch is "it never makes anything up", a evasive
 * answer here would undo the section above it.
 */

const QA = [
  {
    q: "Does it submit the application for me?",
    a: "No, and it never will. It fills the form and stops. You read what is there and press submit yourself. Plenty of companies actively screen out software that auto-applies, and more to the point, it is your name on the form.",
  },
  {
    q: "What if it gets something wrong?",
    a: "Anything it could not find in your own words never reaches the page at all. When you say something the form does not offer, or you are not sure, it asks before anything goes in. And you can tell it to clear or change any answer, out loud.",
  },
  {
    q: "Does it work on forms it has never seen?",
    a: "That is the whole point. It reads whatever is on the screen when you open it, including dropdowns whose options do not exist until something opens them. No site has to integrate with it and no form has to be known in advance.",
  },
  {
    q: "Where does my data go?",
    a: "What it remembers stays in your browser. No account, no sync, nothing uploaded, and one click clears it. Your speech goes to AssemblyAI to be transcribed, the same way any voice feature works, and nowhere else.",
  },
  {
    q: "Can I speak Hindi?",
    a: "Yes, including switching mid-sentence. Hinglish is a first-class input rather than an edge case — start in English, drift into Hindi, come back, and it keeps up.",
  },
  {
    q: "What happens to questions I do not answer?",
    a: "They stay empty, and it asks you about them out loud. It will not fill a field you did not speak to, even when it could make a good guess — a form full of plausible answers you never gave is worse than one with blanks in it.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section>
      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <Reveal>
            <Eyebrow n="06">Questions</Eyebrow>
            <h2 className="display mt-6 max-w-[12ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
              The ones
              <br />
              <span className="text-paper/45">people actually ask.</span>
            </h2>
          </Reveal>

          <Reveal stagger={0.04}>
            <ul className="border-t border-hair">
              {QA.map(({ q, a }, i) => {
                const isOpen = open === i;
                return (
                  <li key={q} data-reveal className="border-b border-hair">
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="press flex w-full items-center justify-between gap-6 py-5 text-left"
                    >
                      <span
                        className={`text-[16px] font-medium transition-colors ${
                          isOpen ? "text-paper" : "text-dim"
                        }`}
                      >
                        {q}
                      </span>
                      {/* A plus that becomes a minus. One rotating bar, no icon set. */}
                      <span className="relative size-4 shrink-0" aria-hidden>
                        <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-dim" />
                        <span
                          className={`absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-dim transition-transform duration-300 ${
                            isOpen ? "rotate-90" : ""
                          }`}
                          style={{ transitionTimingFunction: "var(--ease-out)" }}
                        />
                      </span>
                    </button>

                    {/* grid-rows 0fr→1fr is the only pure-CSS way to animate to
                        a content's natural height; `height: auto` cannot. */}
                    <div
                      className="grid transition-[grid-template-rows] duration-300"
                      style={{
                        gridTemplateRows: isOpen ? "1fr" : "0fr",
                        transitionTimingFunction: "var(--ease-out)",
                      }}
                    >
                      <div className="overflow-hidden">
                        <p className="max-w-[58ch] pb-6 text-[15px] leading-relaxed text-dim">
                          {a}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
