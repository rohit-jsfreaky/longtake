/**
 * Service worker. Three small jobs, none of them about forms.
 *
 * 1. The hotkey. It goes to the frame that holds the form — on a careers page that embeds
 *    Greenhouse, that is an iframe, not the page — so every frame is asked how many fields it has.
 * 2. The token. A voice session needs a single-use token minted with our API key, which only the
 *    Longtake site holds. The page cannot ask the site itself (a different origin); this worker
 *    can, with the host permission in the manifest. The key never reaches the extension.
 * 3. Carrying a call across a page load. Some forms load each page afresh — Google Forms posts
 *    every page — which ends the content script mid-call. The tab is remembered as live, and the
 *    next page of the same site picks the call up again.
 *
 * `chrome.*` still works on every version including 148+, where `browser.*` was added.
 * Docs: https://developer.chrome.com/docs/extensions/reference/api/commands
 */

/**
 * Where the token comes from. The deployed Longtake site once it is live; the dev server until then.
 * `chrome.storage.local.set({ site })` overrides it without a rebuild.
 */
const DEFAULT_SITE = "http://localhost:3000";

/** A tab stays "live" across a page load for this long — long enough to load, not to wander off. */
const CARRY_OVER_MS = 60_000;

async function site() {
  const { site: override } = await chrome.storage.local.get("site");
  return (override || DEFAULT_SITE).replace(/\/+$/, "");
}

/** Which frame of this tab holds the most form. The top frame wins a tie. */
async function formFrame(tabId) {
  let frames = [];
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  } catch {
    frames = [{ frameId: 0 }];
  }
  let best = null;
  for (const { frameId } of frames) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: "longtake:count" }, { frameId });
      if (!reply) continue;
      const better =
        !best || reply.fields > best.fields || (reply.fields === best.fields && reply.top && !best.top);
      if (better) best = { frameId, fields: reply.fields, top: reply.top };
    } catch {
      // No content script in that frame — about:blank ads, sandboxed frames. Not ours.
    }
  }
  return best && best.fields > 0 ? best.frameId : best?.top ? 0 : null;
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-longtake") return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId !== undefined) await toggle(tabId);
});

/** Start or stop Longtake in a tab. Named, so the extension's own tests can press the hotkey. */
async function toggle(tabId) {
  // A tab already live is stopped wherever it is running.
  const live = await liveTabs();
  if (live[tabId]) {
    await chrome.tabs.sendMessage(tabId, { type: "longtake:toggle" }, { frameId: live[tabId].frameId }).catch(() => {});
    return;
  }
  const frameId = await formFrame(tabId);
  if (frameId === null) return; // chrome:// pages, the Web Store, PDF viewers: nothing to fill
  await chrome.tabs.sendMessage(tabId, { type: "longtake:toggle" }, { frameId }).catch(() => {});
}
globalThis.longtakeToggle = toggle;

/** Tabs mid-call, in session storage so a restarted worker still knows. */
async function liveTabs() {
  return (await chrome.storage.session.get("live")).live ?? {};
}
async function setLive(tabId, value) {
  const live = await liveTabs();
  if (value) live[tabId] = value;
  else delete live[tabId];
  await chrome.storage.session.set({ live });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;

  if (message?.type === "longtake:token") {
    (async () => {
      try {
        const response = await fetch(`${await site()}/api/voice-token`, { cache: "no-store" });
        const body = await response.json();
        reply(response.ok ? { token: body.token } : { error: body.error ?? `Token request failed (${response.status})` });
      } catch (cause) {
        reply({ error: `Could not reach the Longtake site for a voice token. ${String(cause)}` });
      }
    })();
    return true; // answered asynchronously
  }

  if (message?.type === "longtake:active" && tabId !== undefined) {
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
    void setLive(tabId, message.active ? { frameId: sender.frameId ?? 0, origin, at: Date.now() } : null);
    return;
  }

  if (message?.type === "longtake:loaded" && tabId !== undefined && message.top) {
    // The top frame of a new page. If this tab was live on the same site a moment ago, carry on.
    (async () => {
      const was = (await liveTabs())[tabId];
      if (!was) return;
      const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
      if (Date.now() - was.at > CARRY_OVER_MS) {
        await setLive(tabId, null);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 800)); // let the frames load
      const frameId = await formFrame(tabId);
      const sameSite = origin === was.origin || frameId !== 0;
      if (frameId === null || !sameSite) {
        await setLive(tabId, null);
        return;
      }
      await chrome.tabs.sendMessage(tabId, { type: "longtake:resume" }, { frameId }).catch(() => {});
    })();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void setLive(tabId, null));
