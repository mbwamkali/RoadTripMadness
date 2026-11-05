// Builds a hand-made model and saves it: node scripts/asset-build.mjs barn [yaw]  -> public/gen/built_barn.glb + /tmp shot
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [name = 'barn', yaw = '35', shot = `/tmp/claude-0/built_${name}.png`] = process.argv.slice(2);
const PORT = 4186;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/asset-build.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`http://localhost:${PORT}/asset-build.html?a=${name}&yaw=${yaw}`);
await page.waitForFunction(() => /^(ready|error)/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 240000 });
console.log(await page.textContent('#status'));
await page.screenshot({ path: shot });
const b64 = await page.evaluate(() => window.__glb);
if (b64) writeFileSync(`public/gen/built_${name}.glb`, Buffer.from(b64, 'base64'));
await browser.close(); stop(); process.exit(0);
