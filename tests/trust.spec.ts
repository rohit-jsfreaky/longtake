/**
 * The trust layer and its timing, off the page: when a reply is worth checking, what a judge's
 * answer is allowed to mean, and when the agent may be asked to speak on our cue.
 */

import { expect, test } from "@playwright/test";

import { REPLY_AFTER_RESULT_MS, REPLY_REQUEST_TTL_MS, ReplyRequestQueue } from "../core/src/dispatch";
import { correction, mismatches, TrustWatch, validateClaims } from "../core/src/trust";

test.describe("when a reply is worth checking", () => {
  test("A: an answer was expected, nothing was called, nothing changed — the 'Got that in' case", () => {
    const watch = new TrustWatch();
    watch.userTurn("I want to help keep Discord safe", "ask", ["why"]);
    watch.replyStarted("r1");
    expect(watch.replyDone("r1", "Got that in. Anything else?", false)).toMatchObject({ reason: "no_call", asking: ["why"], heard: "I want to help keep Discord safe" });
  });

  test("B: a call's answer did not go in, or waits for a yes", () => {
    const watch = new TrustWatch();
    watch.userTurn("I heard from Twitter", "ask", ["heard"]);
    watch.replyStarted("r1");
    watch.toolCall("c1", "fill_fields");
    watch.toolResult("c1", { just_filled: [], not_filled: [{ field: "heard", why: "not_an_option" }], waiting_for_yes: [] });
    watch.replyDone("r1", "One moment.", false); // the reply that made the call: its filler
    watch.replyStarted("r2");
    expect(watch.replyDone("r2", "Twitter isn't on their list.", true)).toMatchObject({ reason: "not_all_in", notIn: ["heard"] });
  });

  test("C: every answer went in — nothing to ask", () => {
    const watch = new TrustWatch();
    watch.userTurn("rohit@example.com", "ask", ["email"]);
    watch.toolCall("c1", "fill_fields");
    watch.toolResult("c1", { just_filled: [{ field: "email" }], not_filled: [], waiting_for_yes: [] });
    watch.replyStarted("r1");
    expect(watch.replyDone("r1", "Got it. Phone?", true)).toBeNull();
  });

  test("the server's filler during a tool call, and a reply while a call runs, are never judged", () => {
    const watch = new TrustWatch();
    watch.userTurn("my email is rohit@example.com", "ask", ["email"]);
    watch.replyStarted("fc-c1");
    expect(watch.replyDone("fc-c1", "Putting that in.", false)).toBeNull();
    watch.toolCall("c1", "fill_fields");
    watch.replyStarted("r1");
    expect(watch.replyDone("r1", "Got it.", false)).toBeNull(); // the call has not answered yet
  });

  test("a reply to something that expects no answer — the handover — is not checked", () => {
    const watch = new TrustWatch();
    watch.userTurn("thanks!", "handover");
    watch.replyStarted("r1");
    expect(watch.replyDone("r1", "Any time. Look it over and send it.", false)).toBeNull();
  });

  test("one check per exchange: a correction cannot set off another", () => {
    const watch = new TrustWatch();
    watch.userTurn("my phone is 98765 43210", "ask", ["phone"]);
    watch.replyStarted("r1");
    expect(watch.replyDone("r1", "Your phone's in.", false)).not.toBeNull();
    watch.replyStarted("r2");
    expect(watch.replyDone("r2", "Sorry — it's in now.", false)).toBeNull();
  });
});

test.describe("what the judge's answer may mean", () => {
  const said = "Got that in. And your phone's in too — what's your city?";

  test("a claim stands only on words the agent really said, about a field the form has", () => {
    const claims = validateClaims(
      {
        claims: [
          { field: "why", claim: "put_in", quote: "Got that in" },
          { field: "phone", claim: "put_in", quote: "your phone's in" },
          { field: "city", claim: "asked", quote: "what's your city?" },
          { field: "email", claim: "put_in", quote: "your email is in" }, // never said
          { field: "nope", claim: "put_in", quote: "Got that in" }, // no such field
          { field: "why", claim: "maybe", quote: "Got that in" }, // no such claim
        ],
      },
      said,
      ["why", "phone", "city", "email"],
    );
    expect(claims.map((c) => [c.field, c.claim])).toEqual([
      ["why", "put_in"],
      ["phone", "put_in"],
      ["city", "asked"],
    ]);
  });

  test("a 'put in' that is not on the form is a mismatch; one that is, is not", () => {
    const found = mismatches(
      [
        { field: "why", claim: "put_in", quote: "Got that in" },
        { field: "phone", claim: "put_in", quote: "your phone's in" },
        { field: "city", claim: "asked", quote: "what's your city?" },
      ],
      (field) => field === "phone",
      (field) => (field === "why" ? "Why do you want to work at Discord?" : field),
    );
    expect(found).toEqual([{ field: "why", question: "Why do you want to work at Discord?", said: "Got that in" }]);
    expect(correction(found)).toContain('You told them "Why do you want to work at Discord?" went in, but it did not');
    expect(correction(found)).toContain("call fill_fields now for why, quoting their exact words");
  });

  // Live: the judge read the agent's check — "Just to check — \"Female\", right?" — as "put in".
  test("a question is never a claim that something went in", () => {
    const claims = validateClaims({ claims: [{ field: "gender", claim: "put_in", quote: `"Female", right?` }] }, `Just to check — "Female", right?`, ["gender"]);
    expect(claims).toEqual([{ field: "gender", claim: "asked", quote: `"Female", right?` }]);
  });

  test("an answer that is not JSON claims nothing", () => {
    expect(validateClaims("I think it said it filled the email", said, ["email"])).toEqual([]);
    expect(validateClaims(null, said, ["email"])).toEqual([]);
  });
});

test.describe("when the agent may be asked to speak (reply.create)", () => {
  test("not over its own reply; at once when it is done", () => {
    const q = new ReplyRequestQueue();
    q.note("reply.started", 0);
    q.add("say it", 10);
    expect(q.due(20)).toBeNull();
    q.note("reply.done", 30);
    expect(q.due(40)).toBe("say it");
    expect(q.due(50)).toBeNull();
  });

  test("not while the person is speaking, nor while a tool call waits for its result", () => {
    const q = new ReplyRequestQueue();
    q.add("say it", 0);
    q.note("input.speech.started", 1);
    expect(q.due(2)).toBeNull();
    q.note("transcript.user", 3);
    q.note("tool.call", 4, "c1");
    expect(q.due(5)).toBeNull();
  });

  test("not in the gap after a tool result — its own reply is coming — unless that never comes", () => {
    const q = new ReplyRequestQueue();
    q.note("tool.call", 0, "c1");
    q.add("say it", 1);
    q.note("tool.result", 100, "c1");
    expect(q.due(200)).toBeNull();
    expect(q.due(100 + REPLY_AFTER_RESULT_MS + 1)).toBe("say it");
  });

  test("the reply a result fires, then ours", () => {
    const q = new ReplyRequestQueue();
    q.note("tool.call", 0, "c1");
    q.add("say it", 1);
    q.note("tool.result", 10, "c1");
    q.note("reply.started", 20);
    expect(q.due(30)).toBeNull();
    q.note("reply.done", 40);
    expect(q.due(50)).toBe("say it");
  });

  test("a newer request replaces an older one; a stale one is dropped", () => {
    const q = new ReplyRequestQueue();
    q.note("reply.started", 0);
    q.add("old", 1);
    q.add("new", 2);
    q.note("reply.done", 3);
    expect(q.due(4)).toBe("new");
    q.add("late", 10);
    expect(q.due(10 + REPLY_REQUEST_TTL_MS + 1)).toBeNull();
  });
});

