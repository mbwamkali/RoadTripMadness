// Times every car move in a town (game seconds, not real seconds) and records the paths.
//   BASE=http://localhost:5173/ node scripts/town-timing.mjs out.json
// Uses the Practice Town test trip. Order: arrive, each place in turn (far first, then back),
// Main Street from the last one, then leave.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = process.argv[2] ?? 'town-timing.json';
const BASE = process.env.BASE ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.error('pageerror', e.message));
const T = () => page.evaluate(() => window.rtm.town ? window.rtm.town.time : -1);
const sample = () => page.evaluate(() => { const t = window.rtm.town; if (!t) return null; const p = t.host.car.position; return [t.time, p.x, p.z, t.phase]; });
async function track(label, start, done) {
  const t0 = await T();
  const pts = [];
  // Retry the action until it takes (a visit is refused while anything is still moving).
  for (let i = 0; i < 200; i++) {
    const ok = await page.evaluate(`(${start})()`);
    if (ok !== false) break;
    await page.waitForTimeout(100);
  }
  const w0 = Date.now();
  while (Date.now() - w0 < 180000) {
    const s = await sample();
    if (s) pts.push(s);
    if (await page.evaluate(done)) break;
    await page.waitForTimeout(60);
  }
  const t1 = await T();
  const secs = t1 >= 0 ? t1 - t0 : pts.length ? pts[pts.length - 1][0] - t0 : NaN;
  console.log(label.padEnd(28), secs.toFixed(2), 's');
  return { label, secs, pts };
}
const out = { moves: [] };
try {
  await page.goto(BASE + '?test=town&kid=0');
  await page.evaluate(() => { localStorage.setItem('rtm-quality', 'low'); });
  await page.goto(BASE + '?test=town&kid=0');
  await page.getByText('Start test').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; });
  const idx = await page.evaluate(() => window.rtm.state.stops.findIndex((x) => x.kind !== 'shortcut'));
  out.moves.push(await track('arrive', `(() => window.rtm.stop(${idx}))`, () => window.rtm.town?.phase === 'street'));
  const town = await page.evaluate(() => {
    const t = window.rtm.town;
    const P = (v) => [v.x, v.z];
    return {
      laneIn: t.laneIn.map(P), laneOut: t.laneOut.map(P),
      spots: t.world.spots.map((s) => ({ place: s.lot.place, side: s.lot.side, along: s.lot.along, park: s.park.map(P), centre: P(s.centre), door: P(s.door) })),
    };
  });
  out.town = town;
  const order = [...town.spots].sort((a, b) => b.along - a.along).map((s) => s.place);
  // Far first, then work back down the street, then the far one again (a long trip up).
  const visits = [order[0], ...order.slice(1), order[0], order[order.length - 1]];
  for (const p of visits) out.moves.push(await track('to ' + p, `(() => window.rtm.visit(${JSON.stringify(p)}))`, () => window.rtm.town?.phase === 'parked' && !window.rtm.town.busy));
  out.moves.push(await track('Main Street', '(() => (window.rtm.town.toStreet(), true))', () => window.rtm.town?.phase === 'street'));
  out.moves.push(await track('to ' + order[0] + ' from street', `(() => window.rtm.visit(${JSON.stringify(order[0])}))`, () => window.rtm.town?.phase === 'parked' && !window.rtm.town.busy));
  out.moves.push(await track('Main Street (far)', '(() => (window.rtm.town.toStreet(), true))', () => window.rtm.town?.phase === 'street'));
  out.moves.push(await track('leave', '(() => (window.rtm.town.leave(), true))', () => !window.rtm.town || window.rtm.town.phase === 'done'));
} finally {
  writeFileSync(OUT, JSON.stringify(out));
  await browser.close();
}
