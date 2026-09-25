/**
 * Hearing the person start to talk, here, before the server says so (core/src/barge.ts): what
 * counts as speech, when it ends, and why the agent's own voice — already taken out by the echo
 * canceller, but not perfectly at the start of a reply — does not count.
 */

import { expect, test } from "@playwright/test";

import { levelOf, LocalSpeech } from "../core/src/barge";

/** Feed `ms` of frames at `db`, 20 ms apart, from `t`; the changes, with when they happened. */
function run(speech: LocalSpeech, t: number, ms: number, db: number, agentFrom = -1) {
  const changes: [string, number][] = [];
  for (let at = t; at < t + ms; at += 20) {
    const change = speech.frame(db, at, agentFrom < 0 ? -1 : at - agentFrom);
    if (change) changes.push([change, at]);
  }
  return changes;
}

test("a quiet room is not speech, however long", () => {
  const speech = new LocalSpeech();
  expect(run(speech, 0, 5000, -62)).toEqual([]);
});

test("speech is a level well above the room held for 160 ms; it ends after 600 ms of quiet", () => {
  const speech = new LocalSpeech();
  run(speech, 0, 1000, -60);
  const started = run(speech, 1000, 1500, -25);
  expect(started).toEqual([["start", 1160]]);
  const ended = run(speech, 2500, 1000, -60);
  expect(ended).toEqual([["end", 3080]]); // last loud frame at 2480, +600
});

test("a click or a cough shorter than 160 ms is not speech", () => {
  const speech = new LocalSpeech();
  run(speech, 0, 1000, -60);
  expect(run(speech, 1000, 100, -20)).toEqual([]);
  expect(run(speech, 1100, 1000, -60)).toEqual([]);
});

test("a noisy room raises the bar: its own hum is never speech", () => {
  const speech = new LocalSpeech();
  run(speech, 0, 3000, -40); // a fan, steadily
  expect(run(speech, 3000, 1000, -35)).toEqual([]); // a little louder than the fan: still the room
  expect(run(speech, 4000, 400, -20)).toEqual([["start", 4160]]);
});

test("over the agent the bar is higher, and the first 300 ms of its reply are ignored", () => {
  const speech = new LocalSpeech();
  run(speech, 0, 1000, -60);
  // The echo canceller settling on a new reply: loud-ish, right at its start.
  expect(run(speech, 1000, 300, -30, 1000)).toEqual([]);
  // What it leaves after that is quiet, but even a level that would count with the agent silent
  // (floor + 14 dB) does not count over it.
  expect(run(speech, 1300, 1000, -46, 1000)).toEqual([]);
  // A person talking over someone is loud: that counts.
  expect(run(speech, 2300, 400, -24, 1000)).toEqual([["start", 2460]]);
});

test("the level of a block of samples, in dBFS", () => {
  expect(levelOf(new Int16Array(480))).toBe(-100);
  const loud = new Int16Array(480).map((_, i) => Math.round(32767 * Math.sin((i / 480) * 2 * Math.PI * 10)));
  expect(levelOf(loud)).toBeGreaterThan(-4);
  expect(levelOf(loud)).toBeLessThan(-2);
});

// Probed on the landing page: the agent spoke from the moment the call opened, so the room was
// never heard while quiet — and nothing over it could count.
test("an agent talking from the first moment can still be talked over", () => {
  const speech = new LocalSpeech();
  expect(run(speech, 0, 2000, -62, 0)).toEqual([]); // its reply, with the echo taken out
  expect(run(speech, 2000, 400, -24, 0)).toEqual([["start", 2160]]);
});

test("before the room is heard, a steady hum over the agent is still not speech", () => {
  const speech = new LocalSpeech();
  expect(run(speech, 0, 3000, -40, 0)).toEqual([]);
});
