import { BentoCard } from "@/components/bento/BentoCard";
import {
  SceneAnyForm,
  SceneAsk,
  SceneBurst,
  SceneLanguage,
  SceneLocal,
  ScenePlayback,
  SceneRecall,
} from "@/components/bento/scenes";
import { Container, Doodle, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * Spans are ordered so the grid tiles with no holes:
 *   row 1  [2][1]   row 2  [1][2]   row 3  [1][1][1]
 * Get the order wrong and a wide card wraps, leaving an empty cell mid-grid.
 *
 * Each cell leads with a live miniature of the feature rather than an icon —
 * see bento/scenes.tsx for why.
 */
const CELLS = [
  {
    scene: SceneAnyForm,
    title: "Any form, any site",
    body: "Job applications, insurance claims, visa paperwork, the school portal. It reads whatever is on the screen — including the dropdowns that only load once you click them.",
    span: "md:col-span-2",
  },
  {
    scene: SceneLanguage,
    title: "Switch language mid-sentence",
    body: "Start in English, drift into Hindi, come back. Hinglish is a first-class input, not an edge case.",
    span: "",
  },
  {
    scene: SceneBurst,
    title: "Twenty answers at once",
    body: "Not one box at a time. The whole form lands together, in the time it takes you to stop talking.",
    span: "",
  },
  {
    scene: SceneRecall,
    title: "The next form already knows",
    body: "Answer once and the next application opens filled in — matched by what each question means, not by what the box happened to be called.",
    span: "md:col-span-2",
  },
  {
    scene: SceneAsk,
    title: "It asks for what you missed",
    body: "Anything you did not mention stays empty, and it asks you out loud. One question, not forty.",
    span: "",
  },
  {
    scene: ScenePlayback,
    title: "It asks before it guesses",
    body: "Say “Twitter” to a list without Twitter and it offers the closest choice. Nothing goes in until you say yes.",
    span: "",
  },
  {
    scene: SceneLocal,
    title: "Stays on your machine",
    body: "No account. What it remembers about you never leaves your browser, and one click clears it.",
    span: "",
  },
];

export function HowItWorks() {
  return (
    <Section id="how" className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <Container className="relative h-full">
          <Doodle name="form" className="absolute right-0 top-0 w-[300px]" />
        </Container>
      </div>

      <Container className="relative">
        <Reveal>
          <Eyebrow n="03">What it does</Eyebrow>
          <h2 className="display mt-6 max-w-[18ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
            One minute of talking,
            <br />
            <span className="text-paper/45">and the paperwork is done.</span>
          </h2>
        </Reveal>

        <Reveal className="mt-14" stagger={0.05}>
          <div className="grid gap-3 md:grid-cols-3">
            {CELLS.map(({ scene: SceneArt, title, body, span }) => (
              <div key={title} data-reveal className={span}>
                <BentoCard className="h-full p-5">
                  {/* The miniature sits in its own sunk well so it reads as a
                      display rather than as loose artwork on the card. */}
                  <div className="overflow-hidden rounded-[10px] border border-hair bg-ink/70 px-2 py-3">
                    <SceneArt />
                  </div>
                  <h3 className="mt-5 text-[16px] font-medium tracking-tight text-paper">
                    {title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-dim">{body}</p>
                </BentoCard>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
