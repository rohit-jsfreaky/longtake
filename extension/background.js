/**
 * Service worker. Its only job is to turn the hotkey into a message for the page.
 *
 * Chrome 148 added the standardised `browser.*` namespace, but `chrome.*` still works on every
 * version including 148+, so we stay on `chrome.*` until the floor moves.
 * Docs: https://developer.chrome.com/docs/extensions/reference/api/commands
 *
 * A command shortcut must contain Ctrl or Alt, and Ctrl+Alt is rejected outright. On macOS
 * `Ctrl` is auto-converted to `Command`; we name the mac binding anyway so it reads clearly.
 */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-longtake") return;

  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: "longtake:toggle" });
  } catch {
    // No content script on this tab — chrome:// pages, the Web Store, PDF viewers.
    // Silently ignoring is correct here: there is no form to fill on those pages anyway.
  }
});
