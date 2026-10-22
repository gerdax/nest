// Offline developer utility. Pass the path to an available Playwright package;
// runtime serving and staging require no Node packages or build step.
// node tools/render-card-effects.mjs /absolute/path/to/node_modules/playwright
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const output = new URL('../assets/img/ui/raster-effects/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 1600 }, deviceScaleFactor: 2 });
  await page.goto(new URL('./card-effects.html', import.meta.url).href);
  for (const effect of ['shadow', 'edge', 'rim']) {
    await page.locator(`#${effect}`).screenshot({ path: fileURLToPath(new URL(`card-${effect}.png`, output)), omitBackground: true });
  }
} finally { await browser.close(); }
