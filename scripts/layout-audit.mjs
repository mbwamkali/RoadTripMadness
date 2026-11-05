// Layout check: opens every screen and overlay at small phone, landscape and
// tablet sizes (with and without kid mode) and reports buttons that are cut
// off, need scrolling to reach, or sit on top of each other.
//
//   npm run build && npm run layout          (screenshots land in layout-out/)
//   npm run layout -- --only=pause,town      (just some screens)
//
// Exits with 1 when any button can't be reached without scrolling, so it can
// guard against screens spilling off the phone again.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4180;
const OUT = 'layout-out';
mkdirSync(OUT, { recursive: true });
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const sizesArg = (process.argv.find((a) => a.startsWith('--sizes=')) ?? '').slice(8).split(',').filter(Boolean);

const SIZES = [
  { name: 'phone-xs', width: 320, height: 568 },
  { name: 'phone-s', width: 360, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'land-s', width: 640, height: 360 },
  { name: 'land', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
].filter((s) => !sizesArg.length || sizesArg.includes(s.name));

// Screens that are long lists by design: scrolling the list is fine, but their
// main buttons must stay on screen.
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

/** Runs in the page: lists visible buttons that are off screen, hidden by a scroller, or overlapping. */
function measure() {
  const vw = innerWidth;
  const vh = innerHeight;
  const out = [];
  const label = (el) => (el.textContent || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  };
  const els = [...document.querySelectorAll('#ui button, #ui a, #ui select, #ui input, body > .update-banner')].filter(visible);
  // Only the top layer counts: a modal hides the screen under it.
  const modals = [...document.querySelectorAll('#ui .modal, #ui .scavenge')].filter(visible);
  const top = modals[modals.length - 1];
  const live = top ? els.filter((e) => top.contains(e)) : els;
  for (const el of live) {
    const r = el.getBoundingClientRect();
    const inside = r.top >= -1 && r.left >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1;
    if (inside) continue;
    const sc = scroller(el);
    // A long list may scroll; a screen's main buttons and anything on a pop-up card may not.
    const key = !!el.closest('.actions, .card-actions, .hud') || (!!el.closest('.modal, .scavenge') && !el.closest('.upgrade, .sights'));
    if (sc && !key) continue;
    const kind = !sc ? 'CUT OFF' : r.top < sc.getBoundingClientRect().top - 1 && sc.scrollTop === 0 ? 'CUT OFF (above, cannot scroll up)' : 'needs scroll';
    out.push({ kind, el: label(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
  }
  // Wider than the screen.
  const doc = document.scrollingElement;
  if (doc.scrollWidth > vw + 1) out.push({ kind: 'page wider than screen', el: `${doc.scrollWidth}px` });
  for (const el of document.querySelectorAll('#ui *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 && getComputedStyle(el).position !== 'fixed' && !el.closest('.scavenge canvas, .town3d')) {
      out.push({ kind: 'spills off right edge', el: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${label(el)}"`, rect: [Math.round(r.left), Math.round(r.right)] });
      break;
    }
  }
  // Buttons on top of each other (only ones that are on screen).
  const onScreen = live.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh;
  });
  for (let i = 0; i < onScreen.length; i++) {
    for (let j = i + 1; j < onScreen.length; j++) {
      const a = onScreen[i].getBoundingClientRect();
      const b = onScreen[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // List items scrolling under a pinned button bar are fine.
      const pinned = (e) => !!e.closest('.actions, .card-actions.sticky');
      if (pinned(onScreen[i]) !== pinned(onScreen[j])) continue;
      if (ox > 4 && oy > 4 && !onScreen[i].contains(onScreen[j]) && !onScreen[j].contains(onScreen[i])) out.push({ kind: 'buttons overlap', el: `${label(onScreen[i])} / ${label(onScreen[j])}` });
    }
  }
  // Small tap targets.
  for (const el of onScreen) {
    const r = el.getBoundingClientRect();
    if (el.tagName === 'A' || el.tagName === 'INPUT') continue;
    if (r.height < 36 || r.width < 36) out.push({ kind: 'small button', el: label(el), rect: [Math.round(r.width), Math.round(r.height)] });
  }
  return out;
}

const STEPS = [
  ['title', async (p) => p.goto(`http://localhost:${PORT}/`)],
  ['voice', async (p) => p.getByText('Narrator voice', { exact: false }).first().click()],
  ['howto', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('How to play').click())],
  ['scores', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('High scores').click())],
  ['about', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('About and credits').click())],
  ['classics', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('Classic road trips').click())],
  ['setup', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('Plan a new trip').click())],
  ['preview', async (p) => (await p.goto(`http://localhost:${PORT}/`), p.getByText('Quick demo trip').click())],
  [
    'drive',
    async (p) => {
      await p.getByText('Hit the road').click();
      await p.waitForTimeout(800);
      await p.evaluate(() => {
        const s = window.rtm.state;
        s.nextEncounterAt = 1e9;
        s.nextEventAt = 1e9;
      });
    },
  ],
  ['pause', async (p) => p.evaluate(() => window.rtm.pause())],
  ['event', async (p) => (await p.evaluate(() => document.querySelector('.modal')?.remove()), p.evaluate(() => window.rtm.roadEvent()))],
  ['bike', async (p) => (await p.evaluate(() => document.querySelector('.modal')?.remove()), p.evaluate(() => window.rtm.bikeRescue()))],
  ['town', async (p) => (await p.evaluate(() => document.querySelector('.modal')?.remove()), p.evaluate(() => void (window.auditStop = window.rtm.stop())))],
  ['town-garage', async (p) => (await p.evaluate(() => window.rtm.visit(window.auditStop.places.includes('garage') ? 'garage' : window.auditStop.places[0])), p.waitForSelector('.sheet .place', { timeout: 8000 }))],
  ['upgrades', async (p) => p.evaluate(() => window.rtm.upgrades())],
  [
    'crates',
    async (p) => {
      await p.evaluate(() => document.querySelector('.modal')?.remove());
      await p.locator('.sheet button', { hasText: /Search|Again/ }).first().click({ timeout: 8000 });
    },
  ],
  ['boss', async (p) => (await p.evaluate(() => { document.querySelector('.scavenge')?.remove(); document.querySelector('.modal')?.remove(); }), p.evaluate(() => window.rtm.boss('karen')))],
  ['fight', async (p) => (await p.evaluate(() => document.querySelector('.modal')?.remove()), p.evaluate(() => window.rtm.fight('zombie', false)))],
  ['end', async (p) => p.evaluate(() => window.rtm.end(true))],
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const report = [];
let blocking = 0;
for (const size of SIZES) {
  for (const kid of [false, true]) {
    const tag = `${size.name}${kid ? '-kid' : ''}`;
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.addInitScript((k) => {
      if (!sessionStorage.getItem('audit-init')) {
        localStorage.clear();
        localStorage.setItem('rtm-kid', k ? '1' : '0');
        localStorage.setItem('rtm-quality', 'medium');
        localStorage.setItem('rtm-swipe-hint', '1');
        localStorage.setItem('rtm-tap-hint', '1');
        sessionStorage.setItem('audit-init', '1');
      }
    }, kid);
    for (const [name, step] of STEPS) {
      try {
        await step(page);
        await page.waitForTimeout(name === 'title' ? 600 : 900);
      } catch (e) {
        console.log(`${tag} · ${name}\n  STEP FAILED: ${e.message.split('\n')[0]}`);
        report.push({ size: tag, screen: name, issues: [{ kind: 'STEP FAILED', el: e.message.split('\n')[0] }] });
        continue;
      }
      if (only.length && !only.includes(name)) continue;
      const issues = await page.evaluate(measure);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
      report.push({ size: tag, screen: name, issues });
      if (issues.length) console.log(`${tag} · ${name}\n${issues.map((i) => `  ${i.kind}: ${i.el}${i.rect ? ` ${JSON.stringify(i.rect)}` : ''}`).join('\n')}`);
      blocking += issues.filter((i) => /CUT OFF|needs scroll|overlap|spills|wider/.test(i.kind)).length;
    }
    await page.close();
  }
}
await browser.close();

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${blocking} layout problem(s) across ${report.length} screens.`);
process.exit(blocking ? 1 : 0);
