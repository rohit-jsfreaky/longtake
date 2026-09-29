import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr";

import { Container, Eyebrow, Section } from "@/components/chrome";
import { Reveal } from "@/components/motion";

/**
 * The same thing, on any form on the web: the Chrome extension.
 *
 * The demo above runs on copies of real forms, inside this page. The extension is the product: it
 * opens on the form in front of you — any site, any page of it — with one hotkey. It is offered as
 * the exact zip sent to the Chrome Web Store, with the three steps to load it, because a store
 * review takes days and a person trying it today should not have to wait for one. Nothing here says
 * the store listing is live until it is.
 */

const STEPS = [
  { n: "01", lead: "Download and unzip it.", rest: "One folder, about 2 MB. Nothing to install beyond it." },
  {
    n: "02",
    lead: "Load it into Chrome.",
    rest: "Open chrome://extensions, turn on Developer mode (top right), press Load unpacked, and choose the folder.",
  },
  {
    n: "03",
    lead: "Open any form and press Ctrl+Shift+L.",
    rest: "Or click the Longtake icon. Press Start, allow the microphone once, and talk. It never submits — that stays yours.",
  },
];

export function GetExtension() {
  return (
    <Section id="extension">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <Reveal>
            <Eyebrow n="05">On any form</Eyebrow>
            <h2 className="display mt-6 max-w-[14ch] text-[clamp(30px,4.4vw,52px)]" data-reveal>
              Now take it
              <br />
              <span className="text-paper/45">to your own forms.</span>
            </h2>
            <p className="mt-6 max-w-[44ch] text-[16px] leading-relaxed text-dim" data-reveal>
              The demo runs on copies. The Chrome extension runs on the real thing — a job application, a
              Google Form with pages, a government form — and remembers you from one to the next, on
              this device only.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3" data-reveal>
              <a
                href="/longtake-extension.zip"
                download
                className="press btn-solid inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium"
              >
                <DownloadSimpleIcon size={17} weight="bold" />
                Download for Chrome
              </a>
              <a
                href="/privacy"
                className="press btn-ghost inline-flex h-12 items-center rounded-full px-6 text-[15px] font-medium"
              >
                What it can see
              </a>
            </div>
            <p className="tag mt-6 text-faint" data-reveal>
              Chrome, Edge, Brave · Version 1.0.0
            </p>
          </Reveal>

          <Reveal stagger={0.08}>
            <ol>
              {STEPS.map(({ n, lead, rest }) => (
                <li
                  key={n}
                  data-reveal
                  className="grid gap-x-8 gap-y-2 border-t border-hair py-7 first:border-t-0 first:pt-0 md:grid-cols-[auto_1fr] md:items-baseline"
                >
                  <span className="tag text-faint">{n}</span>
                  <div>
                    <p className="text-[clamp(18px,1.8vw,22px)] font-medium leading-[1.25] tracking-[-0.02em] text-paper">
                      {lead}
                    </p>
                    <p className="mt-2 text-[15px] leading-relaxed text-dim">{rest}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
