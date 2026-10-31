import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Every file in public/, as paths relative to the site root. */
function publicFiles(dir = 'public', base = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? publicFiles(path.join(dir, e.name), rel) : [rel];
  });
}

/**
 * Writes sw.js, the service worker that makes the game load and play offline.
 * It precaches the built app, the offline atlas and the classic routes.
 */
function serviceWorker(): Plugin {
  return {
    name: 'rtm-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...publicFiles()].filter((f) => f !== 'sw.js');
      const hash = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle)) hash.update(name).update(chunk.type === 'chunk' ? chunk.code : String(chunk.source));
      for (const f of publicFiles()) hash.update(f).update(fs.readFileSync(path.join('public', f)));
      const source = fs
        .readFileSync('src/offline/sw-template.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(files.map((f) => (f === './' ? f : `./${f}`))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
