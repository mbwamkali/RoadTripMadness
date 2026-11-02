import type { RawRoute } from '../geo/route';
import { CURATED_ROUTES, loadCuratedRoute } from '../offline/curated';
import { tripCache } from '../offline/tripCache';
import { clearUi, fmtKm, h, ui } from './dom';

/** Screens for the trips that work offline: classic routes and saved trips. */

export function showClassics(onPick: (raw: RawRoute) => void, onBack: () => void): void {
  clearUi();
  const err = h('div', { class: 'error' });
  const card = (r: (typeof CURATED_ROUTES)[number]) => {
    const btn = h('button', { class: 'btn small primary' }, 'Drive it');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        onPick(await loadCuratedRoute(r.id));
      } catch (e) {
        err.textContent = (e as Error).message;
        btn.disabled = false;
        btn.textContent = 'Drive it';
      }
    });
    return h('div', { class: 'trip' }, h('div', { class: 'trip-text' }, h('h3', {}, r.title), h('p', {}, r.blurb), h('small', {}, fmtKm(r.km))), btn);
  };
  ui().append(
    h(
      'div',
      { class: 'screen trips' },
      h('h2', {}, 'Classic road trips'),
      h('p', { class: 'muted' }, 'Real roads, built into the game. These work with no connection.'),
      h('div', { class: 'trip-list' }, ...CURATED_ROUTES.map(card)),
      err,
      h('p', { class: 'fine' }, 'Routes © OpenStreetMap contributors (ODbL), planned with the game\'s own router.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: onBack }, '← Back')),
    ),
  );
}

export function showSavedTrips(onPick: (raw: RawRoute) => void, onBack: () => void): void {
  clearUi();
  const list = h('div', { class: 'trip-list' });
  const render = () => {
    const trips = tripCache.list();
    if (!trips.length) {
      list.replaceChildren(h('p', { class: 'muted' }, 'No saved trips yet. Every route you plan is saved here so you can drive it again offline.'));
      return;
    }
    list.replaceChildren(
      ...trips.map((t) =>
        h(
          'div',
          { class: 'trip' },
          h(
            'div',
            { class: 'trip-text' },
            h('h3', {}, `${t.startLabel.split(',')[0]} → ${t.endLabel.split(',')[0]}`),
            h('small', {}, `${fmtKm(t.km)} · ${t.source === 'offline' ? 'planned offline' : 'saved'} ${new Date(t.savedAt).toLocaleDateString()}`),
          ),
          h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn small primary',
                onclick: () => {
                  const raw = tripCache.load(t.id);
                  if (raw) onPick(raw);
                  else {
                    tripCache.remove(t.id);
                    render();
                  }
                },
              },
              'Drive',
            ),
            h('button', { class: 'btn small ghost', title: 'Delete', onclick: () => (tripCache.remove(t.id), render()) }, '✕'),
          ),
        ),
      ),
    );
  };
  render();
  ui().append(
    h(
      'div',
      { class: 'screen trips' },
      h('h2', {}, 'Saved trips'),
      h('p', { class: 'muted' }, 'Routes you planned before. They work with no connection.'),
      list,
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: onBack }, '← Back')),
    ),
  );
}
