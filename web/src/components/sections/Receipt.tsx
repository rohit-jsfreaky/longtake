import { Container, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * What it will not do.
 *
 * Rebuilt on Apple's privacy-page pattern, measured off the live page:
 * card `#1D1D1F` at 30px radius with **no border at all**, and a statement set
 * at 40px / 600 / line-height 1.1 where the default colour is GREY and only the
 * key phrase is white. That inversion is the whole trick — the eye lands on the
 * promise, then reads the qualification around it.
 *
 * The version before this put each guarantee in a fake form field with a note
 * underneath. Two type sizes, a mock input and a caption per card is three
 * things competing; one big sentence is one thing, and these sentences are
 * strong enough to carry a card on their own.
 */

type Promise_ = {
  /** The part set in white. Always the commitment itself. */
  lead: string;
  /** The rest, in grey. */
  rest: string;
  tag: string;
};

const PROMISES: Promise_[] = [
  {
    tag: "Evidence",
    lead: "Every answer has to be something you actually said.",
    rest: "If it cannot find your words for it, it does not go in — and a choice you did not name waits for your yes.",
  },
  {
    tag: "Blanks",
    lead: "If you never mentioned it, it stays empty.",
    rest: "It would rather leave a blank on your application than put a plausible guess there.",
  },
  {
    tag: "Doubt",
    lead: "It can tell you hesitated. That is all it will say.",
    rest: "It does not decide whether you meant it, and it never claims to know if you told the truth.",
  },
  {
    tag: "Submission",
    lead: "It fills the form and stops.",
    rest: "You read it, you press submit, and nothing moves until you do.",
  },
];

export function Receipt() {
  return (
    <Section id="trust">
      <Container>
        <Reveal>
          <Eyebrow n="05">What it will not do</Eyebrow>
          <h2 className="display mt-6 max-w-[20ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
            A form full of things you never said
            <br />
            <span className="text-paper/45">is worse than an empty one.</span>
          </h2>
          <p className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-dim" data-reveal>
            This is your name on somebody&rsquo;s desk. So the rules are boring on purpose.
          </p>
        </Reveal>

        <Reveal className="mt-14" stagger={0.06}>
          <div className="grid gap-3 md:grid-cols-2">
            {PROMISES.map(({ lead, rest, tag }) => (
              <div
                key={tag}
                data-reveal
                className="flex min-h-[260px] flex-col justify-between rounded-[26px] bg-ink-700 p-8 sm:p-10"
              >
                <span className="tag text-faint">{tag}</span>
                <p className="mt-10 text-[clamp(21px,2.2vw,28px)] font-medium leading-[1.22] tracking-[-0.02em] text-dim">
                  <span className="text-paper">{lead}</span> {rest}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
