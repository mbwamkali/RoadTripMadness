// Screenshots of the towns: a stop seen from the road, and the stop's town view.
//   npm run build && node scripts/town-shots.mjs outDir [quality]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shots-out', Q = 'high'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = 4188;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.error('pageerror', e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('rtm-quality', q); }, Q);
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Quick demo trip').click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; });
  // Give the buildings time to load before the chunks near the stops are built.
  await page.waitForTimeout(25000);
  const stops = await page.evaluate(() => window.rtm.state.stops.filter((s) => s.kind !== 'shortcut').sort((a, b) => (b.kind === 'town') - (a.kind === 'town')).map((s) => ({ at: s.at, kind: s.kind, places: s.places })));
  console.log(JSON.stringify(stops.slice(0, 4)));
  for (const [i, st] of stops.slice(0, 2).entries()) {
    await page.evaluate((at) => { window.rtm.state.distance = at - 90; }, st.at);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const s = window.rtm.state; s.hoursSpent = (s.hoursSpent || 0) + ((12 - window.rtm.hour() + 48) % 24); });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${OUT}/road-stop-${i}.png`, timeout: 240000 });
    console.log('road', i, st.kind);
  }
  await page.evaluate(() => window.rtm.stop());
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/town.png`, timeout: 240000 });
  console.log('town');
} finally {
  await browser.close();
  stop();
}
process.exit(0);
