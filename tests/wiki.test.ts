import { describe, expect, it } from 'vitest';
import { parseOverpass, wikiUrl } from '../src/geo/overpass';
import { readMoreUrl } from '../src/game/landmarks';

describe('read more about real sights', () => {
  it('turns map tags into Wikipedia links', () => {
    expect(wikiUrl({ wikipedia: 'en:Hoover Dam' })).toBe('https://en.wikipedia.org/wiki/Hoover_Dam');
    expect(wikiUrl({ wikipedia: 'de:Zugspitze' })).toBe('https://de.wikipedia.org/wiki/Zugspitze');
    expect(wikiUrl({ wikidata: 'Q12345' })).toBe('https://www.wikidata.org/wiki/Q12345');
    expect(wikiUrl({})).toBeUndefined();
    const [f] = parseOverpass({ elements: [{ type: 'node', lat: 36, lon: -114.7, tags: { historic: 'monument', name: 'Hoover Dam', wikipedia: 'en:Hoover Dam' } }] });
    expect(f.wiki).toBe('https://en.wikipedia.org/wiki/Hoover_Dam');
  });

  it('searches Wikipedia for real places without a link, and skips made-up ones', () => {
    expect(readMoreUrl({ at: 0, side: 1, offset: 9, kind: 'citysign', name: 'Barstow', real: true }, 'California')).toBe(
      'https://en.wikipedia.org/w/index.php?search=Barstow%2C%20California',
    );
    expect(readMoreUrl({ at: 0, side: 1, offset: 9, kind: 'billboard', name: 'EAT AT JOES', real: false })).toBeNull();
    expect(readMoreUrl({ at: 0, side: 1, offset: 9, kind: 'monument', name: 'Hoover Dam', real: true, wiki: 'https://x' })).toBe('https://x');
  });
});
