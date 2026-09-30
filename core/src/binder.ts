/**
 * ⭐ THE PRODUCT — a form we have never seen becomes a tool the voice agent can call.
 *
 * This is the file to read if you only read one. `reader.ts` is the harder engineering, but this
 * is the idea: **the Voice Agent API lets you describe what a field expects before it decides
 * what the words mean.** So instead of transcribing speech and then guessing where each phrase
 * belongs, we hand the model a schema built from the form in front of the person — this select's
 * real options, this field's real length limit, this question's real wording — and let it place
 * the answers itself, in one pass.
 *
 * Nothing here is hardcoded to any site. Open a different form and a different tool is built,
 * a few milliseconds later.
 *
 * ## Two things the schema makes impossible, rather than discouraged
 *
 * 1. **An answer with no evidence cannot be expressed.** Every field is an object of
 *    `{ value, evidence }` with both required, so "fill in the rest" is not a shape the model
 *    can emit. `writer.ts` checks it again at the point of writing. The rule lives in the type
 *    system, in the schema, and in the code — not in a prompt someone can talk around.
 * 2. **A field that is not on the page cannot be named.** `additionalProperties: false`, and
 *    every choice field carries the page's own options as an `enum`.
 *
 * ## One thing the API will not do for us
 *
 * > *"`parameters` is **not** validated at `session.update` time. Malformed schemas (missing
 * > `type: "object"`, broken `enum`) are accepted silently and break tool calling at runtime.
 * > Validate locally."*
 *
 * So `validateTool` exists, and it runs before the tool is ever sent.
 */

import { fieldName, type FieldSpec } from "./types";

/** The tool shape the Voice Agent API expects in `session.tools`. */
export type VoiceAgentTool = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  /** `interactive` keeps the agent talking while we work. `hold` makes it go silent. */
  execution_mode: "interactive" | "hold";
  timeout_seconds: number;
};

export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: string[];
  format?: string;
  maxLength?: number;
  pattern?: string;
  examples?: string[];
};

export const FILL_TOOL_NAME = "fill_fields";

/**
 * Filling twenty fields takes a couple of seconds, most of it spent opening dropdowns one at a
 * time. That is comfortably inside the range the docs put on `interactive`, where the agent
 * covers the gap with a transition phrase. `hold` would make it go silent and the person would
 * think the call had dropped.
 */
const EXECUTION_MODE = "interactive" as const;
const TIMEOUT_SECONDS = 60;

/**
 * What the model is told about the tool.
 *
 * Written as *"when should I reach for this?"* rather than *"what does this do?"*, because the
 * docs are blunt that most "the tool never fires" failures trace back to this string. It names
 * the trigger, names the anti-trigger, and says plainly that leaving a field out is a correct
 * outcome — which is the opposite of what a helpful assistant assumes by default.
 */
const TOOL_DESCRIPTION = [
  "Write answers into the form. Call it as soon as you hear answers, at most eight per call; call again for the rest.",
  "Include only fields the person spoke about: leaving one out is always fine; filling one they did not mention never is, even if it seems obvious or is required.",
  "Each answer carries evidence — their own words, quoted — and how you heard it:",
  "named (they said this answer, in any words or language), inferred (you worked it out, or chose the closest option to what they said), unsure (they hedged or gave a range).",
  "Inferred and unsure answers wait for their yes.",
].join(" ");

/** Format hints, so a spoken phrase arrives as something the field will accept. */
const FORMAT_HINTS: Partial<Record<FieldSpec["kind"], { format?: string; hint: string; examples?: string[] }>> = {
  email: { format: "email", hint: "A full email address, lowercase.", examples: ["rohit@example.com"] },
  tel: {
    hint: "A phone number in the format the person said it, digits and an optional country code. No brackets or dashes.",
    examples: ["+91 98765 43210"],
  },
  url: { format: "uri", hint: "A full URL including https://", examples: ["https://example.com/in/name"] },
  date: { format: "date", hint: "ISO-8601 date, YYYY-MM-DD.", examples: ["2026-10-01"] },
  number: { hint: "A plain number, no units, no commas." },
};

function valueSchema(spec: FieldSpec): JsonSchema {
  const options = spec.options?.map((option) => option.label).filter(Boolean) ?? [];

  switch (spec.kind) {
    case "checkbox":
      return { type: "boolean", description: "true if the person agreed, false if they declined." };

    case "select":
    case "radio": {
      // The page's own wording, because that is what the person will say out loud. `enum` is the
      // single strongest accuracy hint the API offers, and it removes the "model invented a
      // category" failure entirely.
      // A searchable list is never an enum: what is on show when it opens may be a first page, and
      // an enum would make the rest impossible to say.
      if (spec.searchable) {
        return {
          type: "string",
          description:
            "A list that searches as you type (a place, a school). Put what the person said, as they said it; it is searched for, and only a clear match goes in.",
        };
      }
      if (options.length > 0) {
        return {
          type: "string",
          enum: options,
          // Live: "Twitter" to a list without it was left out here, so the agent asked "how did you
          // hear?" again, and only the second "Twitter" became "Social Media — that one?". The
          // closest choice is safe to send: the gate holds any option they did not name for a yes.
          description:
            "Pick the one they said. If they said something this list does not have, pick the closest one with how inferred: it waits for their yes. Leave this field out only when nothing here is close.",
        };
      }
      return {
        type: "string",
        description: spec.searchable
          ? "A list that searches as you type (a place, a school). Put what the person said, as they said it; it is searched for, and only a clear match goes in."
          : "This dropdown's choices could not be read in advance. Put what the person said; it will be matched against the real options, and left blank if it does not match one.",
      };
    }

    case "multiselect":
      return {
        type: "array",
        items: options.length > 0 ? { type: "string", enum: options } : { type: "string" },
        description: "One entry per thing the person named. Leave out anything they did not say.",
      };

    case "number":
      return spec.range
        ? { type: "number", description: `A number from ${spec.range.min} to ${spec.range.max}.` }
        : { type: "number", description: FORMAT_HINTS.number!.hint };

    default: {
      const hint = FORMAT_HINTS[spec.kind];
      const schema: JsonSchema = {
        type: "string",
        description: hint?.hint ?? "What the person said, tidied into the form's own language.",
      };
      if (hint?.format) schema.format = hint.format;
      if (hint?.examples) schema.examples = hint.examples;
      if (spec.maxLength) schema.maxLength = spec.maxLength;
      // A placeholder that shows a format — "MM/DD/YYYY", "(000) 000-0000" — is the form telling
      // us how it wants the answer written. "Type here..." tells nothing, and is left out.
      if (spec.placeholder && /\d|mm|dd|yy|0{3}|x{2,}/i.test(spec.placeholder)) {
        schema.description = `${schema.description} Written the way the form shows it: "${spec.placeholder}".`;
      }
      if (spec.pattern) schema.pattern = spec.pattern;
      return schema;
    }
  }
}

function fieldSchema(spec: FieldSpec): JsonSchema {
  const parts = [fieldName(spec)];
  // Where it sits, because a real form can ask "First Name" twice — once for the person and once
  // for somebody else — and the heading above is the only thing that tells them apart.
  if (spec.section) parts.push(`(in the "${spec.section}" section)`);
  if (spec.required) parts.push("(the form marks this required)");
  if (spec.longForm) parts.push("(a long answer — several sentences are welcome)");
  if (spec.description) parts.push(`(the form adds: "${spec.description}")`);

  return {
    type: "object",
    description: parts.join(" "),
    properties: {
      value: valueSchema(spec),
      evidence: {
        type: "string",
        description:
          "The few words of theirs this answer came from, 2 to 8 words, copied exactly as they said them. Not a paraphrase. If you cannot quote them, you did not hear this answer and the field must be left out.",
      },
      // How it was heard is the model's judgement of language — whether "2 or 3 years" is unsure,
      // whether "haan" answered this yes-or-no. The gate (gate.ts) acts on it instead of word lists.
      how: { type: "string", enum: ["named", "inferred", "unsure"] },
    },
    // Always. This is what makes an unsupported answer unrepresentable rather than merely
    // discouraged — there is no shape of this object that carries a value without its source.
    required: ["value", "evidence", "how"],
    additionalProperties: false,
  };
}

/**
 * Build the tool for the form currently on screen.
 *
 * ⚠️ Run `harvestOptions` before this. A dropdown whose options have not been read yet produces
 * a field with no `enum`, which is the difference between the model choosing from the page's
 * real answers and the model inventing one.
 */
export function buildFillTool(specs: FieldSpec[]): VoiceAgentTool {
  const properties: Record<string, JsonSchema> = {};

  for (const spec of specs) {
    // A field we believe is a trap never reaches the schema, so the model cannot choose to fill
    // it even if asked to. `reader.ts` already keeps invisible fields out; this covers the ones
    // that are visible but suspicious.
    if (spec.suspectedHoneypot) continue;
    if (spec.kind === "file") continue;
    properties[spec.id] = fieldSchema(spec);
  }

  return {
    type: "function",
    name: FILL_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties,
      // Deliberately empty. Marking the form's required fields as required *here* would make the
      // agent interrogate the person for them before it could call the tool at all — which is
      // precisely the form-shaped questioning Longtake exists to remove. What is still missing
      // is reported back in the tool's result, and asked about afterwards, one at a time.
      required: [],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const CLEAR_TOOL_NAME = "clear_fields";

/**
 * The other half: taking an answer back out.
 *
 * Without it, "remove the gender" had nowhere to go — the agent filled Gender with "Decline To
 * Self Identify" and announced it had cleared it. Separate from `fill_fields` so the model cannot
 * blur the two, and held to the same standard: it needs the person's own words asking for it.
 */
export function buildClearTool(specs: FieldSpec[]): VoiceAgentTool {
  const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
  return {
    type: "function",
    name: CLEAR_TOOL_NAME,
    description:
      "Empty fields the person asked you to clear, remove or undo, with their words. Only when they ask for it. Never pick another option, like a decline choice, as a way of clearing one. If a result says one can't be emptied, tell them why.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "The fields to empty.",
          items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
        },
        evidence: {
          type: "string",
          description: "The person's own words asking for this, quoted exactly.",
        },
      },
      required: ["fields", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const CONFIRM_TOOL_NAME = "confirm_answer";

/**
 * The person's reply to "is that right?", as the agent understood it.
 *
 * An answer they did not name — "Twitter" on a list offering "Social Media" — waits for their yes.
 * Whether a reply IS a yes ("do it", "haan wahi", "that one", "sure, go on") is for the model to
 * judge, in any words and any language; this tool is how it says what it judged. The evidence is
 * checked against the transcript like every other quote, so the reply has to be one they gave.
 */
export function buildConfirmTool(specs: FieldSpec[]): VoiceAgentTool {
  const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
  return {
    type: "function",
    name: CONFIRM_TOOL_NAME,
    description:
      "After you asked about an answer waiting for their yes, report their reply. agreed: true if they accepted it in any words or language, false if they said no or wanted something else. Only for fields waiting for their yes.",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The field that was waiting.",
          ...(ids.length > 0 ? { enum: ids } : {}),
        },
        agreed: { type: "boolean", description: "Did they accept the answer you offered?" },
        evidence: { type: "string", description: "Their reply, quoted exactly." },
      },
      required: ["field", "agreed", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const LATER_TOOL_NAME = "skip_for_now";

/**
 * "Skip this one, we'll come back to it." Moves fields to the end of the queue — nothing is written
 * or cleared. Without it, a person who wanted to leave a hard question for last had no way to say
 * so: the plan always asked the first empty required field, and the agent, stuck repeating it,
 * told them the form would not let them move on. No form works that way.
 */
export function buildLaterTool(specs: FieldSpec[]): VoiceAgentTool {
  const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
  return {
    type: "function",
    name: LATER_TOOL_NAME,
    description:
      "Put fields off until the end when the person says skip it, later, come back to it, or do the rest first — then move on. Nothing is filled or cleared; they are asked again once everything else is done. Any field can wait: never tell them the form makes them answer in order.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "The fields to come back to.",
          items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
        },
        evidence: {
          type: "string",
          description: "The person's own words asking to skip it, quoted exactly.",
        },
      },
      required: ["fields", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const LEAVE_TOOL_NAME = "leave_empty";

/**
 * "That doesn't apply to me." "I'd rather not say." A question answered by saying it isn't theirs
 * to answer is answered: it stays empty and is not asked again. Without this, live — "If you are
 * below 18, have you had your parents fill out the consent form?" / "I'm over 18" — the agent said
 * "Understood", nothing was recorded, and the same question came back a turn later. The agent
 * judges what they meant, in any words; code checks only that the quote was said.
 */
export function buildLeaveTool(specs: FieldSpec[]): VoiceAgentTool {
  const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
  return {
    type: "function",
    name: LEAVE_TOOL_NAME,
    description:
      "Leave fields empty for good when the person says a question doesn't apply to them (\"I'm over 18\" to one for under-18s) or they'd rather not answer it. Nothing is written, and it isn't asked again; say in a few words that it stays blank. You judge what they meant, in any words. A field with an answer in it is emptied with clear_fields instead.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "The fields to leave empty.",
          items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
        },
        evidence: {
          type: "string",
          description: "The person's own words saying it doesn't apply or they'd rather not, quoted exactly.",
        },
      },
      required: ["fields", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const DRAFT_TOOL_NAME = "draft_answer";

/**
 * A long answer — why this role, tell us about yourself — drafted from their points (draft.ts).
 * Only on a form that has one. Nothing is written: the draft waits for their yes, like any answer
 * the agent did not hear word for word, and goes in through confirm_answer.
 */
export function buildDraftTool(specs: FieldSpec[]): VoiceAgentTool | null {
  const ids = specs.filter((spec) => spec.longForm && !spec.suspectedHoneypot).map((spec) => spec.id);
  if (ids.length === 0) return null;
  return {
    type: "function",
    name: DRAFT_TOOL_NAME,
    description:
      "When they ask you to improve, expand, polish or write up a longer answer — never refuse — draft it from their words and what's already in the box. new: from their points; revise: change the draft, or the answer that's there, as they ask; reuse: last time's answer. It uses only what they said: if they want more than that holds, ask for more points. Nothing goes in yet: read the draft word for word, then confirm_answer on their yes.",
    parameters: {
      type: "object",
      properties: {
        field: { type: "string", enum: ids, description: "The long-answer field." },
        mode: { type: "string", enum: ["new", "revise", "reuse"], description: "new, revise or reuse." },
        evidence: {
          type: "string",
          description: "Their own words, quoted exactly: their points (new), what to change (revise), or their yes (reuse).",
        },
      },
      required: ["field", "mode", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const SAVE_TOOL_NAME = "save_for_next_time";

/**
 * Their answer to a question about NEXT time, not this form: keep the phone number they just gave
 * in place of the saved one? Forget an answer they cleared? Remember a personal one? The agent
 * judges their reply, in whatever words; code checks the quote and does the rest. Nothing on the
 * page changes.
 */
export function buildSaveTool(specs: FieldSpec[]): VoiceAgentTool {
  const ids = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file").map((spec) => spec.id);
  return {
    type: "function",
    name: SAVE_TOOL_NAME,
    description:
      "Only after DO NEXT had you ask about next time (keep a new answer, forget a cleared one, remember a personal one): report their reply. agreed: true if they said yes in any words or language, false if not. Changes nothing on this form.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "The fields you asked about.",
          items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
        },
        agreed: { type: "boolean", description: "Did they say yes?" },
        evidence: { type: "string", description: "Their reply, quoted exactly." },
      },
      required: ["fields", "agreed", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

export const PRESS_TOOL_NAME = "press_form_button";

/**
 * Pressing the buttons that are not answers: "Add another" and "Next".
 *
 * Only those — the enum is built from `readActions`, which never lists a submit button, so "submit
 * it for me" is not a thing the agent can express. `null` when the form has none, because a tool
 * with an empty enum is a malformed tool.
 */
export function buildPressTool(actions: { id: string; kind: string; label: string }[]): VoiceAgentTool | null {
  if (actions.length === 0) return null;
  return {
    type: "function",
    name: PRESS_TOOL_NAME,
    description:
      "Press a button on the form when the person asks: add another entry (another job, another school), or go to the next page. Only when they ask for it; then carry on with what appears. page_did_not_change means the form refused to move on: tell them what it asked for. There is no submit button here — the person always submits themselves.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: actions.map((a) => a.id),
          description: `Which button: ${actions.map((a) => `${a.id} = "${a.label}"`).join("; ")}.`,
        },
        evidence: { type: "string", description: "The person's own words asking for it, quoted exactly." },
      },
      required: ["action", "evidence"],
      additionalProperties: false,
    },
    execution_mode: EXECUTION_MODE,
    timeout_seconds: TIMEOUT_SECONDS,
  };
}

/**
 * Check the schema ourselves, because nothing else will.
 *
 * The API accepts a malformed `parameters` silently at `session.update` and then simply fails to
 * call the tool at runtime, which is close to undebuggable from the outside. Returns a list of
 * problems; empty means it is safe to send.
 */
export function validateTool(tool: VoiceAgentTool): string[] {
  const problems: string[] = [];

  if (tool.type !== "function") problems.push('type must be "function"');
  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) problems.push(`name "${tool.name}" must be snake_case`);
  if (!tool.description.trim()) problems.push("description is empty, so the agent has no reason to call it");
  if (tool.timeout_seconds < 1 || tool.timeout_seconds > 300) {
    problems.push("timeout_seconds must be between 1 and 300");
  }

  const walk = (schema: JsonSchema, path: string) => {
    if (!schema.type) {
      problems.push(`${path}: missing "type"`);
      return;
    }
    if (schema.enum) {
      if (schema.enum.length === 0) problems.push(`${path}: enum is empty, so nothing can satisfy it`);
      if (new Set(schema.enum).size !== schema.enum.length) {
        problems.push(`${path}: enum has duplicate entries`);
      }
      if (schema.enum.some((value) => typeof value !== "string" || value === "")) {
        problems.push(`${path}: enum contains a blank entry`);
      }
    }
    if (schema.type === "object") {
      for (const name of schema.required ?? []) {
        if (!schema.properties || !(name in schema.properties)) {
          problems.push(`${path}: "${name}" is required but not defined`);
        }
      }
      for (const [name, child] of Object.entries(schema.properties ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          problems.push(`${path}.${name}: property name is not a plain identifier`);
        }
        walk(child, `${path}.${name}`);
      }
    }
    if (schema.type === "array" && schema.items) walk(schema.items, `${path}[]`);
  };

  if (tool.parameters.type !== "object") {
    problems.push('parameters must be an object schema — a missing type: "object" silently breaks tool calling');
  }
  walk(tool.parameters, "parameters");

  return problems;
}

/**
 * A short description of the form, for the agent's system prompt.
 *
 * The tool schema already carries every field, but a model reads a prompt differently from a
 * schema: the prompt is where it learns what this form is *about*, and therefore what to listen
 * for. Kept compact — long prompts dilute attention, and this one is generated, so it grows with
 * the form.
 */
export function describeForm(specs: FieldSpec[], url = ""): string {
  const usable = specs.filter((spec) => !spec.suspectedHoneypot && spec.kind !== "file");
  if (usable.length === 0) return "There is no form on this page yet.";

  const lines = usable.map((spec) => {
    const bits = [`- ${fieldName(spec)}`];
    if (spec.section) bits.push(`[${spec.section}]`);
    if (spec.required) bits.push("(required)");
    if (spec.options?.length) {
      const shown = spec.options.slice(0, 6).map((o) => o.label).join(", ");
      bits.push(`— choose from: ${shown}${spec.options.length > 6 ? ", …" : ""}`);
    }
    return bits.join(" ");
  });

  const where = url ? ` at ${url}` : "";
  return [
    `The form in front of the person${where} has ${usable.length} fields:`,
    ...lines,
  ].join("\n");
}

/**
 * Which optional fields are still empty — offered once the required ones are in, never before.
 *
 * Asking about optional fields while required ones are still open would make a short form feel
 * long. Leaving them out entirely was the other mistake: the agent went quiet the moment the
 * required fields were done, and a person had no way to know the website box or "how did you
 * hear about us" were there to be filled at all.
 */
export function stillOptional(specs: FieldSpec[], filledIds: Iterable<string>): FieldSpec[] {
  const filled = new Set(filledIds);
  return specs.filter(
    (spec) =>
      !spec.required && !filled.has(spec.id) && !spec.suspectedHoneypot && spec.kind !== "file",
  );
}

/** Which required fields are still empty — what the agent asks about, one at a time. */
export function stillMissing(specs: FieldSpec[], filledIds: Iterable<string>): FieldSpec[] {
  const filled = new Set(filledIds);
  return specs.filter(
    (spec) =>
      spec.required && !filled.has(spec.id) && !spec.suspectedHoneypot && spec.kind !== "file",
  );
}
