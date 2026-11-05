// Prototype screenshots: fights on the road (not part of the test suite).
//   npm run build && node scripts/road-fight-shots.mjs [outDir] [query]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4181;
const OUT = process.argv[2] || 'road-fight-out';
const QUERY = process.argv[3] || '';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const SIZES = { phone: [390, 844], 'phone-xs': [320, 568], 'land-s': [640, 360] };
const SHOTS = (process.env.SHOTS || 'outlaw,horde,warrig,drones,mothership').split(',');
const sizes = (process.env.SIZES || 'phone').split(',');
const kid = process.env.KID === '1';
const errors = [];
for (const size of sizes) {
  const [w, hh] = SIZES[size];
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: w, height: hh }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => errors.push(`${shot}: ${e.message}`));
    await page.goto(`http://localhost:${PORT}/${QUERY}`);
    await page.evaluate((k) => { localStorage.clear(); localStorage.setItem('rtm-kid', k ? '1' : '0'); localStorage.setItem('rtm-quality', 'medium'); }, kid);
    await page.goto(`http://localhost:${PORT}/${QUERY}`);
    await page.getByText('Quick demo trip').click();
    await page.getByText('Hit the road').click();
    await page.waitForTimeout(800);
    await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; s.distance += 900; });
    await page.waitForTimeout(1500);
    if (shot === 'drive') { /* just driving */ }
    else if (shot === 'outlaw') await page.evaluate(() => window.rtm.fight('outlaw', false));
    else if (shot === 'horde') await page.evaluate(() => window.rtm.fight('zombie', true));
    else if (shot === 'cats') await page.evaluate(() => window.rtm.fight('catship', false));
    else {
      await page.evaluate((b) => { window.rtm.drive.paused = true; window.rtm.bossIntro(b); }, shot);
      await page.waitForTimeout(400);
      await page.getByText('Bring it on').click();
    }
    // Headless rendering is slow: step the fight to a set time, then let a few frames draw.
    const want = Number(process.env.FIGHT_T || 10);
    await page.evaluate((t) => { const f = window.rtm.combat; while (f && f.combat.time < t && !f.done) f.update(1 / 30); }, want);
    await page.waitForTimeout(1500);
    console.log(shot, await page.evaluate(() => { const c = window.rtm.combat?.combat; return c ? JSON.stringify({ t: +c.time.toFixed(1), q: c.queue.length, e: c.enemies.slice(0, 5).map((e) => [e.type, +e.x.toFixed(1), +e.z.toFixed(1)]) }) : 'no fight'; }));
    await page.screenshot({ path: `${OUT}/${size}${kid ? '-kid' : ''}-${shot}.png` });
    await page.close();
  }
}
await browser.close();
stop();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('done');
