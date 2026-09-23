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
  // The frame with the form, or — when no frame has one — the top frame, so the panel can say so.
  if (!best) return null;
  return best.fields > 0 ? best.frameId : 0;
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-longtake") return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId !== undefined) await toggle(tabId);
});

// The toolbar icon does exactly what the hotkey does. A hotkey can fail to register — Chrome and
// Brave silently leave it unassigned when another extension or the browser already uses it — so
// the icon is the one way in that always works.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id !== undefined) void toggle(tab.id);
});

/** Open or close Longtake in a tab. Named, so the extension's own tests can press the hotkey. */
async function toggle(tabId) {
  // A tab already live is toggled wherever it is running.
  const live = await liveTabs();
  if (live[tabId]) {
    const sent = await chrome.tabs
      .sendMessage(tabId, { type: "longtake:toggle" }, { frameId: live[tabId].frameId })
      .catch(() => null);
    if (sent) return;
    await setLive(tabId, null); // that frame is gone; start over below
  }
  let frameId = await formFrame(tabId);
  if (frameId === null) {
    // Nothing answered: a tab that was open before the extension was installed or reloaded has
    // no content script in it. Put one in now, rather than asking the person to reload the page
    // and lose what they typed.
    const why = await inject(tabId);
    if (why) {
      await explain(tabId, why);
      return;
    }
    frameId = await formFrame(tabId);
    if (frameId === null) {
      await explain(tabId, "failed");
      return;
    }
  }
  await chrome.tabs.sendMessage(tabId, { type: "longtake:toggle" }, { frameId }).catch(() => {});
}

/** Load the content script into a tab that lacks it. Returns why it could not, or null. */
async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["dist/content.js"] });
    return null;
  } catch (cause) {
    // Chrome refuses outright on its own pages, the Web Store and the PDF viewer.
    return /cannot be scripted|chrome:\/\/|extensions gallery|Cannot access|brave:\/\//i.test(String(cause))
      ? "blocked"
      : "failed";
  }
}

/**
 * Say why Longtake did not open, where the person is looking: a popup from the icon they clicked.
 * Set for this tab only, and cleared by the popup itself, so the next click tries the page again.
 */
async function explain(tabId, why) {
  await chrome.action.setPopup({ tabId, popup: `popup.html?why=${why}&tab=${tabId}` });
  try {
    await chrome.action.openPopup();
  } catch {
    // Some browsers only open an action popup from a click on the icon itself. The popup is set,
    // so that click shows it; the badge says there is something to see.
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#e0b060" });
    await chrome.action.setBadgeText({ tabId, text: "!" });
  }
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

  if (message?.type === "longtake:settings") {
    // Content scripts cannot open extension pages themselves.
    const tab = message.tab === "voice" ? "#voice" : "";
    void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${tab}`) });
    return;
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
