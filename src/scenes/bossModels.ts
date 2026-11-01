import * as THREE from 'three';
import { add, ball, box, capsule, cone, cyl, glow, lam, sampleTraffic } from './samples';

/**
 * Models for the round four bosses. Each has a detailed version (Medium and
 * High) and a simple one for Low. Same conventions as samples.ts: faces +z,
 * stands on y = 0, arms named armL/armR for the wind-up animation.
 */

/** The crazy hermit: skinny, ragged coat, a huge grey beard, wild hair, a sack of junk. */
export function sampleHermit(): THREE.Group {
  const g = new THREE.Group();
  const skin = lam(0xd8a77a);
  const coat = lam(0x6b5236);
  const rags = lam(0x4a3b2a);
  const beard = lam(0xd9d6cc);
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = s < 0 ? 'legL' : 'legR';
    leg.position.set(s * 0.15, 0.8, 0);
    g.add(leg);
    add(leg, capsule(0.09, 0.55), rags, [0, -0.38, 0]);
    add(leg, box(0.16, 0.08, 0.3), skin, [0, -0.76, 0.06]); // bare feet
  }
  // Long patched coat, belted with rope.
  add(g, cyl(0.3, 0.42, 1.0, 7), coat, [0, 1.15, 0]);
  add(g, cyl(0.31, 0.31, 0.06, 7), lam(0xc9b27a), [0, 1.2, 0]);
  add(g, box(0.2, 0.2, 0.04), lam(0x8a6a3a), [0.18, 0.95, 0.36]); // patch
  add(g, box(0.16, 0.14, 0.04), lam(0x3a5a6a), [-0.15, 1.35, 0.3]); // patch
  // Head: wild hair, bushy brows, wide eyes and a beard down to his belt.
  add(g, ball(0.24, 8, 6), skin, [0, 1.92, 0.04]);
  add(g, ball(0.32, 7, 5).scale(1.1, 0.8, 1), beard, [0, 2.08, -0.06]);
  for (let i = 0; i < 6; i++) add(g, cone(0.07, 0.3, 4), beard, [Math.cos(i) * 0.25, 2.2 + (i % 2) * 0.06, Math.sin(i) * 0.2 - 0.05], [Math.sin(i) * 0.8, 0, Math.cos(i) * 0.9]);
  add(g, cone(0.26, 0.85, 6), beard, [0, 1.48, 0.2], [Math.PI + 0.15, 0, 0]);
  for (const s of [-1, 1]) {
    add(g, ball(0.06, 6, 4), glow(0xffffff), [s * 0.09, 1.97, 0.24]);
    add(g, ball(0.03, 4, 3), glow(0x101010), [s * 0.09, 1.97, 0.29]);
    add(g, box(0.12, 0.04, 0.05), beard, [s * 0.1, 2.06, 0.24], [0, 0, s * 0.3]);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = s < 0 ? 'armL' : 'armR';
    arm.position.set(s * 0.36, 1.6, 0);
    g.add(arm);
    add(arm, capsule(0.08, 0.55), coat, [s * 0.04, -0.3, 0.05], [0.3, 0, s * 0.15]);
    add(arm, ball(0.08, 6, 4), skin, [s * 0.06, -0.62, 0.2]);
    if (s > 0) {
      // A toilet seat, ready to throw.
      const seat = new THREE.TorusGeometry(0.22, 0.06, 5, 10).rotateX(Math.PI / 2);
      add(arm, seat, lam(0xf2f2f2), [0.06, -0.7, 0.36], [0.6, 0, 0]);
    }
  }
  // His sack of junk on the back, with a pan sticking out.
  add(g, ball(0.38, 7, 5).scale(1, 1.1, 0.8), lam(0x9a8458), [0, 1.35, -0.42]);
  add(g, cyl(0.16, 0.16, 0.04, 8), lam(0x3a3a40), [0.1, 1.85, -0.45], [0.4, 0, 0.3]);
  add(g, box(0.05, 0.05, 0.4), lam(0x3a3a40), [0.1, 1.95, -0.25], [0.4, 0, 0.3]);
  return g;
}

/** Low graphics: the hermit as a few boxes (beard, coat, sack). */
export function simpleHermit(): THREE.Group {
  const g = new THREE.Group();
  add(g, box(0.25, 0.8, 0.25), lam(0x4a3b2a), [-0.15, 0.4, 0], [0, 0, 0], 'legL');
  add(g, box(0.25, 0.8, 0.25), lam(0x4a3b2a), [0.15, 0.4, 0], [0, 0, 0], 'legR');
  add(g, box(0.7, 1.0, 0.5), lam(0x6b5236), [0, 1.3, 0]);
  add(g, box(0.45, 0.45, 0.45), lam(0xd8a77a), [0, 2.0, 0]);
  add(g, box(0.6, 0.25, 0.6), lam(0xd9d6cc), [0, 2.3, -0.05]);
  add(g, box(0.4, 0.6, 0.15), lam(0xd9d6cc), [0, 1.6, 0.3]);
  add(g, box(0.2, 0.6, 0.2), lam(0x6b5236), [-0.5, 1.4, 0.1], [0, 0, 0], 'armL');
  add(g, box(0.2, 0.6, 0.2), lam(0x6b5236), [0.5, 1.4, 0.1], [0, 0, 0], 'armR');
  add(g, box(0.7, 0.7, 0.5), lam(0x9a8458), [0, 1.4, -0.45]);
  return g;
}

/** A pizza: crust, sauce, cheese and pepperoni. Lies flat, about 0.9 across. */
export function pizzaGeometryParts(parent: THREE.Object3D, r = 0.45): void {
  add(parent, cyl(r, r, 0.08, 12), lam(0xd9a050), [0, 0, 0]);
  add(parent, cyl(r * 0.86, r * 0.86, 0.09, 12), lam(0xf2cf55), [0, 0.01, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(parent, cyl(r * 0.16, r * 0.16, 0.1, 8), lam(0xb02a1e), [Math.cos(a) * r * 0.5, 0.02, Math.sin(a) * r * 0.5]);
  }
}

/** The angry pizza driver's car: a little red delivery car with a pizza sign on the roof. Faces +z. */
export function samplePizzaCar(): THREE.Group {
  const g = sampleTraffic('van', 0xd8261a);
  g.scale.set(0.95, 0.8, 0.8);
  const roof = new THREE.Group();
  roof.position.y = 2.45 * 0.8;
  g.add(roof);
  // The roof sign: a white box with a pizza slice on each end.
  add(roof, box(1.6, 0.55, 0.5), lam(0xffffff), [0, 0.3, -0.4]);
  add(roof, box(1.62, 0.12, 0.52), lam(0xd8261a), [0, 0.1, -0.4]);
  for (const z of [-0.67, -0.13]) {
    const slice = new THREE.Group();
    slice.position.set(0, 0.36, z);
    slice.rotation.x = Math.PI / 2;
    roof.add(slice);
    pizzaGeometryParts(slice, 0.22);
  }
  // A tall stack of pizza boxes strapped to the back.
  for (let i = 0; i < 4; i++) add(g, box(1.0, 0.16, 1.0), lam(i % 2 ? 0xe8d8b8 : 0xd8c8a0), [0, 1.0 + i * 0.17, -3.05]);
  add(g, box(1.6, 0.05, 0.3), lam(0x1d1d22), [0, 0.95, -2.95]);
  // The driver's angry face at the back window (the side we see).
  add(g, ball(0.28, 8, 6), lam(0xd8a77a), [0.45, 2.0, -0.2]);
  add(g, box(0.5, 0.12, 0.5), lam(0xd8261a), [0.45, 2.25, -0.2]); // cap
  for (const s of [-1, 1]) add(g, box(0.1, 0.03, 0.03), glow(0x101010), [0.45 + s * 0.1, 2.05, -0.47], [0, 0, s * -0.4]);
  return g;
}

/** Low graphics: the pizza car as boxes. */
export function simplePizzaCar(): THREE.Group {
  const g = new THREE.Group();
  add(g, box(2.0, 1.0, 4.2), lam(0xd8261a), [0, 0.9, 0]);
  add(g, box(1.8, 0.8, 2.4), lam(0xd8261a), [0, 1.8, -0.4]);
  add(g, box(1.7, 0.5, 0.05), lam(0x5f7f96), [0, 1.9, -1.62]);
  add(g, box(1.4, 0.5, 0.45), lam(0xffffff), [0, 2.45, -0.4]);
  add(g, box(1.0, 0.6, 0.9), lam(0xe8d8b8), [0, 1.6, -2.45]);
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]] as const) add(g, box(0.3, 0.8, 0.8), lam(0x151515), [x, 0.4, z]);
  for (const s of [-1, 1]) add(g, box(0.4, 0.25, 0.06), glow(0xc81e14), [s * 0.7, 1.0, -2.12]);
  return g;
}
