/**
 * The demo's small sounds: a soft press under the microphone button, a tick under a tab or a review
 * item. Synthesized on the spot (cuelume: Web Audio, no files), quiet, and only for the pointer.
 * Short enough that the echo canceller takes them out and far shorter than anything the agent could
 * hear as speech.
 */

import { play, type SoundName } from "cuelume";

export function cue(name: SoundName, volume = 0.3): void {
  play(name, { volume });
}
