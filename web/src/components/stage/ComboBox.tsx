"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

/**
 * A dropdown built the way the modern web builds them — and the way the real
 * Greenhouse application we copied builds them.
 *
 * Deliberately **not** a `<select>`. A live Greenhouse form has none at all: the
 * pickers are React-Select comboboxes whose options are rendered into a portal
 * at the end of `<body>` and **do not exist in the DOM until the thing is
 * opened**. That single fact is most of why `reader.ts` is the moat — it has to
 * open every one of these to learn what the field will accept, and `writer.ts`
 * has to operate it like a person rather than setting `.value`.
 *
 * Nothing here is special-cased anywhere in `core/`. The reader finds it the
 * same way it finds the real one.
 */

/** Where the menu sits right now, in viewport coordinates. */
type Place = { top: number; left: number; width: number; maxHeight: number };

/** Never let the menu run off the bottom of the window, and flip it up if it would. */
const GAP = 4;
const LEAST_ROOM = 160;

function placeUnder(box: DOMRect): Place {
  const below = window.innerHeight - box.bottom - GAP * 2;
  const above = box.top - GAP * 2;
  const flip = below < LEAST_ROOM && above > below;
  const room = Math.max(96, Math.min(256, flip ? above : below));

  return {
    top: flip ? box.top - GAP - room : box.bottom + GAP,
    left: box.left,
    width: box.width,
    maxHeight: room,
  };
}
export function ComboBox({
  id,
  label,
  options,
  required,
  placeholder = "Select...",
}: {
  id: string;
  label: string;
  options: string[];
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const labelId = `${id}_label`;

  useEffect(() => {
    if (!open) return;
    // Radix, React-Select and friends all dismiss on an outside pointerdown,
    // so this one does too — which is exactly the case that broke the writer
    // once, when a widget left open by the reader swallowed the later click.
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  /**
   * Keep the menu under its trigger.
   *
   * The menu is `position: fixed` in a portal, so its coordinates are viewport
   * coordinates and they go stale the instant anything scrolls. Measuring once
   * when it opened left the list floating several hundred pixels below the form,
   * outside the panel entirely — it looked like the dropdown had come loose from
   * the field it belongs to, because in every sense that matters it had.
   *
   * `capture: true` is the part that is easy to get wrong. This form scrolls
   * inside its own panel, and a scroll event on an inner element does not bubble
   * to `window` — only the capture phase sees it. Without that flag this fixes
   * page scrolling and stays broken for the exact case in the screenshot.
   */
  useEffect(() => {
    if (!open) return;

    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPlace(placeUnder(trigger.getBoundingClientRect()));
    };

    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  return (
    <div className="block">
      <span id={labelId} className="mb-1.5 block text-[13px] text-dim">
        {label}
        {required && <span className="text-faint"> *</span>}
      </span>
      {/* The trigger and its clear control share a box, the way React-Select — which the real
          Greenhouse pickers are built on — puts its × beside the chosen value. Without it a choice,
          once made, could never be taken back: not by the person, and not by Longtake when asked. */}
      <div className="relative">
        <div
          ref={triggerRef}
          id={id}
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-required={required}
          tabIndex={0}
          className="flex h-10 cursor-pointer select-none items-center sq-sm border border-hair bg-ink-700 px-3 text-[14px] text-paper transition-colors hover:border-ink-faint"
          onPointerDown={(event) => {
            event.stopPropagation();
            const trigger = triggerRef.current;
            setPlace(trigger ? placeUnder(trigger.getBoundingClientRect()) : null);
            setOpen((was) => !was);
          }}
        >
          {chosen ?? <span className="text-faint">{placeholder}</span>}
        </div>
        {chosen && (
          <button
            type="button"
            aria-label={`Clear selection for ${label}`}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:text-paper"
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
        createPortal(
          <ul
            role="listbox"
            aria-labelledby={labelId}
            className="frame fixed z-[70] overflow-auto sq-sm border border-hair bg-ink-700 py-1 text-[14px] shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
            style={{
              top: place.top,
              left: place.left,
              width: place.width,
              maxHeight: place.maxHeight,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.map((option) => (
              <li
                key={option}
                role="option"
                aria-selected={chosen === option}
                className="cursor-pointer px-3 py-2 text-paper transition-colors hover:bg-ink"
                onPointerDown={() => {
                  setChosen(option);
                  setOpen(false);
                }}
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
