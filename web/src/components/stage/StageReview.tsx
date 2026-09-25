"use client";

import type { ReviewGroup } from "@longtake/core";

import { cue } from "@/lib/sound";

/**
 * Look it over before you send — the demo's side panel, once the call has stopped.
 *
 * The same reading as the badges on the form (core/src/review.ts): what waits for a yes, what was
 * said but is not in, what came from last time, what was spoken, what is still theirs. An item
 * brings its field into view in the browser frame and flashes its badge, so the list and the page
 * are never two different stories.
 */
export function StageReview({ groups, focus }: { groups: ReviewGroup[]; focus: (fieldId: string) => void }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.kind}>
          <p className="tag mb-1.5 text-faint">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item, i) => (
              <li key={item.fieldId ?? `${group.kind}-${i}`}>
                {item.fieldId ? (
                  <button
                    onPointerDown={(event) => event.button === 0 && cue("tick", 0.22)}
                    onClick={() => focus(item.fieldId!)}
                    className="press block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink"
                  >
                    <span className="text-paper">{item.question}</span>{" "}
                    <span className="text-dim">{item.detail}</span>
                  </button>
                ) : (
                  <p className="px-2 py-1.5">
                    <span className="text-paper">{item.question}</span>{" "}
                    <span className="text-dim">{item.detail}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
