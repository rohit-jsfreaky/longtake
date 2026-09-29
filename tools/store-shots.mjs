/**
 * The Chrome Web Store screenshots (1280×800), taken from the site: headless, never a person's browser.
 *
 *   node tools/store-shots.mjs [http://localhost:3001]
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const site = process.argv[2] ?? "http://localhost:3001";
mkdirSync("docs/store", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
await page.goto(site, { waitUntil: "networkidle" });
// The dev server's own badge is not part of the product.
await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

async function at(id, file, offset = 0) {
  if (id) {
    await page.evaluate(
      ([id, offset]) => window.scrollTo(0, document.getElementById(id).getBoundingClientRect().top + window.scrollY + offset),
      [id, offset],
    );
  } else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500); // the reveals finish
  await page.screenshot({ path: `docs/store/${file}` });
  console.log(file);
}

await at(null, "1-hero.png");
await at("try", "2-demo.png", 380);
await at("extension", "3-extension.png", -60);
await at("trust", "4-trust.png", 40);
await browser.close();
