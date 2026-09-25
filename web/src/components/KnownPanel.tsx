"use client";

/**
 * What Longtake knows about the person, on the site — the same view the extension's settings page
 * gives: every answer grouped the way a person thinks of it, where it came from (their words, the
 * site, the day), its whole history, and a way to change it, remove it, keep a copy, bring one back,
 * or forget everything.
 *
 * Nothing here saves a profile: every button sends a change to the page's one owner of it
 * (`siteProfileStore`), so an edit made here while a call is saving answers survives it.
 */

import { useEffect, useRef, useState } from "react";
import {
  exportProfile,
  groupFacts,
  parseProfile,
  sayFact,
  shownValue,
  type Fact,
  type FactValue,
  type Profile,
  type ProfileStore,
  type Provenance,
} from "@longtake/core";

const SOURCE_WORDS: Record<Provenance["source"], string> = {
  spoken: "you said",
  confirmed: "you confirmed",
  typed: "you typed it",
  edited: "edited by you",
  migrated: "kept by an older version",
  imported: "brought in from a file",
};

const day = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

function Telling({ telling }: { telling: Provenance }) {
  const quote = telling.evidence && (telling.source === "spoken" || telling.source === "confirmed") ? ` “${telling.evidence.length > 60 ? `${telling.evidence.slice(0, 60)}…` : telling.evidence}”` : "";
  return (
    <span className="block truncate text-[10px] text-neutral-400">
      {SOURCE_WORDS[telling.source]}
      {quote}
      {telling.host && ` · ${telling.host}`}
      {telling.at ? ` · ${day(telling.at)}` : ""}
    </span>
  );
}

function FactRow({ fact, store }: { fact: Fact; store: ProfileStore }) {
  // A row is keyed by its answer and when it last changed, so a change from elsewhere starts it afresh.
  const [draft, setDraft] = useState(shownValue(fact.value));
  const changed = draft.trim() !== "" && draft.trim() !== shownValue(fact.value);
  const last = fact.history[fact.history.length - 1]!;

  const save = () => {
    const value: FactValue =
      typeof fact.value === "boolean" ? /^(yes|true)$/i.test(draft.trim()) : Array.isArray(fact.value) ? draft.split(",").map((s) => s.trim()).filter(Boolean) : draft.trim();
    const edited: Provenance = { value, evidence: "", source: "edited", host: "", url: "", askedAs: sayFact(fact), formTitle: "", at: Date.now() };
    void store.apply([{ type: "replace", id: fact.id, value, from: edited }]);
  };

  return (
    <div className="mb-2 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <span className="inline-block font-medium first-letter:uppercase">{sayFact(fact)}</span>
        {fact.sensitive && <span className="ml-1 rounded border border-amber-300 px-1 text-[9px] text-amber-700 dark:border-amber-800 dark:text-amber-400">personal</span>}
        <input
          aria-label={sayFact(fact)}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && changed && save()}
          className="mt-0.5 block w-full rounded border border-neutral-200 bg-transparent px-1.5 py-0.5 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
        />
        <Telling telling={last} />
        {fact.history.length > 1 && (
          <details className="mt-0.5 text-[10px] text-neutral-400">
            <summary className="cursor-pointer">History ({fact.history.length})</summary>
            {[...fact.history].reverse().map((telling, i) => (
              <div key={i} className="ml-1 border-l border-neutral-200 pl-1.5 dark:border-neutral-800">
                <span className="text-neutral-600 dark:text-neutral-300">{shownValue(telling.value)}</span>
                <Telling telling={telling} />
              </div>
            ))}
          </details>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          onClick={save}
          disabled={!changed}
          className="rounded border border-neutral-300 px-1.5 text-[10px] leading-4 enabled:hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:enabled:hover:bg-neutral-800"
        >
          Save
        </button>
        <button
          onClick={() => void store.apply([{ type: "delete", id: fact.id }])}
          title="Forget this"
          className="rounded border border-neutral-300 px-1.5 text-[10px] leading-4 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function KnownPanel({ store }: { store: ProfileStore }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preview, setPreview] = useState<{ incoming: Profile | null; text: string } | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    void store.load().then((loaded) => live && setProfile(loaded));
    const off = store.subscribe?.((next) => setProfile(next));
    return () => {
      live = false;
      off?.();
    };
  }, [store]);

  const facts = profile ? Object.values(profile.facts) : [];
  const groups = profile ? groupFacts(profile) : [];

  const download = () => {
    if (!profile) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([exportProfile(profile)], { type: "application/json" }));
    link.download = `longtake-profile-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    const incoming = parseProfile(await chosen.text());
    if (!incoming) return setPreview({ incoming: null, text: "That file isn't a Longtake profile." });
    // What bringing it in would do, before it does anything.
    const mine = profile?.facts ?? {};
    const all = Object.values(incoming.facts);
    const fresh = all.filter((f) => !mine[f.id]).length;
    const newer = all.filter((f) => mine[f.id] && f.updatedAt > mine[f.id]!.updatedAt).length;
    setPreview({ incoming, text: `${all.length} in this file · ${fresh} new · ${newer} newer than yours` });
  };

  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Remembered about you ({facts.length})</h2>
      <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
        {facts.length === 0 && <p className="text-neutral-400">Nothing yet. Answer once and the next form arrives filled in.</p>}
        {groups.map((group) => (
          <div key={group.category} className="mb-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">{group.name}</p>
            {group.facts.map((fact) => (
              <FactRow key={`${fact.id}:${fact.updatedAt}`} fact={fact} store={store} />
            ))}
          </div>
        ))}

        {preview && (
          <div className="mb-2 rounded border border-sky-300 bg-sky-50 p-1.5 text-[11px] dark:border-sky-900 dark:bg-sky-950">
            <p>{preview.text}</p>
            <div className="mt-1 flex gap-1">
              {preview.incoming && (
                <button
                  onClick={() => {
                    void store.apply([{ type: "import", profile: preview.incoming! }]);
                    setPreview(null);
                  }}
                  className="rounded border border-sky-400 px-1.5 text-[10px]"
                >
                  Bring them in
                </button>
              )}
              <button onClick={() => setPreview(null)} className="rounded border border-neutral-300 px-1.5 text-[10px] dark:border-neutral-700">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          <p className="mr-auto text-[10px] text-neutral-400">Stored in this browser only. Never uploaded.</p>
          <button onClick={download} disabled={facts.length === 0} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] disabled:opacity-30 dark:border-neutral-700">
            Export
          </button>
          <button onClick={() => file.current?.click()} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] dark:border-neutral-700">
            Import
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(event) => void choose(event.target.files?.[0])} />
          {facts.length > 0 && (
            <button
              onClick={() => void store.apply([{ type: "deleteAll" }])}
              className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Forget everything
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
