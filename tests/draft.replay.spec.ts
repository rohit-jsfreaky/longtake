/**
 * A long answer, end to end through the one `Conductor`: they give their points, a draft is written
 * from their words and held to them, the agent reads it out word for word, they change a part, they
 * say yes, it goes in — drafted, not spoken — and is kept whole, so the next form asking the same
 * question offers it back. The model is a stand-in that writes as a correct one would, citing their
 * words; everything that decides what goes in is the product's own code.
 */

import { expect, test, type Page } from "@playwright/test";

import { load } from "./helpers";

const FORM = `
  <label for="n">Full name*</label><input id="n" required>
  <label for="w">Why do you want to work at Glean?*</label><textarea id="w" required></textarea>`;

const WHY = "why_do_you_want_to_work_at_glean";

type Win = {
  __c: InstanceType<typeof window.__longtake.Conductor>;
  __fake: InstanceType<typeof window.__longtake.FakeVoice>;
  __drafts: { said: string[]; prior?: string; change?: string; page: { text: string } }[];
  __store: ReturnType<typeof window.__longtake.memoryProfileStore>;
};

async function start(page: Page, profile?: unknown) {
  await load(page, `<h1>Software Engineer, Backend</h1><p>Glean is the Work AI platform. You will build ranking for search.</p>${FORM}`);
  await page.evaluate(async (saved) => {
    const L = window.__longtake;
    const fake = new L.FakeVoice();
    const drafts: unknown[] = [];
    const store = L.memoryProfileStore((saved as never) ?? L.emptyProfile());
    const conductor = new L.Conductor({
      root: () => document,
      ignore: "[data-longtake-ignore]",
      profile: store,
      services: {
        getToken: async () => "t",
        workletUrl: "",
        startVoice: fake.start,
        understand: L.fakeUnderstanding({ [`why_do_you_want_to_work_at_glean`]: { concept: "text.why_this" } }),
        // A model that writes as a correct one would: each sentence citing their exact words.
        draft: async (input) => {
          drafts.push(input);
          const first = input.said[0]!;
          const sentences = [
            { text: "I love search problems, and I've worked on Elasticsearch for 3 years.", supports: [{ source: "said", ref: 0, quote: first }] },
          ];
          if (input.change) {
            const at = input.said.indexOf(input.change);
            sentences.push({ text: "I also use Glean every day at work.", supports: [{ source: "said", ref: at, quote: input.change }] });
          }
          return { sentences, missing: [] };
        },
      },
    });
    await conductor.start();
    await new Promise((r) => setTimeout(r, 30));
    Object.assign(window, { __c: conductor, __fake: fake, __drafts: drafts, __store: store });
  }, profile ?? null);
}

const FIRST = "I love search problems, and I've worked on Elasticsearch for 3 years.";

test("their points become a draft that waits; a change is a revise; their yes puts it in, drafted, and keeps it", async ({ page }) => {
  await start(page);
  const out = await page.evaluate(async (why) => {
    const w = window as unknown as Win;
    const points = "mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai";
    w.__fake.userSays(`Glean kyun? ${points}`);
    const drafted = (await w.__fake.toolCall("draft_answer", { field: why, mode: "new", evidence: points })) as Record<string, unknown>;
    const waiting = w.__c.session.state().fields.find((f) => f.spec.id === why)!;
    const prompt = w.__fake.prompt;
    const box = (document.getElementById("w") as HTMLTextAreaElement).value;
    w.__fake.agentSays(`Here's the draft: "${drafted.draft}" Should it go in as it is?`);
    await new Promise((r) => setTimeout(r, 30));
    const askedAfterReading = w.__fake.asked.length;

    const change = "add that I use Glean daily";
    w.__fake.userSays(`thoda change karo, ${change}`);
    const revised = (await w.__fake.toolCall("draft_answer", { field: why, mode: "revise", evidence: change })) as Record<string, unknown>;
    w.__fake.userSays("haan daal do");
    const confirmed = (await w.__fake.toolCall("confirm_answer", { field: why, agreed: true, evidence: "haan daal do" })) as Record<string, unknown>;
    const after = w.__c.session.state().fields.find((f) => f.spec.id === why)!;
    const kept = Object.values((await w.__store.load()).answers);
    return {
      drafted,
      waiting: { value: waiting.value, reason: waiting.pending?.reason },
      prompt,
      box,
      askedAfterReading,
      revise: w.__drafts[1],
      page: w.__drafts[0]!.page.text,
      revised,
      confirmed,
      after: { value: after.value, source: after.source },
      kept: kept.map((a) => ({ text: a.text, concept: a.concept, question: a.question })),
      review: w.__c.view().review.map((g) => g.title),
    };
  }, WHY);

  expect(out.drafted).toMatchObject({ draft: FIRST, read_it_word_for_word: true, submitted: false });
  expect(out.waiting).toEqual({ value: null, reason: "draft" }); // nothing in until their yes
  expect(out.box).toBe("");
  expect(out.prompt).toContain("Read it to them word for word");
  expect(out.askedAfterReading).toBe(0); // read word for word: nothing to correct
  expect(out.page).toContain("Glean is the Work AI platform");
  expect(out.revise).toMatchObject({ prior: FIRST, change: "add that I use Glean daily" });
  expect(out.revised.draft).toBe(`${FIRST} I also use Glean every day at work.`);
  expect(out.after).toEqual({ value: `${FIRST} I also use Glean every day at work.`, source: "drafted" });
  expect(out.kept).toEqual([{ text: `${FIRST} I also use Glean every day at work.`, concept: "text.why_this", question: "Why do you want to work at Glean?" }]);
  expect(out.review).toContain("Drafted from your words");
});

// Live: "What AI tools…" held "I'm using Claude, Conan, and Codex."; asked to "improve it and make
// it better", the agent refused — "I can't rewrite your answers". Asked, it drafts; not asked, it
// puts their words in as they said them.
test("'make it better' on an answer already in the box drafts from that answer — the agent is told it may, and only when asked", async ({ page }) => {
  await start(page);
  const out = await page.evaluate(async (why) => {
    const w = window as unknown as Win;
    const said = "mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai";
    w.__fake.userSays(said);
    await w.__fake.toolCall("fill_fields", { [why]: { value: said, evidence: said, how: "named" } });
    const ask = "can you improve it for me and make it better";
    w.__fake.userSays(ask);
    const drafted = (await w.__fake.toolCall("draft_answer", { field: why, mode: "new", evidence: ask })) as Record<string, unknown>;
    const tool = w.__c.session.tools().find((t) => t.name === "draft_answer")!.description;
    return { drafted, input: w.__drafts[0], tool, prompt: w.__fake.prompt };
  }, WHY);
  expect(out.input).toMatchObject({ prior: "mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai", change: "can you improve it for me and make it better" });
  expect(out.input.said).toContain("mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai");
  expect(out.drafted).toMatchObject({ read_it_word_for_word: true });
  expect(out.tool).toContain("never refuse");
  expect(out.prompt).toContain("write up a longer answer from their own points when they ask");
  expect(out.prompt).toContain("If they ask you to improve it or write it up, use draft_answer — never refuse.");
});

test("a draft paraphrased instead of read out is caught, and the agent asked to read it exactly", async ({ page }) => {
  await start(page);
  const asked = await page.evaluate(async (why) => {
    const w = window as unknown as Win;
    const points = "mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai";
    w.__fake.userSays(points);
    await w.__fake.toolCall("draft_answer", { field: why, mode: "new", evidence: points });
    w.__fake.agentSays("I've written something about you liking search and your Elasticsearch background. Want it in?");
    await new Promise((r) => setTimeout(r, 30));
    return w.__fake.asked;
  }, WHY);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("did not read the draft word for word");
  expect(asked[0]).toContain(FIRST);
});

test("points they never said draft nothing; a model that invents is held to their words", async ({ page }) => {
  await start(page);
  const out = await page.evaluate(async (why) => {
    const w = window as unknown as Win;
    w.__fake.userSays("I like Glean");
    const unsaid = await w.__fake.toolCall("draft_answer", { field: why, mode: "new", evidence: "I have ten years of search experience" });
    return { unsaid, pending: w.__c.session.state().fields.find((f) => f.spec.id === why)!.pending ?? null };
  }, WHY);
  expect(out.unsaid).toMatchObject({ drafted: false, why: "quote_not_found" });
  expect(out.pending).toBeNull();
});

test("the next form asking the same question offers last time's answer — reuse it, word for word", async ({ page }) => {
  const text = `${FIRST} I also use Glean every day at work.`;
  const saved = {
    version: 2,
    facts: {},
    answers: {
      "answer:text.why_this:jobs.example": {
        id: "answer:text.why_this:jobs.example",
        gist: "why this company",
        question: "Why do you want to work at Glean?",
        text,
        said: ["mujhe search problems pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai"],
        host: "jobs.example",
        at: 1,
        uses: 0,
        concept: "text.why_this",
      },
    },
    settings: { rememberSensitive: false },
  };
  await start(page, saved);
  const out = await page.evaluate(async (why) => {
    const w = window as unknown as Win;
    const field = w.__c.session.state().fields.find((f) => f.spec.id === why)!;
    w.__fake.userSays("Rohit Kashyap");
    await w.__fake.toolCall("fill_fields", { full_name: { value: "Rohit Kashyap", evidence: "Rohit Kashyap", how: "named" } });
    const offered = w.__fake.prompt;
    w.__fake.userSays("haan wahi use karo");
    const reused = await w.__fake.toolCall("draft_answer", { field: why, mode: "reuse", evidence: "haan wahi use karo" });
    return { library: field.library?.text, offered, reused, drafts: w.__drafts.length };
  }, WHY);
  expect(out.library).toBe(text);
  expect(out.offered).toContain('last time, for "Why do you want to work at Glean?"');
  expect(out.reused).toMatchObject({ draft: text, from_last_time: true, read_it_word_for_word: true });
  expect(out.drafts).toBe(0); // their own answer, not a model's
});
