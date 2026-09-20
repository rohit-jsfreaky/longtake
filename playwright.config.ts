import { defineConfig } from "@playwright/test";

/**
 * The moat's test suite runs in a real browser, and it has to.
 *
 * jsdom cannot do this job: `getBoundingClientRect` returns zeroes there, so every visibility
 * decision — the thing that separates a real field from a honeypot — would be untestable. Shadow
 * roots, portals, `pointerdown` handlers and React-style components all need a real engine too.
 *
 * `channel: "chrome"` uses the Chrome already installed on the machine rather than downloading a
 * second browser, which also means the tests run against what a judge will actually use.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : [["list", { printSteps: false }]],
  use: {
    channel: "chrome",
    headless: true,
  },
  projects: [{ name: "chrome" }],
});
