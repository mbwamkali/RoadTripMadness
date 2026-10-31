import type { LatLng } from './geo';
import type { RawRoute, RawStep } from './route';
import { makeRng } from '../game/rng';

/**
 * A made-up desert highway used when the map services can't be reached
 * (offline, blocked network) and for the "Quick demo" button.
 */
export function demoRawRoute(seed = 7): RawRoute {
  const rng = makeRng(seed);
  const start: LatLng = { lat: 35.0, lng: -115.0 };
  const coords: LatLng[] = [start];
  const steps: RawStep[] = [];
  const towns = ['Dustwater', 'Coyote Flats', 'Rustbucket Junction', 'Last Chance', 'Mesa Verde Spur', 'Tumbleweed', 'Gravel Gulch', 'Sunburn'];
  let heading = 0.6; // radians, east-north-east
  let { lat, lng } = start;
  const segments = 420;
  for (let i = 1; i <= segments; i++) {
    heading += (rng() - 0.5) * 0.18;
    heading = Math.max(-0.2, Math.min(1.2, heading));
    const stepKm = 1.0;
    lat += (Math.sin(heading) * stepKm) / 111;
    lng += (Math.cos(heading) * stepKm) / (111 * Math.cos((lat * Math.PI) / 180));
    coords.push({ lat, lng });
    if (i % 45 === 0) {
      steps.push({
        location: { lat, lng },
        name: towns[(i / 45 - 1) % towns.length],
        type: 'turn',
        modifier: rng() < 0.5 ? 'left' : 'right',
      });
    }
  }
  return {
    source: 'demo',
    startLabel: 'Bone Dry, NV',
    endLabel: 'Neon Oasis, AZ',
    coords,
    realMeters: segments * 1000,
    realSeconds: segments * 40,
    steps,
    attribution: 'Demo route (made-up map)',
  };
}
