"use client";

import { useState } from "react";

import { FIELD_STYLE, Label } from "./GleanApplication";

/**
 * A real form that changes shape as you answer it, copied unchanged.
 *
 * SOURCE  Society Membership Application — Actsafe
 *         https://form.jotform.com/221326312365043
 *         Read off the live page on 2026-09-23, conditions included.
 *
 * It loads with ONE question. Answer "Independent Representative" and nineteen more appear;
 * answer "Organization Representative" and a different set does — an organisation name and
 * description instead of a person's, plus a whole second contact. Name, phone, email and the
 * rest stay through both. Tick "Other" under Industry and one more question appears. Those are
 * the form's own four rules, read out of `JotForm.conditions` on the live page, not invented:
 *
 *   applying as = Independent   → show Independent Information, hide Organization + Alternate
 *   applying as = Organization  → show Organization + Alternate, hide Independent Information
 *   applying as = (nothing)     → hide everything below the question
 *   Industry includes Other     → show "Please indicate which industry…"
 *
 * Hidden the way Jotform hides them: `display: none` on a block that stays mounted, so whatever
 * was typed into a hidden field is still there when it comes back. That matters — a React form
 * that unmounts instead would lose it, and Longtake has to cope with both.
 *
 * The labels are the accessible names the live page exposes, which is what a reader sees. That
 * includes its awkward part, kept deliberately: the representative's name fields and the
 * alternate's are both called just "First Name" and "Last Name", and only the heading above says
 * whose is whose.
 *
 * Omitted, both unspeakable: the signature pad, and the inline "Please type another option here"
 * box beside "Other" (the form asks the same thing again in its own field right below).
 */

const APPLYING_AS = ["Independent Representative", "Organization Representative"] as const;
const INDUSTRY = ["Performing Arts", "Motion Picture", "Both", "Other"];
const YES_NO = ["Yes", "No"];

const TEXTAREA_STYLE =
  "w-full sq-sm border border-hair bg-ink-700 px-3 py-2.5 text-[14px] leading-relaxed text-paper outline-none transition-colors placeholder:text-faint focus:border-hair-lit";

/** Jotform's own way of hiding a question: still on the page, just not shown. */
function Shown({ when, children }: { when: boolean; children: React.ReactNode }) {
  return <div style={when ? undefined : { display: "none" }}>{children}</div>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <h4 className="border-t border-hair pt-5 text-[14px] font-medium text-paper">{children}</h4>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-faint">{children}</p>;
}

function Text({
  id,
  label,
  required,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input
        id={id}
        type={type}
        required={required}
        placeholder={placeholder}
        className={FIELD_STYLE}
      />
    </div>
  );
}

/** Jotform's address block: one question, five inputs, each named by the caption under it. */
function Address({ q }: { q: string }) {
  const part = (key: string, caption: string, required?: boolean) => (
    <div>
      <input id={`input_${q}_${key}`} type="text" required={required} className={FIELD_STYLE} />
      <label htmlFor={`input_${q}_${key}`} className="mt-1 block text-[11.5px] text-faint">
        {caption}
      </label>
    </div>
  );
  return (
    <div className="space-y-2">
      <span className="block text-[13px] text-dim">
        Address<span className="text-faint"> *</span>
      </span>
      {part("addr_line1", "Street Address", true)}
      {part("addr_line2", "Street Address Line 2")}
      <div className="grid gap-3 sm:grid-cols-2">
        {part("city", "City")}
        {part("state", "State / Province")}
      </div>
      {part("postal", "Postal / Zip Code")}
    </div>
  );
}

/** A first/last pair, named exactly as the live page names them: just "First Name", "Last Name". */
function FullName({ q, required }: { q: string; required?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Text id={`first_${q}`} label="First Name" required={required} />
      <Text id={`last_${q}`} label="Last Name" />
    </div>
  );
}

function YesNo({ q, legend }: { q: string; legend: string }) {
  return (
    <fieldset>
      <legend className="mb-2 block text-[13px] text-dim">
        {legend}
        <span className="text-faint"> *</span>
      </legend>
      <div className="flex gap-6">
        {YES_NO.map((answer, i) => (
          <label key={answer} className="flex cursor-pointer items-center gap-2 text-[14px] text-paper">
            <input
              type="radio"
              name={`q${q}`}
              value={answer}
              required={i === 0}
              className="accent-[var(--color-mint)]"
            />
            {answer}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ActsafeMembership() {
  const [applyingAs, setApplyingAs] = useState<(typeof APPLYING_AS)[number] | null>(null);
  const [otherIndustry, setOtherIndustry] = useState(false);

  const independent = applyingAs === "Independent Representative";
  const organization = applyingAs === "Organization Representative";
  const either = independent || organization;

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div>
        <h3 className="text-[15px] font-medium text-paper">Society Membership Application</h3>
        <p className="mt-0.5 text-[13px] text-faint">Actsafe · Jotform</p>
      </div>

      <fieldset>
        <legend className="mb-2 block text-[13px] text-dim">
          Are you applying as an Independent Representative, or a Representative of your
          Organization?<span className="text-faint"> *</span>
        </legend>
        <div className="space-y-2">
          {APPLYING_AS.map((option, i) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 text-[14px] text-paper">
              <input
                type="radio"
                name="q40_areYou"
                value={option}
                required={i === 0}
                onChange={(event) => event.target.checked && setApplyingAs(option)}
                className="accent-[var(--color-mint)]"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <Shown when={independent}>
        <div className="space-y-5">
          <Section>Independent Information</Section>
          <Text id="input_42" label="Independent's Name" required />
          <Address q="43" />
          <Text id="input_44" label="Independent's Website (if applicable)" />
          <div>
            <Label htmlFor="input_45" required>
              Brief description of your career history and connection to Actsafe
            </Label>
            <textarea id="input_45" required rows={3} className={TEXTAREA_STYLE} />
          </div>
        </div>
      </Shown>

      <Shown when={organization}>
        <div className="space-y-5">
          <Section>Organization Information</Section>
          <Text id="input_39" label="Organization Name" required />
          <Address q="9" />
          <Text id="input_38" label="Organization's Website" />
          <div>
            <Label htmlFor="input_11" required>
              Brief description of your organization
            </Label>
            <textarea id="input_11" required rows={3} placeholder="Type here..." className={TEXTAREA_STYLE} />
          </div>
        </div>
      </Shown>

      <Shown when={either}>
        <div className="space-y-5">
          <Section>Designated Representative</Section>
          <Note>
            An Organization admitted as a Member to Actsafe must appoint a Person to be its
            designated representative and exercise the rights of membership on behalf of the
            Organization.
          </Note>
          <FullName q="17" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Text id="input_19_full" label="Phone Number" type="tel" required placeholder="(000) 000-0000" />
            <Text id="input_18" label="Email" type="email" required placeholder="example@example.com" />
          </div>
        </div>
      </Shown>

      <Shown when={organization}>
        <div className="space-y-5">
          <Section>Alternate Designated Representative</Section>
          <Note>
            An Organization may also appoint an alternate designated representative who may, in the
            event the designated representative is not available to attend a General Meeting,
            exercise the rights of membership on behalf of the Organization.
          </Note>
          <FullName q="21" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Text id="input_23_full" label="Phone Number" type="tel" placeholder="(000) 000-0000" />
            <Text id="input_22" label="Email" type="email" placeholder="example@example.com" />
          </div>
        </div>
      </Shown>

      <Shown when={either}>
        <div className="space-y-5">
          <Section>Affiliations</Section>
          <fieldset>
            <legend className="mb-2 block text-[13px] text-dim">
              Industry<span className="text-faint"> *</span>
            </legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {INDUSTRY.map((option, i) => (
                <label key={option} className="flex cursor-pointer items-center gap-2 text-[14px] text-paper">
                  <input
                    type="checkbox"
                    name="q25_typeA[]"
                    value={option}
                    required={i === 0}
                    onChange={(event) => option === "Other" && setOtherIndustry(event.target.checked)}
                    className="accent-[var(--color-mint)]"
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <Shown when={otherIndustry}>
            <Text id="input_50" label="Please indicate which industry you are affiliated with:" />
          </Shown>

          <Text id="input_27" label="Unions/Associations (if any)" />

          <Section>Additional Information</Section>
          <Text id="input_29" label="How did you hear about Actsafe?" />
          <YesNo q="30_wouldYou" legend="Would you be interested in volunteering on one of our standing committees?" />
          <YesNo
            q="49_wouldYou49"
            legend="Would you be interested in other volunteer opportunities? (i.e., AESC, AIP Week, etc.)"
          />
          <Text id="input_31" label="Additional Comments" />
          <Note>
            Applications for membership to the society are reviewed and approved by Actsafe&apos;s
            Board of Directors.
          </Note>
        </div>
      </Shown>

      <div className="flex items-center gap-4 border-t border-hair pt-5">
        <button
          type="submit"
          disabled
          className="h-10 cursor-not-allowed sq-sm border border-hair px-4 text-[14px] text-faint"
          title="Longtake never submits anything. You read it and send it yourself."
        >
          Submit
        </button>
        <p className="text-[12px] text-faint">Longtake never sends it. That part is yours.</p>
      </div>
    </form>
  );
}
