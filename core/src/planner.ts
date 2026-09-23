/**
 * What happens next in the conversation — decided in code, said by the model.
 *
 * ## Why this is not the model's job any more
 *
 * The model used to carry the plan in its head: which fields were left, whether the optional ones
 * had been offered, whether a correction was still outstanding. It lost track in every way it
 * could — stalling with "let me know when you're ready", asking for a Country that was already
 * filled, asking the same question three times. A plan is state, and state belongs in code.
 *
 * `nextMove` looks at the form as it is and returns the one thing to do next. `brief` turns the
 * form and that move into a short block of text the agent reads on every turn — pushed into its
 * prompt after every tool result, so even a turn with no tool call sees the form as it is now.
 * The model still chooses every word it says. It no longer chooses what to talk about.
 */

import { factsOf, inAskingOrder, type FieldFacts } from "./conversation";
import { isOpen, type FieldState, type FormState } from "./form-state";

export type Move =
  /** An answer is waiting for their yes. Always first: nothing else makes sense until it is settled. */
  | { kind: "confirm"; field: FieldFacts; suggestion: string; heard: string; reason: "not_named" | "hedged" }
  /** The form rejected something that went in. Before anything new — it is a mistake on the page now. */
  | { kind: "resolve"; field: FieldFacts; problem: string; value: string }
  /** Ask for the next required field — or group of fields that is one question to a person. */
  | { kind: "ask"; fields: FieldFacts[] }
  /** The required part is done. Offer the optional part, once. */
  | { kind: "offer_optional"; fields: FieldFacts[] }
  /** The offer has been made: go through these if they wanted them, move on if not. */
  | { kind: "optional"; fields: FieldFacts[]; next?: string; submit?: string }
  /** This page is done and the form has another. Ask, and press Next only on their yes. */
  | { kind: "next_page"; label: string }
  /** Nothing left that is ours to do. */
  | { kind: "handover"; theirs: string[]; submit?: string };

/** What the planner has to remember between moves. Tiny on purpose — the form is the rest. */
export type Plan = { optionalOffered: boolean };

export function nextMove(state: FormState, plan: Plan): Move {
  const specs = state.fields.map((f) => f.spec);

  const waiting = state.fields.find((f) => f.pending);
  if (waiting?.pending) {
    return {
      kind: "confirm",
      field: factsOf(waiting.spec, specs),
      suggestion: waiting.pending.suggestion,
      heard: waiting.pending.heard,
      reason: waiting.pending.reason,
    };
  }

  // A value the form says is wrong, only once something is in it — an empty required field's
  // "this field is required" is just the ordinary next question, asked in its turn.
  const wrong = state.fields.find((f) => f.error && f.value !== null);
  if (wrong?.error) {
    return { kind: "resolve", field: factsOf(wrong.spec, specs), problem: wrong.error, value: shown(wrong.value) };
  }

  const open = state.fields.filter(isOpen);
  const required = inAskingOrder(open.filter((f) => f.spec.required).map((f) => f.spec));

  if (required.length > 0) {
    const first = factsOf(required[0]!, specs);
    // An address — or a phone number split from its country code — is one question to a person,
    // however many boxes the form splits it into.
    if (first.group) {
      const together = open
        .map((f) => factsOf(f.spec, specs))
        .filter((facts) => facts.group === first.group && facts.section === first.section);
      return { kind: "ask", fields: together };
    }
    return { kind: "ask", fields: [first] };
  }

  const optional = inAskingOrder(open.filter((f) => !f.spec.required).map((f) => f.spec)).map((spec) =>
    factsOf(spec, specs),
  );
  const next = state.actions.find((a) => a.kind === "next");
  if (optional.length > 0) {
    if (!plan.optionalOffered) return { kind: "offer_optional", fields: optional };
    if (next) return { kind: "optional", fields: optional, next: next.label };
    return state.submitLabel
      ? { kind: "optional", fields: optional, submit: state.submitLabel }
      : { kind: "optional", fields: optional };
  }
  if (next) return { kind: "next_page", label: next.label };

  return state.submitLabel
    ? { kind: "handover", theirs: state.theirs, submit: state.submitLabel }
    : { kind: "handover", theirs: state.theirs };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// The brief — the form and the next move, as the agent reads them
// ═══════════════════════════════════════════════════════════════════════════════════════

const SOURCE_WORDS: Record<FieldState["source"], string> = {
  spoken: "they said it",
  memory: "from their last form",
  typed: "they typed it",
  page: "was already there",
  empty: "",
};

function shown(value: FieldState["value"]): string {
  const text = value === true ? "ticked" : Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** One field's facts as a short phrase: "How did you hear? — 11 options, point them at the list". */
function describe(facts: FieldFacts): string {
  const where = facts.section ? ` (under "${facts.section}")` : "";
  if (facts.searchable) return `${facts.question}${where} — a searchable list; whatever they say is looked up, and if several match they'll be offered`;
  if (facts.range) return `${facts.question}${where} — a number from ${facts.range.min} to ${facts.range.max}`;
  if (facts.choices) return `${facts.question}${where} — choices: ${facts.choices.join(", ")}`;
  if (facts.choice_count) return `${facts.question}${where} — ${facts.choice_count} options; ask them to look at the list on screen`;
  if (facts.answer_type === "yes or no") return `${facts.question}${where} — yes or no`;
  if (facts.answer_type === "long answer") return `${facts.question}${where} — a longer answer`;
  return `${facts.question}${where}`;
}

/** The instruction for the next move. What to do, never the words to say. */
export function doNext(move: Move): string {
  switch (move.kind) {
    case "confirm":
      return move.reason === "hedged"
        ? `They weren't sure for "${move.field.question}" (they said: "${move.heard}"). Ask which it is before anything goes in.`
        : `"${move.field.question}" is waiting for their yes: they said "${move.heard}", and the closest the form offers is "${move.suggestion}". Ask if that's right. If they say yes, call fill_fields with "${move.suggestion}" and their yes as evidence. If not, offer the other choices.`;
    case "resolve":
      return `The form won't accept "${move.value}" for "${move.field.question}" — it says: "${move.problem}". Tell them in a few words and ask for it again.`;
    case "ask": {
      if (move.fields.length > 1 && move.fields.every((f) => f.group === "address")) {
        const where = move.fields[0]!.section ? ` under "${move.fields[0]!.section}"` : "";
        return `Ask for their address${where} as one question — ${move.fields.map((f) => f.question).join(", ")}.`;
      }
      if (move.fields.length > 1 && move.fields.every((f) => f.group === "phone")) {
        return `Ask for their phone number, with its country code, as one question.`;
      }
      return `Ask for ${describe(move.fields[0]!)}.`;
    }
    case "offer_optional":
      return `Every required field is in. Say so, and ask if they want to do the ${move.fields.length} optional ones or hear what they are: ${move.fields.map((f) => f.question).join("; ")}.`;
    case "optional":
      return move.next
        ? `If they wanted the optional ones, ask for ${describe(move.fields[0]!)}. If they didn't, ask if they're ready for the next page, and press "${move.next}" with press_form_button only on their yes.`
        : `If they wanted the optional ones, ask for ${describe(move.fields[0]!)}. If they didn't, hand over: everything they told you is in, and they should ${move.submit ? `look it over and press "${move.submit}" themselves` : "look it over and send it themselves"}.`;
    case "next_page":
      return `Everything needed on this page is in. Ask if they're ready for the next page, and press "${move.label}" with press_form_button only on their yes.`;
    case "handover": {
      const send = move.submit ? `look it over and press "${move.submit}" themselves` : "look it over and send it themselves";
      return move.theirs.length > 0
        ? `Nothing left for you. Say everything they told you is in, that ${move.theirs.join(" and ")} is theirs to do by hand, and that they should ${send}.`
        : `Nothing left for you. Say everything they told you is in, and that they should ${send}.`;
    }
  }
}

/**
 * The form as it is and the next move, as text for the agent's prompt.
 *
 * Compact, because it is read on every turn: answered fields as one line each, empty ones with
 * what they accept, and the one thing to do next.
 */
export function brief(state: FormState, move: Move): string {
  const { progress } = state;
  const specs = state.fields.map((f) => f.spec);
  const lines: string[] = [];

  lines.push(
    `FORM NOW${state.title ? ` — ${state.title}` : ""}: ${progress.filled} of ${progress.total} answered, ${progress.requiredLeft} required left, ${progress.optionalLeft} optional left.`,
  );

  const answered = state.fields.filter((f) => f.value !== null);
  if (answered.length > 0) {
    lines.push("Answered:");
    for (const f of answered) {
      lines.push(`  ${factsOf(f.spec, specs).question}: ${shown(f.value)} (${SOURCE_WORDS[f.source]})`);
    }
  }

  const left = state.fields.filter((f) => isOpen(f) && !f.pending);
  if (left.length > 0) {
    lines.push("Still empty:");
    for (const f of left) {
      lines.push(`  ${describe(factsOf(f.spec, specs))}${f.spec.required ? " [required]" : ""}`);
    }
  }

  const declined = state.fields.filter((f) => f.declined && f.value === null);
  if (declined.length > 0) {
    lines.push(`Left empty on purpose (do not ask again): ${declined.map((f) => factsOf(f.spec, specs).question).join(", ")}`);
  }

  const waiting = state.fields.filter((f) => f.pending);
  for (const f of waiting) {
    lines.push(`Waiting for their yes: ${factsOf(f.spec, specs).question} → "${f.pending!.suggestion}" (they said "${f.pending!.heard}")`);
  }

  const problems = state.fields.filter((f) => f.error && f.value !== null);
  for (const f of problems) {
    lines.push(`The form rejects: ${factsOf(f.spec, specs).question} = "${shown(f.value)}" — "${f.error}"`);
  }

  if (state.theirs.length > 0) lines.push(`Theirs to do by hand: ${state.theirs.join(", ")}`);
  if (state.actions.length > 0) {
    lines.push(`Buttons you can press when they ask: ${state.actions.map((a) => `"${a.label}"`).join(", ")}`);
  }
  if (state.submitLabel) lines.push(`"${state.submitLabel}" sends the form — only they press it, never you.`);

  lines.push("", `DO NEXT: ${doNext(move)}`);
  return lines.join("\n");
}
