"use client";

import { MicrophoneIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { RecordDot } from "@/components/RecordDot";
import { Reveal } from "@/components/motion";
import { Waveform } from "@/components/Waveform";
import { BrowserChrome } from "./BrowserChrome";
import { GleanApplication } from "./GleanApplication";

const FIELD_COUNT = 14;
const SOURCE_URL = "job-boards.greenhouse.io/gleanwork/jobs/4006731005";

/**
 * The working demo, on a real copied application.
 *
 * The microphone is not connected to this page yet — the voice session runs at
 * /fill — and the button says so rather than pretending. A control that looks
 * live and does nothing is exactly the kind of small lie this product cannot
 * afford to tell.
 */
export function Stage() {
  const [live] = useState(false);
  const [filled] = useState(0);

  return (
    <section id="try" className="section border-t border-hair">
      <div className="wrap">
        <Reveal>
          <h2
            className="display mx-auto max-w-[18ch] text-center text-[clamp(2rem,4vw,3rem)]"
            data-reveal
          >
            Try it on a real application.
          </h2>
          <p
            className="mx-auto mt-5 max-w-[52ch] text-center text-[16px] leading-relaxed text-dim"
            data-reveal
          >
            This is a live job posting, copied here exactly as it appears on Greenhouse — the
            labels, the order and every dropdown option are theirs.
          </p>
        </Reveal>

        <Reveal className="mt-12">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-stretch" data-reveal>
            <BrowserChrome url={SOURCE_URL} live={live}>
              <div className="max-h-[32rem] overflow-y-auto p-5 sm:p-7">
                <GleanApplication />
              </div>
            </BrowserChrome>

            <aside className="panel flex flex-col gap-5 sq p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-paper">What Longtake heard</span>
                <RecordDot live={live} />
              </div>

              <div className="rounded-xl border border-hair bg-ink px-4 py-3">
                <Waveform live={live} />
              </div>

              <p className="text-[13.5px] leading-relaxed text-dim">
                Your words appear here as you speak, and every answer keeps the audio that produced
                it — click any filled field to hear yourself say it.
              </p>

              <div className="mt-auto">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-dim">Fields filled</span>
                  <span className="text-[13px] font-medium text-paper">
                    {filled} of {FIELD_COUNT}
                  </span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-hair">
                  <div
                    className="h-1 rounded-full bg-mint transition-[width] duration-300 ease-out"
                    style={{ width: `${(filled / FIELD_COUNT) * 100}%` }}
                  />
                </div>

                <button
                  disabled
                  className="mt-5 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-ink px-6 py-3.5 text-[15px] font-medium text-paper opacity-40"
                >
                  <MicrophoneIcon size={17} weight="fill" />
                  Hold to talk
                </button>
                <p className="mt-3 text-center text-[12px] text-faint">
                  Not wired to this page yet — the working demo is at{" "}
                  <a
                    href="/fill"
                    className="cursor-pointer underline underline-offset-2 hover:text-dim"
                  >
                    /fill
                  </a>
                </p>
              </div>
            </aside>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
