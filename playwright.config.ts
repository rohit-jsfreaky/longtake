import { defineConfig } from "@playwright/test";

/**
 * The moat's test suite runs in a real browser, and it has to.
 *
 * jsdom cannot do this job: `getBoundingClientRect` returns zeroes there, so every visibility
 * decision — the thing that separates a real field from a honeypot — would be untestable. Shadow
 * roots, portals, `pointerdown` handlers and React-style components all need a real engine too.
 *
 * `channel: "chrome"` uses real Google Chrome rather than bundled Chromium, on CI as well as
 * locally. Several tests turn on measured pixel values (an `<input style="width:0">` reports
 * 7.2px; a checkbox reports 13px; the honeypot rule lives between them), so both places need to
 * be running the same engine or the suite would disagree with itself.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,

  /**
   * Half the cores locally. The suite is five hundred browser tests and letting it take every
   * core makes the machine unusable while it runs — which is how it stops being run.
   *
   * On CI, two. Playwright defaults to a single worker there for stability, which put the first
   * green run at five minutes; the tests are independent (each builds its own page with
   * `setContent`) so a second worker is safe, and `retries: 2` below covers the rest.
   */
  workers: process.env.CI ? 2 : "50%",

  /** A browser test that fails once under load has not necessarily found a bug. */
  retries: process.env.CI ? 2 : 0,

  /** No `.only` left behind in a commit. */
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list", { printSteps: false }]],

  use: {
    channel: "chrome",
    headless: true,
    trace: process.env.CI ? "retain-on-failure" : "off",
  },

  projects: [
    { name: "chrome", testIgnore: /corpus[\\/]/ },
    /**
     * Real forms, replayed offline from the private corpus. A site's own CSP would refuse the
     * injected `core/` bundle; the extension is never subject to it, so the corpus is not either.
     */
    {
      name: "corpus",
      testMatch: /corpus[\\/].*\.spec\.ts$/,
      use: { bypassCSP: true },
      // A real page, a full read with every dropdown opened, then ten answers that each wait for
      // the page to settle: 14–28 s on a quiet machine. The 30 s default is for one small page —
      // at it, a busy machine cut runs off mid-navigation ("ERR_ABORTED; frame detached").
      timeout: 120_000,
      // Last run's results cleared first; the report runs after, whatever passed or failed.
      dependencies: ["corpus-setup"],
      teardown: "corpus-report",
    },
    { name: "corpus-setup", testMatch: /corpus[\\/]setup\.ts$/ },
    { name: "corpus-report", testMatch: /corpus[\\/]report\.teardown\.ts$/ },
  ],
});
