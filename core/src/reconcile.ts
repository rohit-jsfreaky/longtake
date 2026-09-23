/**
 * A form that changes shape while somebody is filling it in.
 *
 * ## The case this exists for
 *
 * A live Jotform membership application loads with one question: *"Are you applying as an
 * Independent Representative, or a Representative of your Organization?"* Answer it and twenty
 * fields appear. Change the answer and some of them go — "Independent's Name", a career history —
 * while others arrive in their place: "Organization Name", a second contact. Name, phone, email
 * and industry stay throughout.
 *
 * Read once at the start, that form is one question. The tool the agent was given has one
 * property, and everything the person says after the first answer has nowhere to go.
 *
 * ## What has to stay true across a change
 *
 * **An id means the same field for the whole session.** The agent holds ids between calls, the
 * receipts are keyed by them, and "fill `independent_s_name`" must never start meaning a
 * different box because the page moved. So a field is recognised by the element itself first —
 * Jotform hides a field rather than removing it, and the same element coming back is the same
 * question — and, for pages that unmount and remount instead, by what it asks and where it sits.
 * A field that is genuinely new never inherits an id that belonged to something else.
 *
 * **Nothing already learned is thrown away.** Dropdown options carry over by id, so a re-read
 * does not reopen every widget on the page while the person is mid-sentence.
 */

import type { FieldSpec, FormRead } from "./types";

/** What changed between the form as it was and the form as it is now. */
export type FormChange = {
  /** The new read, with ids that mean the same field they meant before. */
  read: FormRead;
  /** Questions on the page now that were not a moment ago. */
  appeared: FieldSpec[];
  /** Questions that were on the page and are not any more. */
  disappeared: FieldSpec[];
};

/** `Organization Information` → `organization_information`, the same shape the reader uses. */
function slug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** What a field asks, and where — enough to recognise it after a page remounts it. */
function signature(spec: FieldSpec): string {
  return `${spec.kind}|${spec.section ?? ""}|${spec.label}`;
}

/**
 * Every field seen in this session, and the id it was given.
 *
 * One per session. `adopt` every read through it — the first one and every one after — and the
 * ids it hands back are stable for as long as the session lasts.
 */
export class FieldRegistry {
  /** The element a field was found at. Weak, so a page that throws its DOM away is not held. */
  private idByElement = new WeakMap<Element, string>();
  /** Ids by what they ask, for the page that rebuilds a field rather than hiding it. */
  private idsBySignature = new Map<string, string[]>();
  /** Every id ever handed out. A new field never gets one of these. */
  private used = new Set<string>();
  private current: FormRead | null = null;

  /** The latest read this registry has adopted. */
  get read(): FormRead | null {
    return this.current;
  }

  /**
   * Take a fresh read of the page and give its fields their session ids.
   *
   * The first call just establishes the ids, and reports nothing as having appeared — the whole
   * form is new then, which is not a change.
   */
  adopt(next: FormRead): FormChange {
    const previous = this.current;
    const taken = new Set<string>();
    const finalIds = new Map<FieldSpec, string>();

    // ── 1. The same element is the same field ─────────────────────────────────────
    for (const spec of next.specs) {
      const el = next.handles.get(spec.id);
      const known = el ? this.idByElement.get(el) : undefined;
      if (known && !taken.has(known)) {
        finalIds.set(spec, known);
        taken.add(known);
      }
    }

    // ── 2. A rebuilt field that asks the same thing in the same place ────────────
    for (const spec of next.specs) {
      if (finalIds.has(spec)) continue;
      const earlier = (this.idsBySignature.get(signature(spec)) ?? []).find((id) => !taken.has(id));
      if (earlier) {
        finalIds.set(spec, earlier);
        taken.add(earlier);
      }
    }

    // ── 3. Genuinely new. Its own id, never one that meant something else ────────
    for (const spec of next.specs) {
      if (finalIds.has(spec)) continue;
      const free = (id: string) => !this.used.has(id) && !taken.has(id);

      // When the plain id already meant something, say where this one lives rather than
      // numbering it. The organisation's "City" arriving after the individual's has gone is
      // `organization_information_city` to the model, not the meaningless `city_2`.
      const base =
        free(spec.id) || !spec.section ? spec.id : `${slug(spec.section)}_${spec.id}`.slice(0, 64);
      let id = base;
      for (let n = 2; !free(id); n++) id = `${base}_${n}`;

      finalIds.set(spec, id);
      taken.add(id);
    }

    // ── Rewrite the read under the session ids ────────────────────────────────────
    const before = new Map(previous?.specs.map((spec) => [spec.id, spec]) ?? []);
    const handles: FormRead["handles"] = new Map();

    for (const spec of next.specs) {
      const el = next.handles.get(spec.id);
      const id = finalIds.get(spec)!;
      spec.id = id;
      if (el) {
        handles.set(id, el);
        this.idByElement.set(el, id);
      }
      this.used.add(id);

      const ids = this.idsBySignature.get(signature(spec)) ?? [];
      if (!ids.includes(id)) this.idsBySignature.set(signature(spec), [...ids, id]);

      // Options learned by opening a dropdown are kept, so a re-read never has to open it again.
      const old = before.get(id);
      if (!spec.options?.length && old?.options?.length) spec.options = old.options;
    }

    const read: FormRead = { ...next, handles };
    this.current = read;

    if (!previous) return { read, appeared: [], disappeared: [] };

    const now = new Set(read.specs.map((spec) => spec.id));
    return {
      read,
      appeared: read.specs.filter((spec) => !before.has(spec.id)),
      disappeared: previous.specs.filter((spec) => !now.has(spec.id)),
    };
  }
}
