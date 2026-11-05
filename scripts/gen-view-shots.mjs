// node scripts/gen-view-shots.mjs out.png "gen/x.glb" yaw1,yaw2,...
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, model, yaws = '0', extra = ''] = process.argv.slice(2);
const PORT = 4185;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/gen-view.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let i = 0;
for (const y of yaws.split(',')) {
  const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
  await page.goto(`http://localhost:${PORT}/gen-view.html?m=${model}&yaw=${y}${extra}`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('ready'), null, { timeout: 240000 });
  console.log(await page.textContent('#status'));
  await page.screenshot({ path: out.replace('.png', `-${i++}.png`), timeout: 120000 });
  await page.close();
}
await browser.close(); stop(); process.exit(0);
