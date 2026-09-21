/**
 * Playing a person their own voice back.
 *
 * This is the receipt. Every answer on the form was spoken, and the audio it was spoken in is
 * already in memory — `voice-session.ts` keeps each turn as it streams it. Clicking a field and
 * hearing yourself say it is the difference between trusting the software and checking it, and
 * checking should always be available.
 *
 * The audio is PCM16 mono at 24 kHz, the rate the whole pipeline runs at. Turning it into
 * something playable is arithmetic, not a network call.
 */

const SAMPLE_RATE = 24000;

/** One shared context. Browsers cap how many can exist, and a page could have twenty fields. */
let shared: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

function context(): AudioContext {
  if (!shared || shared.state === "closed") {
    shared = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  return shared;
}

/** Stop whatever is currently playing. Safe to call when nothing is. */
export function stopPlayback(): void {
  if (!playing) return;
  try {
    playing.onended = null;
    playing.stop(0);
    playing.disconnect();
  } catch {
    // already finished
  }
  playing = null;
}

/**
 * Play a recorded turn, and resolve when it finishes.
 *
 * Starting a new clip stops the previous one — two answers talking over each other is worse
 * than useless, and clicking around a form is exactly how somebody would trigger that.
 */
export async function playTurn(samples: Int16Array): Promise<void> {
  stopPlayback();
  if (samples.length === 0) return;

  const ctx = context();
  // Browsers suspend an AudioContext created outside a gesture; a click is a gesture.
  await ctx.resume();

  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  playing = source;

  await new Promise<void>((resolve) => {
    source.onended = () => {
      if (playing === source) playing = null;
      resolve();
    };
    source.start();
  });
}

/** How long a recording lasts, for a label. */
export function turnSeconds(samples: Int16Array): number {
  return Number((samples.length / SAMPLE_RATE).toFixed(1));
}
