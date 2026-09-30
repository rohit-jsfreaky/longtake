/**
 * A live rehearsal: the real AssemblyAI voice agent, the real site or extension, and a fake
 * microphone playing Rohit's cloned voice (longtake-video/voice/rehearsal/<scenario>.wav). Nobody
 * has to talk; every run is the same words, so a fix can be measured before and after.
 *
 *   node tools/rehearse.mjs glean  http://localhost:3000     # the site's Glean copy
 *   node tools/rehearse.mjs gform  http://localhost:3000     # the site's Google Form copy
 *   node tools/rehearse.mjs next                             # the extension on the real Google Form
 *
 * Writes the whole log to .probe/rehearse-<scenario>-<time>.json and prints a timeline.
 * Not a test: it spends real voice-agent minutes. Needs the dev server for glean/gform.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const scenario = process.argv[2] ?? "glean";
const site = process.argv[3] ?? "http://localhost:3000";
const noAutoplay = process.argv.includes("--no-autoplay");
const WAV = resolve(`../longtake-video/voice/rehearsal/${scenario}.wav`);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", WAV]).toString().trim());
const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSe9YP7zfEu01jKJ8IxIa_tjd0GaCoHv9B-nDlX351D-JRnQ9g/viewform";

const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const timeline = [];
const note = (line) => {
  timeline.push(`${at()}s  ${line}`);
  console.log(`${at()}s  ${line}`);
};

const args = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${WAV}%noloop`,
  ...(noAutoplay ? [] : ["--autoplay-policy=no-user-gesture-required"]),
];

/** Every frame worth reading, both ways — not the audio. */
function watch(page) {
  page.on("websocket", (ws) => {
    if (ws.url().includes("/_next/")) return; // the dev server's own reload socket
    note(`socket open ${ws.url().replace(/token=[^&]+/, "token=…")}`);
    const read = (dir) => (frame) => {
      let m;
      try {
        m = JSON.parse(frame.payload);
      } catch {
        return;
      }
      const type = m.type ?? "";
      if (/audio$|delta$/.test(type) || type === "input.audio") return;
      if (type === "transcript.user") note(`YOU: ${m.text}`);
      else if (type === "transcript.agent") note(`AGENT: ${m.text}`);
      else if (type === "tool.call") note(`tool.call ${m.name} ${Object.keys(m.arguments ?? {}).join(", ")}`);
      else if (type === "tool.result") {
        const r = JSON.parse(m.result ?? "{}");
        note(`tool.result ${m.call_id}: filled [${(r.just_filled ?? []).map((f) => f.field).join(", ")}] not [${(r.not_filled ?? []).map((f) => `${f.field}:${f.why}`).join(", ")}] waiting [${(r.waiting_for_yes ?? []).map((f) => f.field).join(", ")}]${r.pressed ? ` pressed=${r.pressed}` : ""}${r.next_page_loading ? " next_page_loading" : ""}${r.page_did_not_change ? " PAGE_DID_NOT_CHANGE" : ""}`);
      } else if (["session.update", "session.updated"].includes(type)) return;
      else note(`${dir} ${type}${m.status ? ` ${m.status}` : ""}${m.code ? ` ${m.code}` : ""}${m.message ? ` ${m.message}` : ""}${m.instructions ? ` "${String(m.instructions).slice(0, 90)}…"` : ""}`);
    };
    ws.on("framereceived", read("<"));
    ws.on("framesent", read(">"));
    ws.on("close", () => note("socket closed"));
  });
}

async function site_(which) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  watch(page);
  page.on("console", (m) => m.type() === "error" && note(`console error: ${m.text().slice(0, 160)}`));
  page.on("pageerror", (e) => note(`page error: ${String(e).slice(0, 160)}`));
  await page.goto(site, { waitUntil: "networkidle" });
  await page.locator("#try").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if (which === "gform") await page.getByText("Google Form, 3 pages").first().click();
  await page.waitForTimeout(3000); // the form's meanings arrive
  await page.getByText("Start talking", { exact: false }).first().click();
  note("pressed Start");
  await page.waitForTimeout((seconds + 8) * 1000);
  const log = await page.evaluate(() => (window.longtakeLog ? window.longtakeLog() : "{}"));
  const values = await page.evaluate(() =>
    [...document.querySelectorAll("#try input, #try textarea, #try select, #try [role=combobox]")]
      .map((el) => [el.getAttribute("aria-label") || el.id || el.getAttribute("name") || "", "value" in el ? el.value : el.textContent?.trim()])
      .filter(([, v]) => v && v !== "on"),
  );
  await browser.close();
  return { log, values };
}

async function extension_() {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${resolve("extension")}`, `--load-extension=${resolve("extension")}`, ...args],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  watch(page);
  page.on("framenavigated", (f) => f === page.mainFrame() && note(`page → ${f.url().slice(0, 90)}`));
  await page.goto(FORM);
  await page.waitForTimeout(2500);
  // Page 1's answers typed straight in: this run is about the Next, not the filling.
  const texts = page.locator("input[type=text], input[type=email], input:not([type])");
  const n = await texts.count();
  for (let i = 0; i < n; i++) await texts.nth(i).fill(i === 2 ? "rohit@example.com" : i === 3 ? "https://drive.google.com/demo" : "Rohit");
  await page.locator("input[type=date]").fill("2000-08-15").catch(() => {});
  for (const label of ["Male", "C1: Advanced"]) await page.getByRole("radio", { name: label }).first().click().catch(() => {});
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => (t.url ?? "").includes("docs.google.com")) ?? tabs[tabs.length - 1];
    await globalThis.longtakeToggle(tab.id);
  });
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter"); // Start has the focus
  note("pressed Start");
  await page.waitForTimeout((seconds + 8) * 1000);
  const panels = await page.locator("longtake-panel").count();
  note(`panels on the page now: ${panels}, url ${page.url().slice(0, 90)}`);
  await context.close();
  return { log: "{}", values: [] };
}

const out = scenario === "next" ? await extension_() : await site_(scenario);
mkdirSync(".probe", { recursive: true });
const file = `.probe/rehearse-${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ scenario, site, timeline, values: out.values, log: JSON.parse(out.log || "{}") }, null, 1));
console.log("\nfinal values:", JSON.stringify(out.values));
console.log(`saved ${file}`);
