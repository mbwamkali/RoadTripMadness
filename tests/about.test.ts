import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CREDITS } from '../src/ui/about';

describe('about and credits', () => {
  it('credits OpenStreetMap with the ODbL and its copyright page', () => {
    const osm = CREDITS.find((c) => c.name === 'OpenStreetMap')!;
    expect(osm.licence).toMatch(/ODbL/);
    expect(osm.links.map(([, href]) => href)).toContain('https://www.openstreetmap.org/copyright');
  });
  it('lists every third party named in NOTICE, each with a licence and a link', () => {
    const notice = fs.readFileSync('NOTICE', 'utf8');
    for (const name of ['OpenStreetMap', 'Natural Earth', 'Poly Haven', 'Quaternius', 'Open-Meteo']) {
      expect(notice).toContain(name);
      const c = CREDITS.find((x) => x.name === name)!;
      expect(c.licence.length).toBeGreaterThan(0);
      expect(c.links.length).toBeGreaterThan(0);
      for (const [, href] of c.links) expect(href).toMatch(/^https:\/\//);
    }
  });
});
