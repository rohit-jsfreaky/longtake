import { Container, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * The sequence, in three moves.
 *
 * The bento says *what* it does; this says *in what order*, which is a
 * different question and the one people actually ask before trying something.
 *
 * Laid out as a numbered list with a hairline between rows rather than three
 * cards — cards would repeat the bento directly above it, and a sequence wants
 * to read downward, not sideways.
 */

const STEPS = [
  {
    n: "01",
    lead: "It reads the form before you say anything.",
    rest: "Including the dropdowns that have no options in them until something clicks them open. That part is why it works on forms it has never seen.",
  },
  {
    n: "02",
    lead: "You talk for about a minute.",
    rest: "Not field by field. One go, in whatever order it comes out, in whatever language it comes out in.",
  },
  {
    n: "03",
    lead: "Everything you covered lands at once.",
    rest: "Whatever you skipped stays empty, and it asks you about that out loud — then you read the form and send it yourself.",
  },
];

export function Steps() {
  return (
    <Section>
      <Container>
        <Reveal>
          <Eyebrow n="02">How it goes</Eyebrow>
          <h2 className="display mt-6 max-w-[16ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
            One breath in,
            <br />
            <span className="text-paper/45">twenty answers out.</span>
          </h2>
        </Reveal>

        <Reveal className="mt-16" stagger={0.08}>
          <ol>
            {STEPS.map(({ n, lead, rest }) => (
              <li
                key={n}
                data-reveal
                className="grid gap-x-10 gap-y-3 border-t border-hair py-9 md:grid-cols-[auto_1fr_1fr] md:items-baseline"
              >
                <span className="tag text-faint md:pt-1.5">{n}</span>
                <p className="text-[clamp(19px,2vw,25px)] font-medium leading-[1.25] tracking-[-0.02em] text-paper">
                  {lead}
                </p>
                <p className="text-[15px] leading-relaxed text-dim">{rest}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </Container>
    </Section>
  );
}
