// Screenshots of a walkable town: turning in, pulling in at the gas station,
// filling up, walking into a shop, the dollhouse search, zombies on the street.
//   npm run build && node scripts/town-shots.mjs outDir [quality] [scale]
//   BASE=http://localhost:5173/ node scripts/town-shots.mjs ...   (a running dev server instead of a build)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shots-out', Q = 'medium', SCALE = '1'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = 4188;
let server = null;
let BASE = process.env.BASE;
if (!BASE) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  BASE = `http://localhost:${PORT}/`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
}
const stop = () => { try { if (server) process.kill(-server.pid, 'SIGTERM'); } catch {} };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(SCALE), hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 });
  console.log(name, await page.evaluate(() => window.rtm.town?.phase ?? 'road'));
};
/** Waits (game time is real time) until the town reaches a phase. */
const until = async (phase, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.rtm.town?.phase)) === phase) return true;
    await page.waitForTimeout(400);
  }
  console.log('timed out waiting for', phase);
  return false;
};
try {
  await page.goto(BASE);
  await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('rtm-quality', q); }, Q);
  await page.goto(BASE);
  await page.getByText('Quick demo trip').click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; s.inv.fuel = 4; s.inv.cash = 60; });
  // Give the buildings and people time to load before the town is built.
  await page.waitForTimeout(Number(process.env.LOAD_MS ?? 20000));
  const st = await page.evaluate(() => {
    const s = window.rtm.state;
    const i = s.stops.findIndex((x) => x.places.includes('pumps') && x.places.length >= 3 && x.kind !== 'shortcut');
    const at = window.rtm.stop(i >= 0 ? i : undefined);
    // Midday, so the pictures are easy to judge.
    s.hoursSpent = (s.hoursSpent || 0) + ((12 - window.rtm.hour() + 48) % 24);
    return { kind: at.kind, places: at.places, name: at.name };
  });
  console.log(JSON.stringify(st));
  await page.waitForTimeout(700);
  await shot('town-1-turning');
  await until('street');
  await page.waitForTimeout(1200);
  await shot('town-2-main-street');
  await page.evaluate(() => window.rtm.visit('pumps'));
  await until('parked');
  await page.waitForTimeout(1500);
  await shot('town-3-at-pumps');
  await page.evaluate(() => window.rtm.town.fillUp());
  await page.waitForTimeout(2500);
  await shot('town-4-filling');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.rtm.town.backToCar());
  await until('parked');
  const other = await page.evaluate(() => window.rtm.town.world.spots.find((s) => s.lot.place !== 'pumps')?.lot.place);
  await page.evaluate((p) => window.rtm.visit(p), other);
  await until('parked');
  await page.waitForTimeout(1500);
  await shot('town-5-parked-' + other);
  await page.evaluate(() => window.rtm.town.getOut());
  await page.waitForTimeout(1200);
  await shot('town-6-walking');
  await page.evaluate(() => window.rtm.town.goIn(window.rtm.town.at));
  await until('inside');
  await page.waitForTimeout(1500);
  await shot('town-7-inside');
  // Open every crate (noise brings zombies), then step out to meet them.
  await page.evaluate(() => {
    const t = window.rtm.town;
    for (let i = 0; i < t.at.crates.length; i++) t['openCrate'](i);
  });
  await page.waitForTimeout(1500);
  await shot('town-8-searched');
  await page.evaluate(() => window.rtm.town.leaveBuilding());
  await page.waitForTimeout(4000);
  await shot('town-9-zombies');
  await page.evaluate(() => window.rtm.town.backToCar(true));
  await until('parked');
  await page.evaluate(() => window.rtm.town.leave());
  await page.waitForTimeout(2500);
  await shot('town-10-leaving');
  await page.waitForTimeout(8000);
  await shot('town-11-back-on-road');
} finally {
  await browser.close();
  stop();
}
process.exit(0);
