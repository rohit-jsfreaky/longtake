/**
 * When a tool result is allowed to go back to the agent.
 *
 * These exist because of one live failure that cost a whole session. The agent asked for a
 * dropdown to be filled, the fill took about six hundred milliseconds, and in that window the
 * `reply.done` that the old code waited for came and went. The finished result was then held for
 * a moment that had already passed, so it was never sent — and an agent waiting on a tool result
 * does not speak again. The person kept talking to something that had quietly died.
 *
 * Every ordering below is one that really happens on the wire. The first one is the bug.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

type Queued = { call_id: string; result: unknown };

/**
 * Drive the queue inside the page, as a little script of steps.
 *
 * Time is passed in rather than read from the clock, so a test about a two-and-a-half second
 * deadline does not take two and a half seconds.
 */
type Step =
  | { do: "note"; type: string; status?: string }
  | { do: "add"; call_id: string; at: number }
  | { do: "due"; at: number };

async function run(page: Page, steps: Step[]): Promise<Queued[][]> {
  await load(page, `<p>no form needed</p>`);
  return page.evaluate((script) => {
    const queue = new window.__longtake.ToolResultQueue();
    const sent: Queued[][] = [];
    for (const step of script as Step[]) {
      if (step.do === "note") queue.note(step.type);
      if (step.do === "add") queue.add({ call_id: step.call_id, result: { ok: true } }, step.at);
      if (step.do === "due") sent.push(queue.due(step.at) as Queued[]);
    }
    return sent;
  }, steps) as Promise<Queued[][]>;
}

/** Everything that went out across the whole script, flattened. */
const allSent = (batches: Queued[][]) => batches.flat().map((item) => item.call_id);

test.describe("the deadlock that killed a live session", () => {
  /**
   * The exact sequence from the recording.
   *
   * The old rule was "only send if the last event I saw was `reply.done`". Here the last event
   * is `input.speech.started`, because the person started talking while the dropdown was being
   * operated. Under that rule nothing is ever sent and the agent waits for ever.
   */
  test("a result that finishes after a new turn has started is still sent", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "tool.call" },
      { do: "note", type: "reply.started" },
      { do: "note", type: "reply.done" },
      { do: "due", at: 1000 }, // the old code's only chance; the tool is still running
      { do: "note", type: "input.speech.started" },
      { do: "note", type: "transcript.user" },
      { do: "add", call_id: "c1", at: 1600 }, // the dropdown finally finishes
      { do: "due", at: 1600 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]);
  });

  /**
   * The same shape with no `reply.done` at all — the agent started a transition phrase and the
   * turn never closed. Nothing in the protocol will ever release this, so the deadline must.
   */
  test("a reply that never finishes releases the result on the deadline", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c1", at: 0 },
      { do: "due", at: 100 }, // held: the agent is mid-sentence
      { do: "due", at: 2000 }, // still held
      { do: "due", at: 2600 }, // past MAX_HOLD_MS — send it anyway
    ]);

    expect(sent[0]).toEqual([]);
    expect(sent[1]).toEqual([]);
    expect(allSent(sent)).toEqual(["c1"]);
  });

  test("nothing is ever dropped silently — a queued result always leaves eventually", async ({
    page,
  }) => {
    // Four calls, every one finishing at an awkward moment.
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "a", at: 0 },
      { do: "note", type: "reply.done" },
      { do: "due", at: 10 },
      { do: "note", type: "input.speech.started" },
      { do: "add", call_id: "b", at: 20 },
      { do: "due", at: 20 },
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c", at: 30 },
      { do: "note", type: "reply.done" },
      { do: "due", at: 40 },
      { do: "add", call_id: "d", at: 50 },
      { do: "due", at: 50 },
    ]);

    expect(allSent(sent).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

test.describe("the rule it still keeps", () => {
  /**
   * The one thing the docs actually ask for: do not cut in while the agent is mid-sentence.
   * Relaxing the timing must not turn into ignoring it.
   */
  test("a result is held while the agent is speaking", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c1", at: 0 },
      { do: "due", at: 100 },
    ]);

    expect(sent[0]).toEqual([]);
  });

  test("and goes out the moment the reply finishes", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c1", at: 0 },
      { do: "due", at: 100 },
      { do: "note", type: "reply.done" },
      { do: "due", at: 110 },
    ]);

    expect(sent[0]).toEqual([]);
    expect(allSent(sent)).toEqual(["c1"]);
  });

  test("a completed reply releases the result", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c1", at: 0 },
      { do: "note", type: "reply.done", status: "completed" },
      { do: "due", at: 10 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]);
  });
});

test.describe("the second deadlock: a barge-in must not destroy the answer", () => {
  /**
   * This is the one that survived the first fix and killed the session again.
   *
   * The old code threw the queue away when a reply came back `interrupted`, reasoning that the
   * agent had moved on. It had not. An interruption stops the agent TALKING; the tool call is
   * still outstanding and it is still holding that `call_id`. Dropping the result leaves it
   * waiting for ever.
   *
   * And the trigger is nothing exotic — `interrupt_response` is on, so a cough, a door, or
   * somebody talking in the next room while the agent says "one moment" is a barge-in.
   */
  test("a result survives its reply being interrupted", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" }, // "one moment, putting that in"
      { do: "add", call_id: "c1", at: 0 }, // the dropdown refusal is ready
      { do: "note", type: "reply.done", status: "interrupted" }, // noise in the room
      { do: "due", at: 10 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]);
  });

  test("an interruption still ends the speaking window", async ({ page }) => {
    // Held while speaking, released by the interruption — not held for the full deadline.
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "c1", at: 0 },
      { do: "due", at: 5 },
      { do: "note", type: "reply.done", status: "interrupted" },
      { do: "due", at: 10 },
    ]);

    expect(sent[0]).toEqual([]);
    expect(allSent(sent)).toEqual(["c1"]);
  });

  test("repeated barge-ins never lose the result", async ({ page }) => {
    const sent = await run(page, [
      { do: "add", call_id: "c1", at: 0 },
      { do: "note", type: "reply.started" },
      { do: "note", type: "reply.done", status: "interrupted" },
      { do: "note", type: "reply.started" },
      { do: "note", type: "reply.done", status: "interrupted" },
      { do: "note", type: "reply.started" },
      { do: "note", type: "reply.done", status: "interrupted" },
      { do: "due", at: 30 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]);
  });
});

/**
 * The invariant, checked against every ordering rather than the ones we thought of.
 *
 * Both deadlocks were the same mistake twice: a rule about *when* to send, written without a
 * guarantee that sending happens at all. Each time, the specific case was fixed and the general
 * one was not — so the second bug was free to hide behind a different event.
 *
 * This asserts the property directly. Whatever the agent does, in whatever order, a result that
 * was added comes out exactly once. Run it against either old version and it fails immediately.
 */
test.describe("the invariant: late is allowed, lost is not", () => {
  test("no ordering of events can lose or duplicate a result", async ({ page }) => {
    await load(page, `<p>no form needed</p>`);

    const worst = await page.evaluate(() => {
      const EVENTS = [
        "reply.started",
        "reply.done",
        "input.speech.started",
        "transcript.user",
        "transcript.user.delta",
        "reply.audio",
        "tool.call",
        "session.ready",
      ];

      // A deterministic generator, so a failure is reproducible from the seed.
      let seed = 1337;
      const next = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };

      const broken: string[] = [];

      for (let run = 0; run < 400; run++) {
        const queue = new window.__longtake.ToolResultQueue();
        const added: string[] = [];
        const sent: string[] = [];
        let clock = 0;

        for (let step = 0; step < 24; step++) {
          clock += next(400);
          const roll = next(10);

          if (roll < 2) {
            const id = `c${added.length}`;
            added.push(id);
            queue.add({ call_id: id, result: null }, clock);
          } else if (roll < 4) {
            for (const item of queue.due(clock)) sent.push(item.call_id);
          } else {
            // `reply.done` sometimes interrupted — the case that ate the answer.
            queue.note(EVENTS[next(EVENTS.length)]!);
          }
        }

        // However it ended, give it a quiet moment long past the deadline. Everything that was
        // added must now have come out — this is the whole promise.
        queue.note("reply.done");
        for (const item of queue.due(clock + 60000)) sent.push(item.call_id);

        const lost = added.filter((id) => !sent.includes(id));
        const duplicated = sent.filter((id, i) => sent.indexOf(id) !== i);

        if (lost.length > 0) broken.push(`run ${run}: lost ${lost.join(",")}`);
        if (duplicated.length > 0) broken.push(`run ${run}: sent twice ${duplicated.join(",")}`);
      }

      return broken.slice(0, 5);
    });

    expect(worst).toEqual([]);
  });
});

test.describe("ordinary behaviour", () => {
  test("an empty queue sends nothing", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.done" },
      { do: "due", at: 0 },
    ]);
    expect(sent[0]).toEqual([]);
  });

  test("a result is sent once and then forgotten", async ({ page }) => {
    const sent = await run(page, [
      { do: "add", call_id: "c1", at: 0 },
      { do: "due", at: 0 },
      { do: "due", at: 10 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]); // not twice
  });

  test("several results from one breath go out together, in order", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "first", at: 0 },
      { do: "add", call_id: "second", at: 1 },
      { do: "add", call_id: "third", at: 2 },
      { do: "note", type: "reply.done" },
      { do: "due", at: 3 },
    ]);

    expect(allSent(sent)).toEqual(["first", "second", "third"]);
  });

  /**
   * Events that are not about the agent speaking must not move the gate. Reacting to these is
   * precisely what the broken version did.
   */
  test("unrelated events do not change whether a result may be sent", async ({ page }) => {
    const sent = await run(page, [
      { do: "add", call_id: "c1", at: 0 },
      { do: "note", type: "transcript.user.delta" },
      { do: "note", type: "reply.audio" },
      { do: "note", type: "session.ready" },
      { do: "note", type: "transcript.agent" },
      { do: "due", at: 10 },
    ]);

    expect(allSent(sent)).toEqual(["c1"]);
  });

  test("the deadline is measured from the oldest waiting result", async ({ page }) => {
    const sent = await run(page, [
      { do: "note", type: "reply.started" },
      { do: "add", call_id: "old", at: 0 },
      { do: "add", call_id: "new", at: 2000 },
      { do: "due", at: 2400 }, // old has waited 2400ms — not yet
      { do: "due", at: 2500 }, // now it has waited long enough, and both go
    ]);

    expect(sent[0]).toEqual([]);
    expect(allSent(sent)).toEqual(["old", "new"]);
  });
});
