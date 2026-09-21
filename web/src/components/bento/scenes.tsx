/**
 * One small looping scene per bento cell.
 *
 * All seven are built on one primitive — `Beam`, reverse-engineered from
 * dub.co's hero SVG — so the set reads as one language rather than seven
 * drawings. The beam always means the same thing here: **an answer in
 * motion.** Where it travels, where it stops, and which way it runs is the
 * whole vocabulary:
 *
 *   forward  → an answer arriving in a field
 *   reverse  → the agent asking you something, or playing your voice back
 *   looping  → nothing leaving the machine
 *
 * House rules:
 *   · 220×120, or 460×120 for the two cells that span two columns
 *   · SMIL only — runs before hydration, off the main thread, no layout shift
 *   · monochrome, with mint used only where it means "filled"
 *   · loop lengths are deliberately near-co-prime (2.6s / 3.2s / 4s / 5s) so
 *     neighbouring cells drift out of phase instead of pulsing in unison
 */

import { Beam } from "./Beam";

const H = 120;

function Scene({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${wide ? 460 : 220} ${H}`}
      className="h-[120px] w-full"
      fill="none"
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {children}
    </svg>
  );
}

const HAIR = "rgba(255,255,255,0.10)";
const HAIR_LIT = "rgba(255,255,255,0.18)";
const PAPER = "#fafafa";
const DIM = "#6e6e77";
const MINT = "#43c39b";

/** The voice, wherever a scene needs it. Bars are uneven so it reads as speech. */
function Voice({ cx, cy, r = 20 }: { cx: number; cy: number; r?: number }) {
  const bars = [-8, -4, 0, 4, 8];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.04)" stroke={HAIR_LIT} />
      {bars.map((dx, i) => (
        <rect key={dx} x={cx + dx - 1} y={cy - 5} width="2" height="10" rx="1" fill={PAPER}>
          <animate
            attributeName="height"
            values="5;15;8;13;5"
            dur="1.4s"
            begin={`${i * 0.11}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values={`${cy - 2.5};${cy - 7.5};${cy - 4};${cy - 6.5};${cy - 2.5}`}
            dur="1.4s"
            begin={`${i * 0.11}s`}
            repeatCount="indefinite"
          />
        </rect>
      ))}
    </g>
  );
}

/* ── 01 · Any form, any site ──────────────────────────────────────────────
   Tried generated artwork here with the beams overlaid on top, and it failed:
   the glow is masked to the traced path rather than to the PNG's own line, so
   any misalignment shows up as a detached blob beside the connector. Matching
   overlay coordinates to a raster by eye is never exact enough for this.
   Generated art is useful as a composition reference; it is not usable as the
   animated layer. */
export function SceneAnyForm() {
  const rows = [26, 60, 94];
  return (
    <Scene wide>
      <Voice cx={60} cy={60} r={26} />
      {rows.map((y, i) => (
        <Beam
          key={y}
          id={`anyform-${i}`}
          d={`M96 60 C 170 60, 190 ${y}, 264 ${y}`}
          dur={3.2}
          begin={i * 0.55}
        />
      ))}
      {rows.map((y, i) => (
        <g key={`f${y}`}>
          <rect x="264" y={y - 13} width="182" height="26" rx="8" stroke={HAIR} />
          <rect x="276" y={y - 2} width="0" height="4" rx="2" fill={PAPER} opacity="0.75">
            <animate
              attributeName="width"
              values="0;0;120;120;0"
              keyTimes="0;0.34;0.46;0.92;1"
              dur="3.2s"
              begin={`${i * 0.55}s`}
              repeatCount="indefinite"
            />
          </rect>
          <circle cx="434" cy={y} r="3" fill={MINT} opacity="0">
            <animate
              attributeName="opacity"
              values="0;0;1;1;0"
              keyTimes="0;0.34;0.46;0.92;1"
              dur="3.2s"
              begin={`${i * 0.55}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}
    </Scene>
  );
}

/* ── 02 · Switch language mid-sentence ────────────────────────────────────
   One beam, one field, and the answer arriving in a different script each
   time round. The beam never changes — which is the point. */
export function SceneLanguage() {
  return (
    <Scene>
      <Voice cx={28} cy={60} r={17} />
      <Beam id="lang" d="M45 60 H 112" dur={4} glowRadius={34} />

      <rect x="112" y="44" width="96" height="32" rx="9" stroke={HAIR} />
      <text
        x="160"
        y="64"
        fill={MINT}
        fontSize="12"
        textAnchor="middle"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        Rohit
        <animate
          attributeName="opacity"
          values="0;1;1;0;0;0;0"
          keyTimes="0;0.12;0.44;0.5;0.62;0.94;1"
          dur="8s"
          repeatCount="indefinite"
        />
      </text>
      <text
        x="160"
        y="64"
        fill={MINT}
        fontSize="12"
        textAnchor="middle"
        opacity="0"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        रोहित
        <animate
          attributeName="opacity"
          values="0;0;0;0;1;1;0"
          keyTimes="0;0.12;0.44;0.5;0.62;0.94;1"
          dur="8s"
          repeatCount="indefinite"
        />
      </text>
    </Scene>
  );
}

/* ── 03 · Twenty answers at once ──────────────────────────────────────────
   Five beams that fire together rather than in sequence. Everywhere else on
   the page things are staggered; here they are not, and that contrast is what
   carries "at once". */
export function SceneBurst() {
  const rows = [18, 39, 60, 81, 102];
  return (
    <Scene>
      <Voice cx={26} cy={60} r={16} />
      {rows.map((y, i) => (
        <Beam
          key={y}
          id={`burst-${i}`}
          d={`M43 60 C 72 60, 78 ${y}, 106 ${y}`}
          dur={2.6}
          begin={i * 0.04}
          glowRadius={30}
        />
      ))}
      {rows.map((y, i) => (
        <g key={`f${y}`}>
          <rect x="106" y={y - 7} width="102" height="14" rx="5" stroke={HAIR} />
          <rect x="113" y={y - 2} width="0" height="4" rx="2" fill={PAPER} opacity="0.75">
            <animate
              attributeName="width"
              values="0;0;70;70;0"
              keyTimes="0;0.42;0.54;0.9;1"
              dur="2.6s"
              begin={`${i * 0.04}s`}
              repeatCount="indefinite"
            />
          </rect>
        </g>
      ))}
    </Scene>
  );
}

/* ── 04 · The next form already knows ────────────────────────────────────── */
export function SceneRecall() {
  const rows = [36, 54, 72];
  return (
    <Scene wide>
      <rect x="18" y="22" width="150" height="76" rx="10" stroke={HAIR} />
      <rect x="292" y="22" width="150" height="76" rx="10" stroke={HAIR} />

      {rows.map((y, i) => (
        <g key={y}>
          <rect x="32" y={y} width="122" height="8" rx="3" fill={DIM} opacity="0.45" />
          <rect x="306" y={y} width="122" height="8" rx="3" stroke={HAIR_LIT} />
          <rect x="306" y={y} width="122" height="8" rx="3" fill={MINT} opacity="0">
            <animate
              attributeName="opacity"
              values="0;0;0.22;0.22;0"
              keyTimes="0;0.45;0.6;0.92;1"
              dur="5s"
              begin={`${i * 0.3}s`}
              repeatCount="indefinite"
            />
          </rect>
          <Beam
            id={`recall-${i}`}
            d={`M168 ${y + 4} C 210 ${y + 4}, 250 ${y + 4}, 298 ${y + 4}`}
            dur={5}
            begin={i * 0.3}
            glowRadius={40}
          />
        </g>
      ))}
    </Scene>
  );
}

/* ── 05 · It asks for what you missed ─────────────────────────────────────
   Two beams arrive and fill. The third field is dashed and nothing ever
   reaches it — instead a beam runs BACK from it to the voice. That reversal
   is the feature: the empty box is what makes it speak. */
export function SceneAsk() {
  const filled = [26, 60];
  return (
    <Scene>
      <Voice cx={26} cy={60} r={16} />

      {filled.map((y, i) => (
        <Beam
          key={y}
          id={`ask-${i}`}
          d={`M43 60 C 70 60, 76 ${y}, 104 ${y}`}
          dur={4}
          begin={i * 0.4}
          glowRadius={30}
        />
      ))}
      {filled.map((y, i) => (
        <g key={`f${y}`}>
          <rect x="104" y={y - 8} width="104" height="16" rx="5" stroke={HAIR} />
          <rect x="111" y={y - 2} width="0" height="4" rx="2" fill={PAPER} opacity="0.7">
            <animate
              attributeName="width"
              values="0;0;66;66;0"
              keyTimes="0;0.3;0.42;0.9;1"
              dur="4s"
              begin={`${i * 0.4}s`}
              repeatCount="indefinite"
            />
          </rect>
        </g>
      ))}

      {/* the one it will not fill — and the question coming back out of it */}
      <rect
        x="104"
        y="86"
        width="104"
        height="18"
        rx="6"
        stroke={HAIR_LIT}
        strokeDasharray="4 4"
      />
      <Beam
        id="ask-back"
        d="M104 95 C 76 95, 70 60, 43 60"
        dur={4}
        begin={1.2}
        glowRadius={30}
        color={PAPER}
      />
    </Scene>
  );
}

/* ── 06 · Hear yourself say it ────────────────────────────────────────────
   The beam runs backwards along a waveform — out of the field, into your ear.
   Everywhere else the motion goes left to right; here it does not. */
export function ScenePlayback() {
  const wave =
    "M16 60 C 34 26, 52 94, 70 60 S 106 26, 124 60 S 160 94, 178 60 S 200 40, 206 60";

  const bars = Array.from({ length: 30 }, (_, i) => {
    const a = Math.sin(i * 0.8) * 0.5 + 0.5;
    const b = Math.sin(i * 2.1 + 1.1) * 0.5 + 0.5;
    return 8 + (a * 0.6 + b * 0.4) * 44;
  });

  return (
    <Scene>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={14 + i * 6.6}
          y={60 - h / 2}
          width="2.5"
          height={h}
          rx="1.25"
          fill={PAPER}
          opacity="0.16"
        />
      ))}
      <Beam id="playback" d={wave} dur={4.4} reverse glowRadius={38} color={PAPER} />
    </Scene>
  );
}

/* ── 07 · Stays on your machine ───────────────────────────────────────────
   A closed circuit inside a dashed boundary. The beam goes round and round
   and never once crosses the line. */
export function SceneLocal() {
  const loop = "M74 40 H 146 C 162 40, 162 80, 146 80 H 74 C 58 80, 58 40, 74 40 Z";
  return (
    <Scene>
      <rect
        x="12"
        y="16"
        width="196"
        height="88"
        rx="12"
        stroke={HAIR_LIT}
        strokeDasharray="5 5"
      />
      <rect x="86" y="50" width="48" height="20" rx="6" stroke={HAIR} />
      <rect x="94" y="57" width="32" height="3" rx="1.5" fill={DIM} />
      <rect x="94" y="63" width="20" height="3" rx="1.5" fill={DIM} opacity="0.6" />
      <Beam id="local" d={loop} dur={5} glowRadius={34} />
    </Scene>
  );
}
