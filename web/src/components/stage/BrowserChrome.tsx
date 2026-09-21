import { RecordDot } from "@/components/RecordDot";

/**
 * Browser chrome around the demo.
 *
 * This is not decoration. Longtake's whole claim is that it works on **a form
 * you do not own**, and a bare form on our own page cannot say that — it looks
 * like our form. Wrapped in a window showing a real `job-boards.greenhouse.io`
 * URL, the argument makes itself before anybody reads a word.
 *
 * Superhuman does exactly this: their hero is a real Google Doc inside real
 * browser chrome, because "it works inside your other apps" is the product.
 */
export function BrowserChrome({
  url,
  live = false,
  children,
}: {
  url: string;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="sq overflow-hidden border border-hair bg-ink-700">
      <div className="flex items-center gap-4 border-b border-hair px-4 py-3">
        {/* Traffic lights, drawn as three dots in the hairline colour rather
            than the usual red/amber/green — the page has no hue, and three
            coloured circles would be the loudest thing on it. */}
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-hair" />
          <span className="size-2.5 rounded-full bg-hair" />
          <span className="size-2.5 rounded-full bg-hair" />
        </div>

        <div className="min-w-0 flex-1 rounded-full border border-hair bg-ink-700 px-3 py-1.5">
          <span className="block truncate text-[12px] text-faint">{url}</span>
        </div>

        {/* Present at all times so the bar does not reflow when recording
            starts; it just stops being faint. */}
        <span
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors ${
            live ? "border-hair bg-ink-700" : "border-transparent"
          }`}
        >
          <RecordDot live={live} size={7} />
          <span className={`text-[11px] ${live ? "text-paper" : "text-faint"}`}>
            {live ? "Live" : "Idle"}
          </span>
        </span>
      </div>

      {children}
    </div>
  );
}
