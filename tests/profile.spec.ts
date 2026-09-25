/**
 * What Longtake keeps about a person, and what it offers back — pure, no browser.
 *
 * Keeping is easy. The two ways this goes wrong are the other end: an answer that is not theirs
 * offered as theirs (an emergency contact's phone, a business's street), and an answer that
 * changed quietly overwritten or quietly re-used. So most of this is about what is NOT offered, and
 * about a different answer becoming a question instead of a change.
 */

import { expect, test } from "@playwright/test";

import {
  applyChanges,
  emptyProfile,
  exportProfile,
  factKeys,
  migrateV1,
  parseProfile,
  recallFor,
  type FactKey,
  type Profile,
  type ProfileChange,
  type Provenance,
} from "../core/src/profile";
import { memoryProfileStore } from "../core/src/profile-store";
import type { Meaning, Meanings } from "../core/src/understand";
import type { FieldSpec } from "../core/src/types";

const NOW = Date.UTC(2026, 8, 25);

const said = (value: Provenance["value"], evidence: string, extra: Partial<Provenance> = {}): Provenance => ({
  value,
  evidence,
  source: "spoken",
  host: "job-boards.greenhouse.io",
  url: "https://job-boards.greenhouse.io/glean/jobs/1",
  askedAs: "Email",
  formTitle: "Glean",
  at: NOW,
  ...extra,
});

const observe = (concept: string, value: Provenance["value"], evidence: string, extra: Partial<Provenance> = {}, key: Partial<FactKey> = {}): ProfileChange => ({
  type: "observe",
  key: { concept, ...key },
  gist: concept,
  value,
  from: said(value, evidence, extra),
});

const keep = (changes: ProfileChange[], profile: Profile = emptyProfile()) => applyChanges(profile, changes, NOW);

const spec = (id: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ id, label, kind: "text", required: false, ...extra });

const meaning = (concept: string, extra: Partial<Meaning> = {}): Meaning => ({
  concept,
  subject: "self",
  scope: "remember",
  gist: concept,
  confidence: "high",
  source: "model",
  ...extra,
});

/** A profile that knows their email, phone and city — said out loud on a Greenhouse form. */
function known(): Profile {
  return keep([
    observe("contact.email", "rohit@example.com", "rohit at example dot com"),
    observe("contact.phone", "+91 98765 43210", "plus nine one nine eight seven six five"),
    observe("address.city", "Kolkata", "Kolkata mein rehta hoon"),
  ]).profile;
}

test.describe("what is kept", () => {
  test("an answer they said is kept under what it means, with their words, the site and the question", () => {
    const { profile } = keep([observe("contact.email", "rohit@example.com", "rohit at example dot com")]);
    const fact = profile.facts["contact.email"]!;
    expect(fact.value).toBe("rohit@example.com");
    expect(fact.history[0]).toMatchObject({ evidence: "rohit at example dot com", host: "job-boards.greenhouse.io", askedAs: "Email", source: "spoken" });
  });

  test("an answer with none of their words is not kept", () => {
    expect(Object.keys(keep([observe("contact.email", "x@y.z", "  ")]).profile.facts)).toEqual([]);
  });

  test("what is asked fresh on every form is never kept — a salary expectation, a consent, the form's own question", () => {
    const { profile } = keep([
      observe("employment.expected_salary", "30 LPA", "thirty lakh"),
      observe("consent.privacy", true, "yes I agree"),
      observe("other", "The team", "the team"),
    ]);
    expect(Object.keys(profile.facts)).toEqual([]);
  });

  test("a personal answer is kept only when they said yes to keeping it, or turned that on", () => {
    expect(Object.keys(keep([observe("eeo.gender", "Male", "male")]).profile.facts)).toEqual([]);
    const allowed = keep([{ ...(observe("eeo.gender", "Male", "male") as Extract<ProfileChange, { type: "observe" }>), allowSensitive: true }]);
    expect(allowed.profile.facts["eeo.gender"]).toMatchObject({ value: "Male", sensitive: true });
    const on = { ...emptyProfile(), settings: { rememberSensitive: true } };
    expect(keep([observe("eeo.gender", "Male", "male")], on).profile.facts["eeo.gender"]).toBeDefined();
  });

  test("the same answer again is counted, not asked about", () => {
    const again = keep([observe("contact.email", "Rohit@Example.com", "same email", { host: "jobs.lever.co" })], known());
    expect(again.questions).toEqual([]);
    const fact = again.profile.facts["contact.email"]!;
    expect(fact.useCount).toBe(2);
    expect(fact.history.map((h) => h.host)).toEqual(["job-boards.greenhouse.io", "jobs.lever.co"]);
  });

  test("a different answer changes nothing — it becomes a question for them", () => {
    const moved = keep([observe("address.city", "Bengaluru", "ab Bengaluru mein hoon", { session: "call-2", field: "city" })], known());
    expect(moved.profile.facts["address.city"]!.value).toBe("Kolkata");
    expect(moved.questions).toEqual([expect.objectContaining({ id: "address.city", was: "Kolkata", now: "Bengaluru" })]);
  });

  test("a correction within the same call, to the same box, simply replaces — they fixed a slip", () => {
    const first = keep([observe("address.city", "Kolkatta", "Kolkata", { session: "call-1", field: "city" })]).profile;
    const fixed = keep([observe("address.city", "Kolkata", "Kolkata, K-O-L", { session: "call-1", field: "city" })], first);
    expect(fixed.questions).toEqual([]);
    expect(fixed.profile.facts["address.city"]!.value).toBe("Kolkata");
  });

  test("the same answer to a different box in the same call is still a question — a patient's name and their contact's", () => {
    const first = keep([observe("identity.first_name", "Rohit", "I am Rohit", { session: "call-1", field: "patient_first" })]).profile;
    const other = keep([observe("identity.first_name", "Anita", "my mother Anita", { session: "call-1", field: "contact_first" })], first);
    expect(other.questions).toHaveLength(1);
    expect(other.profile.facts["identity.first_name"]!.value).toBe("Rohit");
  });

  test("a yes to the new answer replaces it, and the old one stays in its history", () => {
    const replaced = keep([{ type: "replace", id: "address.city", value: "Bengaluru", from: said("Bengaluru", "ab Bengaluru — haan update kar do") }], known());
    const fact = replaced.profile.facts["address.city"]!;
    expect(fact.value).toBe("Bengaluru");
    expect(fact.history.map((h) => h.value)).toEqual(["Kolkata", "Bengaluru"]);
  });

  test("taking back what one box of one call added: gone if it was new, back to before if it was not", () => {
    const withNew = keep([observe("links.github", "rohitk", "github rohitk", { session: "c", field: "gh" })], known()).profile;
    const undone = keep([{ type: "unobserve", id: "links.github", session: "c", field: "gh" }], withNew).profile;
    expect(undone.facts["links.github"]).toBeUndefined();
    expect(undone.facts["contact.email"]).toBeDefined();
  });

  test("forgetting everything keeps their settings", () => {
    const on = { ...known(), settings: { rememberSensitive: true } };
    const empty = keep([{ type: "deleteAll" }], on).profile;
    expect(empty.facts).toEqual({});
    expect(empty.settings.rememberSensitive).toBe(true);
  });

  test("a long history is capped, newest kept", () => {
    const changes = Array.from({ length: 20 }, (_, i) => observe("contact.email", "rohit@example.com", `telling ${i}`));
    const fact = keep(changes).profile.facts["contact.email"]!;
    expect(fact.history).toHaveLength(12);
    expect(fact.history.at(-1)!.evidence).toBe("telling 19");
  });
});

test.describe("which fact a field is", () => {
  test("the piece of a split answer comes from the model, else from the page's own sub-label", () => {
    const specs = [spec("dob_d", "Date of birth", { part: "Day" }), spec("dob_m", "Date of birth", { part: "Month" })];
    const keys = factKeys(specs, { dob_d: meaning("identity.date_of_birth", { part: "day" }), dob_m: meaning("identity.date_of_birth") });
    expect(keys.get("dob_d")).toEqual({ concept: "identity.date_of_birth", part: "day" });
    expect(keys.get("dob_m")).toEqual({ concept: "identity.date_of_birth", part: "month" });
  });

  // Workable captions its lone country-code picker "Telephone country code": the code is the whole
  // of its concept there, and a caption must not split one answer into two facts.
  test("a page's caption names a piece only where the answer is split across boxes", () => {
    const lone = factKeys([spec("c", "Phone", { kind: "select", part: "Telephone country code" })], { c: meaning("contact.phone.country_code") });
    expect(lone.get("c")).toEqual({ concept: "contact.phone.country_code" });
    const split = factKeys([spec("d", "Date of birth", { part: "Day" }), spec("y", "Date of birth", { part: "Year" })], { d: meaning("identity.date_of_birth"), y: meaning("identity.date_of_birth") });
    expect([split.get("d")?.part, split.get("y")?.part]).toEqual(["day", "year"]);
    const yearOnly = factKeys([spec("y", "Year of birth")], { y: meaning("identity.date_of_birth", { part: "year" }) });
    expect(yearOnly.get("y")).toEqual({ concept: "identity.date_of_birth", part: "year" });
  });

  test("a piece that only repeats its concept is the concept itself", () => {
    const keys = factKeys([spec("c", "Country", { kind: "select" })], { c: meaning("contact.phone.country_code", { part: "country_code" }) });
    expect(keys.get("c")).toEqual({ concept: "contact.phone.country_code" });
  });

  test("the second school box on a form is the second school", () => {
    const specs = [spec("s1", "School"), spec("s2", "School")];
    const keys = factKeys(specs, { s1: meaning("education.school"), s2: meaning("education.school") });
    expect(keys.get("s1")).toEqual({ concept: "education.school" });
    expect(keys.get("s2")).toEqual({ concept: "education.school", entry: 1 });
  });

  test("somebody else's answer, an organisation's, or nobody's has no fact at all", () => {
    const specs = [spec("a", "Phone"), spec("b", "Street"), spec("c", "Search")];
    const keys = factKeys(specs, {
      a: meaning("contact.phone", { subject: "other_person" }),
      b: meaning("address.street", { subject: "organization" }),
      c: meaning("meta.search", { subject: "none" }),
    });
    expect([...keys.keys()]).toEqual([]);
  });
});

test.describe("what goes into the next form", () => {
  const specs = [spec("email", "E-mail address", { kind: "email" }), spec("tel", "Mobile", { kind: "tel" }), spec("where", "Location (City)")];
  const meanings: Meanings = { email: meaning("contact.email"), tel: meaning("contact.phone"), where: meaning("address.city") };

  test("their own answers, on a differently worded form, go straight in — with the words they came from", () => {
    const found = recallFor(specs, meanings, known(), NOW);
    expect(found.map((r) => [r.fieldId, r.value, r.sure])).toEqual([
      ["email", "rohit@example.com", true],
      ["tel", "+91 98765 43210", true],
      ["where", "Kolkata", true],
    ]);
    expect(found[0]!.evidence).toBe("rohit at example dot com");
  });

  // Each of these once had a regex "never" list in memory.ts. Now the model says whose answer it
  // is and what it is, and code only ever offers the person's own answer to the same concept.
  const traps: [label: string, why: string, m: Meaning][] = [
    ["Preferred first name", "a different answer from the legal one", meaning("identity.preferred_name")],
    ["Emergency contact phone", "somebody else's number", meaning("contact.phone", { subject: "other_person" })],
    ["Parent or guardian email", "not the applicant's", meaning("contact.email", { subject: "other_person" })],
    ["Referee email", "not the applicant's", meaning("source.referrer_email")],
    ["Company city", "an organisation's, not theirs", meaning("address.city", { subject: "organization" })],
    ["City of birth", "not where they live now", meaning("other", { gist: "city of birth" })],
    ["Business phone", "the business's", meaning("contact.phone", { subject: "organization" })],
  ];
  for (const [label, why, m] of traps) {
    test(`"${label}" gets nothing of theirs — ${why}`, () => {
      const profile = keep([
        observe("identity.first_name", "Rohit", "I'm Rohit"),
        observe("contact.email", "rohit@example.com", "rohit at example"),
        observe("contact.phone", "98765 43210", "nine eight seven"),
        observe("address.city", "Kolkata", "Kolkata"),
      ]).profile;
      expect(recallFor([spec("f", label)], { f: m }, profile, NOW)).toEqual([]);
    });
  }

  test("a meaning the model was not certain of waits for a yes — and so does the offline reading", () => {
    const unsure = recallFor([specs[0]!], { email: meaning("contact.email", { confidence: "medium" }) }, known(), NOW);
    expect(unsure[0]).toMatchObject({ sure: false, why: "not_sure_same_question" });
    const offline = recallFor([specs[0]!], { email: meaning("contact.email", { source: "fallback", confidence: "low" }) }, known(), NOW);
    expect(offline[0]).toMatchObject({ sure: false, why: "not_sure_same_question" });
  });

  test("an answer they typed, or one an older version kept, waits for a yes", () => {
    const typed = keep([observe("contact.email", "typed@example.com", "", { source: "typed" })]).profile;
    expect(recallFor([specs[0]!], meanings, typed, NOW)[0]).toMatchObject({ sure: false, why: "typed_last_time" });
    const migrated = applyChanges(emptyProfile(), migrateV1({ email: { key: "email", value: "old@example.com", evidence: "old", askedAs: "Email", savedAt: 1, sourceUrl: "" } }), NOW).profile;
    expect(recallFor([specs[0]!], meanings, migrated, NOW)[0]).toMatchObject({ sure: false, why: "carried_over", value: "old@example.com" });
  });

  test("their own edit in settings goes straight in, with a note of where it came from", () => {
    const edited = keep([{ type: "replace", id: "contact.email", value: "new@example.com", from: { ...said("new@example.com", ""), source: "edited" } }], known()).profile;
    const [found] = recallFor([specs[0]!], meanings, edited, NOW);
    expect(found).toMatchObject({ sure: true, value: "new@example.com" });
    expect(found!.evidence).toContain("saved by you");
  });

  test("a personal answer is always checked, even when it is kept", () => {
    const on = { ...emptyProfile(), settings: { rememberSensitive: true } };
    const profile = keep([observe("eeo.gender", "Male", "male")], on).profile;
    const choices = [{ value: "m", label: "Male" }, { value: "f", label: "Female" }];
    const found = recallFor([spec("g", "Gender", { kind: "select", options: choices })], { g: meaning("eeo.gender", { scope: "sensitive" }) }, profile, NOW);
    expect(found[0]).toMatchObject({ sure: false, why: "sensitive" });
  });

  // The same test a spoken answer passes (gate.ts): "India" names "India (+91)" on a phone picker.
  test("a choice goes in when their words name one of this form's options; no match is not offered", () => {
    const profile = keep([observe("address.country", "India", "I'm in India")]).profile;
    const m = { c: meaning("address.country") };
    const exact = recallFor([spec("c", "Country", { kind: "select", options: [{ value: "in", label: "India" }, { value: "us", label: "United States" }] })], m, profile, NOW);
    expect(exact[0]).toMatchObject({ sure: true });
    const coded = recallFor([spec("c", "Country", { kind: "select", options: [{ value: "in", label: "India (+91)" }, { value: "io", label: "British Indian Ocean Territory" }] })], m, profile, NOW);
    expect(coded[0]).toMatchObject({ sure: true, value: "India" });
    const none = recallFor([spec("c", "Country", { kind: "select", options: [{ value: "de", label: "Germany" }] })], m, profile, NOW);
    expect(none).toEqual([]);
  });

  // A phone is one answer: said whole on one form, split into a code picker and a number box on the
  // next — each box gets its piece, the picker matched by its dialling code, not its wording.
  test("a whole phone number goes into a form that splits it, each box its piece", () => {
    const profile = keep([observe("contact.phone", "+91 98765 43210", "phone number +91 98765 43210")]).profile;
    const picker = spec("code", "Country", { kind: "select", options: [{ value: "us", label: "United States +1" }, { value: "in", label: "India +91" }] });
    const found = recallFor([picker, spec("tel", "Phone", { kind: "tel" })], { code: meaning("contact.phone.country_code"), tel: meaning("contact.phone.number") }, profile, NOW);
    expect(found.map((r) => [r.fieldId, r.value, r.sure])).toEqual([
      ["code", "India +91", true],
      ["tel", "98765 43210", true],
    ]);
  });

  test("a code picker is matched by its code whatever each form calls it; an ambiguous code is not picked", () => {
    const profile = keep([observe("contact.phone.country_code", "India (+91)", "plus nine one")]).profile;
    const other = spec("code", "Code", { kind: "select", options: [{ value: "91", label: "+91 India" }, { value: "44", label: "+44 United Kingdom" }] });
    expect(recallFor([other], { code: meaning("contact.phone.country_code") }, profile, NOW)[0]).toMatchObject({ value: "+91 India", sure: true });
    const us = keep([observe("contact.phone", "+1 415 555 0100", "+1 415 555 0100")]).profile;
    const shared = spec("code", "Code", { kind: "select", options: [{ value: "us", label: "United States +1" }, { value: "ca", label: "Canada +1" }] });
    expect(recallFor([shared], { code: meaning("contact.phone.country_code") }, us, NOW)).toEqual([]);
  });

  test("a whole phone box, when only the pieces are known, is offered put together — for a yes", () => {
    const profile = keep([observe("contact.phone.country_code", "India +91", "plus nine one"), observe("contact.phone.number", "98765 43210", "98765 43210")]).profile;
    const [found] = recallFor([spec("tel", "Phone", { kind: "tel" })], { tel: meaning("contact.phone") }, profile, NOW);
    expect(found).toMatchObject({ value: "+91 98765 43210", sure: false, why: "put_together" });
  });

  // A date is one answer too: said whole on one form, split into day / month / year boxes on the
  // next (GOV.UK, IRCC, Jotform) — each box its piece, by the calendar, not by words.
  test("a whole date of birth goes into a form that splits it: text boxes by number, lists by position or value", () => {
    const profile = keep([observe("identity.date_of_birth", "1996-05-14", "meri date of birth 14 May 1996 hai")]).profile;
    const dob = (part: string) => meaning("identity.date_of_birth", { part });
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const found = recallFor(
      [
        spec("d", "Date of birth", { part: "Day" }),
        spec("m", "Date of birth", { part: "Month", kind: "select", options: [{ value: "", label: "Select month" }, ...months.map((label, i) => ({ value: String(i + 1), label }))] }),
        spec("y", "Date of birth", { part: "Year", kind: "select", options: [{ value: "1997", label: "1997" }, { value: "1996", label: "1996" }] }),
      ],
      { d: dob("day"), m: dob("month"), y: dob("year") },
      profile,
      NOW,
    );
    expect(found.map((r) => [r.fieldId, r.value, r.sure])).toEqual([
      ["d", "14", true],
      ["m", "May", true],
      ["y", "1996", true],
    ]);
  });

  test("a whole date box, when only the pieces are known, is offered put together — for a yes", () => {
    const pieces = ([["day", "14"], ["month", "05"], ["year", "1996"]] as const).map(([part, value]) => observe("identity.date_of_birth", value, `dob ${value}`, {}, { part }));
    const [found] = recallFor([spec("dob", "Date of Birth", { kind: "date" })], { dob: meaning("identity.date_of_birth") }, keep(pieces).profile, NOW);
    expect(found).toMatchObject({ value: "1996-05-14", sure: false, why: "put_together" });
  });

  test("a first and last name out of a two-word full name are offered, never assumed; three words are not split", () => {
    const two = keep([observe("identity.full_name", "Asha Verma", "mera naam Asha Verma hai")]).profile;
    const found = recallFor([spec("f", "First name"), spec("l", "Last name")], { f: meaning("identity.first_name"), l: meaning("identity.last_name") }, two, NOW);
    expect(found.map((r) => [r.value, r.sure, r.why])).toEqual([
      ["Asha", false, "taken_apart"],
      ["Verma", false, "taken_apart"],
    ]);
    const three = keep([observe("identity.full_name", "Asha Rani Verma", "Asha Rani Verma")]).profile;
    expect(recallFor([spec("f", "First name")], { f: meaning("identity.first_name") }, three, NOW)).toEqual([]);
  });

  test("a close neighbour in the vocabulary is offered, never put in: a city for 'where are you based'", () => {
    const [found] = recallFor([spec("loc", "Location")], { loc: meaning("address.current_location") }, known(), NOW);
    expect(found).toMatchObject({ value: "Kolkata", sure: false, why: "not_sure_same_question" });
  });

  test("a trap field and a file upload never get anything", () => {
    const found = recallFor(
      [spec("email", "Email", { suspectedHoneypot: true }), spec("cv", "Email", { kind: "file" })],
      { email: meaning("contact.email"), cv: meaning("contact.email") },
      known(),
      NOW,
    );
    expect(found).toEqual([]);
  });

  test("a full name is put together from a first and a last they gave — offered, never assumed", () => {
    const profile = keep([observe("identity.first_name", "Rohit", "I'm Rohit Kashyap"), observe("identity.last_name", "Kashyap", "I'm Rohit Kashyap")]).profile;
    const [found] = recallFor([spec("n", "Full name")], { n: meaning("identity.full_name") }, profile, NOW);
    expect(found).toMatchObject({ value: "Rohit Kashyap", sure: false, why: "put_together", factId: "identity.full_name" });
  });
});

test.describe("the first memory, moved over", () => {
  test("answers the rules allow come over; ones now asked fresh do not", () => {
    const changes = migrateV1({
      first_name: { key: "first_name", value: "Rohit", evidence: "mera naam Rohit", askedAs: "First name", savedAt: 5, sourceUrl: "https://a.com/x" },
      expected_salary: { key: "expected_salary", value: "30 LPA", evidence: "thirty", askedAs: "Expected salary", savedAt: 5, sourceUrl: "" },
      current_salary: { key: "current_salary", value: "20 LPA", evidence: "twenty", askedAs: "Current salary", savedAt: 5, sourceUrl: "" },
    });
    const { profile } = applyChanges(emptyProfile(), changes, NOW);
    expect(Object.keys(profile.facts).sort()).toEqual(["employment.current_salary", "identity.first_name"]);
    expect(profile.facts["identity.first_name"]!.history[0]).toMatchObject({ source: "migrated", host: "a.com", evidence: "mera naam Rohit" });
    expect(profile.facts["employment.current_salary"]!.sensitive).toBe(true);
  });
});

test.describe("a file they can keep", () => {
  test("export, then import into an empty profile, gives the same answers", () => {
    const back = parseProfile(exportProfile(known()))!;
    expect(back).not.toBeNull();
    const original = known().facts;
    for (const [id, fact] of Object.entries(original)) {
      expect(back.facts[id]).toMatchObject({ value: fact.value, concept: fact.concept });
      expect(back.facts[id]!.history.map((h) => h.evidence)).toEqual(fact.history.map((h) => h.evidence));
    }
    expect(Object.keys(back.facts).sort()).toEqual(Object.keys(original).sort());
  });

  test("a file that is not a profile is refused; answers the rules do not allow are left out", () => {
    expect(parseProfile("not json")).toBeNull();
    expect(parseProfile(JSON.stringify({ hello: 1 }))).toBeNull();
    const file = JSON.stringify({
      longtake: "profile",
      version: 2,
      facts: {
        a: { concept: "contact.email", value: "a@b.c", updatedAt: 1 },
        b: { concept: "employment.expected_salary", value: "lots", updatedAt: 1 },
        c: { concept: "made.up", value: "x", updatedAt: 1 },
        d: { concept: "contact.phone", value: { evil: true }, updatedAt: 1 },
      },
    });
    expect(Object.keys(parseProfile(file)!.facts)).toEqual(["contact.email"]);
  });

  test("bringing a file in: newer answers win one by one, older ones leave theirs alone", () => {
    const mine = known();
    const file = parseProfile(exportProfile(mine))!;
    file.facts["address.city"] = { ...file.facts["address.city"]!, value: "Pune", updatedAt: NOW + 1000 };
    file.facts["contact.email"] = { ...file.facts["contact.email"]!, value: "stale@example.com", updatedAt: NOW - 1000 };
    const merged = applyChanges(mine, [{ type: "import", profile: file }], NOW).profile;
    expect(merged.facts["address.city"]!.value).toBe("Pune");
    expect(merged.facts["contact.email"]!.value).toBe("rohit@example.com");
  });
});

test.describe("one owner, changes only", () => {
  // The settings race: a name edited in settings mid-call, while the call saves a new answer. With
  // whole-map saves the slower writer undid the other. With changes, both survive.
  test("an edit and a new answer, from two places at once, both survive", async () => {
    const store = memoryProfileStore(known());
    const heard: string[] = [];
    store.subscribe!((p) => heard.push(Object.keys(p.facts).join(",")));
    await Promise.all([
      store.apply([{ type: "replace", id: "contact.email", value: "edited@example.com", from: { ...said("edited@example.com", ""), source: "edited" } }]),
      store.apply([observe("links.linkedin", "linkedin.com/in/rohitk", "linkedin rohitk")]),
    ]);
    const now = store.current();
    expect(now.facts["contact.email"]!.value).toBe("edited@example.com");
    expect(now.facts["links.linkedin"]!.value).toBe("linkedin.com/in/rohitk");
    expect(heard).toHaveLength(2);
  });
});
