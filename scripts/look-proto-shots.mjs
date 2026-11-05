// Screenshots of the visual target mock-up: node scripts/look-proto-shots.mjs outDir
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4183;
const OUT = process.argv[2] || 'look-out';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/look-proto.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
for (const t of (process.env.TIMES || 'day,golden').split(',')) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.error(t, e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(t, m.text()));
  await page.goto(`http://localhost:${PORT}/look-proto.html?time=${t}`);
  await page.evaluate(() => localStorage.setItem('rtm-quality', 'high'));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', null, { timeout: 300000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/target-${t}.png`, timeout: 120000 });
  await page.close();
}
await browser.close();
stop();
process.exit(0);
