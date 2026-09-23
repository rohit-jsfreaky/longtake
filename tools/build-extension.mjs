/**
 * Builds the extension: `core/` and the content script into one file, plus the audio worklet.
 *
 * Output goes to `extension/dist/`, which the manifest points at and git ignores. Load the
 * `extension/` folder unpacked after running this: chrome://extensions → Developer mode → Load
 * unpacked.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("extension/dist", { recursive: true });

await build({
  entryPoints: ["extension/src/content.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: "extension/dist/content.js",
  logLevel: "info",
});

// The same worklet the site serves, so the extension records exactly as the demo does.
copyFileSync("web/public/pcm-processor.js", "extension/dist/pcm-processor.js");
