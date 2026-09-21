import { expect, test, type Page } from "@playwright/test";
import { load } from "./helpers";

/**
 * The hesitation map, and the one sentence it is allowed to say.
 *
 * The first block below is the important one. It is not testing behaviour — it is testing that a
 * whole category of sentence cannot escape this module. Hesitation means a hard question, a
 * noisy room, a second language, a memory that took a moment. It does not mean dishonesty, and
 * software that implies otherwise on a job application would be indefensible. So the guarantee
 * is enforced by assertion rather than by good intentions.
 */

type Mark = { kind: string; count?: number; words?: string[]; examples?: string[]; removedRatio?: number; seconds?: number };
type Hesitation = { fieldId: string; marks: Mark[]; worthAnotherLook: boolean; prompt?: string };

async function read(
  page: Page,
  verbatim: string,
  clean: string,
  seconds?: number,
): Promise<Hesitation> {
  await load(page, `<p>nothing</p>`);
  return page.evaluate(
    ([v, c, s]) =>
      window.__longtake.readHesitation("f", v as string, c as string, s as number | undefined) as unknown,
    [verbatim, clean, seconds],
  ) as Promise<Hesitation>;
}

/** The exact sentence Rohit spoke during the Phase 3 test, and its tidied form. */
const MESSY = "Um, I think I mean I want this role because, because I want to grow and work on harder problems here.";
const MESSY_CLEAN = "I think I want this role because I want to grow and work on harder problems here.";

const CALM = "I want this role because I want to grow and work on harder problems.";

test.describe("the one thing it is never allowed to say", () => {
  /**
   * Every word here would turn an observation about audio into a claim about a person. If any of
   * them ever appears in this module's output, that is a product failure, not a test failure.
   */
  const FORBIDDEN = [
    "unsure",
    "uncertain",
    "certainty",
    "confidence",
    "confident",
    "truth",
    "truthful",
    "honest",
    "dishonest",
    "lying",
    "lie",
    "suspicious",
    "doubt",
    "nervous",
    "anxious",
    "score",
    "credibility",
    "trustworthy",
  ];

  const samples: [string, string, number | undefined][] = [
    [MESSY, MESSY_CLEAN, 4],
    [CALM, CALM, 0],
    ["Um um um uh uh er", "", 9],
    ["", "", undefined],
    ["I I I think so", "I think so", 3],
  ];

  for (const word of FORBIDDEN) {
    test(`the word "${word}" never appears anywhere in the output`, async ({ page }) => {
      for (const [verbatim, clean, seconds] of samples) {
        const result = await read(page, verbatim, clean, seconds);
        expect(JSON.stringify(result).toLowerCase()).not.toContain(word);
      }
    });
  }

  test("there is exactly one user-facing sentence, and it is a question about the box", async ({ page }) => {
    const result = await read(page, MESSY, MESSY_CLEAN);
    expect(result.prompt).toBe("Want another look at this one?");
  });

  test("a calm answer gets no sentence at all rather than a reassuring one", async ({ page }) => {
    const result = await read(page, CALM, CALM);
    expect(result.prompt).toBeUndefined();
  });

  test("the descriptions talk about the recording, never about the person", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const lines = (await page.evaluate(() => {
      const h = window.__longtake.readHesitation(
        "f",
        "Um, I think I mean I want this because, because yes.",
        "I think I want this.",
        4,
      );
      return window.__longtake.describeMarks(h) as unknown;
    })) as string[];

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain("you ");
      expect(line.toLowerCase()).not.toMatch(/\bseemed\b|\bsounded\b/);
    }
  });
});

test.describe("what it notices", () => {
  test("filler words in the verbatim", async ({ page }) => {
    const result = await read(page, "Um, I uh think so", "I think so");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(true);
  });

  test("one stray um is just how people talk", async ({ page }) => {
    const result = await read(page, "Um, I think so", "I think so");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(false);
  });

  test("a restart — the same word twice in a row", async ({ page }) => {
    const result = await read(page, "I want it because, because I do", "I want it because I do");
    const restart = result.marks.find((m) => m.kind === "restart");
    expect(restart?.examples).toContain("because");
  });

  test("heavy tidying is itself a signal", async ({ page }) => {
    const result = await read(page, "Um so uh I mean basically yes I suppose so really", "Yes");
    expect(result.marks.some((m) => m.kind === "heavily-edited")).toBe(true);
  });

  test("a long pause before answering", async ({ page }) => {
    const result = await read(page, CALM, CALM, 4.2);
    const slow = result.marks.find((m) => m.kind === "slow-start");
    expect(slow?.seconds).toBe(4.2);
  });

  test("answering straight away is not a mark", async ({ page }) => {
    const result = await read(page, CALM, CALM, 0.4);
    expect(result.marks.some((m) => m.kind === "slow-start")).toBe(false);
  });

  test("Hindi fillers count too", async ({ page }) => {
    const result = await read(page, "matlab, yaani main yeh chahta hoon", "Main yeh chahta hoon");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(true);
  });

  test("Devanagari fillers count too", async ({ page }) => {
    const result = await read(page, "मतलब, यानी मैं यह चाहता हूँ", "मैं यह चाहता हूँ");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(true);
  });

  test("\"um\" inside another word is not a filler", async ({ page }) => {
    const result = await read(page, "I sell umbrellas and umbrella parts", "I sell umbrellas");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(false);
  });

  test("\"like\" as a real verb is padded away from the filler match", async ({ page }) => {
    const result = await read(page, "I likely liked it", "I liked it");
    expect(result.marks.some((m) => m.kind === "filler")).toBe(false);
  });
});

test.describe("the actual Phase 3 recording", () => {
  test("it is marked", async ({ page }) => {
    const result = await read(page, MESSY, MESSY_CLEAN, 1.2);
    expect(result.worthAnotherLook).toBe(true);
  });

  test("it catches the um and the I mean", async ({ page }) => {
    const result = await read(page, MESSY, MESSY_CLEAN);
    const filler = result.marks.find((m) => m.kind === "filler");
    expect(filler?.words).toEqual(expect.arrayContaining(["um", "i mean"]));
  });

  test("it catches the because, because", async ({ page }) => {
    const result = await read(page, MESSY, MESSY_CLEAN);
    expect(result.marks.some((m) => m.kind === "restart")).toBe(true);
  });

  test("and the calm version of the same answer is left alone", async ({ page }) => {
    const result = await read(page, CALM, CALM, 0.8);
    expect(result.worthAnotherLook).toBe(false);
    expect(result.marks).toEqual([]);
  });
});

test.describe("only the field that earned it", () => {
  test("a marked answer and a calm one do not affect each other", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const both = (await page.evaluate(
      ([messy, messyClean, calm]) => [
        window.__longtake.readHesitation("why", messy as string, messyClean as string),
        window.__longtake.readHesitation("name", calm as string, calm as string),
      ],
      [MESSY, MESSY_CLEAN, CALM],
    )) as unknown as Hesitation[];

    expect(both[0]!.worthAnotherLook).toBe(true);
    expect(both[1]!.worthAnotherLook).toBe(false);
  });

  test("the field id is carried through", async ({ page }) => {
    await load(page, `<p>nothing</p>`);
    const result = (await page.evaluate(() =>
      window.__longtake.readHesitation("cover_letter", "Um, uh, yes", "Yes"),
    )) as unknown as Hesitation;
    expect(result.fieldId).toBe("cover_letter");
  });

  test("an empty answer is not marked", async ({ page }) => {
    const result = await read(page, "", "");
    expect(result.worthAnotherLook).toBe(false);
  });

  test("an answer that was not tidied at all is not marked", async ({ page }) => {
    const result = await read(page, CALM, CALM);
    expect(result.marks).toEqual([]);
  });

  test("a rewrite that failed — clean equals verbatim — is not marked as heavy editing", async ({ page }) => {
    // When the five-second rewrite deadline is missed, `clean` falls back to the verbatim. That
    // is a service timeout, not something the person did, and must not show up as a nudge.
    const result = await read(page, "Um, uh, I suppose so", "Um, uh, I suppose so");
    expect(result.marks.some((m) => m.kind === "heavily-edited")).toBe(false);
  });
});
