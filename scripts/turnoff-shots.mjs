// Top-down and turning-in pictures of a trip's turn-offs, to check the clear zone
// (no roadside scenery next to a turn-off or on a town's ground).
//   npm run build && node scripts/turnoff-shots.mjs outDir [distDir] [count]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shots-out', DIST = 'dist', COUNT = '4'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = 4189 + Math.floor(Math.random() * 500);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { stdio: 'ignore', detached: true });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
try {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('rtm-quality', 'medium'); });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Quick demo trip' }).click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; s.hoursSpent = (s.hoursSpent || 0) + ((12 - window.rtm.hour() + 48) % 24); });
  await page.waitForTimeout(Number(process.env.LOAD_MS ?? 15000));
  const stops = await page.evaluate(() => window.rtm.state.stops.map((s, i) => ({ i, at: Math.round(s.at), kind: s.kind, side: s.side })));
  console.log(JSON.stringify(stops));
  const pick = [...stops.filter((s) => s.kind !== 'shortcut').slice(0, Number(COUNT)), ...stops.filter((s) => s.kind === 'shortcut').slice(0, 1)];
  for (const st of pick) {
    // Park just short of the turn-off, build the town, then look straight down on it.
    await page.evaluate((i) => {
      const d = window.rtm.drive;
      const stop = window.rtm.state.stops[i];
      d.followCamera = () => {};
      window.rtm.state.distance = stop.at - 40;
      d.paused = true;
      d.placeCar(true);
      d.streamChunks();
      if (stop.kind !== 'shortcut') d.ensureTown(stop);
      const p = d.path.pointAt(stop.at);
      const f = d.path.directionAt(stop.at);
      const k = stop.side === 'right' ? 1 : -1;
      const c = { x: p.x + f.y * k * 50, y: p.y - f.x * k * 50 };
      d.camera.position.set(c.x, 230, -c.y);
      d.camera.up.set(f.x, 0, -f.y);
      d.camera.lookAt(c.x, 0, -c.y);
    }, st.i);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/stop${st.i}-${st.kind}-${st.side}-top.png`, timeout: 240000 });
    // From behind the car, just before it turns in.
    await page.evaluate((i) => {
      const d = window.rtm.drive;
      const stop = window.rtm.state.stops[i];
      const p = d.path.pointAt(stop.at - 30);
      const f = d.path.directionAt(stop.at - 30);
      const k = stop.side === 'right' ? 1 : -1;
      d.camera.up.set(0, 1, 0);
      d.camera.position.set(p.x - f.x * 10 - f.y * k * 2, 9, -(p.y - f.y * 10 + f.x * k * 2));
      const q = d.path.pointAt(stop.at);
      d.camera.lookAt(q.x + f.y * k * 14, 1, -(q.y - f.x * k * 14));
    }, st.i);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/stop${st.i}-${st.kind}-${st.side}-turn.png`, timeout: 240000 });
    console.log('shot', st.i);
  }
} finally {
  await browser.close();
  stop();
}
