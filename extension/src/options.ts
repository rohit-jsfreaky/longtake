/**
 * The settings page: what Longtake knows about you, and the voice it speaks in.
 *
 * Everything known is on one page, grouped the way a person thinks of it, each answer with where
 * it came from — the words they said, on which site, when — and its whole history a click away.
 * Every answer can be changed or removed; all of them can be exported, brought back, or forgotten.
 *
 * Nothing here saves a profile. Every edit is a change sent to the background worker, which applies
 * it to what is stored at that moment — so an edit made here while a call on another tab is saving
 * answers survives, and the call's new answers appear here as they are said.
 *
 * Built by `npm run build:extension` into `extension/dist/options.js`.
 */

import {
  exportProfile,
  groupFacts,
  parseProfile,
  sayFact,
  shownValue,
  type Fact,
  type FactValue,
  type LongAnswer,
  type Profile,
  type Provenance,
} from "@longtake/core";

import { profileClient } from "./profile-client";

const DEFAULT_VOICE = "charles";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────────────

function show(tab: string): void {
  for (const button of document.querySelectorAll<HTMLElement>("[role=tab]")) {
    const on = button.id === `tab-${tab}`;
    button.setAttribute("aria-selected", String(on));
    $(button.getAttribute("aria-controls")!).hidden = !on;
  }
  history.replaceState(null, "", `#${tab}`);
}
$("tab-memory").addEventListener("click", () => show("memory"));
$("tab-voice").addEventListener("click", () => show("voice"));
if (location.hash === "#voice") show("voice");

// ── What is known ────────────────────────────────────────────────────────────────────

let profile: Profile | null = null;

function flash(text = "Saved"): void {
  const saved = $("saved");
  saved.textContent = text;
  saved.classList.add("on");
  setTimeout(() => saved.classList.remove("on"), 1400);
}

function where(url: string, host: string): string {
  if (host) return host;
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const date = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const SOURCE_WORDS: Record<Provenance["source"], string> = {
  spoken: "You said",
  confirmed: "You confirmed",
  typed: "You typed",
  edited: "Edited by you",
  migrated: "Kept by an older version",
  imported: "Brought in from a file",
};

function quote(text: string, max = 90): HTMLElement {
  return el("q", { textContent: text.length > max ? `${text.slice(0, max)}…` : text });
}

/** One line of where an answer came from: "You said 'Kolkata mein' · on greenhouse.io · 3 Sep 2026". */
function telling(h: Provenance): HTMLElement {
  const line = el("div", { className: "meta" });
  const site = where(h.url, h.host);
  line.append([SOURCE_WORDS[h.source], site && `on ${site}`, date(h.at)].filter(Boolean).join(" · "));
  if (h.evidence && (h.source === "spoken" || h.source === "confirmed" || h.source === "migrated")) line.append(" — ", quote(h.evidence));
  return line;
}

/** A value as it can be typed back: lists comma-separated, yes/no as a choice. */
function editor(fact: Fact, label: string): { node: HTMLInputElement | HTMLSelectElement; read: () => FactValue } {
  if (typeof fact.value === "boolean") {
    const select = el("select", {}, el("option", { value: "true", textContent: "Yes" }), el("option", { value: "false", textContent: "No" }));
    select.value = String(fact.value);
    select.setAttribute("aria-label", label);
    return { node: select, read: () => select.value === "true" };
  }
  const input = el("input", { value: shownValue(fact.value) });
  input.setAttribute("aria-label", label);
  return {
    node: input,
    read: () => (Array.isArray(fact.value) ? input.value.split(",").map((s) => s.trim()).filter(Boolean) : input.value.trim()),
  };
}

function factRow(fact: Fact): HTMLElement {
  const label = sayFact(fact);
  const row = el("div", { className: "row" });
  row.dataset.fact = fact.id;

  const what = el("div", { className: "what" }, label);
  if (fact.sensitive) what.append(el("span", { className: "chip", textContent: "personal" }));
  const { node, read } = editor(fact, label);
  const value = el("div", { className: "value" }, node);
  const last = fact.history[fact.history.length - 1]!;
  const left = el("div", {}, what, value, telling(last));

  if (fact.history.length > 1) {
    const details = el("details", { className: "history" }, el("summary", { textContent: `History (${fact.history.length})` }));
    for (const h of [...fact.history].reverse()) {
      const item = el("div", { className: "told" }, el("span", { className: "was", textContent: shownValue(h.value) }));
      item.append(telling(h));
      details.append(item);
    }
    left.append(details);
  }

  const save = el("button", { className: "small go", textContent: "Save", disabled: true });
  const changed = () => JSON.stringify(read()) !== JSON.stringify(fact.value) && shownValue(read()) !== "";
  node.addEventListener("input", () => (save.disabled = !changed()));
  node.addEventListener("change", () => (save.disabled = !changed()));
  node.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" && !save.disabled) save.click();
  });
  save.addEventListener("click", async () => {
    // Your own edit: typed, not spoken, and marked so — the words it came from no longer apply.
    const edited: Provenance = { value: read(), evidence: "", source: "edited", host: "", url: "", askedAs: label, formTitle: "", at: Date.now() };
    await profileClient.apply([{ type: "replace", id: fact.id, value: read(), from: edited }]);
    flash();
  });
  const remove = el("button", { className: "small", textContent: "Remove" });
  remove.addEventListener("click", async () => {
    await profileClient.apply([{ type: "delete", id: fact.id }]);
    flash("Removed");
  });

  row.append(left, el("div", { className: "actions" }, save, remove));
  return row;
}

function answerRow(answer: LongAnswer): HTMLElement {
  const row = el("div", { className: "row" });
  const text = el("textarea", { value: answer.text, rows: 4 });
  text.setAttribute("aria-label", answer.question || answer.gist);
  const left = el(
    "div",
    {},
    el("div", { className: "what", textContent: answer.question || answer.gist }),
    el("div", { className: "value" }, text),
    el("div", { className: "meta", textContent: [answer.host && `on ${answer.host}`, date(answer.at)].filter(Boolean).join(" · ") }),
  );
  const save = el("button", { className: "small go", textContent: "Save", disabled: true });
  text.addEventListener("input", () => (save.disabled = text.value.trim() === answer.text || !text.value.trim()));
  save.addEventListener("click", async () => {
    await profileClient.apply([{ type: "saveAnswer", answer: { ...answer, text: text.value.trim(), at: Date.now() } }]);
    flash();
  });
  const remove = el("button", { className: "small", textContent: "Remove" });
  remove.addEventListener("click", async () => {
    await profileClient.apply([{ type: "deleteAnswer", id: answer.id }]);
    flash("Removed");
  });
  row.append(left, el("div", { className: "actions" }, save, remove));
  return row;
}

/**
 * Draw everything known. An answer being edited keeps what was typed into it: a call on another
 * tab may save new answers while this page is open, and that must not wipe an edit in progress.
 */
function render(next: Profile): void {
  profile = next;
  const typing = new Map<string, string>();
  for (const row of document.querySelectorAll<HTMLElement>("#answers .row[data-fact]")) {
    const field = row.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
    const save = row.querySelector<HTMLButtonElement>("button.go");
    if (field && save && !save.disabled) typing.set(row.dataset.fact!, field.value);
  }
  const focused = (document.activeElement?.closest(".row") as HTMLElement | null)?.dataset.fact;

  const list = $("answers");
  list.textContent = "";
  const groups = groupFacts(next);
  const answers = Object.values(next.answers).sort((a, b) => b.at - a.at);
  const count = Object.keys(next.facts).length;
  $<HTMLButtonElement>("clear-all").disabled = count === 0 && answers.length === 0;
  $<HTMLButtonElement>("export").disabled = count === 0 && answers.length === 0;
  $("count").textContent = count === 0 ? "" : `${count} ${count === 1 ? "answer" : "answers"}`;

  if (count === 0 && answers.length === 0) {
    list.append(
      el("div", { className: "card" }, el("div", { className: "empty", textContent: "Nothing saved yet. Answers you give on a form are kept here for the next one." })),
    );
  }
  for (const group of groups) {
    const card = el("div", { className: "card" });
    for (const fact of group.facts) card.append(factRow(fact));
    list.append(el("h2", { textContent: group.name }), card);
  }
  if (answers.length > 0) {
    const card = el("div", { className: "card" });
    for (const answer of answers) card.append(answerRow(answer));
    list.append(el("h2", { textContent: "Longer answers" }), card);
  }

  for (const [id, value] of typing) {
    const row = list.querySelector<HTMLElement>(`.row[data-fact="${CSS.escape(id)}"]`);
    const field = row?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
    if (!row || !field) continue;
    field.value = value;
    field.dispatchEvent(new Event("input"));
  }
  if (focused) list.querySelector<HTMLElement>(`.row[data-fact="${CSS.escape(focused)}"] input, .row[data-fact="${CSS.escape(focused)}"] select`)?.focus();

  $<HTMLInputElement>("sensitive").checked = next.settings.rememberSensitive;
}

$("clear-all").addEventListener("click", async () => {
  if (!confirm("Forget everything Longtake knows about you? The next form starts empty.")) return;
  await profileClient.apply([{ type: "deleteAll" }]);
  flash("Forgotten");
});

$<HTMLInputElement>("sensitive").addEventListener("change", async (event) => {
  await profileClient.apply([{ type: "settings", settings: { rememberSensitive: (event.target as HTMLInputElement).checked } }]);
  flash();
});

// ── A file of it, and back ───────────────────────────────────────────────────────────

$("export").addEventListener("click", () => {
  if (!profile) return;
  const blob = new Blob([exportProfile(profile)], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(blob), download: `longtake-profile-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$("import").addEventListener("click", () => $<HTMLInputElement>("import-file").click());
$<HTMLInputElement>("import-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const incoming = parseProfile(await file.text());
  const preview = $("import-preview");
  preview.textContent = "";
  preview.hidden = false;
  if (!incoming) {
    preview.append(el("p", { textContent: "That file isn't a Longtake profile." }));
    return;
  }
  // What bringing it in would do, before it does anything.
  const current = profile?.facts ?? {};
  const facts = Object.values(incoming.facts);
  const fresh = facts.filter((f) => !current[f.id]).length;
  const newer = facts.filter((f) => current[f.id] && f.updatedAt > current[f.id]!.updatedAt).length;
  const older = facts.length - fresh - newer;
  const lines = [
    `${facts.length} ${facts.length === 1 ? "answer" : "answers"} in this file`,
    fresh && `${fresh} new`,
    newer && `${newer} newer than yours — these replace yours`,
    older && `${older} older than yours — yours are kept`,
  ].filter(Boolean);
  const bring = el("button", { className: "small go", textContent: "Bring them in" });
  const cancel = el("button", { className: "small", textContent: "Cancel" });
  bring.addEventListener("click", async () => {
    await profileClient.apply([{ type: "import", profile: incoming }]);
    preview.hidden = true;
    flash("Brought in");
  });
  cancel.addEventListener("click", () => (preview.hidden = true));
  preview.append(el("p", { textContent: `${lines.join(" · ")}.` }), el("div", { className: "actions" }, bring, cancel));
});

// A call on any tab changes what is known; this page follows it.
profileClient.subscribe?.((next) => render(next));
void profileClient.load().then(render);

// ── Voice ────────────────────────────────────────────────────────────────────────────

let playing: { id: string; audio: HTMLAudioElement; button: HTMLButtonElement } | null = null;

async function renderVoices(): Promise<void> {
  const voices = (await (await fetch("voices/voices.json")).json()) as { id: string; accent: string }[];
  const chosen = ((await chrome.storage.local.get("voice")) as { voice?: string }).voice ?? DEFAULT_VOICE;
  const grid = $("voices");
  grid.textContent = "";

  for (const { id, accent } of voices) {
    const card = el("div", { className: "voice", tabIndex: 0 });
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(id === chosen));

    const play = el("button", { className: "play", textContent: "▶" });
    play.setAttribute("aria-label", `Hear ${id}`);
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

    const text = el(
      "div",
      { className: "grow" },
      el("div", { className: "name", textContent: id }),
      el("div", { className: "accent", textContent: `${accent} English${id === DEFAULT_VOICE ? " · default" : ""}` }),
    );

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

void renderVoices();
