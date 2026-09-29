"use client";

import { useMemo, useState } from "react";

import { FIELD_STYLE, Label } from "./GleanApplication";
import { SearchSelect, filterList, placeSearch, recordedSearch } from "./SearchSelect";
import {
  DEGREES,
  DISABILITY,
  DISCIPLINES,
  GENDER,
  GENDER_IDENTITY,
  LGBTQ,
  LOCATION_SEARCHES,
  PHONE_COUNTRIES,
  RACE,
  RACE_OR_ETHNICITY,
  SCHOOL_SEARCHES,
  SCHOOLS_ON_OPEN,
  VETERAN,
  YES_NO,
} from "./discord-data";

/**
 * A real job application, copied unchanged — the one with the hard parts.
 *
 * SOURCE  Director of Engineering, Safety — Discord
 *         https://job-boards.greenhouse.io/discord/jobs/8571766002
 *         Read off the live page headlessly on 2026-09-23.
 *
 * Every label, its order, what is required, and every choice (see discord-data.ts) are as the live
 * page had them. It is here for what the Glean copy does not have:
 *
 *   · Location (City) shows nothing until you type — the answer has to be searched for
 *   · School opens on a hundred schools, and IIT Kharagpur is not one of them until typed
 *   · Phone comes with its own country picker, one spoken number for two boxes
 *   · Education has "Add another", which adds a second School / Degree / Discipline
 *   · the button at the bottom is "Submit application", which Longtake will not press
 *
 * Left out, as on the Glean copy: the resume and cover-letter uploads' Dropbox and Google Drive
 * buttons. The resume box itself stays, because saying it is yours to attach is part of the demo.
 */

const EMPTY: string[] = [];
const searchPhoneCountries = filterList(PHONE_COUNTRIES);
const searchSchools = recordedSearch(SCHOOL_SEARCHES, SCHOOLS_ON_OPEN);
const searchLocations = placeSearch(LOCATION_SEARCHES);
const searchDegrees = filterList(DEGREES);
const searchDisciplines = filterList(DISCIPLINES);
const searchYesNo = filterList(YES_NO);

function Field({ id, label, required, type = "text" }: { id: string; label: string; required?: boolean; type?: string }) {
  return (
    <div>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input id={id} type={type} required={required} className={FIELD_STYLE} />
    </div>
  );
}

function Choice({ id, label, options, required }: { id: string; label: string; options: string[]; required?: boolean }) {
  // Stable, or the picker's search effect would re-run on every render.
  const search = useMemo(() => filterList(options), [options]);
  return <SearchSelect id={id} label={label} required={required} onOpen={options} search={search} />;
}

export function DiscordApplication() {
  // Greenhouse numbers each education block: school--0, school--1, …
  const [schools, setSchools] = useState(1);

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div>
        <h3 className="text-[15px] font-medium text-paper">Director of Engineering, Safety</h3>
        <p className="mt-0.5 text-[13px] text-faint">Discord · San Francisco Bay Area</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="first_name" label="First Name" required />
        <Field id="last_name" label="Last Name" required />
        <Field id="preferred_name" label="Preferred First Name" />
        <Field id="email" label="Email" required type="email" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SearchSelect id="country" label="Country" required onOpen={PHONE_COUNTRIES} search={searchPhoneCountries} />
        <Field id="phone" label="Phone" required type="tel" />
      </div>

      <SearchSelect id="candidate-location" label="Location (City)" required onOpen={EMPTY} search={searchLocations} />

      <div>
        <Label htmlFor="resume" required>
          Resume/CV
        </Label>
        <input
          id="resume"
          type="file"
          required
          accept=".pdf,.doc,.docx,.txt,.rtf"
          className="block w-full text-[13px] text-dim file:mr-3 file:h-9 file:sq-sm file:border file:border-hair file:bg-ink-700 file:px-3 file:text-paper"
        />
        <p className="mt-1 text-[12px] text-faint">Accepted file types: pdf, doc, docx, txt, rtf</p>
      </div>

      <div className="space-y-4 border-t border-hair pt-5">
        {Array.from({ length: schools }, (_, n) => (
          <div key={n} className="space-y-4">
            <p className="text-[13px] text-faint">Education</p>
            <SearchSelect id={`school--${n}`} label="School" onOpen={SCHOOLS_ON_OPEN} search={searchSchools} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SearchSelect id={`degree--${n}`} label="Degree" onOpen={DEGREES} search={searchDegrees} />
              <SearchSelect id={`discipline--${n}`} label="Discipline" onOpen={DISCIPLINES} search={searchDisciplines} />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSchools((count) => count + 1)}
          className="h-9 sq-sm border border-hair px-3 text-[13px] text-dim transition-colors hover:border-hair-lit hover:text-paper"
        >
          Add another
        </button>
      </div>

      <div className="space-y-4 border-t border-hair pt-5">
        <div>
          <Label htmlFor="question_36758311002" required>
            Why do you want to work at Discord?
          </Label>
          <textarea
            id="question_36758311002"
            required
            rows={3}
            className="w-full sq-sm border border-hair bg-ink-700 px-3 py-2.5 text-[14px] leading-relaxed text-paper outline-none transition-colors focus:border-hair-lit"
          />
        </div>
        <SearchSelect
          id="question_36758315002"
          label="Are you legally authorized to work in the United States for our Company?"
          required
          onOpen={YES_NO}
          search={searchYesNo}
        />
        <SearchSelect
          id="question_36758317002"
          label="Are you currently based in or willing to relocate to the Bay Area for this position?"
          required
          onOpen={YES_NO}
          search={searchYesNo}
        />
        <SearchSelect id="question_36758316002" label="Are you currently located in the US?" required onOpen={YES_NO} search={searchYesNo} />
        <Field id="question_36758314002" label="How did you hear about this job?" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="question_36758312002" label="LinkedIn Profile" />
          <Field id="question_36758313002" label="Website" />
        </div>
      </div>

      <fieldset className="space-y-4 border-t border-hair pt-5">
        <legend className="text-[13px] text-faint">Voluntary Self Identification</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice id="4033064002" label="Gender" options={GENDER} required />
          <Choice id="4033065002" label="Race and Ethnicity" options={RACE} required />
          <Choice id="4033066002" label="Veteran Status" options={VETERAN} required />
          <Choice id="4033067002" label="Disability Status" options={DISABILITY} required />
          <Choice id="4033068002" label="Gender Identity (optional)" options={GENDER_IDENTITY} />
          <Choice id="4033069002" label="Race or Ethnicity (optional)" options={RACE_OR_ETHNICITY} />
          <Choice id="4033070002" label="I consider myself a member of the LGBTQ+ community. (optional)" options={LGBTQ} />
        </div>
      </fieldset>

      <div className="flex items-center gap-4 border-t border-hair pt-5">
        <button
          type="submit"
          disabled
          className="h-10 cursor-not-allowed sq-sm border border-hair px-4 text-[14px] text-faint"
          title="Longtake never submits anything. You read it and send it yourself."
        >
          Submit application
        </button>
        <p className="text-[12px] text-faint">Longtake never sends it. That part is yours.</p>
      </div>
    </form>
  );
}
