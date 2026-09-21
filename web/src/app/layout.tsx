import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Longtake — the whole form, in one take",
  description:
    "Speak once, for about a minute, like telling a friend. Twenty fields fill at once on a form you do not own. It asks out loud only for what you did not cover.",
};

/**
 * Typed by hand rather than with Next's generated `LayoutProps<"/">`.
 *
 * That type lives in `.next/types`, which only exists after a build — so on a clean checkout
 * `npm run typecheck` failed with *"Cannot find name 'LayoutProps'"*, which is exactly what CI
 * found on its first run. It worked locally only because a stale `.next` was lying around.
 * A root layout takes nothing but its children, so naming the type outright costs nothing and
 * the repo now type-checks the moment it is cloned.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
