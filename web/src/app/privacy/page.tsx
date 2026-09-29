import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/chrome";
import { Mark } from "@/components/Mark";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Privacy — Longtake",
  description: "What Longtake keeps, what leaves your device, and why the extension asks for each permission.",
};

/**
 * The privacy policy — for people, and for the Chrome Web Store's review, which asks what an
 * extension with a microphone and access to every page does with them. Every line is what the code
 * does; nothing here is aspirational.
 */

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What stays on your device",
    body: [
      "The answers Longtake remembers for your next form — your name, email, phone, the long answers you approved — and your settings are kept in your browser only: the extension's own storage, or this site's local storage. They are never sent to our server and never kept on one.",
      "You can see, edit, export and delete every one of them in the extension's settings (What Longtake knows), and forget everything with one button.",
    ],
  },
  {
    title: "What leaves your device",
    body: [
      "Your voice. While a call is running, the microphone is streamed to AssemblyAI's Voice Agent API, which transcribes it and runs the conversation. The microphone is opened only when you press Start, and closed when you press Stop or close the window.",
      "When you open Longtake on a form, its questions — never your answers — go to AssemblyAI's LLM Gateway so Longtake knows what each field means.",
      "What you and the agent just said, so its claims can be checked against the form (\"Got that in\" when nothing went in).",
      "For a long answer you ask it to write up: your own words for it, the question, and the text of the page around the form (the job description), to draft it from. For a long spoken answer, its audio may be re-transcribed by AssemblyAI to get your wording exactly.",
      "All of this passes through this site's server (longtake-web.vercel.app) only to reach AssemblyAI with our key, so the key is never in your browser. Our server does not store it.",
    ],
  },
  {
    title: "What Longtake never does",
    body: [
      "It never submits a form. It types into it; you read it and press submit yourself.",
      "It never fills a field you did not speak to, and never writes anything you did not say without your yes.",
      "No accounts, no analytics, no advertising, and nothing is sold or shared with anyone other than AssemblyAI for the uses above.",
    ],
  },
  {
    title: "Why the extension asks for each permission",
    body: [
      "The microphone is not an extension permission: when you press Start, Chrome asks you on that page, and you can take it back at any time.",
      "Access to the pages you visit, and scripting — to read the form on the page you open Longtake on, fill in what you said, and show its small window there. It stays idle on every page until you click its icon.",
      "Access to longtake-web.vercel.app — to reach AssemblyAI through our server, which holds the key.",
      "Active tab — to open on the tab where you clicked its icon.",
      "Storage — to keep your saved answers and settings on your device.",
      "Web navigation — to find the frame that holds the form (some sites embed it), and to carry a call on when a form loads its next page.",
    ],
  },
  {
    title: "Questions",
    body: ["Longtake is open source. Questions and requests: github.com/rohit-jsfreaky."],
  },
];

export default function Privacy() {
  return (
    <>
      <main className="flex flex-1 flex-col">
        <Container className="flex h-[76px] items-center">
          <Link href="/" className="press flex items-center gap-2.5">
            <Mark className="size-7" />
            <span className="text-[16px] font-medium tracking-tight text-paper">Longtake</span>
          </Link>
        </Container>
        <Container className="py-16">
          <div className="max-w-[680px]">
          <h1 className="display text-[clamp(34px,5vw,56px)]">Privacy</h1>
          <p className="mt-5 text-[16px] leading-relaxed text-dim">
            Longtake fills in other people&rsquo;s forms from what you say. This is everything it keeps, everything
            that leaves your device, and why the Chrome extension asks for each permission. Updated 29 September 2026.
          </p>
          {SECTIONS.map((section) => (
            <section key={section.title} className="mt-12">
              <h2 className="text-[20px] font-medium tracking-tight text-paper">{section.title}</h2>
              <ul className="mt-4 space-y-3">
                {section.body.map((line) => (
                  <li key={line} className="text-[15px] leading-relaxed text-dim">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
