/**
 * The settings page: remembered answers, and the voice.
 *
 * Reads and writes the same `chrome.storage.local` keys the content script uses —
 * `longtake.memory.v1` (see core/src/memory.ts for the shape) and `voice`. Plain JavaScript, like
 * the background worker: nothing here needs `core/`.
 */

const MEMORY_KEY = "longtake.memory.v1";
const MEMORY_VERSION = 1;
const DEFAULT_VOICE = "charles";

/** What each remembered thing is, in words — the keys are core/src/memory.ts's. */
const NAMES = {
  first_name: "First name", last_name: "Last name", full_name: "Full name", preferred_name: "Preferred name",
  email: "Email", phone: "Phone", city: "City", country: "Country", postal_code: "Postal code",
  linkedin: "LinkedIn", github: "GitHub", portfolio: "Website",
  current_employer: "Current company", current_title: "Current title", years_experience: "Years of experience",
  notice_period: "Notice period", expected_salary: "Expected salary", current_salary: "Current salary",
  willing_to_relocate: "Willing to relocate", work_authorization: "Authorised to work",
  needs_sponsorship: "Needs sponsorship", about_you: "About you",
};
const ORDER = Object.keys(NAMES);

const $ = (id) => document.getElementById(id);

// ── Tabs ─────────────────────────────────────────────────────────────────────────────

function show(tab) {
  for (const button of document.querySelectorAll("[role=tab]")) {
    const on = button.id === `tab-${tab}`;
    button.setAttribute("aria-selected", String(on));
    $(button.getAttribute("aria-controls")).hidden = !on;
  }
  history.replaceState(null, "", `#${tab}`);
}
$("tab-memory").addEventListener("click", () => show("memory"));
$("tab-voice").addEventListener("click", () => show("voice"));
if (location.hash === "#voice") show("voice");

// ── Saved answers ────────────────────────────────────────────────────────────────────

async function loadMemory() {
  const stored = (await chrome.storage.local.get(MEMORY_KEY))[MEMORY_KEY];
  return stored?.version === MEMORY_VERSION ? stored.memory ?? {} : {};
}

async function saveMemory(memory) {
  await chrome.storage.local.set({ [MEMORY_KEY]: { version: MEMORY_VERSION, memory } });
  const saved = $("saved");
  saved.classList.add("on");
  setTimeout(() => saved.classList.remove("on"), 1200);
}

function shown(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
}

function where(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function renderMemory() {
  const memory = await loadMemory();
  const list = $("answers");
  list.textContent = "";
  const keys = Object.keys(memory).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  $("clear-all").disabled = keys.length === 0;

  if (keys.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nothing saved yet. Answers you give on a form are kept here for the next one.";
    list.append(empty);
    return;
  }

  for (const key of keys) {
    const answer = memory[key];
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    const what = document.createElement("div");
    what.className = "what";
    what.textContent = NAMES[key] ?? answer.askedAs ?? key;
    const value = document.createElement("div");
    value.className = "value";
    const input = document.createElement("input");
    input.value = shown(answer.value);
    input.setAttribute("aria-label", what.textContent);
    value.append(input);
    const meta = document.createElement("div");
    meta.className = "meta";
    const site = where(answer.sourceUrl);
    const when = answer.savedAt ? new Date(answer.savedAt).toLocaleDateString() : "";
    meta.textContent = [answer.editedAt ? "Edited by you" : "You said", site && `on ${site}`, when].filter(Boolean).join(" · ");
    if (!answer.editedAt && answer.evidence) {
      const quote = document.createElement("q");
      quote.textContent = answer.evidence.length > 80 ? `${answer.evidence.slice(0, 80)}…` : answer.evidence;
      meta.append(" — ", quote);
    }
    left.append(what, value, meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    const save = document.createElement("button");
    save.className = "small go";
    save.textContent = "Save";
    save.disabled = true;
    input.addEventListener("input", () => (save.disabled = input.value.trim() === shown(answer.value)));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !save.disabled) save.click();
    });
    save.addEventListener("click", async () => {
      const next = await loadMemory();
      const text = input.value.trim();
      if (!text || !next[key]) return;
      // Your own edit: typed, not spoken, and marked so — the words it came from no longer apply.
      next[key] = { ...next[key], value: text, evidence: `edited by you: ${text}`, editedAt: Date.now() };
      await saveMemory(next);
      await renderMemory();
    });
    const remove = document.createElement("button");
    remove.className = "small";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const next = await loadMemory();
      delete next[key];
      await saveMemory(next);
      await renderMemory();
    });
    actions.append(save, remove);

    row.append(left, actions);
    list.append(row);
  }
}

$("clear-all").addEventListener("click", async () => {
  if (!confirm("Forget every saved answer? The next form starts empty.")) return;
  await saveMemory({});
  await renderMemory();
});

// A call on another tab may save new answers while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[MEMORY_KEY]) void renderMemory();
});

// ── Voice ────────────────────────────────────────────────────────────────────────────

let playing = null;

async function renderVoices() {
  const voices = await (await fetch("voices/voices.json")).json();
  const chosen = (await chrome.storage.local.get("voice")).voice ?? DEFAULT_VOICE;
  const grid = $("voices");
  grid.textContent = "";

  for (const { id, accent } of voices) {
    const card = document.createElement("div");
    card.className = "voice";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(id === chosen));
    card.tabIndex = 0;

    const play = document.createElement("button");
    play.className = "play";
    play.setAttribute("aria-label", `Hear ${id}`);
    play.textContent = "▶";
    play.addEventListener("click", (event) => {
      event.stopPropagation();
      if (playing) {
        playing.audio.pause();
        playing.button.textContent = "▶";
        if (playing.id === id) {
          playing = null;
          return;
        }
      }
      const audio = new Audio(`voices/${id}.wav`);
      playing = { id, audio, button: play };
      play.textContent = "■";
      audio.addEventListener("ended", () => {
        play.textContent = "▶";
        playing = null;
      });
      void audio.play();
    });

    const text = document.createElement("div");
    text.className = "grow";
    text.innerHTML = `<div class="name"></div><div class="accent"></div>`;
    text.querySelector(".name").textContent = id;
    text.querySelector(".accent").textContent = `${accent} English${id === DEFAULT_VOICE ? " · default" : ""}`;

    const choose = async () => {
      await chrome.storage.local.set({ voice: id });
      await renderVoices();
    };
    card.addEventListener("click", () => void choose());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void choose();
      }
    });

    card.append(play, text);
    grid.append(card);
  }
}

void renderMemory();
void renderVoices();
