/**
 * What a form field means — one small, general vocabulary for every kind of form, not a list of
 * phrases. The model names the concept (see `understand.ts`); code only ever checks that the name
 * it gave is one of these, and applies the rules that go with it.
 *
 * Meaning is two things, kept apart on purpose:
 *   - the **concept** — what kind of answer it is: a phone number, a date of birth, a school;
 *   - the **subject** — whose answer: the person's own, someone else's, an organisation's, or
 *     nobody's. An emergency contact's phone is still `contact.phone`, but not theirs — and that
 *     one axis replaces every "never" list the old memory keys needed.
 *
 * `scope` is the default for what may happen to an answer after the form: `remember` for the next
 * form, `this_form` only, `sensitive` (remembered only if they say so), `never` (asked fresh every
 * time — a consent, a signature). `volatility` says how long a remembered answer stays safe to offer.
 */

export type ValueKind = "text" | "email" | "phone" | "date" | "number" | "choice" | "url" | "long" | "yesno";
export type Scope = "remember" | "this_form" | "sensitive" | "never";
export type Volatility = "stable" | "slow" | "volatile";
export type Subject = "self" | "other_person" | "organization" | "none";

export type Concept = {
  /** Dotted, category first: "contact.phone", "address.postal_code". */
  id: string;
  /** How the agent says it out loud: "phone number". */
  say: string;
  valueKind: ValueKind;
  scope: Scope;
  volatility: Volatility;
  /** Concepts that are one answer together: a name's parts, an address, a date's pieces. */
  group?: string;
  /** Asked once per entry: each school, each job. */
  repeatable?: boolean;
};

const c = (id: string, say: string, valueKind: ValueKind, scope: Scope, volatility: Volatility, extra: Partial<Concept> = {}): Concept => ({
  id,
  say,
  valueKind,
  scope,
  volatility,
  ...extra,
});

export const CONCEPTS: Concept[] = [
  // ── Who they are ──────────────────────────────────────────────────────────────────────
  c("identity.full_name", "full name", "text", "remember", "stable", { group: "name" }),
  c("identity.first_name", "first name", "text", "remember", "stable", { group: "name" }),
  c("identity.middle_name", "middle name", "text", "remember", "stable", { group: "name" }),
  c("identity.last_name", "last name", "text", "remember", "stable", { group: "name" }),
  c("identity.preferred_name", "preferred name", "text", "remember", "stable"),
  c("identity.name_prefix", "title (Mr, Ms, Dr)", "choice", "remember", "stable"),
  c("identity.name_pronunciation", "how the name is said", "text", "remember", "stable"),
  c("identity.pronouns", "pronouns", "choice", "remember", "stable"),
  c("identity.date_of_birth", "date of birth", "date", "remember", "stable", { group: "date_of_birth" }),
  c("identity.age", "age", "number", "this_form", "volatile"),
  c("identity.sex", "sex", "choice", "sensitive", "stable"),
  c("identity.nationality", "nationality", "choice", "remember", "stable"),
  c("identity.marital_status", "marital status", "choice", "sensitive", "slow"),
  c("identity.signature", "signature", "text", "never", "stable"),

  // ── How to reach them ────────────────────────────────────────────────────────────────
  c("contact.email", "email", "email", "remember", "slow"),
  c("contact.phone", "phone number", "phone", "remember", "slow", { group: "phone" }),
  c("contact.phone.country_code", "phone country code", "choice", "remember", "slow", { group: "phone" }),
  c("contact.phone.area_code", "phone area code", "phone", "remember", "slow", { group: "phone" }),
  c("contact.phone.number", "phone number (without its codes)", "phone", "remember", "slow", { group: "phone" }),
  c("contact.preferred_method", "best way to reach them", "choice", "remember", "slow"),

  // ── Where ────────────────────────────────────────────────────────────────────────────
  c("address.full", "address", "long", "remember", "slow", { group: "address" }),
  c("address.street", "street address", "text", "remember", "slow", { group: "address" }),
  c("address.street2", "address line 2", "text", "remember", "slow", { group: "address" }),
  c("address.city", "city", "text", "remember", "slow", { group: "address" }),
  c("address.state", "state or region", "text", "remember", "slow", { group: "address" }),
  c("address.postal_code", "postal code", "text", "remember", "slow", { group: "address" }),
  c("address.country", "country", "choice", "remember", "slow", { group: "address" }),
  c("address.current_location", "where they are based", "text", "remember", "slow"),
  c("address.country_of_residence", "country they live in", "choice", "remember", "slow"),

  // ── Documents ────────────────────────────────────────────────────────────────────────
  c("document.passport_number", "passport number", "text", "sensitive", "slow"),
  c("document.passport_country", "passport country", "choice", "remember", "stable"),
  c("document.passport_expiry", "passport expiry", "date", "sensitive", "slow"),
  c("document.national_id", "national ID number", "text", "sensitive", "stable"),
  c("document.tax_id", "tax number", "text", "sensitive", "stable"),
  c("document.health_insurance_number", "health insurance number", "text", "sensitive", "slow"),
  c("document.drivers_license", "driving licence number", "text", "sensitive", "slow"),

  // ── Education (one entry per school) ─────────────────────────────────────────────────
  c("education.school", "school or university", "choice", "remember", "stable", { group: "education", repeatable: true }),
  c("education.degree", "degree", "choice", "remember", "stable", { group: "education", repeatable: true }),
  c("education.field_of_study", "field of study", "choice", "remember", "stable", { group: "education", repeatable: true }),
  c("education.start_date", "study start date", "date", "remember", "stable", { group: "education", repeatable: true }),
  c("education.graduation_date", "graduation date", "date", "remember", "stable", { group: "education", repeatable: true }),
  c("education.gpa", "grade average", "text", "remember", "stable", { group: "education", repeatable: true }),
  c("education.highest_level", "highest level of education", "choice", "remember", "slow"),
  c("education.student_type", "kind of student", "choice", "this_form", "slow"),
  c("education.interests", "subjects of interest", "choice", "this_form", "slow"),

  // ── Work history (one entry per job) ─────────────────────────────────────────────────
  c("employment.current_employer", "current company", "text", "remember", "slow"),
  c("employment.current_title", "current job title", "text", "remember", "slow"),
  c("employment.employer", "company", "text", "remember", "stable", { group: "employment", repeatable: true }),
  c("employment.title", "job title", "text", "remember", "stable", { group: "employment", repeatable: true }),
  c("employment.start_date", "job start date", "date", "remember", "stable", { group: "employment", repeatable: true }),
  c("employment.end_date", "job end date", "date", "remember", "stable", { group: "employment", repeatable: true }),
  c("employment.description", "what they did there", "long", "remember", "stable", { group: "employment", repeatable: true }),
  c("employment.years_experience", "years of experience", "number", "remember", "slow"),
  c("employment.headline", "professional headline", "text", "remember", "slow"),
  c("employment.notice_period", "notice period", "text", "this_form", "volatile"),
  c("employment.earliest_start", "earliest start date", "date", "this_form", "volatile"),
  c("employment.expected_salary", "expected salary", "text", "this_form", "volatile"),
  c("employment.current_salary", "current salary", "text", "sensitive", "volatile"),
  c("employment.interviewing_elsewhere", "other interviews under way", "long", "this_form", "volatile"),

  // ── Links ────────────────────────────────────────────────────────────────────────────
  c("links.linkedin", "LinkedIn", "url", "remember", "slow"),
  c("links.github", "GitHub", "url", "remember", "slow"),
  c("links.portfolio", "portfolio", "url", "remember", "slow"),
  c("links.website", "website", "url", "remember", "slow"),
  c("links.twitter", "X / Twitter", "url", "remember", "slow"),
  c("links.other", "other links", "url", "remember", "slow"),

  // ── The job, the place, the terms ──────────────────────────────────────────────────────
  // Authorisation and sponsorship are kept: they are the person's standing, asked the same way on
  // form after form (the old memory kept them too). The rest depends on this job and this place.
  c("work.authorized", "authorised to work there", "yesno", "remember", "slow"),
  c("work.needs_sponsorship", "needs visa sponsorship", "yesno", "remember", "slow"),
  c("work.willing_to_relocate", "willing to relocate", "yesno", "this_form", "volatile"),
  c("work.relocation_plans", "relocation plans", "long", "this_form", "volatile"),
  c("work.lives_near_office", "lives near the office", "yesno", "this_form", "volatile"),
  c("work.office_attendance", "able to work from the office", "yesno", "this_form", "volatile"),
  c("work.remote_preference", "remote or office preference", "choice", "remember", "slow"),
  c("work.travel", "comfortable with travel", "yesno", "this_form", "volatile"),
  c("work.security_clearance", "security clearance", "choice", "sensitive", "slow"),
  c("work.compensation_ok", "fine with the pay range", "yesno", "this_form", "volatile"),
  c("work.languages", "languages spoken", "choice", "remember", "stable"),
  c("work.language_level", "level in a language", "choice", "remember", "slow"),

  // ── How they found this ──────────────────────────────────────────────────────────────
  c("source.how_heard", "how they heard about this", "choice", "this_form", "volatile"),
  c("source.referrer_name", "who referred them", "text", "this_form", "volatile"),
  c("source.referrer_email", "referrer's email", "email", "this_form", "volatile"),

  // ── Consents (always asked fresh) ────────────────────────────────────────────────────
  c("consent.privacy", "privacy notice agreement", "yesno", "never", "volatile"),
  c("consent.terms", "terms agreement", "yesno", "never", "volatile"),
  c("consent.marketing", "marketing messages", "yesno", "never", "volatile"),
  c("consent.background_check", "background check consent", "yesno", "never", "volatile"),
  c("consent.recording", "recording or AI notetaker consent", "yesno", "never", "volatile"),
  c("consent.future_contact", "being contacted later", "yesno", "never", "volatile"),
  c("consent.data_processing", "data processing consent", "yesno", "never", "volatile"),

  // ── Equal-opportunity questions (sensitive, always optional to answer) ───────────────
  c("eeo.gender", "gender", "choice", "sensitive", "stable"),
  c("eeo.gender_identity", "gender identity", "choice", "sensitive", "stable"),
  c("eeo.transgender", "transgender experience", "choice", "sensitive", "stable"),
  c("eeo.sexual_orientation", "sexual orientation", "choice", "sensitive", "stable"),
  c("eeo.lgbtq", "LGBTQ+ community", "choice", "sensitive", "stable"),
  c("eeo.race_ethnicity", "race or ethnicity", "choice", "sensitive", "stable"),
  c("eeo.hispanic_latino", "Hispanic or Latino", "choice", "sensitive", "stable"),
  c("eeo.veteran_status", "veteran status", "choice", "sensitive", "slow"),
  c("eeo.disability_status", "disability status", "choice", "sensitive", "slow"),

  // ── Health (sensitive) ───────────────────────────────────────────────────────────────
  c("health.allergies", "allergies", "long", "sensitive", "slow"),
  c("health.medications", "current medications", "long", "sensitive", "volatile"),
  c("health.conditions", "health conditions", "long", "sensitive", "slow"),
  c("health.history", "medical history", "long", "sensitive", "slow"),
  c("health.family_history", "family medical history", "long", "sensitive", "stable"),
  c("health.symptoms", "current symptoms", "long", "sensitive", "volatile"),
  c("health.lifestyle", "lifestyle (sleep, diet, exercise, smoking)", "long", "sensitive", "slow"),
  c("health.mental", "psychological history", "long", "sensitive", "slow"),
  c("health.doctor", "their doctor", "text", "sensitive", "slow"),

  // ── An organisation's own details (subject: organization) ───────────────────────────
  c("organization.name", "organisation name", "text", "remember", "slow"),
  c("organization.type", "kind of organisation", "choice", "remember", "slow"),

  // ── Answers written for this form ────────────────────────────────────────────────────
  c("text.about_you", "about them", "long", "remember", "slow"),
  c("text.cover_letter", "cover letter", "long", "this_form", "volatile"),
  c("text.why_this", "why this company or role", "long", "this_form", "volatile"),
  c("text.additional_info", "anything else", "long", "this_form", "volatile"),

  // ── The form itself ──────────────────────────────────────────────────────────────────
  c("meta.today", "today's date", "date", "never", "volatile"),
  c("meta.signature_date", "date signed", "date", "never", "volatile"),
  c("meta.search", "a search box, not a question", "text", "never", "volatile"),
  // Anything else: the form's own question. Its `gist` (from the model) says what it asks.
  c("other", "this form's own question", "text", "this_form", "volatile"),
];

const BY_ID = new Map(CONCEPTS.map((concept) => [concept.id, concept]));

export function conceptById(id: string): Concept | undefined {
  return BY_ID.get(id);
}

/** Every concept as the model is shown it: id and how it is said, one per line. */
export function conceptList(): string {
  return CONCEPTS.map((concept) => `${concept.id} — ${concept.say}`).join("\n");
}

/**
 * The old memory keys (`memory.ts`), by concept — for moving saved answers over, and for the
 * offline reading when the model cannot be reached.
 */
export const LEGACY_KEY_TO_CONCEPT: Record<string, string> = {
  first_name: "identity.first_name",
  last_name: "identity.last_name",
  full_name: "identity.full_name",
  preferred_name: "identity.preferred_name",
  email: "contact.email",
  phone: "contact.phone",
  city: "address.city",
  country: "address.country",
  postal_code: "address.postal_code",
  linkedin: "links.linkedin",
  github: "links.github",
  portfolio: "links.portfolio",
  current_employer: "employment.current_employer",
  current_title: "employment.current_title",
  years_experience: "employment.years_experience",
  notice_period: "employment.notice_period",
  expected_salary: "employment.expected_salary",
  current_salary: "employment.current_salary",
  willing_to_relocate: "work.willing_to_relocate",
  work_authorization: "work.authorized",
  needs_sponsorship: "work.needs_sponsorship",
  about_you: "text.about_you",
};
