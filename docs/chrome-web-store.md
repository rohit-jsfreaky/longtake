# Chrome Web Store listing — Longtake 1.0.0

Package: `web/public/longtake-extension.zip` (`npm run pack:extension`). Visibility: **Unlisted**.

## Store listing

**Name** (from the manifest): Longtake — the whole form, in one take

**Summary** (from the manifest): Speak once, like telling a friend, and the whole form fills. It asks out loud only for what you did not cover.

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English

**Description:**

```
You already know the answers. Stop typing them into forty boxes.

Open any web form — a job application, a Google Form with pages, a government or college form — press Ctrl+Shift+L, and talk for a minute like you would to a friend. Longtake fills every field you spoke to, at once, on a form it has never seen before. Then it asks out loud only for what you did not cover.

What it will never do:
• Submit anything. It types into the form; you read it and press submit yourself.
• Fill a field you did not speak to. It leaves it blank and asks.
• Put in an answer you did not say without your yes. Say "Twitter" to a list without Twitter and it offers the closest choice and waits.

What makes it different:
• One breath, many fields. Not one mic per box: one spoken paragraph fills the whole form.
• Hindi, English, or both in one sentence.
• It remembers you, on this device only. The next form is already half done, and it tells you what it filled from last time.
• Long answers in your own words. Ask it to write one up and every sentence is held to what you said — no invented numbers, names or claims — and read back to you before it goes in.
• It checks itself. If the agent says "got that in" and the box is empty, it corrects itself out loud.

Works on React forms, dropdowns that search as you type, radio groups, checkboxes, dates, phones, forms inside iframes, and forms that load a new page on Next — the call carries on.

Built on AssemblyAI's Voice Agent API. Your saved answers never leave your browser. Privacy: https://longtake-web.vercel.app/privacy
```

## Privacy practices tab

**Single purpose:**

```
Longtake fills in the web form on the page you open it on, from what you say out loud, and asks by voice for what you did not cover.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| activeTab | Opens Longtake on the tab where the person pressed the hotkey or the toolbar icon. |
| scripting | Injects the form reader and its small window into a tab that was already open before the extension was installed, so the hotkey works without a reload. |
| storage | Keeps the person's saved answers and settings on their own device (chrome.storage.local), so the next form can be filled from what they said last time. Nothing is synced or sent to a server. |
| webNavigation | Finds the frame that holds the form (many sites embed their application form in an iframe) and carries a voice call on when a multi-page form loads its next page. |
| Host permission (content script on all URLs) | Forms live on any site. The content script stays idle until the person opens Longtake on that page; it then reads that page's form fields and fills in what the person said. |
| Host permission longtake-web.vercel.app | The extension's server: it mints a short-lived voice token and relays requests to AssemblyAI, so the API key is never in the extension. |

**Remote code:** No, I am not using remote code. (All JavaScript is in the package; the server returns data only.)

**Data usage — collected:** tick
- *Personally identifiable information* (name, email, phone the person speaks into a form)
- *Website content* (the form's questions, and the page text around the form when the person asks for a long answer to be drafted)
- *User activity*? — no. *Location*? — no (a city is only what they say). *Authentication info*, *Financial*, *Health*? — only if the person speaks it into such a form; leave unticked unless the reviewer asks.

Also covers **audio**: the voice is streamed to AssemblyAI during a call the person started.

**Certify all three:** not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.

**Privacy policy URL:** https://longtake-web.vercel.app/privacy

## Graphics

- Icon 128×128: `extension/icons/icon-128.png`
- Screenshots 1280×800: `docs/store/1-hero.png`, `2-demo.png`, `4-trust.png` (`node tools/store-shots.mjs` against the dev server)
- Small promo tile 440×280: optional
