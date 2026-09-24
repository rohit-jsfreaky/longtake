/**
 * `npm run corpus:review -- <id>` — the page where a human turns a seeded draft into the truth.
 *
 * A small local server, nothing installed: the full-page screenshot with a numbered box on every
 * field, and beside it every field of `truth.json`, editable. Saving writes the file; "Verified"
 * stamps it with who checked it. An edit after that clears the stamp — a truth nobody re-checked
 * is not verified. Below it, the fill plan (`fill.json`) — what we try on the form — with a stamp
 * of its own.
 */

import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import type { AxCapture, FillPlan, Meta, Truth } from "./types";

const KINDS = ["text", "textarea", "email", "tel", "url", "number", "date", "select", "radio", "checkbox", "multiselect", "file"];
const SUBJECTS = ["self", "other_person", "organization", "none"];
const SCOPES = ["remember", "this_form", "sensitive", "never"];

/** What is wrong with a truth before it can be saved (or, with `verifying`, stamped). */
export function problemsIn(truth: Truth, verifying: boolean): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const page of truth.pages) {
    for (const field of page.fields) {
      const at = `${field.key} "${field.question}"`;
      if (keys.has(field.key)) problems.push(`${field.key}: key used twice`);
      keys.add(field.key);
      if (!KINDS.includes(field.kind)) problems.push(`${at}: kind "${field.kind}" is not one of ${KINDS.join(", ")}`);
      if (!SUBJECTS.includes(field.subject)) problems.push(`${at}: subject "${field.subject}"`);
      if (!SCOPES.includes(field.scope)) problems.push(`${at}: scope "${field.scope}"`);
      // A hidden field asks nobody anything; a list that fills as you type has no choices to list.
      if (verifying && !field.honeypot && !field.question.trim()) problems.push(`${field.key}: no question — what does a person read here?`);
      // …and a list whose choices exist but were not recorded says so (`complete: false`).
      const unlisted = field.options?.searchable || field.options?.complete === false;
      if (verifying && !field.honeypot && ["select", "radio", "multiselect"].includes(field.kind) && !field.options?.labels.length && !unlisted) {
        problems.push(`${at}: a ${field.kind} with no options`);
      }
    }
  }
  return problems;
}

const OUTCOMES = ["written", "refused", "held"];

/**
 * One judgement a first pass made about the truth, for the verifier to confirm on the page:
 * which fields, what was decided, and why. `corpus/<id>/checks.json`.
 */
export type Check = { keys: string[]; decided: string; why: string };

/** What is wrong with a fill plan before it can be saved (or, with `verifying`, stamped). */
export function problemsInPlan(plan: FillPlan, truth: Truth, verifying: boolean): string[] {
  const problems: string[] = [];
  const keys = new Set(truth.pages.flatMap((page) => page.fields.map((field) => field.key)));
  plan.cases.forEach((item, i) => {
    const at = `answer ${i + 1} (${item.field})`;
    if (!keys.has(item.field)) problems.push(`${at}: no field ${item.field} in the truth`);
    if (!OUTCOMES.includes(item.expect?.outcome)) problems.push(`${at}: outcome must be one of ${OUTCOMES.join(", ")}`);
    for (const key of item.expect?.also ?? []) if (!keys.has(key)) problems.push(`${at}: also-changes names ${key}, which is not in the truth`);
    if (verifying && (item.value === "" || (Array.isArray(item.value) && item.value.length === 0))) problems.push(`${at}: no answer`);
    if (verifying && !item.evidence.trim()) problems.push(`${at}: no words — what did they say?`);
  });
  return problems;
}

function gitUser(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "reviewer";
  } catch {
    return "reviewer";
  }
}

/**
 * `reviewer` names whoever really checks — the git user by default. A stamp is a record of who
 * looked; when someone else looks on the git user's behalf, it says so.
 */
export async function review(id: string, dir = "corpus", port = 4477, reviewer?: string): Promise<void> {
  const base = join(dir, id);
  const page = resolve(process.cwd(), "tools/corpus/review.html");
  const by = reviewer ?? gitUser();

  const server = createServer(async (req, res) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    try {
      if (req.method === "GET" && req.url === "/") return send(200, "text/html; charset=utf-8", await readFile(page));
      if (req.method === "GET" && req.url === "/shot.png") return send(200, "image/png", await readFile(join(base, "shots", "page.png")));
      if (req.method === "GET" && req.url === "/api/form") {
        const [meta, ax, truth] = await Promise.all(
          ["meta.json", "ax.json", "truth.json"].map((name) => readFile(join(base, name), "utf8").then(JSON.parse)),
        );
        const fill: FillPlan = await access(join(base, "fill.json"))
          .then(() => readFile(join(base, "fill.json"), "utf8").then((text) => JSON.parse(text) as FillPlan))
          .catch(() => ({ cases: [], verified: null }));
        // The calls a first pass made that a person should look at — each with why.
        const checks: Check[] = await readFile(join(base, "checks.json"), "utf8")
          .then((text) => JSON.parse(text) as Check[])
          .catch(() => []);
        return send(200, "application/json", JSON.stringify({ meta: meta as Meta, ax: ax as AxCapture, truth: truth as Truth, fill, checks, by }));
      }
      if (req.method === "PUT" && req.url === "/api/fill") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { fill, verify } = JSON.parse(body) as { fill: FillPlan; verify: boolean };
        const truth = JSON.parse(await readFile(join(base, "truth.json"), "utf8")) as Truth;
        const problems = problemsInPlan(fill, truth, verify);
        if (problems.length > 0) return send(422, "application/json", JSON.stringify({ problems }));
        const saved: FillPlan = { cases: fill.cases, verified: verify ? { by, at: new Date().toISOString() } : null };
        await writeFile(join(base, "fill.json"), JSON.stringify(saved, null, 2) + "\n");
        return send(200, "application/json", JSON.stringify({ fill: saved }));
      }
      if (req.method === "PUT" && req.url === "/api/truth") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { truth, verify } = JSON.parse(body) as { truth: Truth; verify: boolean };
        const problems = problemsIn(truth, verify);
        if (problems.length > 0) return send(422, "application/json", JSON.stringify({ problems }));
        truth.id = id;
        truth.verified = verify ? { by, at: new Date().toISOString() } : null;
        await writeFile(join(base, "truth.json"), JSON.stringify(truth, null, 2) + "\n");
        return send(200, "application/json", JSON.stringify({ truth }));
      }
      send(404, "text/plain", "not found");
    } catch (cause) {
      send(500, "text/plain", String(cause));
    }
  });

  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  console.log(`review ${id}: http://127.0.0.1:${port}/  (Ctrl+C to stop)`);
}

