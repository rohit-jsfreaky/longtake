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
  const [box, setBox] = useState<DOMRect | null>(null);
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

  return (
    <div className="block">
      <span id={labelId} className="mb-1.5 block text-[13px] text-dim">
        {label}
        {required && <span className="text-faint"> *</span>}
      </span>
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
          setBox(triggerRef.current?.getBoundingClientRect() ?? null);
          setOpen((was) => !was);
        }}
      >
        {chosen ?? <span className="text-faint">{placeholder}</span>}
      </div>

      {open &&
        box &&
        createPortal(
          <ul
            role="listbox"
            aria-labelledby={labelId}
            className="frame fixed z-[70] max-h-64 overflow-auto sq-sm border border-hair bg-ink-700 py-1 text-[14px]"
            style={{ top: box.bottom + 4, left: box.left, width: box.width }}
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
