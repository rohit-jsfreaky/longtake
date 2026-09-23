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

import type { FieldSpec } from "./types";

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
  "Write answers into the form the person is looking at.",
  "Call this as soon as you have heard even one answer, and call it again each time you hear more —",
  "you do not need to wait until the person has finished.",
  "Include ONLY fields the person actually spoke about.",
  "Leaving a field out is always correct and costs nothing; the form will ask about it later.",
  "Filling one they did not mention is never acceptable, even if the answer seems obvious from",
  "something else they said, and even if the field is required.",
  "Every answer carries the person's own words in `evidence`, quoted as they said them.",
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
      if (options.length > 0) {
        return {
          type: "string",
          enum: options,
          description: "Pick the closest of these. If none of them is what the person said, leave this field out.",
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
  const parts = [spec.label || spec.id];
  // Where it sits, because a real form can ask "First Name" twice — once for the person and once
  // for somebody else — and the heading above is the only thing that tells them apart.
  if (spec.section) parts.push(`(in the "${spec.section}" section)`);
  if (spec.required) parts.push("(the form marks this required)");
  if (spec.longForm) parts.push("(a long answer — several sentences are welcome)");

  return {
    type: "object",
    description: parts.join(" "),
    properties: {
      value: valueSchema(spec),
      evidence: {
        type: "string",
        description:
          "The person's own words that this answer came from, quoted. Not a paraphrase. If you cannot quote them, you did not hear this answer and the field must be left out.",
      },
    },
    // Both, always. This is what makes an unsupported answer unrepresentable rather than merely
    // discouraged — there is no shape of this object that carries a value without its source.
    required: ["value", "evidence"],
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
      "Empty fields the person asked you to clear, remove or undo. Only when they ask for it. Never pick another option as a way of clearing one.",
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
    const bits = [`- ${spec.label || spec.id}`];
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
