"use client";

/**
 * A stand-in application form for the Phase 2 workbench.
 *
 * ⚠️ This one IS ours, and that is the whole reason it cannot be the demo. A form we wrote is no
 * evidence at all — "of course it fills, you made it." The submission page in Phase 8a carries
 * forms copied from real sites, unchanged, and says so.
 *
 * What it is for is exercising the shapes we found on a real Greenhouse page, locally and
 * repeatably: a **combobox rendered through a portal** whose options do not exist until it is
 * opened, a native `<select>`, a radio group in a fieldset, a lone consent checkbox, and a long
 * textarea. Nothing here is special-cased anywhere in `core/` — the reader finds it the same way
 * it finds Reddit's.
 */

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

const FIELD =
  "mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300";

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="text-sm font-medium">
      {children}
      {required && <span className="text-red-600"> *</span>}
    </span>
  );
}

/**
 * A dropdown built the way the modern web builds them: a trigger, component state, and options
 * rendered into a portal at the end of `<body>` that only exist while it is open.
 *
 * Deliberately NOT a `<select>`. A real Greenhouse application has none at all.
 */
function ComboBox({
  label,
  options,
  required,
}: {
  label: string;
  options: string[];
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const labelId = `${label.replace(/\W+/g, "_").toLowerCase()}_label`;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Radix and friends dismiss on an outside pointerdown, so this one does too.
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <label className="block">
      <span id={labelId}>
        <Label required={required}>{label}</Label>
      </span>
      <div
        ref={triggerRef}
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={0}
        className={`${FIELD} cursor-pointer select-none`}
        onPointerDown={(event) => {
          event.stopPropagation();
          setBox(triggerRef.current?.getBoundingClientRect() ?? null);
          setOpen((was) => !was);
        }}
      >
        {chosen ?? <span className="text-neutral-400">Select…</span>}
      </div>

      {open &&
        box &&
        createPortal(
          <div
            role="listbox"
            style={{ position: "absolute", top: box.bottom + window.scrollY, left: box.left + window.scrollX, width: box.width }}
            className="z-50 overflow-hidden rounded-md border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.map((option) => (
              <div
                key={option}
                role="option"
                aria-selected={chosen === option}
                className="cursor-pointer px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => {
                  setChosen(option);
                  setOpen(false);
                }}
              >
                {option}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </label>
  );
}

export function DemoForm() {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => event.preventDefault()}
      aria-label="Application"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label required>First name</Label>
          <input name="first_name" className={FIELD} required />
        </label>
        <label className="block">
          <Label required>Last name</Label>
          <input name="last_name" className={FIELD} required />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label required>Email</Label>
          <input type="email" name="email" className={FIELD} required />
        </label>
        <label className="block">
          <Label>Phone</Label>
          <input type="tel" name="phone" className={FIELD} placeholder="+91…" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label required>Current city</Label>
          <input name="current_city" className={FIELD} required />
        </label>
        <label className="block">
          <Label>LinkedIn</Label>
          <input type="url" name="linkedin" className={FIELD} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* A real <select>, so both paths are exercised on one page. */}
        <label className="block">
          <Label required>Country</Label>
          <select name="country" className={FIELD} required defaultValue="">
            <option value="">Select…</option>
            <option value="in">India</option>
            <option value="us">United States</option>
            <option value="gb">United Kingdom</option>
            <option value="de">Germany</option>
          </select>
        </label>

        {/* …and a component dropdown, which is what real ATS forms actually use. */}
        <ComboBox
          label="Notice period"
          required
          options={["Immediate", "15 days", "30 days", "60 days", "90 days"]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label>Current employer</Label>
          <input name="current_employer" className={FIELD} />
        </label>
        <label className="block">
          <Label>Years of experience</Label>
          <input type="number" name="years_of_experience" className={FIELD} />
        </label>
      </div>

      <fieldset className="rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
        <legend className="px-1 text-sm font-medium">Are you open to relocating?</legend>
        <div className="flex gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="relocate" value="yes" /> Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="relocate" value="no" /> No
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="relocate" value="maybe" /> Open to discussing
          </label>
        </div>
      </fieldset>

      <label className="block">
        <Label required>Why do you want this role?</Label>
        <textarea name="why_this_role" rows={4} className={FIELD} required />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>I agree to the processing of my application data.</span>
      </label>

      {/*
        A honeypot, exactly as a real site would plant one: present, fillable, and invisible.
        `reader.ts` keeps it out of the schema entirely, so the agent is never even offered it.
      */}
      <input
        name="website_url"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
      />
    </form>
  );
}
