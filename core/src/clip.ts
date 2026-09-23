/**
 * The few seconds of audio that one answer came from.
 *
 * ## Why
 *
 * Clicking "First Name" to hear yourself say it used to play the whole turn — thirty seconds of
 * name, job, city and LinkedIn, because the answer was one breath among many. The receipt is only a
 * receipt if it is the words for THIS box.
 *
 * The Voice Agent API gives no word timings: `transcript.user` is text only. But the running
 * transcript (`transcript.user.delta`) arrives while the person is still speaking, and we know how
 * much audio we had captured when each one arrived. So a word's place in the recording is bounded
 * by the last delta that did not contain it yet and the first that did. That is enough to cut a
 * clip around a quote — with padding, because transcription lags speech by a few hundred
 * milliseconds.
 *
 * Pure: a timeline in, a sample range out.
 */

/** One running transcript, and how much of the turn's audio had been captured when it arrived. */
export type TimelinePoint = { text: string; sample: number };

export type Clip = { start: number; end: number };

/** Words too common to place a quote by — "my name is" is everywhere in a long take. */
const COMMON = new Set([
  "a", "an", "the", "and", "or", "but", "is", "am", "are", "was", "were", "be", "i", "im", "me", "my", "mine",
  "it", "its", "to", "of", "in", "on", "at", "for", "from", "with", "as", "so", "that", "this", "uh", "um",
  "like", "yeah", "yes", "no", "hai", "hain", "ka", "ki", "ke", "mera", "meri", "main", "se", "aur", "toh",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The words of a quote that can actually place it: uncommon ones, or all of them if there are none. */
function markers(quote: string): string[] {
  const all = words(quote);
  const rare = all.filter((w) => !COMMON.has(w));
  return rare.length > 0 ? rare : all;
}

/** How many times a word appears in a text — a quote's word may already be earlier in the turn. */
function count(text: string, word: string): number {
  return words(text).filter((w) => w === word).length;
}

/**
 * Where in the turn's audio a quote was spoken.
 *
 * `null` when the quote cannot be placed — the caller then plays the whole turn, which is the old
 * behaviour and still honest, just longer.
 */
export function clipFor(
  quote: string,
  timeline: TimelinePoint[],
  totalSamples: number,
  sampleRate = 24000,
): Clip | null {
  const marks = markers(quote);
  if (marks.length === 0 || timeline.length === 0) return null;

  const first = marks[0]!;
  const last = marks[marks.length - 1]!;

  // The first delta that holds the quote's first marker word. Before it, the word had not been
  // said yet — so the answer starts after the delta before this one.
  let startIndex = -1;
  for (let i = 0; i < timeline.length; i++) {
    if (count(timeline[i]!.text, first) > 0) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;

  // The end: the first delta at or after the start that holds every marker of the quote.
  let endIndex = -1;
  for (let i = startIndex; i < timeline.length; i++) {
    const text = timeline[i]!.text;
    if (marks.every((w) => count(text, w) > 0) && count(text, last) > 0) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return null;

  // Transcription lags speech. The word was spoken somewhere after the delta that lacked it —
  // backed off a little further for the lag — and was over by the delta that had it.
  const LEAD = Math.round(0.6 * sampleRate);
  const TAIL = Math.round(0.35 * sampleRate);
  const before = startIndex > 0 ? timeline[startIndex - 1]!.sample : 0;
  const start = Math.max(0, before - LEAD);
  const end = Math.min(totalSamples, timeline[endIndex]!.sample + TAIL);

  // A clip shorter than half a second is a misplacement, not an answer.
  if (end - start < sampleRate / 2) return null;
  return { start, end };
}
