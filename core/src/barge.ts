/**
 * Hearing the person start to talk, here, before the server says so — to lower the agent's voice.
 *
 * ## Why this exists
 *
 * Live, a person talked over the agent and it talked on; their words appeared only once it had
 * finished. Measured against the real API (`npm run probe:barge`, RESEARCH.md §9i): barge-in is
 * semantic, so the server waits to understand before it interrupts. "Wait, stop" stopped the agent
 * 1.5 s after it was said; "Uh, my gender is male…" 3.1–3.6 s after, the length of that first
 * clause, and no transcript of their words arrived until then either. Every knob that might hurry
 * it (`min_latency`, `interruption_delay: 0`) left the timing as it was and lost the first clause.
 *
 * So the server keeps the decision — it knows "uh-huh" from "wait" — and this only answers the
 * question the person is really asking, "did it hear me?", at once: the agent's voice drops the
 * moment they speak over it, and comes back if the server decides they were only saying "mm-hm".
 *
 * ## How
 *
 * The microphone's level, in ~20 ms frames, against the room's noise: the quietest frame of the
 * last 3 s in which neither of them was talking. A steady fan sets that floor where it is; speech
 * never does, because it has gaps between words and is not learned from while it lasts. Nothing
 * counts until half a second of the room has been heard. Speech is a level well above the floor
 * held for 160 ms; it ends after 600 ms below it.
 * While the agent is audible the bar is higher, and its first 300 ms are ignored: the echo
 * canceller has already taken the agent's voice out of this signal, but it takes a moment to
 * settle on a new reply, and what it leaves is quiet — a person talking over someone is not.
 *
 * Pure, with time passed in.
 */

export type LocalSpeechOptions = {
  /** Never counts as speech below this, however quiet the room (dBFS). */
  floorMin?: number;
  /** How far above the room's noise speech is (dB); and how much further while the agent talks. */
  margin?: number;
  marginWhileAgent?: number;
  /** How long speech must hold before it counts, and how long silence must before it ends (ms). */
  startMs?: number;
  endMs?: number;
  /** The start of each agent reply the echo canceller may still be settling on (ms). */
  settleMs?: number;
  /** How much of the room is remembered for its floor, and how much must be heard first (ms). */
  roomMs?: number;
  calibrateMs?: number;
};

const DEFAULTS: Required<LocalSpeechOptions> = {
  floorMin: -45,
  margin: 12,
  marginWhileAgent: 20,
  startMs: 160,
  endMs: 600,
  settleMs: 300,
  roomMs: 3000,
  calibrateMs: 500,
};

/** dBFS of a block of 16-bit samples. */
export function levelOf(samples: Int16Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length) / 32768;
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

/** The floor assumed before the room has been heard: a fairly quiet one, so only a voice clears it. */
const UNHEARD_ROOM = -55;

export class LocalSpeech {
  private readonly o: Required<LocalSpeechOptions>;
  /** Recent levels of the room — frames in which neither of them was talking — with their times. */
  private room: [number, number][] = [];
  private heardRoomFor = 0;
  private speaking = false;
  /** When the level first went over the bar in this run of loud frames, and when it last was. */
  private loudSince = -1;
  private lastLoud = -Infinity;

  constructor(options: LocalSpeechOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * One frame of the microphone. `agentFor` is how long the agent has been audible (ms), or -1
   * when it is not. Returns "start" or "end" when that changes, else null.
   */
  frame(db: number, now: number, agentFor: number): "start" | "end" | null {
    const agent = agentFor >= 0;
    // The room, while neither of them talks: its quietest frame of the last few seconds is its floor.
    if (!agent && !this.speaking) {
      this.room.push([now, db]);
      this.heardRoomFor += 20;
      while (this.room.length > 0 && now - this.room[0]![0] > this.o.roomMs) this.room.shift();
    }
    // Quiet, the room must be heard first: a steady fan is not someone starting to talk. Over the
    // agent there may be no quiet to learn from — it can start speaking the moment the call opens —
    // so there a cautious floor stands in, under the higher bar anyway.
    const calibrated = this.heardRoomFor >= this.o.calibrateMs;
    if (!calibrated && !agent) return null;
    if (agent && agentFor < this.o.settleMs && !this.speaking) {
      this.loudSince = -1;
      return null;
    }
    const floor = calibrated ? Math.min(...this.room.map(([, level]) => level)) : UNHEARD_ROOM;
    const bar = Math.max(this.o.floorMin, floor + (agent ? this.o.marginWhileAgent : this.o.margin));
    const loud = db >= bar;

    if (loud) {
      if (this.loudSince < 0 || now - this.lastLoud > 80) this.loudSince = now; // a gap starts a new run
      this.lastLoud = now;
      if (!this.speaking && now - this.loudSince >= this.o.startMs) {
        this.speaking = true;
        return "start";
      }
      return null;
    }
    if (this.speaking && now - this.lastLoud >= this.o.endMs) {
      this.speaking = false;
      this.loudSince = -1;
      return "end";
    }
    return null;
  }
}
