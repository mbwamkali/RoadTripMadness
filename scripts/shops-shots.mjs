// Screenshots of every code-built shop (shops.html): front by day, corner by day, front at night, inside.
//   npx vite --port 5199 &   then   node scripts/shops-shots.mjs outDir [places,comma,separated] [views]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shops-out', PLACES = 'grocery,pumps,garage,hardware,gunshop,pharmacy,police,junkyard,barn,motel', VIEWS = 'front,corner,night,inside'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5199/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
for (const place of PLACES.split(',')) {
  for (const v of VIEWS.split(',')) {
    const q = v === 'night' ? 'view=front&night=1' : `view=${v}`;
    await page.goto(`${BASE}shops.html?place=${place}&${q}`);
    await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', null, { timeout: 180000 });
    await page.screenshot({ path: `${OUT}/${place}-${v}.png` });
    console.log(place, v);
  }
}
await browser.close();
