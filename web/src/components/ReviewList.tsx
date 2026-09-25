"use client";

/**
 * Look it over before you send it: what waits for a yes, what was said but is not in, what came
 * from last time, and the rest — the same reading as the badges on the page. An item with a field
 * brings it into view and flashes its badge.
 */

import type { ReviewGroup } from "@longtake/core";

export function ReviewList({ groups, focus }: { groups: ReviewGroup[]; focus: (fieldId: string) => void }) {
  const count = groups.reduce((n, group) => n + group.items.length, 0);
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Look it over before you send ({count})</h2>
      <div className="mt-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
        {count === 0 && <p className="text-neutral-400">Nothing yet — answers show here as they go in.</p>}
        {groups.map((group) => (
          <div key={group.kind} className="mb-1.5">
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">{group.title}</p>
            {group.items.map((item, i) =>
              item.fieldId ? (
                <button
                  key={item.fieldId}
                  onClick={() => focus(item.fieldId!)}
                  className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-neutral-100 active:scale-[0.99] dark:hover:bg-neutral-800"
                >
                  <span className="font-medium">{item.question}</span> <span className="text-neutral-500">{item.detail}</span>
                </button>
              ) : (
                <p key={`${group.kind}-${i}`} className="truncate px-1 py-0.5">
                  <span className="font-medium">{item.question}</span> <span className="text-neutral-500">{item.detail}</span>
                </p>
              ),
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
