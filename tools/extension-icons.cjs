/**
 * The extension's toolbar icons, drawn from the same mark as the site (web/src/components/Mark.tsx):
 * a squircle with the one-breath waveform inside, edged so it still shows on a light toolbar. Rendered by a headless browser so every size is
 * the vector redrawn, not a big PNG shrunk. Run once: `node tools/extension-icons.cjs`.
 */
const { chromium } = require("@playwright/test");
const { mkdirSync } = require("node:fs");

const SQUIRCLE = "M2 16 C2 6.2 6.2 2 16 2 C25.8 2 30 6.2 30 16 C30 25.8 25.8 30 16 30 C6.2 30 2 25.8 2 16 Z";
const BARS = [[9.5, 6], [13, 13], [16.5, 9], [20, 15], [23.5, 7]];
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
  <path d="${SQUIRCLE}" fill="#FAFAFA" stroke="#C9C9CF" stroke-width="0.8"/>
  ${BARS.map(([x, h]) => `<rect x="${x - 1}" y="${16 - h / 2}" width="2" height="${h}" rx="1" fill="#0A0A0B"/>`).join("")}
</svg>`;

(async () => {
  mkdirSync("extension/icons", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
    await page.locator("svg").screenshot({ path: `extension/icons/icon-${size}.png`, omitBackground: true });
  }
  await browser.close();
})();
