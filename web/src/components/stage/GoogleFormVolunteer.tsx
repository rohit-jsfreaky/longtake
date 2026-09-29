"use client";

import { useId, useState } from "react";

import { FIELD_STYLE } from "./GleanApplication";

/**
 * A real Google Form, copied unchanged — three pages, Next between them, Submit at the end.
 *
 * SOURCE  Volunteer Registration & Interest Form — EDUkraine
 *         https://docs.google.com/forms/d/e/1FAIpQLSe9YP7zfEu01jKJ8IxIa_tjd0GaCoHv9B-nDlX351D-JRnQ9g/viewform
 *         Read on 2026-09-23 from the form's own data (FB_PUBLIC_LOAD_DATA_) and its rendered page.
 *
 * Every question, its wording, order, section, what is required, and every choice are as the live
 * form has them. The markup follows what Google renders, because that is what `core/` has to read:
 *
 *   · each question a `role="listitem"` whose title is a `role="heading"` the input points at
 *     through `aria-labelledby` — there is no `<label for>` anywhere
 *   · choices are `div role="radio"` in a `role="radiogroup"`, not inputs
 *   · a date answer's own label is just "Date"; the question is on the group around it
 *   · only the current page exists in the DOM; answers survive going Back and Next
 *   · Next refuses to leave a page with a required question empty, and says so under it:
 *     "This is a required question"
 *   · Back, Next, Submit and Clear form are `div role="button"`
 *
 * Why it is here: a judge named Google Forms, and it is the multi-page case. Longtake presses Next
 * when the person says so, and never Submit.
 */

type Question =
  | { kind: "text" | "paragraph" | "date"; title: string; required?: boolean }
  | { kind: "radio"; title: string; required?: boolean; options: string[]; other?: boolean };

const INTRO = `Thank you for your interest in volunteering with EDUkraine!

To help us get to know you better and make sure our students are paired with safe, supportive, and committed volunteers, we ask that you record and submit short video responses to the following questions.

Please answer each question honestly and thoughtfully. Your responses will be reviewed by our team as part of the application process.
____________________________________________________
Required Directions:
1. We must be able to see your full face clearly!

2. Be sure to film this in a quiet setting, where we can clearly hear your voice.

3. Make sure that you are looking at the screen, we don't want you to be reading a script.

4. It must be you answering the questions and the one in the video!
___________________________________________________
Required Video Questions:

1. Please introduce yourself. Include:

a) your full name
b) current role (student, profession, etc.)
c) Do you have any teaching/tutoring/volunteer experience? If so, describe your role and experience.
d) What do you like to do in your free time? What are your likes and dislikes?

2. Why do you want to volunteer with EDUkraine?

3. Why do you specifically want to support Ukrainians learning English?

4. Many of our students are traumatized by the war and may sometimes express strong emotions of anger or grief. For example, a student might express strong comments about Russians or about the war. How would you handle this situation?

5. What do you hope to gain personally or professionally from this experience?

6. What do you hope to contribute to your student?

7. Is there anything about yourself that you would like us to know to better understand who you are as a person and as a volunteer?`;

const PAGES: { title?: string; questions: Question[] }[] = [
  {
    questions: [
      { kind: "text", title: "First Name", required: true },
      { kind: "text", title: "Last Name", required: true },
      {
        kind: "text",
        title: "Email Address (Please double check for any typos, all further information will be sent to this address)",
        required: true,
      },
      {
        kind: "text",
        title:
          'Please upload your video to Google Drive and paste the shareable link here.\n\n**Make sure that the video is uploaded to Google Drive and the share setting is set to "Anyone with link".\n\nPLEASE READ AND FOLLOW THE INSTRUCTIONS ABOVE CAREFULLY. ',
        required: true,
      },
      {
        kind: "radio",
        title: "If you are below 18 years of age, have you had your parents fill out the Parental Consent Form?",
        options: ["Yes", "No"],
      },
      { kind: "text", title: "Phone Number", required: true },
      { kind: "date", title: "Date of Birth", required: true },
      { kind: "radio", title: "Gender", required: true, options: ["Male", "Female", "Prefer not to say"] },
      { kind: "text", title: "Nationality (Country)", required: true },
      {
        kind: "text",
        title: "Country of Residence and State, if necessary (e.g. US). Where are you living now?",
        required: true,
      },
      {
        kind: "radio",
        title: "Level of your English",
        required: true,
        options: [
          "A1: Beginner",
          "A2: Pre-intermediate",
          "B1: Intermediate",
          "B2: Upper-intermediate",
          "C1: Advanced",
          "C2: Mastery",
        ],
      },
    ],
  },
  {
    title: "Availability",
    questions: [
      { kind: "date", title: "Preferred Start Date", required: true },
      { kind: "text", title: "How many hours per week are you available to volunteer? (At least 30 minutes)", required: true },
      { kind: "text", title: "Timezone", required: true },
      { kind: "radio", title: "Do you have any previous teaching or tutoring experience?", required: true, options: ["Yes", "No"] },
      { kind: "paragraph", title: "If yes, please briefly describe your experience" },
    ],
  },
  {
    title: "Additional Information",
    questions: [
      {
        kind: "radio",
        title: "How did you hear about us?",
        required: true,
        other: true,
        options: [
          "Idealist",
          "Press Release/News Article",
          "Reddit",
          "LinkedIn",
          "Facebook",
          "Nextdoor",
          "Indeed",
          "Instagram",
          "Web Search",
          "EDUkraine Chapter/Club",
          "High School Community Service Opportunity",
          "EDUkraine Event",
        ],
      },
      { kind: "paragraph", title: "Is there any other information you would like us to know?" },
      {
        kind: "radio",
        title:
          "I consent to EDUkraine contacting my references and using the information provided in this application for the purpose of volunteer recruitment.",
        required: true,
        options: ["Yes"],
      },
    ],
  },
];

const REQUIRED_MESSAGE = "This is a required question";

/** Answers are keyed page:question, and live above the pages, so Back and Next keep them. */
type Answers = Record<string, string>;

function GoogleButton({ children, onPress, primary }: { children: string; onPress?: () => void; primary?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPress?.();
        }
      }}
      className={
        primary
          ? "inline-flex h-9 cursor-pointer items-center sq-sm border border-hair-lit bg-ink-700 px-5 text-[14px] text-paper transition-colors hover:border-paper"
          : "inline-flex h-9 cursor-pointer items-center px-3 text-[14px] text-dim transition-colors hover:text-paper"
      }
    >
      <span>{children}</span>
    </div>
  );
}

function Item({
  question,
  value,
  onChange,
  error,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
  error: boolean;
}) {
  const base = useId();
  const headingId = `${base}-h`;
  const alertId = `${base}-a`;
  const [otherText, setOtherText] = useState("");

  return (
    <div role="listitem" className="space-y-3 sq-sm border border-hair bg-ink-800/40 p-4">
      <div role="heading" aria-level={3} id={headingId} className="whitespace-pre-line text-[14px] text-paper">
        <span>{question.title}</span>
        {question.required && (
          <span aria-label="Required question" className="text-faint">
            {" "}
            *
          </span>
        )}
      </div>

      {(question.kind === "text" || question.kind === "paragraph") &&
        (question.kind === "text" ? (
          <input
            type="text"
            aria-labelledby={headingId}
            aria-describedby={alertId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Your answer"
            className={FIELD_STYLE}
          />
        ) : (
          <textarea
            aria-labelledby={headingId}
            aria-describedby={alertId}
            value={value}
            rows={2}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Your answer"
            className="w-full sq-sm border border-hair bg-ink-700 px-3 py-2.5 text-[14px] text-paper outline-none transition-colors placeholder:text-faint focus:border-hair-lit"
          />
        ))}

      {question.kind === "date" && (
        <div aria-labelledby={headingId} aria-describedby={alertId}>
          <div id={`${base}-d`} className="mb-1 text-[12px] text-faint">
            Date
          </div>
          <input
            type="date"
            aria-labelledby={`${base}-d`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={`${FIELD_STYLE} max-w-[12rem]`}
          />
        </div>
      )}

      {question.kind === "radio" && (
        <div role="radiogroup" aria-labelledby={headingId} aria-describedby={alertId} aria-required={question.required}>
          {[...question.options, ...(question.other ? ["__other_option__"] : [])].map((option) => {
            const isOther = option === "__other_option__";
            const checked = isOther ? value.startsWith("Other: ") : value === option;
            return (
              <label key={option} className="flex cursor-pointer items-center gap-3 py-1.5 text-[14px] text-paper">
                <div
                  role="radio"
                  aria-label={isOther ? "Other:" : option}
                  data-value={option}
                  aria-checked={checked}
                  tabIndex={0}
                  onClick={() => onChange(isOther ? `Other: ${otherText}` : option)}
                  className={`size-4 shrink-0 rounded-full border ${checked ? "border-paper bg-paper" : "border-ink-faint"}`}
                />
                {isOther ? (
                  <span className="flex items-center gap-2">
                    Other:
                    <input
                      type="text"
                      aria-label="Other response"
                      value={otherText}
                      onChange={(event) => {
                        setOtherText(event.target.value);
                        onChange(`Other: ${event.target.value}`);
                      }}
                      className="h-7 border-b border-hair bg-transparent text-[14px] outline-none"
                    />
                  </span>
                ) : (
                  <span>{option}</span>
                )}
              </label>
            );
          })}
        </div>
      )}

      <div id={alertId} role="alert" className="text-[12px] text-dim">
        {error ? REQUIRED_MESSAGE : ""}
      </div>
    </div>
  );
}

export function GoogleFormVolunteer() {
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [tried, setTried] = useState(false);
  const current = PAGES[page]!;
  const last = page === PAGES.length - 1;

  const missing = current.questions.some((q, i) => q.required && !answers[`${page}:${i}`]?.trim());

  const next = () => {
    if (missing) {
      setTried(true);
      return;
    }
    setTried(false);
    setPage((p) => Math.min(PAGES.length - 1, p + 1));
  };

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <div className="sq-sm border border-hair p-4">
        <div role="heading" aria-level={1} className="text-[18px] text-paper">
          Volunteer Registration &amp; Interest Form
        </div>
        {page === 0 && (
          <p className="mt-2 max-h-40 overflow-auto whitespace-pre-line text-[13px] leading-relaxed text-dim" data-lenis-prevent>{INTRO}</p>
        )}
      </div>

      {current.title && (
        <div role="heading" aria-level={2} className="text-[15px] font-medium text-paper">
          {current.title}
        </div>
      )}

      <div role="list" className="space-y-3" key={page}>
        {current.questions.map((question, i) => (
          <Item
            key={`${page}:${i}`}
            question={question}
            value={answers[`${page}:${i}`] ?? ""}
            onChange={(value) => setAnswers((all) => ({ ...all, [`${page}:${i}`]: value }))}
            error={tried && Boolean(question.required) && !answers[`${page}:${i}`]?.trim()}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2">
        {page > 0 && <GoogleButton onPress={() => setPage((p) => p - 1)}>Back</GoogleButton>}
        {last ? (
          // Longtake never presses this, and on this copy it does nothing either.
          <GoogleButton primary>Submit</GoogleButton>
        ) : (
          <GoogleButton primary onPress={next}>
            Next
          </GoogleButton>
        )}
        <span className="text-[12px] text-faint">
          Page {page + 1} of {PAGES.length}
        </span>
        <div className="ml-auto">
          <GoogleButton
            onPress={() => {
              setAnswers({});
              setPage(0);
              setTried(false);
            }}
          >
            Clear form
          </GoogleButton>
        </div>
      </div>
    </form>
  );
}
