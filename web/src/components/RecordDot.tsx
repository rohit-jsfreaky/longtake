/**
 * A small live indicator. It only ever moves while the microphone is actually
 * open — a dot that pulses at rest is the first small lie an interface tells.
 */
export function RecordDot({
  live = false,
  size = 8,
  className = "",
}: {
  live?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={live ? "Recording" : "Not recording"}
    >
      {live && (
        <span
          className="absolute animate-ping rounded-full bg-mint opacity-60"
          style={{ width: size, height: size }}
        />
      )}
      <span
        className={`rounded-full ${live ? "bg-mint" : "bg-faint"}`}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
