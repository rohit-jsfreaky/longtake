/**
 * The small sounds of the panel: a soft press under a button, a tick under a link, a click-clack
 * when the review list opens. Synthesized on the spot (cuelume: Web Audio, no files), quiet, and
 * only ever for the pointer — a key pressed a hundred times a day should not make a noise a hundred
 * times a day.
 *
 * On unless turned off in settings (`sounds: false` in extension storage). Short enough that the
 * microphone's echo canceller takes them out, and far shorter than anything the agent could hear
 * as speech (core/src/barge.ts wants 160 ms of voice).
 */

import { play, setEnabled, setVolume, type SoundName } from "cuelume";

let on = true;
setVolume(0.6);

void chrome.storage.local.get("sounds").then(({ sounds }) => {
  on = sounds !== false;
  setEnabled(on);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("sounds" in changes)) return;
  on = changes.sounds!.newValue !== false;
  setEnabled(on);
});

export function cue(name: SoundName, volume = 0.35): void {
  if (on) play(name, { volume });
}
