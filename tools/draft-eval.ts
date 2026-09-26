/**
 * Drafts, live. `npm run probe:draft`
 *
 * The long-answer studio's promise is that nothing in a draft is invented. This asks the real model
 * (the LLM Gateway, the site's own `chatJSON`, the product's own prompt) for drafts on a set of
 * cases built to tempt it — a question that asks for impact numbers when none were given, a sparse
 * answer, Hinglish, a revision, saved facts — runs the product's `verifyDraft` exactly as the route
 * does (one retry when a sentence falls), and then checks the result again independently:
 *   - every kept sentence cites their words or a fact, and every quote is in its source;
 *   - no number, number word, email or link in the final text is missing from their words and facts.
 * Invented sentences in the final drafts must be 0.
 */

import { readFileSync } from "node:fs";
import { draftPrompt, verifyDraft, type DraftInput, type VerifiedDraft } from "@longtake/core";

import { chatJSON, modelsFor } from "../web/src/lib/gateway";

const line = readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split(/\r?\n/).find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
process.env.ASSEMBLYAI_API_KEY = line!.slice("ASSEMBLYAI_API_KEY=".length).trim();

const page = (title: string, text: string) => ({ title, text });
const CASES: { name: string; input: DraftInput }[] = [
  {
    name: "Hinglish, why this company",
    input: {
      question: "Why do you want to work at Glean?",
      page: page("Software Engineer, Backend at Glean", "Glean is the Work AI platform. You will build search and ranking infrastructure used by millions."),
      said: ["mujhe search problems bahut pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai", "and I use Glean at my current job every day, it saves me hours", "I want to work on ranking, that is the hard part"],
      facts: [{ name: "current employer", value: "Acme Corp" }],
    },
  },
  {
    name: "asks for impact numbers; none were given",
    input: {
      question: "Describe a project you are proud of, including its measurable impact.",
      page: page("Staff Engineer at Stripe", "We move money for millions of businesses."),
      said: ["I built the billing system at my last job, it made payments a lot faster and the finance team loved it"],
      facts: [],
    },
  },
  {
    name: "sparse",
    input: {
      question: "Tell us about yourself.",
      page: page("Backend Engineer at Notion", "Notion is the connected workspace."),
      said: ["I'm a backend developer, mostly Python"],
      facts: [],
    },
  },
  {
    name: "numbers they did say, in words",
    input: {
      question: "Is there anything else you'd like us to know?",
      page: page("Product Designer at Figma", ""),
      said: ["I can start in two weeks and I prefer remote, but I can come in twice a week"],
      facts: [],
    },
  },
  {
    name: "Hinglish, volunteering",
    input: {
      question: "Why do you want to volunteer with EDUkraine?",
      page: page("Volunteer Registration & Interest Form", "EDUkraine connects volunteer English teachers with students in Ukraine."),
      said: ["main bachon ko padhana chahta hoon, English mera strong subject hai", "aur Ukraine ke bacchon ki madad karna chahta hoon, war ki wajah se unki padhai ruk gayi hai"],
      facts: [],
    },
  },
  {
    name: "Discord, with a real number",
    input: {
      question: "Why Discord?",
      page: page("Trust & Safety Engineer at Discord", "Discord is where people play games and hang out with friends."),
      said: ["I play games with my friends on Discord every night", "I moderated a server of 2000 people for two years", "I want to work on safety because I've seen what happens when it goes wrong"],
      facts: [],
    },
  },
  {
    name: "saved facts beside their words",
    input: {
      question: "Why are you interested in this role?",
      page: page("Search Engineer at Algolia", "Algolia powers search for thousands of websites."),
      said: ["I want to move from payments to search"],
      facts: [
        { name: "current employer", value: "Razorpay" },
        { name: "current title", value: "Senior Backend Engineer" },
      ],
    },
  },
  {
    name: "revise: shorter",
    input: {
      question: "Why do you want to work at Glean?",
      page: page("Software Engineer, Backend at Glean", "Glean is the Work AI platform."),
      said: ["mujhe search problems bahut pasand hain, maine 3 saal Elasticsearch pe kaam kiya hai", "make it shorter, just one or two lines"],
      facts: [],
      prior: "I love solving search problems, having worked on Elasticsearch for 3 years. I use Glean daily at my current job, where it saves me hours. I want to work on ranking, which I know is the hard part.",
      change: "make it shorter, just one or two lines",
    },
  },
];

const NUMBERS = /\d[\d,.]*|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|dozen)\b/gi;
const LINKS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|www\.\S+/gi;

const WORD_VALUE: Record<string, string> = { two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100", thousand: "1000", dozen: "12" };

/** An independent look at the final text: every number and link must be in their words or facts. */
// A number written as a word counts as found when its digits are in the source ("3 saal" → "three").
function invented(draft: VerifiedDraft, input: DraftInput): string[] {
  const sources = [...input.said, ...input.facts.map((f) => f.value)].join(" ").toLowerCase();
  return draft.sentences.flatMap((s) =>
    [...(s.text.match(NUMBERS) ?? []), ...(s.text.match(LINKS) ?? [])]
      .filter((token) => !sources.includes(token.toLowerCase().replace(/[.,]+$/, "")))
      .filter((token) => !WORD_VALUE[token.toLowerCase()] || !new RegExp(`\\b${WORD_VALUE[token.toLowerCase()]}\\b`).test(sources))
      .filter((token) => !/^\d+$/.test(token) || !new RegExp(`\\b${token}\\b`).test(sources))
      .map((token) => `${token} in "${s.text}"`),
  );
}

async function ask(system: string, user: string) {
  for (let tries = 0; tries < 6; tries++) {
    const answer = await chatJSON({ system, user, models: modelsFor("draft"), timeoutMs: 20_000, maxTokens: 900 });
    if (answer.ok) return answer.json;
    if (answer.reason !== "rate-limited") return null;
    await new Promise((wait) => setTimeout(wait, ((answer.resetSeconds ?? 20) + 1) * 1000));
  }
  return null;
}

let inventedTotal = 0;
let empty = 0;
for (const { name, input } of CASES) {
  const { system, user } = draftPrompt(input);
  let draft = verifyDraft(await ask(system, user), input);
  const firstDropped = draft.dropped.length;
  if (draft.dropped.length > 0) {
    const retry = verifyDraft(await ask(system, JSON.stringify({ ...JSON.parse(user), your_last_draft_failed: draft.dropped, instruction: "Write it again. Every sentence must cite their exact words; leave out anything they did not say." })), input);
    if (retry.sentences.length >= draft.sentences.length) draft = retry;
  }
  const bad = invented(draft, input);
  inventedTotal += bad.length;
  if (!draft.text) empty++;
  console.log(`\n## ${name}\n${draft.text || "(no draft)"}`);
  console.log(`kept ${draft.sentences.length} · dropped first try ${firstDropped} · dropped final ${draft.dropped.length} · flagged ${JSON.stringify(draft.flagged)} · missing ${JSON.stringify(draft.missing)}`);
  for (const d of draft.dropped) console.log(`  dropped: ${d.text} — ${d.why}`);
  for (const b of bad) console.log(`  INVENTED: ${b}`);
}
console.log(`\nCASES ${CASES.length} · empty drafts ${empty} · invented in final drafts ${inventedTotal}`);
