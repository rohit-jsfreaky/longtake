/**
 * Plays a scripted conversation through a real `Conductor` with a `FakeVoice`, and says where it
 * went differently from what the script expected.
 *
 * A script is data — JSON on disk in the corpus, or inline in a test — so a live failure can be
 * written down once, the way it happened, and replayed on every change from then on. Field
 * references may be `$key` placeholders, resolved by the caller (the corpus maps them from truth
 * keys to whatever ids the reader of the day gives those elements); plain ids pass through.
 */

import type { Conductor } from "../../core/src/conductor";
import type { FakeVoice } from "./fake-voice";

export type Step =
  | { user: string }
  | { partial: string }
  | { tool: string; args: Record<string, unknown> }
  | { agentSays: string }
  | { wait: number }
  | {
      expectResult: {
        justFilled?: string[];
        notFilled?: { field: string; why?: string }[];
        waiting?: string[];
        doNextHas?: string;
        doNextLacks?: string;
      };
    }
  | { expectFinal: { values?: Record<string, string>; empty?: string[]; promptHas?: string[] } };

export type Script = { name: string; steps: Step[] };

export type ScriptReport = { ok: boolean; failures: string[]; results: unknown[] };

type Result = {
  just_filled?: { field: string }[];
  not_filled?: { field: string; why: string }[];
  waiting_for_yes?: { field: string }[];
  do_next?: string;
};

export async function runScript(
  conductor: Conductor,
  fake: FakeVoice,
  script: Script,
  resolve: (ref: string) => string = (ref) => ref.replace(/^\$/, ""),
): Promise<ScriptReport> {
  const failures: string[] = [];
  const results: unknown[] = [];
  let last: Result | null = null;
  const fail = (index: number, what: string) => failures.push(`step ${index + 1}: ${what}`);
  const ids = (list?: { field: string }[]) => (list ?? []).map((item) => item.field).sort();
  const resolveArgs = (args: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      out[key.startsWith("$") ? resolve(key) : key] =
        typeof value === "string" && value.startsWith("$") ? resolve(value) : value;
    }
    // The array forms: clear_fields / skip_for_now take `fields`; confirm_answer takes `field`.
    if (Array.isArray(out.fields)) out.fields = (out.fields as string[]).map((f) => (f.startsWith("$") ? resolve(f) : f));
    return out;
  };

  for (const [index, step] of script.steps.entries()) {
    if ("user" in step) fake.userSays(step.user);
    else if ("partial" in step) fake.partial(step.partial);
    else if ("agentSays" in step) fake.agentSays(step.agentSays);
    else if ("wait" in step) await new Promise((r) => setTimeout(r, step.wait));
    else if ("tool" in step) {
      last = (await fake.toolCall(step.tool, resolveArgs(step.args))) as Result;
      results.push(last);
    } else if ("expectResult" in step) {
      const want = step.expectResult;
      if (!last) {
        fail(index, "no tool result to check");
        continue;
      }
      if (want.justFilled) {
        const expected = want.justFilled.map(resolve).sort();
        if (JSON.stringify(ids(last.just_filled)) !== JSON.stringify(expected)) {
          fail(index, `just_filled ${JSON.stringify(ids(last.just_filled))}, expected ${JSON.stringify(expected)}`);
        }
      }
      if (want.notFilled) {
        for (const item of want.notFilled) {
          const found = (last.not_filled ?? []).find((n) => n.field === resolve(item.field));
          if (!found) fail(index, `expected ${item.field} not filled`);
          else if (item.why && found.why !== item.why) fail(index, `${item.field} not filled because ${found.why}, expected ${item.why}`);
        }
      }
      if (want.waiting) {
        const expected = want.waiting.map(resolve).sort();
        if (JSON.stringify(ids(last.waiting_for_yes)) !== JSON.stringify(expected)) {
          fail(index, `waiting ${JSON.stringify(ids(last.waiting_for_yes))}, expected ${JSON.stringify(expected)}`);
        }
      }
      if (want.doNextHas && !String(last.do_next ?? "").includes(want.doNextHas)) {
        fail(index, `do_next "${last.do_next}" lacks "${want.doNextHas}"`);
      }
      if (want.doNextLacks && String(last.do_next ?? "").includes(want.doNextLacks)) {
        fail(index, `do_next "${last.do_next}" should not mention "${want.doNextLacks}"`);
      }
    } else if ("expectFinal" in step) {
      const fields = conductor.session.state().fields;
      const value = (ref: string) => {
        const field = fields.find((f) => f.spec.id === resolve(ref));
        return field ? field.value : undefined;
      };
      for (const [ref, want] of Object.entries(step.expectFinal.values ?? {})) {
        const got = value(ref);
        if (got === undefined) fail(index, `no field ${ref}`);
        else if (!String(Array.isArray(got) ? got.join(", ") : got).includes(want)) {
          fail(index, `${ref} is ${JSON.stringify(got)}, expected it to contain ${JSON.stringify(want)}`);
        }
      }
      for (const ref of step.expectFinal.empty ?? []) {
        const got = value(ref);
        if (got !== null) fail(index, `${ref} should be empty, is ${JSON.stringify(got)}`);
      }
      for (const words of step.expectFinal.promptHas ?? []) {
        if (!fake.prompt.includes(words)) fail(index, `the agent's prompt lacks "${words}"`);
      }
    }
  }
  return { ok: failures.length === 0, failures, results };
}
