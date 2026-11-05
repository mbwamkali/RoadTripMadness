import { COVERAGE_NOTE } from '../geo/coverage';
import { h, ui } from './dom';

/**
 * The About screen on the title menu: what the game is, who made it, where
 * trips work, and the licence and credit for everything it uses (the same
 * list as NOTICE and docs/CREDITS.md, written for players).
 */

export const REPO_URL = 'https://github.com/mbwamkali/RoadTripMadness';

export interface Credit {
  icon: string;
  name: string;
  what: string;
  licence: string;
  links: [label: string, href: string][];
}

export const CREDITS: Credit[] = [
  {
    icon: '🗺️',
    name: 'OpenStreetMap',
    what: 'Roads, towns, landmarks, gas stations, local streets and the classic road trips.',
    licence: '© OpenStreetMap contributors. The map data is available under the Open Database License (ODbL), not the game\'s licence.',
    links: [
      ['Copyright and licence', 'https://www.openstreetmap.org/copyright'],
      ['Fix the map', 'https://www.openstreetmap.org/fixthemap'],
    ],
  },
  {
    icon: '🔎',
    name: 'Nominatim and Overpass',
    what: 'Place search (Nominatim) and the streets around each end of a trip (Overpass API), free OpenStreetMap services run by volunteers.',
    licence: 'Results are OpenStreetMap data (ODbL).',
    links: [
      ['Nominatim', 'https://nominatim.org'],
      ['Overpass API', 'https://overpass-api.de'],
    ],
  },
  {
    icon: '🌎',
    name: 'Natural Earth',
    what: 'The offline highway atlas and the US state outlines.',
    licence: 'Public domain.',
    links: [['naturalearthdata.com', 'https://www.naturalearthdata.com']],
  },
  {
    icon: '🚗',
    name: 'Quaternius',
    what: 'Low-poly 3D models: cars, the zombie, trees, plants, rocks and buildings.',
    licence: 'CC0 (public domain).',
    links: [['quaternius.com', 'https://quaternius.com']],
  },
  {
    icon: '🧱',
    name: 'Poly Haven',
    what: 'Asphalt, ground and gravel textures.',
    licence: 'CC0 (public domain).',
    links: [['polyhaven.com', 'https://polyhaven.com']],
  },
  {
    icon: '🌦️',
    name: 'Open-Meteo',
    what: 'Live weather and local time at the start of a trip.',
    licence: 'CC BY 4.0.',
    links: [['open-meteo.com', 'https://open-meteo.com']],
  },
];

const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);

/** `buildLine` is the title screen's build number and Check for updates button. */
export function showAbout(back: () => void, buildLine: () => HTMLElement): void {
  ui().replaceChildren(
    h(
      'div',
      { class: 'screen about' },
      h('h2', {}, 'ℹ️ About'),
      h(
        'section',
        { class: 'about-section' },
        h('h3', {}, '🚙 Road Trip Madness'),
        h('p', {}, 'A free game by mbwamkali. Pick two real places and drive the real roads between them, with zombies, outlaws and alien cats along the way.'),
        h(
          'p',
          { class: 'muted' },
          'The code is open source under the ',
          link('Apache License 2.0', `${REPO_URL}/blob/main/LICENSE`),
          ': anyone may use, change and share it, as long as they credit mbwamkali. ',
          link('Source code on GitHub', REPO_URL),
          '.',
        ),
      ),
      h('section', { class: 'about-section' }, h('h3', {}, '📍 Where you can drive'), h('p', {}, COVERAGE_NOTE)),
      h(
        'section',
        { class: 'about-section' },
        h('h3', {}, '🙏 Credits and licences'),
        h(
          'ul',
          { class: 'about-credits' },
          ...CREDITS.map((c) =>
            h(
              'li',
              {},
              h('span', { class: 'about-icon', 'aria-hidden': 'true' }, c.icon),
              h(
                'span',
                {},
                h('b', {}, c.name),
                h('span', {}, c.what),
                h('span', { class: 'muted' }, c.licence),
                h('span', { class: 'about-links' }, ...c.links.flatMap(([l, href], i) => (i ? [' · ', link(l, href)] : [link(l, href)]))),
              ),
            ),
          ),
        ),
        h('p', { class: 'muted' }, 'Sounds are made by the game itself. Full details are in the NOTICE file with the code.'),
      ),
      h('section', { class: 'about-section' }, h('h3', {}, '🔄 Version'), buildLine()),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: back }, '← Back')),
    ),
  );
}
