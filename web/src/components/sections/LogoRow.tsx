import { Container } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * Social proof, honestly framed.
 *
 * Every landing page in this pattern has a logo row under the fold and almost
 * all of them say "trusted by". We cannot: nobody is using this yet, and a
 * borrowed customer list on a product whose whole pitch is "it never makes
 * anything up" would be the worst possible opening line.
 *
 * So it says what is true — the form systems it has actually been run against.
 */
const SYSTEMS = ["Greenhouse", "Lever", "Workday", "Ashby", "Typeform", "Google Forms"];

export function LogoRow() {
  return (
    <div className="border-t border-hair">
      <Reveal stagger={0.04}>
        <Container className="py-10">
          <p className="tag text-center text-faint" data-reveal>
            Run against the systems most applications are built on
          </p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {SYSTEMS.map((name) => (
              <li key={name} data-reveal className="text-[15px] tracking-tight text-paper/35">
                {name}
              </li>
            ))}
          </ul>
        </Container>
      </Reveal>
    </div>
  );
}
