import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * Display, body, mono — the same three roles Outwait uses, because the split
 * works: a grotesk with some width for headlines, a neutral face for reading,
 * and a mono reserved for labels, counters and captions.
 */
const display = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
});

const sans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Longtake — say it once, the form fills itself",
  description:
    "Talk for about a minute, the way you would tell a friend. Longtake fills every field on the page at once — on job applications, claims, and any other form you did not build.",
};

/**
 * Typed by hand rather than with Next's generated `LayoutProps<"/">`, which
 * lives in `.next/types` and does not exist on a clean checkout — exactly what
 * CI caught the first time it ran.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
