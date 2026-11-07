// Fast-run check: drives the demo trip on the motorcycle at top speed and
// reports the real mph, how far it got, and how long each new stretch of
// scenery took to build (more stretches per second at high speed).
//
//   npm run build && node scripts/fast-run.mjs [ride] [seconds]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4181;
const ride = process.argv[2] || 'motorcycle';
const secs = Number(process.argv[3] || 20);
// Headless graphics are slow, so drive on Low and time the scenery build on High separately.
const quality = process.argv[4] || 'low';
mkdirSync('smoke-out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(([r, q]) => { localStorage.clear(); localStorage.setItem('rtm-ride', r); localStorage.setItem('rtm-quality', q); }, [ride, quality]);
  await page.goto(`http://localhost:${PORT}/?perf=1`);
  await page.getByRole('button', { name: 'Quick demo trip' }).click();
  await page.getByText('Hit the road').click();
  await page.waitForFunction(() => window.rtm?.drive, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = window.rtm.drive;
    const s = window.rtm.state;
    s.nextEncounterAt = 1e9;
    s.nextEventAt = 1e9;
    const orig = d.buildChunk.bind(d);
    window.__builds = [];
    d.buildChunk = (k) => { const t = performance.now(); const g = orig(k); window.__builds.push(performance.now() - t); return g; };
    for (let i = 0; i < 40; i++) d.pedal(1);
  });
  await page.waitForTimeout(6000);
  {
    const before = await page.evaluate(() => ({ d: window.rtm.state.distance, t: performance.now(), n: window.__builds.length }));
    const samples = [];
    for (let i = 0; i < secs; i++) {
      await page.waitForTimeout(1000);
      samples.push(await page.evaluate(() => ({ mph: Math.round(window.rtm.drive.mph), target: window.rtm.drive.targetMph, limit: window.rtm.drive.speedLimit(), dash: document.querySelector('.speed-gauge b')?.textContent })));
    }
    const after = await page.evaluate(() => ({ d: window.rtm.state.distance, t: performance.now(), builds: window.__builds }));
    const b = after.builds.slice(before.n);
    console.log(JSON.stringify({ ride, samples: samples.filter((_, i) => i % 4 === 0), unitsPerSec: Math.round((after.d - before.d) / ((after.t - before.t) / 1000)), chunksBuilt: b.length, buildMs: b.map((x) => Math.round(x)) }, null, 1));
    await page.screenshot({ path: `smoke-out/fast-${ride}.png`, timeout: 120000 });
    // Time building a stretch of scenery ahead (CPU work that happens twice as often at 140 as at 65).
    const bench = await page.evaluate(() => {
      const d = window.rtm.drive;
      const k0 = Math.floor(window.rtm.state.distance / 400) + 8;
      const ms = [];
      for (let k = k0; k < k0 + 5; k++) { const t = performance.now(); d.buildChunk(k); ms.push(Math.round(performance.now() - t)); }
      return ms;
    });
    console.log(`scenery build ms per 400-unit stretch: ${bench.join(', ')}; at ${Math.round(140 * 38 / 65)} units/s that is one every ${(400 / (140 * 38 / 65)).toFixed(1)} s (every ${(400 / 38).toFixed(1)} s at 65)`);
  }
  console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no page errors');
} finally {
  await browser.close();
  stop();
}
