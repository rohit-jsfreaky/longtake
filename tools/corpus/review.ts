/**
 * `npm run corpus:review -- <id>` — the page where a human turns a seeded draft into the truth.
 *
 * A small local server, nothing installed: the full-page screenshot with a numbered box on every
 * field, and beside it every field of `truth.json`, editable. Saving writes the file; "Verified"
 * stamps it with who checked it. An edit after that clears the stamp — a truth nobody re-checked
 * is not verified.
 */

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import type { AxCapture, Meta, Truth } from "./types";

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
      if (verifying && !field.question.trim()) problems.push(`${field.key}: no question — what does a person read here?`);
      if (verifying && ["select", "radio", "multiselect"].includes(field.kind) && !field.options?.labels.length) {
        problems.push(`${at}: a ${field.kind} with no options`);
      }
    }
  }
  return problems;
}

function gitUser(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "reviewer";
  } catch {
    return "reviewer";
  }
}

export async function review(id: string, dir = "corpus", port = 4477): Promise<void> {
  const base = join(dir, id);
  const page = resolve(process.cwd(), "tools/corpus/review.html");
  const by = gitUser();

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
        return send(200, "application/json", JSON.stringify({ meta: meta as Meta, ax: ax as AxCapture, truth: truth as Truth, by }));
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

