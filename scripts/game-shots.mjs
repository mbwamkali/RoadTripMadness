// Screenshots of the real game on the offline demo trip, for checking the look.
//   npm run build && node scripts/game-shots.mjs outDir [hours] [quality]
// hours: comma list of clock hours to show (default 12,18.6,22); quality: low|medium|high (default high).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [OUT = 'shots-out', HOURS = '12,18.6,22', Q = 'high'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = 4187;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && console.error('console', m.text()));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('rtm-quality', q); }, Q);
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Quick demo trip').click();
  await page.getByText('Hit the road').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { const s = window.rtm.state; s.nextEncounterAt = 1e9; s.nextEventAt = 1e9; window.rtm.drive.warp = 3; });
  await page.waitForTimeout(3000);
  for (const h of HOURS.split(',').map(Number)) {
    await page.evaluate((h) => {
      const s = window.rtm.state;
      s.nextEncounterAt = 1e9; s.nextEventAt = 1e9;
      const now = ((s.live?.startHour ?? 9) + 0) % 24;
      const cur = window.rtm.hour ? window.rtm.hour() : null;
      // Move the clock by adding hours spent off the road.
      const base = cur ?? now;
      s.hoursSpent = (s.hoursSpent || 0) + ((h - base + 48) % 24);
    }, h);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/drive-${Q}-${String(h).replace('.', '_')}.png`, timeout: 240000 });
    console.log('shot', h);
  }
} finally {
  await browser.close();
  stop();
}
process.exit(0);
