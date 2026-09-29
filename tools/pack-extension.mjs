/**
 * The extension as it ships: built, then zipped with only what Chrome loads — the manifest, the
 * bundles, the icons, the pages and the voice samples. The same file goes to the Chrome Web Store
 * and to the site (`web/public/longtake-extension.zip`), so a judge who cannot wait for the store's
 * review loads exactly what the store was sent.
 *
 *   npm run pack:extension
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

execFileSync("node", ["tools/build-extension.mjs"], { stdio: "inherit" });

const { version } = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
const out = resolve("web/public/longtake-extension.zip");
if (existsSync(out)) rmSync(out);
const parts = ["manifest.json", "dist", "icons", "voices", "options.html", "popup.html", "popup.js"];
// Windows' own tar (bsdtar) writes a real zip with forward slashes. PowerShell 5's Compress-Archive
// writes backslashes into the paths ("dist\content.js"), which other systems read as one file name.
execFileSync("C:/Windows/System32/tar.exe",["-a", "-c", "-f", out, "-C", "extension", ...parts], { stdio: "inherit" });
console.log(`Longtake ${version} → ${out}`);
