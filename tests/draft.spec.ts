/**
 * A long answer drafted from the person's own words (core/src/draft.ts), and what the page says
 * around the form (core/src/page-context.ts): what a draft may keep, what it must drop, how a
 * read-back is measured, and which of a page's words are context rather than the form.
 */

import { expect, test } from "@playwright/test";

import { readBack, verifyDraft, type DraftInput } from "../core/src/draft";
import { load } from "./helpers";

const INPUT: DraftInput = {
  question: "Why do you want to work at Glean?",
  page: { title: "Software Engineer, Backend at Glean", text: "Glean is the Work AI platform. You will build search infrastructure used by millions." },
  said: ["mujhe search problems bahut pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai", "and I use Glean at my current job every day"],
  facts: [{ name: "current employer", value: "Acme Corp" }],
};

test.describe("what a draft may keep", () => {
  test("a sentence standing on their words is kept, quote checked, number found in what it cites", () => {
    const draft = verifyDraft(
      {
        sentences: [
          { text: "I love search problems, and I've worked on Elasticsearch for 3 years.", supports: [{ source: "said", ref: 0, quote: "maine 3 saal Elasticsearch pe kaam kiya hai" }] },
          { text: "I already use Glean every day at Acme Corp.", supports: [{ source: "said", ref: 1, quote: "I use Glean at my current job every day" }, { source: "fact", ref: 0, quote: "Acme Corp" }] },
        ],
        missing: ["what you'd like to build"],
      },
      INPUT,
    );
    expect(draft.dropped).toEqual([]);
    expect(draft.text).toBe("I love search problems, and I've worked on Elasticsearch for 3 years. I already use Glean every day at Acme Corp.");
    expect(draft.missing).toEqual(["what you'd like to build"]);
    expect(draft.flagged).toEqual([]);
  });

  test("a sentence with a number they never said is dropped, not repaired", () => {
    const draft = verifyDraft(
      { sentences: [{ text: "I've led a team of 12 engineers on Elasticsearch.", supports: [{ source: "said", ref: 0, quote: "maine 3 saal Elasticsearch pe kaam kiya hai" }] }] },
      INPUT,
    );
    expect(draft.text).toBe("");
    expect(draft.dropped[0]!.why).toContain("12");
  });

  test("a quote they never said, or one from the page alone, holds nothing up", () => {
    const draft = verifyDraft(
      {
        sentences: [
          { text: "I'm an expert in distributed systems.", supports: [{ source: "said", ref: 0, quote: "I am an expert in distributed systems" }] },
          { text: "I want to build search infrastructure used by millions.", supports: [{ source: "page", ref: 0, quote: "build search infrastructure used by millions" }] },
        ],
      },
      INPUT,
    );
    expect(draft.sentences).toEqual([]);
    expect(draft.dropped.map((d) => d.why)).toEqual(["none of their words behind it", "only the page says this, not them"]);
  });

  test("the page may name the company beside their words; a name in no source at all is flagged", () => {
    const draft = verifyDraft(
      {
        sentences: [
          { text: "Search is what I enjoy most, and Glean is where it matters.", supports: [{ source: "said", ref: 0, quote: "mujhe search problems bahut pasand hain" }, { source: "page", ref: 0, quote: "Glean is the Work AI platform" }] },
          { text: "I'd love to work with Kubernetes at Glean.", supports: [{ source: "said", ref: 1, quote: "I use Glean at my current job every day" }] },
        ],
      },
      INPUT,
    );
    expect(draft.sentences).toHaveLength(2);
    expect(draft.flagged).toEqual(["Kubernetes"]);
  });

  test("an answer that is not the expected shape is an empty draft", () => {
    expect(verifyDraft("I would love to join Glean!", INPUT)).toMatchObject({ text: "", sentences: [], dropped: [] });
    expect(verifyDraft(null, INPUT).text).toBe("");
  });

  test("the form's limit is kept by dropping whole sentences from the end", () => {
    const draft = verifyDraft(
      {
        sentences: [
          { text: "I love search problems.", supports: [{ source: "said", ref: 0, quote: "mujhe search problems bahut pasand hain" }] },
          { text: "I use Glean at work every day.", supports: [{ source: "said", ref: 1, quote: "I use Glean at my current job every day" }] },
        ],
      },
      { ...INPUT, maxChars: 30 },
    );
    expect(draft.text).toBe("I love search problems.");
    expect(draft.dropped[0]!.why).toBe("over the form's length limit");
  });
});

test.describe("reading it back", () => {
  test("word for word is 1; a paraphrase falls below the line", () => {
    const text = "I love search problems, and I've worked on Elasticsearch for 3 years.";
    expect(readBack(text, `Here's the draft: "${text}" Shall I put it in?`)).toBe(1);
    expect(readBack(text, "Basically you like search and you've done some Elasticsearch.")).toBeLessThan(0.85);
  });
});

test.describe("what the page says around the form", () => {
  test("the job description is context; the form's questions, controls, navigation and our panel are not", async ({ page }) => {
    await load(
      page,
      `<nav><a href="/">Careers home</a><p>Open roles across the company and around the world</p></nav>
       <h1>Software Engineer, Backend</h1>
       <div id="desc"><p>Glean is the Work AI platform that connects your company's knowledge.</p>
         <ul><li>Build search infrastructure used by millions of people every day</li></ul></div>
       <form><h2>Apply for this job</h2>
         <label for="w">Why do you want to work at Glean?</label><textarea id="w"></textarea>
         <p class="hint">Please be specific.</p>
         <select id="s"><option>LinkedIn</option><option>Twitter</option></select></form>
       <div data-longtake-ignore><p>Longtake panel text that must never be read as the page's</p></div>
       <footer><p>© Glean Technologies, all rights reserved everywhere</p></footer>
       <p style="display:none">A hidden paragraph that nobody can see on this page</p>`,
      "<title>Software Engineer, Backend at Glean | Greenhouse</title>",
    );
    const ctx = await page.evaluate(() => {
      const L = window.__longtake;
      return L.pageContext(document, L.readForm(), "[data-longtake-ignore]");
    });
    expect(ctx.title).toBe("Software Engineer, Backend at Glean");
    expect(ctx.text).toContain("Glean is the Work AI platform");
    expect(ctx.text).toContain("Build search infrastructure");
    expect(ctx.text).not.toContain("Why do you want to work at Glean");
    expect(ctx.text).not.toContain("Twitter");
    expect(ctx.text).not.toContain("Careers home");
    expect(ctx.text).not.toContain("Longtake panel");
    expect(ctx.text).not.toContain("all rights reserved");
    expect(ctx.text).not.toContain("hidden paragraph");
  });

  test("a Google Form's introduction, written in a bare div, is read; its questions are not", async ({ page }) => {
    await load(
      page,
      `<div role="heading" aria-level="1">Volunteer Registration &amp; Interest Form</div>
       <div>EDUkraine connects volunteer English teachers with students in Ukraine. Lessons are one hour, online.</div>
       <div role="listitem"><div role="heading" aria-level="3" id="q1">First Name</div><input aria-labelledby="q1"></div>`,
    );
    const text = await page.evaluate(() => {
      const L = window.__longtake;
      return L.pageContext(document, L.readForm(), "[data-longtake-ignore]").text;
    });
    expect(text).toContain("EDUkraine connects volunteer English teachers");
    expect(text).toContain("Volunteer Registration & Interest Form");
    expect(text).not.toContain("First Name");
  });
});

test("a number written as a word must be in what it cites, as the word or its digits", () => {
  const said = { ...INPUT, said: ["maine 3 saal Elasticsearch pe kaam kiya hai"] };
  const three = verifyDraft({ sentences: [{ text: "I've worked on Elasticsearch for three years.", supports: [{ source: "said", ref: 0, quote: "maine 3 saal Elasticsearch pe kaam kiya hai" }] }] }, said);
  const five = verifyDraft({ sentences: [{ text: "I've worked on Elasticsearch for five years.", supports: [{ source: "said", ref: 0, quote: "maine 3 saal Elasticsearch pe kaam kiya hai" }] }] }, said);
  const one = verifyDraft({ sentences: [{ text: "Search is the one thing I enjoy most on Elasticsearch.", supports: [{ source: "said", ref: 0, quote: "maine 3 saal Elasticsearch pe kaam kiya hai" }] }] }, said);
  expect(three.dropped).toEqual([]);
  expect(five.dropped[0]!.why).toContain("five");
  expect(one.dropped).toEqual([]);
});
