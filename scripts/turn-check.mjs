// Checks the turn run-up: after choosing a turn the car can still change lanes,
// the big shoot button returns in kid mode, and the "Turning…" state fits phones.
//   npm run build && node scripts/turn-check.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4181;
const OUT = process.argv[2] || 'turn-out';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
const problems = [];
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const sizes = [ { name: 'phone-xs', w: 320, h: 568 }, { name: 'phone', w: 390, h: 844 }, { name: 'small', w: 360, h: 640 }, { name: 'sideways', w: 844, h: 390 }, { name: 'land-s', w: 640, h: 360 }, { name: 'tablet', w: 768, h: 1024 } ];
for (const size of sizes) for (const kid of [false, true]) {
  const tag = `${size.name}${kid ? '-kid' : ''}`;
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => problems.push(`${tag}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((k) => { localStorage.clear(); localStorage.setItem('rtm-kid', k ? '1' : '0'); }, kid);
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('button', { name: 'Quick demo trip' }).click();
  await page.getByText(/Hit the road|Let's go|Go!/).first().click();
  await page.waitForTimeout(500);
  // Jump to just before a right-hand stop on a road with more than one lane our way.
  await page.evaluate(() => {
    const s = window.rtm.state;
    s.nextEncounterAt = 1e9; s.nextEventAt = 1e9;
    const st = s.stops.find((x) => x.at > s.distance + 400) ?? s.stops[0];
    s.distance = st.at - 300;
    window.rtm.drive.placeCar?.(true);
  });
  const turnBtn = page.locator('.prompt .btn.turn');
  try { await turnBtn.waitFor({ timeout: 8000 }); } catch { problems.push(`${tag}: no turn prompt`); await page.close(); continue; }
  await page.screenshot({ path: `${OUT}/${tag}-offer.png` });
  await turnBtn.click();
  await page.waitForSelector('.prompt.signalling');
  // Put junk ahead in the car's lane so the shoot button has a target.
  const res = await page.evaluate(() => {
    const d = window.rtm.drive;
    const before = d.playerLane;
    d.steer(-1);
    const afterLeft = d.playerLane;
    d.steer(1);
    return { before, afterLeft, back: d.playerLane, pending: !!d.pendingTurn };
  });
  if (!res.pending) problems.push(`${tag}: turn was dropped by steering`);
  if (res.afterLeft === res.before) problems.push(`${tag}: lane did not change while signalling (lane ${res.before})`);
  await page.evaluate(() => {
    const d = window.rtm.drive;
    const o = d.obstacles;
    if (o.list && o.list.push) o.list.push({ id: 99999, kind: 'debris', d: window.rtm.state.distance + 40, lane: d.playerLane, hp: 1 });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-signalling.png` });
  const boxes = await page.evaluate(() => {
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    return { prompt: vis(document.querySelector('.prompt')), cancel: vis(document.querySelector('.prompt .btn')), shoot: vis(document.querySelector('.shoot-row.show:not(.horn-row) .btn, .shoot-row.show:not(.horn-row) button')), target: !!window.rtm.drive.target, vw: innerWidth, vh: innerHeight };
  });
  const inside = (b) => b && b.l >= -1 && b.t >= -1 && b.r <= boxes.vw + 1 && b.b <= boxes.vh + 1;
  if (!inside(boxes.cancel)) problems.push(`${tag}: Cancel button off screen ${JSON.stringify(boxes.cancel)}`);
  if (kid && boxes.target && !boxes.shoot) problems.push(`${tag}: big shoot button hidden while signalling`);
  if (boxes.shoot) {
    if (!inside(boxes.shoot)) problems.push(`${tag}: shoot button off screen`);
    const c = boxes.cancel, s = boxes.shoot;
    if (c && !(s.r <= c.l || s.l >= c.r || s.b <= c.t || s.t >= c.b)) problems.push(`${tag}: shoot button overlaps Cancel`);
  }
  console.log(tag, JSON.stringify(res), 'target', boxes.target, 'shoot', !!boxes.shoot);
  await page.close();
}
await browser.close();
stop();
if (problems.length) { console.error('PROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('Turn check passed');
