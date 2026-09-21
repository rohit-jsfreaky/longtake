"use client";

import { ComboBox } from "./ComboBox";

/**
 * A real job application, copied unchanged.
 *
 * SOURCE  Software Engineer, Backend — Glean
 *         https://job-boards.greenhouse.io/gleanwork/jobs/4006731005
 *         Read off the live page on 2026-09-21.
 *
 * The field list, the label wording, the order and every dropdown option were
 * taken off that page as they were found. The option sets were harvested by
 * opening each combobox, because on Greenhouse they do not exist in the DOM
 * until you do.
 *
 * It also has to *look* like a job application, not like our design system
 * wearing a form as a costume. Real ATS forms use quiet sentence-case labels
 * and compact inputs — the first pass here shouted every label in uppercase
 * mono at 12px letter-spaced, which read as a wireframe. Labels are plain text,
 * inputs are 40px, and the rhythm is tight.
 *
 * Two omissions, both unspeakable: the file inputs and the reCAPTCHA.
 */

const HEARD_ABOUT = [
  "Conference",
  "Glean Career Site",
  "Job Board",
  "LinkedIn",
  "On Campus Event",
  "Podcast",
  "Referred by Glean Employee",
  "Social Media",
  "Virtual Event",
  "Word of Mouth",
  "Other",
];

const GENDER = ["Male", "Female", "Decline To Self Identify"];
const HISPANIC = ["Yes", "No", "Decline To Self Identify"];
const VETERAN = [
  "I am not a protected veteran",
  "I identify as one or more of the classifications of a protected veteran",
  "I don't wish to answer",
];
const DISABILITY = [
  "Yes, I have a disability, or have had one in the past",
  "No, I do not have a disability and have not had one in the past",
  "I do not want to answer",
];
const COUNTRIES = [
  "Australia",
  "Canada",
  "France",
  "Germany",
  "India",
  "Ireland",
  "Netherlands",
  "Singapore",
  "United Kingdom",
  "United States",
];

export const FIELD_STYLE =
  "h-10 w-full sq-sm border border-hair bg-ink-700 px-3 text-[14px] text-paper outline-none transition-colors placeholder:text-faint focus:border-hair-lit";

export function Label({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] text-dim">
      {children}
      {required && <span className="text-faint"> *</span>}
    </label>
  );
}

function Field({
  id,
  label,
  required,
  type = "text",
}: {
  id: string;
  label: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input id={id} type={type} required={required} className={FIELD_STYLE} />
    </div>
  );
}

export function GleanApplication() {
  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div>
        <h3 className="text-[15px] font-medium text-paper">Software Engineer, Backend</h3>
        <p className="mt-0.5 text-[13px] text-faint">Glean · Palo Alto, CA</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="first_name" label="First Name" required />
        <Field id="last_name" label="Last Name" required />
        <Field id="email" label="Email" required type="email" />
        <Field id="phone" label="Phone" type="tel" />
      </div>

      <ComboBox id="country" label="Country" options={COUNTRIES} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="question_4021092005" label="LinkedIn Profile" required />
        <Field id="question_4021093005" label="Website" />
      </div>

      <ComboBox
        id="question_7132748005"
        label="How did you hear about Glean?"
        options={HEARD_ABOUT}
        required
      />

      <Field
        id="question_8504960005"
        label="Total years of experience relevant for this role"
        required
      />

      <div>
        <Label htmlFor="question_8595582005" required>
          What AI tools are you currently using today and how are you using them?
        </Label>
        <textarea
          id="question_8595582005"
          required
          rows={3}
          className="w-full sq-sm border border-hair bg-ink-700 px-3 py-2.5 text-[14px] leading-relaxed text-paper outline-none transition-colors focus:border-hair-lit"
        />
      </div>

      {/* Kept on purpose: the most useful thing this demo shows is Longtake
          leaving every one of these blank because you did not speak to it. */}
      <fieldset className="space-y-4 border-t border-hair pt-5">
        <legend className="text-[13px] text-faint">
          U.S. Equal Employment Opportunity (voluntary)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <ComboBox id="gender" label="Gender" options={GENDER} />
          <ComboBox id="hispanic_ethnicity" label="Are you Hispanic/Latino?" options={HISPANIC} />
          <ComboBox id="veteran_status" label="Veteran Status" options={VETERAN} />
          <ComboBox id="disability_status" label="Disability Status" options={DISABILITY} />
        </div>
      </fieldset>

      <div className="flex items-center gap-4 border-t border-hair pt-5">
        <button
          type="submit"
          disabled
          className="h-10 cursor-not-allowed sq-sm border border-hair px-4 text-[14px] text-faint"
          title="Longtake never submits anything. You read it and send it yourself."
        >
          Submit Application
        </button>
        <p className="text-[12px] text-faint">Longtake never sends it. That part is yours.</p>
      </div>
    </form>
  );
}
