import Link from "next/link";

/**
 * Placeholder. The real landing page — three forms copied from real sites, unchanged, and a
 * floating button that fills them by voice — is Phase 8a.
 *
 * It exists now only so that an early deploy shows what Longtake is instead of the
 * create-next-app template.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Longtake</h1>
        <p className="mt-3 text-xl text-neutral-600 dark:text-neutral-400">
          The whole form, in one take.
        </p>
      </div>

      <p className="text-lg leading-relaxed text-neutral-700 dark:text-neutral-300">
        A voice layer for <em>other people&apos;s</em> forms. Speak once, for about a minute, like
        telling a friend — and the fields fill on a form you do not own and cannot change. It asks
        out loud only for what you did not cover, and it never writes a field you did not speak to.
      </p>

      <p className="text-sm text-neutral-500">
        Being built in the open. The demo lands here.
      </p>

      <div>
        <Link
          href="/hello"
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Voice connection check
        </Link>
      </div>
    </main>
  );
}
