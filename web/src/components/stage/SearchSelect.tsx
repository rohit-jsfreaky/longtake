"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

import { placeUnder, type Place } from "./ComboBox";

/**
 * A picker you type into, built the way React-Select builds one — which is what every picker on
 * the Discord application is.
 *
 * `ComboBox` beside this is a div you click. This is the other shape the web uses: an `<input
 * role="combobox" aria-autocomplete="list">` inside a value container, the chosen answer shown in
 * a sibling next to it, and the choices filtered as you type. Three flavours of it sit on the
 * copied form, and each is a different problem for `core/`:
 *
 *   · a short list (Degree): opens on every choice, like any dropdown
 *   · a long list (School, Phone country): opens on a first page; the rest only come by typing
 *   · a search (Location): opens on nothing at all until something is typed
 *
 * `search` is how the choices arrive for what was typed. The live page asks a server; the copy
 * answers from what that server returned, after a short wait, because a real search is never
 * instant and the writer has to be able to wait for it.
 */

const SEARCH_DELAY_MS = 250;

export function SearchSelect({
  id,
  label,
  required,
  onOpen,
  search,
}: {
  id: string;
  label: string;
  required?: boolean;
  /** What shows when it opens with nothing typed. Empty for a pure search. */
  onOpen: string[];
  /** The choices for what has been typed. */
  search: (query: string) => string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [answered, setAnswered] = useState<{ query: string; options: string[] } | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listId = `${useId()}-listbox`;
  const labelId = `${id}-label`;

  // The search answers a moment after the typing, and only for what is still typed.
  useEffect(() => {
    if (!open || !query.trim()) return;
    const timer = setTimeout(() => setAnswered({ query, options: search(query) }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  // What the menu holds: the opening list, or the search's answer once it has arrived.
  const shown = !query.trim() ? onOpen : answered?.query === query ? answered.options : [];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const measure = () => {
      if (boxRef.current) setPlace(placeUnder(boxRef.current.getBoundingClientRect()));
    };
    measure();
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const choose = (option: string) => {
    setChosen(option);
    setQuery("");
    setOpen(false);
  };

  return (
    <div>
      <label id={labelId} htmlFor={id} className="mb-1.5 block text-[13px] text-dim">
        {label}
        {required && <span className="text-faint"> *</span>}
      </label>
      <div
        ref={boxRef}
        className="relative flex h-10 items-center sq-sm border border-hair bg-ink-700 px-3 text-[14px] text-paper transition-colors focus-within:border-hair-lit hover:border-ink-faint"
        onPointerDown={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {/* The value container: the chosen answer (or the placeholder) and the input share it, the
            way React-Select lays them out — so the answer is read from the block around the input. */}
        <div className="relative grid min-w-0 flex-1 items-center">
          {!query && (
            <div className="pointer-events-none col-start-1 row-start-1 truncate">
              {chosen ?? <span className="text-faint">Select...</span>}
            </div>
          )}
          <div className="col-start-1 row-start-1">
            <input
              id={id}
              role="combobox"
              type="text"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-haspopup="true"
              aria-controls={open ? listId : undefined}
              aria-labelledby={labelId}
              aria-required={required}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && open && shown[0]) {
                  event.preventDefault();
                  choose(shown[0]);
                }
              }}
              onBlur={() => setQuery("")}
              className="w-full bg-transparent outline-none"
            />
          </div>
        </div>
        {chosen && (
          <button
            type="button"
            aria-label={`Clear selection for ${label}`}
            className="ml-2 flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:text-paper"
            onPointerDown={(event) => {
              event.stopPropagation();
              setChosen(null);
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </div>

      {open &&
        place &&
        shown.length > 0 &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="frame fixed z-[70] overflow-auto sq-sm border border-hair bg-ink-700 py-1 text-[14px] shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
            style={{ top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {shown.map((option, index) => (
              <li
                key={`${option}-${index}`}
                role="option"
                aria-selected={chosen === option}
                className="cursor-pointer px-3 py-2 text-paper transition-colors hover:bg-ink"
                onPointerDown={() => choose(option)}
              >
                {option}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

/** Filter a fixed list by what was typed — a short list's own search box. */
export function filterList(options: string[]) {
  return (query: string) => {
    const q = query.trim().toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(q));
  };
}

/**
 * Answer a search from recorded results: the exact search if it was recorded, else every recorded
 * result containing what was typed. Never an answer the live page did not give.
 */
export function recordedSearch(recorded: Record<string, string[]>, alsoKnown: string[] = []) {
  const everything = [...new Set([...Object.values(recorded).flat(), ...alsoKnown])];
  return (query: string) => {
    const q = query.trim().toLowerCase();
    const exact = Object.entries(recorded).find(([key]) => key.toLowerCase() === q);
    if (exact) return exact[1];
    return everything.filter((option) => option.toLowerCase().includes(q));
  };
}
