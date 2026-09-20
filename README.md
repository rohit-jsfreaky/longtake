# Longtake

**The whole form, in one take.** One breath. No cuts. Twenty fields.

Longtake is a voice layer for **other people's** forms. You speak once, for about a minute, like
telling a friend — and the fields fill on a form you do not own and cannot change. It asks out
loud only for what you did not cover, it never writes a field you did not speak to, and every
answer keeps your own voice attached to it.

Built on the [AssemblyAI Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api)
for the AssemblyAI Voice Agent Hackathon.

## The idea

Every voice input tool today has the same shape: **one mic icon, one text box.** Notes apps,
email clients, CRMs, dictation tools. They all solve "typing is slow."

None of them solve the actual problem, which is that **a form is an interrogation.** Forty boxes,
asked one at a time, about things you already know off the top of your head.

But one spoken paragraph already contains twenty field values. The job is not transcription. The
job is knowing what each field expects *before* deciding what the words mean, and then writing
only the ones the person actually spoke to.

**The unit is not a field. The unit is a breath.**

## Status

Built in the open, one phase at a time. This table is the honest state — nothing below is
described as working before it works.

| Piece | What it does | State |
|---|---|---|
| `web/` | Next.js 16 app, the demo you can click | ✅ builds and runs |
| `web/src/app/api/voice-token/` | mints a short-lived token so the API key stays server-side | ✅ working |
| `web/src/lib/voice-session.ts` | one Voice Agent call in the browser: mic, socket, playback, barge-in | ✅ written |
| `web/public/pcm-processor.js` | AudioWorklet, resamples mic audio to 24 kHz | ✅ working |
| `web/src/app/hello/` | workbench page — talk, watch every frame in both directions | ✅ working |
| `core/src/types.ts` | the shared vocabulary: `FieldSpec`, `FieldHandles`, `SpokenValue` | ✅ written |
| `core/src/reader.ts` | somebody else's DOM → `FieldSpec[]` | ⬜ next |
| `core/src/writer.ts` | values → live inputs, without the page noticing anything odd | ⬜ next |
| `core/src/binder.ts` | `FieldSpec[]` → a JSON-Schema tool built at runtime | ⬜ planned |
| `core/src/dictation.ts` | per-field shaping, verbatim kept beside the clean text | ⬜ planned |
| `extension/` | Chrome MV3, runs `core/` against any live page | 🟡 skeleton + hotkey only |

## How AssemblyAI is used

Three surfaces, each doing something only it can do.

- **Voice Agent API — the spine.** Turn detection, interruption, LLM routing, voice output, and
  JSON-Schema tool calling. The agent is what asks you, out loud, about the one field you skipped.
- **Dictation API — the edge.** Long free-text answers get shaped to the field they are going
  into, and the raw verbatim is kept beside the cleaned-up text rather than thrown away.
- **Turn detection, tuned for a breath.** Silence thresholds are set for dictation-style speech,
  not conversation, so a 60-second answer does not get cut off mid-sentence.

## Run it

Needs Node 18+ and an [AssemblyAI API key](https://www.assemblyai.com/dashboard/api-keys). One key
covers everything here.

```bash
git clone <this repo>
cd longtake
npm install

cp web/.env.example web/.env.local   # then paste your key into it
npm run dev
```

Open <http://localhost:3000/hello>, press **Start talking**, and say something. If a transcript
comes back, everything is wired: the mic, the token route and the Voice Agent socket.

The key never reaches the browser. The server mints a short-lived, single-use token and only that
token goes to the client.

```bash
npm run build       # production build
npm run typecheck   # both packages
```

## Layout

An npm workspace, so the exact same `core/` runs in two places — the web app and the extension —
with no second implementation to keep in sync.

```
longtake/
├── core/         @longtake/core — plain TypeScript, no dependencies, no framework
│   └── src/      reader · writer · binder · dictation · hesitation
├── web/          Next.js 16 + Tailwind v4. The demo, and the token endpoint
└── extension/    Chrome MV3. Same core/, pointed at whatever page you are on
```

`core/` deliberately has no dependencies and imports nothing from React, Next or Chrome. That is
what lets one copy of the field logic serve both the web demo and the extension.

## The extension

Not published yet. To run the skeleton:

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick the `extension/` folder
3. Open any page with a form and press **Ctrl+Shift+L** (**Command+Shift+L** on a Mac)

Right now it reports what it can see in the console. The real work lands with `reader.ts`.

## Design rules

Two of these are hard constraints, not preferences.

- **Never fill a field the person did not speak to.** Not a prompt instruction — there is no code
  path to "just guess". A value that cannot point at the words that produced it does not get
  written. Some forms deliberately plant fields to catch software that fills everything; more
  importantly, a form filled with things you never said is worse than an empty one.
- **Never claim to know whether you told the truth.** Longtake can see where speech got hesitant.
  It only ever uses that to ask *"want another look at this one?"* — never to judge.
- **The verbatim is kept.** What you actually said stays next to the cleaned-up version, per
  field, so you can always hear yourself say it.

## License

MIT — see [LICENSE](LICENSE).
