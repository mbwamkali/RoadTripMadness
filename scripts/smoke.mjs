// Smoke test: loads the built game in a phone-sized headless browser, drives
// the offline demo route for a few seconds, starts a fight, and fails on any
// page error or if the car doesn't move.
//
//   npm run build && npm run smoke            (screenshots land in smoke-out/)
//
// Needs Playwright with Chromium (npx playwright install chromium).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4179;
const OUT = 'smoke-out';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
// Kill the whole process group (npx and the vite it starts).
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  stop();
  process.exit(1);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail('preview server did not start');
}

await waitForServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Quick demo trip').click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => {
    const s = window.rtm.state;
    s.nextEncounterAt = 1e9;
    s.nextEventAt = 1e9;
    window.rtm.drive.warp = 3;
    return s.distance;
  });
  await page.waitForTimeout(4000);
  const moved = await page.evaluate(() => window.rtm.state.distance);
  await page.screenshot({ path: `${OUT}/drive.png` });
  if (!(moved > start + 20)) fail(`car did not move (${start} -> ${moved})`);

  // Force a fight and let it run.
  await page.evaluate(() => {
    const s = window.rtm.state;
    s.nextEncounterAt = s.distance + 1;
  });
  await page.waitForFunction(() => !!window.rtm.combat, null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  const enemies = await page.evaluate(() => window.rtm.combat.combat.enemies.length + window.rtm.combat.combat.queue.length);
  await page.screenshot({ path: `${OUT}/combat.png` });
  if (enemies <= 0) fail('fight started with no enemies');
} catch (e) {
  fail(e.message);
}

await browser.close();
stop();
if (errors.length) fail(`page errors:\n  ${errors.join('\n  ')}`);
console.log('Smoke test passed: drove the demo route and started a fight.');
process.exit(0);
