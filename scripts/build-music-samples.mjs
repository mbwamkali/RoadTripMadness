/**
 * Writes the recorded instrument notes the radio songs need into public/audio/inst/<instrument>/<midi>.mp3.
 *
 * Usage: node scripts/build-music-samples.mjs <folder with FluidR3_GM *-mp3.js files>
 *
 * The notes come from the FluidR3 GM soundfont as pre-rendered by gleitz/midi-js-soundfonts
 * (https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/<instrument>-mp3.js), CC-BY 3.0.
 * Only the notes the songs actually play are kept. The drum kit (public/audio/drums, VCSL, CC0)
 * and the cat sounds (public/audio/cats, OpenGameArt) were trimmed and levelled by hand with ffmpeg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const src = process.argv[2];
if (!src) {
  console.error('Pass the folder holding the FluidR3 *-mp3.js files.');
  process.exit(1);
}
const out = await build({ entryPoints: ['src/audio/songs.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const need = new Map();
for (const s of Object.values(mod.SONGS)) for (const key of mod.notesUsed(s)) {
  const [inst, midi] = key.split(':');
  if (!need.has(inst)) need.set(inst, new Set());
  need.get(inst).add(+midi);
}
let bytes = 0;
for (const [inst, notes] of need) {
  const text = fs.readFileSync(path.join(src, `${inst}-mp3.js`), 'utf8');
  const all = Object.fromEntries([...text.matchAll(/"([A-G]b?-?\d+)":\s*"data:audio\/mp3;base64,([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const dir = path.join('public/audio/inst', inst);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const midi of notes) {
    const name = NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
    if (!all[name]) throw new Error(`${inst} has no ${name}`);
    const buf = Buffer.from(all[name], 'base64');
    fs.writeFileSync(path.join(dir, `${midi}.mp3`), buf);
    bytes += buf.length;
  }
  console.log(inst, notes.size, 'notes');
}
console.log(`${(bytes / 1024 / 1024).toFixed(1)} MB of instrument notes`);
