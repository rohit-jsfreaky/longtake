import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { Container } from "./chrome";
import { Mark } from "./Mark";

const LINKS = [
  { href: "#try", label: "Try it" },
  { href: "#how", label: "How it works" },
  { href: "#extension", label: "Extension" },
  { href: "#trust", label: "Trust" },
];

export function SiteNav() {
  return (
    <Container className="flex h-[76px] items-center justify-between gap-6">
      <Link href="/" className="press flex items-center gap-2.5">
        <Mark className="size-7" />
        <span className="text-[16px] font-medium tracking-tight text-paper">Longtake</span>
      </Link>

      <ul className="hidden items-center gap-1 md:flex">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="press rounded-full px-3.5 py-2 text-[14px] text-dim hover:bg-paper/5 hover:text-paper"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Link
          href="https://github.com/rohit-jsfreaky"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Source on GitHub"
          className="press inline-flex size-9 items-center justify-center rounded-full text-dim hover:bg-paper/5 hover:text-paper"
        >
          <GithubLogoIcon size={18} weight="fill" />
        </Link>
        <Link
          href="#try"
          className="press btn-solid h-10 rounded-full px-5 text-[14px] font-medium leading-10"
        >
          Try it
        </Link>
      </div>
    </Container>
  );
}
