/**
 * Runs inside somebody else's page. This is where `core/` gets pointed at a live form.
 *
 * Phase 0 keeps it to a heartbeat: prove the hotkey reaches the page, and prove we can count
 * the fields on it. Phase 1 replaces the counting with the real `reader.ts`, and Phase 2 hands
 * the result to `binder.ts`.
 *
 * Plain JavaScript on purpose — no build step yet, so `chrome://extensions` → Load unpacked
 * works the moment you clone the repo. The bundler arrives when this file needs to import
 * TypeScript out of `core/`.
 */

let active = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "longtake:toggle") return;

  active = !active;

  if (!active) {
    console.log("[Longtake] stopped");
    return;
  }

  // A crude count, only so the heartbeat says something true about THIS page.
  // Deliberately not a field reader — that is `core/src/reader.ts` in Phase 1, and it has to be
  // one file, shared with the web demo, not a second implementation living here.
  const controls = document.querySelectorAll("input, textarea, select");
  console.log(
    `[Longtake] listening on ${location.host} — ${controls.length} form controls visible`,
  );
});

console.log("[Longtake] content script ready. Press Ctrl+Shift+L (Command+Shift+L on a Mac).");
