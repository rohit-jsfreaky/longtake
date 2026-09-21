import Link from "next/link";

import { Container } from "./chrome";
import { Mark } from "./Mark";

export function SiteFooter() {
  return (
    <footer className="border-t border-hair">
      <Container className="flex flex-wrap items-center justify-between gap-6 py-10">
        <div className="flex items-center gap-2.5">
          <Mark className="size-6" />
          <span className="text-[15px] font-medium tracking-tight text-paper">Longtake</span>
          <span className="ml-2 text-[13px] text-faint">Say it once.</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          <Link
            href="https://www.assemblyai.com/docs/voice-agents/voice-agent-api"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] text-faint transition-colors hover:text-paper"
          >
            Built on AssemblyAI
          </Link>
          <Link
            href="https://github.com/rohit-jsfreaky"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] text-faint transition-colors hover:text-paper"
          >
            Source
          </Link>
          <span className="text-[13px] text-faint">MIT</span>
        </div>
      </Container>
    </footer>
  );
}
