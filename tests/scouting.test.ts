import { describe, expect, it, vi } from 'vitest';

// The public map server hangs: the lookup never answers.
vi.mock('../src/geo/overpass', () => ({ fetchMapFeatures: () => new Promise(() => {}) }));
// This road build has no landmark files, so planning falls back to the live lookup.
let baked: { kind: 'peak'; name: string; point: { lat: number; lng: number } }[] | null = null;
vi.mock('../src/offline/features', () => ({ loadRouteFeatures: async () => baked }));
vi.mock('../src/offline/atlas', () => ({ loadAtlas: async () => ({ featuresAlong: () => [{ kind: 'citysign', name: 'Atlas Town', point: { lat: 0, lng: 0 } }] }) }));

const { addFeatures } = await import('../src/offline/planner');

const raw = () => ({ coords: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }) as never as Parameters<typeof addFeatures>[0];

describe('landmark scouting', () => {
  it('gives up on a hanging lookup after the wait and uses the atlas', async () => {
    const r = raw();
    const t0 = Date.now();
    await addFeatures(r, () => {}, undefined, 50);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.features?.map((f) => f.name)).toEqual(['Atlas Town']);
  });

  it('lets the player skip, and hides Skip when done', async () => {
    const r = raw();
    const calls: boolean[] = [];
    await addFeatures(r, () => {}, (skip) => {
      calls.push(!!skip);
      skip?.();
    }, 60_000);
    expect(calls).toEqual([true, false]);
    expect(r.features?.length).toBe(1);
  });

  it('uses the baked landmark files when the road build has them, without asking the server', async () => {
    baked = [{ kind: 'peak', name: 'Pikes Peak', point: { lat: 0, lng: 0.5 } }];
    const r = raw();
    const calls: boolean[] = [];
    await addFeatures(r, () => {}, (skip) => calls.push(!!skip), 60_000);
    baked = null;
    expect(calls).toEqual([]);
    expect(r.features?.map((f) => f.name)).toEqual(['Pikes Peak']);
  });
});
