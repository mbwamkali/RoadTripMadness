// Screenshots of the town grocery: pulling in, a still front view by day and night,
// walking up, the door opening, and inside. For comparing the code-built storefront
// (scenes/storefront.ts) with the generated model (?shops=old).
//   npm run build && node scripts/storefront-shots.mjs outDir [new|old] [quality] [scale]
//   BASE=http://localhost:5173/ node scripts/storefront-shots.mjs ...   (a running dev server instead of a build)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shots-out', SHOPS = 'new', Q = 'high', SCALE = '1'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = 4189;
let server = null;
let BASE = process.env.BASE;
if (!BASE) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  BASE = `http://localhost:${PORT}/`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
}
const URL = BASE + (SHOPS === 'old' ? '?shops=old' : '');
const stop = () => { try { if (server) process.kill(-server.pid, 'SIGTERM'); } catch {} };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(SCALE), hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${SHOPS}-${name}.png`, timeout: 240000 });
  console.log(name, await page.evaluate(() => window.rtm.town?.phase ?? 'road'));
};
const until = async (phase, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.rtm.town?.phase)) === phase) return true;
    await page.waitForTimeout(400);
  }
  console.log('timed out waiting for', phase);
  return false;
};
const setHour = (h) => page.evaluate((h) => { const s = window.rtm.state; s.hoursSpent = (s.hoursSpent || 0) + ((h - window.rtm.hour() + 48) % 24); }, h);
/** Holds the camera still, looking at the grocery from the street (`side` metres off centre). */
const still = (dist, height, side) =>
  page.evaluate(([dist, height, side]) => {
    const t = window.rtm.town;
    const sp = t.world.spots.find((s) => s.lot.place === 'grocery');
    const c = sp.shell.getWorldPosition(new t.walker.position.constructor());
    const f = sp.facing.clone().setY(0).normalize();
    const right = new t.walker.position.constructor(-f.z, 0, f.x);
    const cam = t.host.camera;
    t.updateCamera = () => {
      cam.position.copy(c).addScaledVector(f, sp.size.z / 2 + dist).addScaledVector(right, side).setY(height);
      cam.lookAt(c.x + f.x * sp.size.z * 0.3, 2.6, c.z + f.z * sp.size.z * 0.3);
    };
  }, [dist, height, side]);
const freeCamera = () => page.evaluate(() => { delete window.rtm.town.updateCamera; });
try {
  await page.goto(URL);
  await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('rtm-quality', q); }, Q);
  await page.goto(URL);
  await page.getByRole('button', { name: 'Quick demo trip' }).click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; s.inv.fuel = 40; s.inv.cash = 60; });
  await page.waitForTimeout(Number(process.env.LOAD_MS ?? 25000));
  const st = await page.evaluate(() => {
    const s = window.rtm.state;
    const i = s.stops.findIndex((x) => x.places.includes('grocery') && x.kind !== 'shortcut');
    const at = window.rtm.stop(i >= 0 ? i : undefined);
    return { i, kind: at.kind, places: at.places, name: at.name };
  });
  console.log(JSON.stringify(st));
  await setHour(15);
  await until('street');
  await page.waitForTimeout(1000);
  const ok = await page.evaluate(() => window.rtm.visit('grocery'));
  if (!ok) throw new Error('no grocery in this town');
  await until('parked', 120000);
  await page.waitForTimeout(2500);
  await shot('1-parked');
  await still(13, 3.2, 4);
  await page.waitForTimeout(1500);
  await shot('2-front-day');
  await still(5, 1.8, 2.5);
  await page.waitForTimeout(1000);
  await shot('3-close-day');
  await freeCamera();
  await page.evaluate(() => window.rtm.town.getOut());
  await page.waitForTimeout(1500);
  await shot('4-walking');
  // Going in, from a still camera by the door: walk up, the door swings open, step through.
  await still(6.5, 2.4, -3);
  await page.evaluate(() => window.rtm.town.goIn(window.rtm.town.at));
  for (let k = 0; k < 8; k++) {
    await page.waitForTimeout(1500);
    const ph = await page.evaluate(() => window.rtm.town.phase);
    if (ph === 'inside') break;
    await shot(`5-going-in-${k}`);
  }
  await freeCamera();
  await until('inside');
  // Headless rendering is slow; give the camera time to finish gliding.
  await page.waitForTimeout(20000);
  await shot('8-inside');
  await page.evaluate(() => window.rtm.town.leaveBuilding());
  await page.waitForTimeout(4000);
  await setHour(21);
  await still(13, 3.2, 4);
  await page.waitForTimeout(2500);
  await shot('9-front-night');
} finally {
  await browser.close();
  stop();
}
process.exit(0);
