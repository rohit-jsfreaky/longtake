/**
 * The name and the description a screen reader gives a control — the W3C accname algorithm, from
 * `dom-accessibility-api` (the implementation Testing Library uses), not a hand-rolled copy.
 *
 * What the page author declared about a field, in the order the standard reads it. `reader.ts`
 * decides where this wins over its own rules and where it does not — by the corpus, rule by rule.
 */

import { computeAccessibleDescription, computeAccessibleName } from "dom-accessibility-api";

// In a real browser, `::before` / `::after` content is part of the name — MS Forms draws its
// required star that way.
const OPTIONS = { computedStyleSupportsPseudoElements: true };

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

export function accessibleName(el: Element): string {
  try {
    return flat(computeAccessibleName(el, OPTIONS));
  } catch {
    return "";
  }
}

export function accessibleDescription(el: Element): string {
  try {
    return flat(computeAccessibleDescription(el, OPTIONS));
  } catch {
    return "";
  }
}
