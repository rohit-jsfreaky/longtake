"use client";

import { Container, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * The problem, stated with evidence rather than a statistic.
 *
 * No invented numbers. Every question in the column on the right is one that
 * actually appears on the Greenhouse application this site demos, and the point
 * makes itself by repetition: the same list, scrolling forever, because that is
 * what applying to anything is actually like.
 *
 * A marquee is the right form here because the content genuinely has no end —
 * which is the argument.
 */

const QUESTIONS = [
  "First name",
  "Last name",
  "Email",
  "Phone",
  "Country",
  "LinkedIn profile",
  "Website",
  "How did you hear about us?",
  "Years of relevant experience",
  "Why do you want this role?",
  "Current employer",
  "Notice period",
  "Expected compensation",
  "Are you legally authorised to work?",
  "Will you require sponsorship?",
  "Preferred pronouns",
  "Gender",
  "Are you Hispanic/Latino?",
  "Veteran status",
  "Disability status",
];

export function Problem() {
  // Duplicated so the loop has no visible seam.
  const loop = [...QUESTIONS, ...QUESTIONS];

  return (
    <Section className="overflow-hidden">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20">
          <Reveal>
            <Eyebrow n="01">The problem</Eyebrow>
            <h2
              className="display mt-6 max-w-[16ch] text-[clamp(30px,4.4vw,52px)]"
              data-reveal
            >
              You have answered all of this before.
              <br />
              <span className="text-paper/45">Several times this month.</span>
            </h2>
            <p className="mt-7 max-w-[46ch] text-[17px] leading-[1.55] text-dim" data-reveal>
              Nobody is refusing you. They are just asking you to type your own name, your own
              email and your own LinkedIn URL into another forty boxes — and then asking the next
              company to do it again.
            </p>
            <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-faint" data-reveal>
              Every question on the right is one that actually appears on the application this
              page demos.
            </p>
          </Reveal>

          {/* The list that never ends. */}
          <div
            className="relative h-[420px] overflow-hidden"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
            }}
            aria-hidden
          >
            <ul className="animate-[marquee-y_36s_linear_infinite] space-y-2.5">
              {loop.map((q, i) => (
                <li
                  key={`${q}-${i}`}
                  className="flex h-11 items-center gap-3 rounded-lg border border-hair px-4"
                >
                  <span className="size-3 shrink-0 rounded-[3px] border border-hair-lit" />
                  <span className="truncate text-[14px] text-dim">{q}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </Section>
  );
}
