/**
 * Builds the extension: the content script, the background worker and the settings page, each with
 * `core/` bundled in, plus the audio worklet.
 *
 * Output goes to `extension/dist/`, which the manifest points at and git ignores. Load the
 * `extension/` folder unpacked after running this: chrome://extensions → Developer mode → Load
 * unpacked.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("extension/dist", { recursive: true });

// The content script, the background worker (the profile's one owner) and the settings page.
for (const name of ["content", "background", "options"]) {
  await build({
    entryPoints: [`extension/src/${name}.ts`],
    bundle: true,
    format: "iife",
    target: "chrome120",
    outfile: `extension/dist/${name}.js`,
    logLevel: "info",
  });
}

// The same worklet the site serves, so the extension records exactly as the demo does.
copyFileSync("web/public/pcm-processor.js", "extension/dist/pcm-processor.js");
