/**
 * The Longtake mark.
 *
 * A squircle — Apple's continuous corner, drawn here as a real superellipse
 * path so it is identical in every browser rather than depending on
 * `corner-shape` support — with a waveform inside it.
 *
 * The waveform is the product: one continuous utterance. The bars are uneven on
 * purpose; a symmetrical set would read as a generic audio glyph.
 */
export function Mark({ className = "", live = false }: { className?: string; live?: boolean }) {
  // A superellipse (|x|^n + |y|^n = 1, n = 4) traced with cubic curves. The
  // 0.55 control-point ratio is what gives the corner its continuous falloff
  // instead of the sudden arc a plain border-radius produces.
  const squircle =
    "M2 16 C2 6.2 6.2 2 16 2 C25.8 2 30 6.2 30 16 C30 25.8 25.8 30 16 30 C6.2 30 2 25.8 2 16 Z";

  const bars = [
    { x: 9.5, h: 6 },
    { x: 13, h: 13 },
    { x: 16.5, h: 9 },
    { x: 20, h: 15 },
    { x: 23.5, h: 7 },
  ];

  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Longtake">
      <path d={squircle} fill="#FAFAFA" />
      {bars.map((bar, i) => (
        <rect
          key={bar.x}
          x={bar.x - 1}
          y={16 - bar.h / 2}
          width={2}
          height={bar.h}
          rx={1}
          fill="#0A0A0B"
        >
          {live && (
            <>
              <animate
                attributeName="height"
                values={`${bar.h};${bar.h * 1.5};${bar.h * 0.6};${bar.h}`}
                dur="1.3s"
                begin={`${i * 0.1}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="y"
                values={`${16 - bar.h / 2};${16 - (bar.h * 1.5) / 2};${16 - (bar.h * 0.6) / 2};${16 - bar.h / 2}`}
                dur="1.3s"
                begin={`${i * 0.1}s`}
                repeatCount="indefinite"
              />
            </>
          )}
        </rect>
      ))}
    </svg>
  );
}
