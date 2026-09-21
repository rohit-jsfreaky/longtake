/**
 * The distance between what somebody said and what got written down.
 *
 * We hold both halves of every long answer — `dictation.ts` keeps the verbatim beside the tidy
 * version — and the gap between them is information nobody else keeps. A person who says
 * *"Um, I think I mean I want this role because, because…"* left four traces in that sentence
 * that the finished answer does not carry.
 *
 * ## What this file is allowed to conclude
 *
 * **That the person might want another look at that box. Nothing else, ever.**
 *
 * It does not know whether an answer is true. It cannot know. Hesitation means a hundred things
 * — a hard question, a noisy room, a second language, a memory that took a moment — and exactly
 * none of them is dishonesty. Software that implies otherwise, on a job application, would be
 * indefensible.
 *
 * So the constraint is structural rather than editorial: this module exports **one** sentence,
 * `ANOTHER_LOOK`, and there is no code path that produces any other user-facing words.
 * `tests/hesitation.spec.ts` asserts that nothing it emits ever contains the vocabulary of
 * certainty or truth. If someone later adds a `confidence` number, the tests fail.
 *
 * ## And it is not the headline
 *
 * Another entrant already does certainty scoring properly, deeply, one answer at a time. Ours is
 * a quiet supporting layer across a whole form, offered as help. It never leads the pitch.
 */

/** The only thing this file ever says to a person. */
export const ANOTHER_LOOK = "Want another look at this one?";

/**
 * Words that carry no answer, in both the languages Longtake listens to.
 *
 * Hindi fillers are here in both scripts because the transcript comes back in whichever one was
 * spoken — a Hinglish sentence can produce either, sometimes in the same breath.
 */
const FILLERS = [
  "um",
  "uh",
  "erm",
  "er",
  "ah",
  "hmm",
  "mm",
  "like",
  "you know",
  "i mean",
  "sort of",
  "kind of",
  "basically",
  "actually",
  "matlab",
  "yaani",
  "arre",
  "haan to",
  "मतलब",
  "यानी",
  "अरे",
];

/** How much of the answer has to disappear before the tidying itself is worth noticing. */
const HEAVILY_EDITED_RATIO = 0.25;
/** A pause this long before starting to answer is worth a gentle nudge. */
const SLOW_START_SECONDS = 2.5;
/** Below this, one stray "um" is just how people talk. */
const FILLER_THRESHOLD = 2;

export type HesitationMark =
  | { kind: "filler"; count: number; words: string[] }
  | { kind: "restart"; count: number; examples: string[] }
  | { kind: "slow-start"; seconds: number }
  | { kind: "heavily-edited"; removedRatio: number };

export type Hesitation = {
  fieldId: string;
  /** What was noticed. Observations about the speech, never about the speaker. */
  marks: HesitationMark[];
  /** Whether to offer the nudge at all. */
  worthAnotherLook: boolean;
  /** `ANOTHER_LOOK`, or nothing. There is no third option by design. */
  prompt?: string;
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countFillers(verbatim: string): { count: number; words: string[] } {
  const text = ` ${normalise(verbatim)} `;
  const found: string[] = [];
  let count = 0;

  for (const filler of FILLERS) {
    // Padded so "um" does not match inside "umbrella", and "like" not inside "likely".
    const matches = text.split(` ${filler} `).length - 1;
    if (matches > 0) {
      count += matches;
      found.push(filler);
    }
  }

  return { count, words: found };
}

/**
 * Words the speaker said twice in a row, or near enough.
 *
 * *"because, because I want to grow"* is a restart. It is the most visible trace of somebody
 * assembling a thought while speaking, and it survives into the verbatim while the tidy version
 * loses it entirely.
 */
function countRestarts(verbatim: string): { count: number; examples: string[] } {
  const words = normalise(verbatim).split(" ").filter(Boolean);
  const examples: string[] = [];
  let count = 0;

  for (let i = 1; i < words.length; i++) {
    if (words[i] && words[i] === words[i - 1] && words[i]!.length > 1) {
      count++;
      if (examples.length < 3) examples.push(words[i]!);
    }
  }

  return { count, examples };
}

/**
 * Compare the two halves of one answer.
 *
 * `secondsBeforeSpeaking` is optional — the pause between being asked and starting to answer.
 * It is the one signal that does not come from the text.
 */
export function readHesitation(
  fieldId: string,
  verbatim: string,
  clean: string,
  secondsBeforeSpeaking?: number,
): Hesitation {
  const marks: HesitationMark[] = [];

  const fillers = countFillers(verbatim);
  if (fillers.count >= FILLER_THRESHOLD) {
    marks.push({ kind: "filler", count: fillers.count, words: fillers.words });
  }

  const restarts = countRestarts(verbatim);
  if (restarts.count > 0) {
    marks.push({ kind: "restart", count: restarts.count, examples: restarts.examples });
  }

  const spoken = normalise(verbatim).length;
  const written = normalise(clean).length;
  if (spoken > 0 && written < spoken) {
    const removedRatio = (spoken - written) / spoken;
    if (removedRatio >= HEAVILY_EDITED_RATIO) {
      marks.push({ kind: "heavily-edited", removedRatio: Number(removedRatio.toFixed(2)) });
    }
  }

  if (secondsBeforeSpeaking !== undefined && secondsBeforeSpeaking >= SLOW_START_SECONDS) {
    marks.push({ kind: "slow-start", seconds: Number(secondsBeforeSpeaking.toFixed(1)) });
  }

  const worthAnotherLook = marks.length > 0;

  return {
    fieldId,
    marks,
    worthAnotherLook,
    // The only sentence, and only when there is a reason for it.
    ...(worthAnotherLook ? { prompt: ANOTHER_LOOK } : {}),
  };
}

/**
 * A plain description of what was noticed, for someone who asks why a field is marked.
 *
 * Deliberately about the recording, not the person: "two filler words", never "you hesitated".
 * The difference sounds small and is the whole point — one is a fact about audio, the other is a
 * claim about a state of mind.
 */
export function describeMarks(hesitation: Hesitation): string[] {
  return hesitation.marks.map((mark) => {
    switch (mark.kind) {
      case "filler":
        return `${mark.count} filler ${mark.count === 1 ? "word" : "words"} in the recording`;
      case "restart":
        return `${mark.count} ${mark.count === 1 ? "restart" : "restarts"} while speaking`;
      case "heavily-edited":
        return `${Math.round(mark.removedRatio * 100)}% shorter once tidied`;
      case "slow-start":
        return `${mark.seconds}s before the answer started`;
    }
  });
}
