/**
 * A beam travelling down a path.
 *
 * Reverse-engineered from dub.co's hero SVG rather than invented. Their recipe,
 * which is the one most good product sites use, has three layers on the same
 * path string:
 *
 *   1. a static track, drawn in a dim stroke
 *   2. a BIG radial-gradient circle (they use r=70) whose fill fades to zero at
 *      its edge, moving along the path and **masked to the path itself** — this
 *      is the glow, and the mask is what stops it being a blob floating over
 *      the artwork
 *   3. a small solid dot with a translucent halo, on the same path — the packet
 *
 * The mask is simply the same path stroked in white. Everything the glow
 * touches outside that stroke is clipped away.
 *
 * `reverse` uses dub's `keyPoints="1;0"` trick to run the motion backwards
 * without having to write the path the other way round.
 */
export function Beam({
  id,
  d,
  color = "#43c39b",
  dur = 4,
  begin = 0,
  reverse = false,
  glowRadius = 60,
  trackWidth = 1.25,
}: {
  /** Unique within the page — mask and gradient ids are global. */
  id: string;
  d: string;
  color?: string;
  dur?: number;
  begin?: number;
  reverse?: boolean;
  glowRadius?: number;
  trackWidth?: number;
}) {
  const maskId = `${id}-mask`;
  const gradId = `${id}-grad`;
  const motion = {
    path: d,
    dur: `${dur}s`,
    begin: `${begin}s`,
    repeatCount: "indefinite" as const,
    ...(reverse ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" as const } : {}),
  };

  return (
    <>
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0%" stopOpacity="1" stopColor={color} />
          <stop offset="100%" stopOpacity="0" stopColor={color} />
        </radialGradient>
        <mask id={maskId}>
          <path d={d} fill="none" stroke="white" strokeWidth={trackWidth + 0.5} />
        </mask>
      </defs>

      {/* the track */}
      <path d={d} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={trackWidth} />

      {/* the glow, clipped to the track */}
      <g mask={`url(#${maskId})`}>
        <circle r={glowRadius} fill={`url(#${gradId})`}>
          <animateMotion {...motion} />
        </circle>
      </g>

      {/* the packet */}
      <g>
        <animateMotion {...motion} />
        <circle r="6" fill={color} opacity="0.25" />
        <circle r="2.5" fill={color} />
      </g>
    </>
  );
}
