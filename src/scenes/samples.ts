import * as THREE from 'three';

/**
 * Sample models built in code, for the things that are still simple box shapes:
 * outlaws, alien cats, the Cat Queen, the brute and the war rig, plus traffic
 * pickups, vans, semis, motorcycles and wrecks. Flat-shaded low poly to match
 * the CC0 models. Used on Medium and High (Jared approved them 2026-11-01);
 * Low keeps the box shapes. Materials are cached and shared (marked so scene
 * clean-up leaves them alone); geometry belongs to each copy.
 *
 * Conventions match the current builders: everything faces +z, stands on y = 0,
 * and keeps the part names the animations look for (legL, armL, turret, light,
 * charge, wheel).
 */

type V3 = [number, number, number];

const mats = new Map<string, THREE.Material>();
/** Flat-shaded Lambert, shared by colour. */
function lam(color: number, emissive = 0): THREE.Material {
  const key = `l${color}-${emissive}`;
  let m = mats.get(key);
  if (!m) {
    mats.set(key, (m = new THREE.MeshLambertMaterial({ color, emissive, flatShading: true })));
    m.userData.shared = true;
  }
  return m;
}
/** Unlit colour, for lights, eyes and glows. */
function glow(color: number, opacity = 1): THREE.Material {
  const key = `g${color}-${opacity}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide });
    m.userData.shared = true;
    mats.set(key, m);
  }
  return m;
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.name = name;
  parent.add(m);
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const ball = (r: number, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 2, 8);
/** A solid of revolution from [radius, y] points. */
const lathe = (pts: [number, number][], s = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s);

/** A side profile (points as [z, y]) extruded across a width, centred on x = 0, with soft edges. */
function profile(width: number, pts: [number, number][], bevel = 0.08): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2 - bevel, 0, 0);
  return geo;
}

/** A wheel with a tyre, a rim and a hub, axle along x. */
function wheel(parent: THREE.Object3D, r: number, w: number, pos: V3, rim = 0xb8b8b8): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wheel';
  const tyre = new THREE.TorusGeometry(r * 0.78, r * 0.24, 6, 14).rotateY(Math.PI / 2);
  tyre.scale(w / (r * 0.48), 1, 1);
  add(g, tyre, lam(0x1b1b1f));
  add(g, cyl(r * 0.6, r * 0.6, w * 0.8, 10).rotateZ(Math.PI / 2), lam(rim));
  add(g, cyl(r * 0.2, r * 0.2, w * 0.95, 6).rotateZ(Math.PI / 2), lam(0x3a3a40));
  g.position.set(...pos);
  parent.add(g);
  return g;
}

/** A spoked motorcycle wheel, axle along x. */
function spokedWheel(parent: THREE.Object3D, r: number, pos: V3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wheel';
  add(g, new THREE.TorusGeometry(r * 0.82, r * 0.2, 6, 16).rotateY(Math.PI / 2), lam(0x1b1b1f));
  add(g, new THREE.TorusGeometry(r * 0.62, 0.025, 4, 16).rotateY(Math.PI / 2), lam(0xd0d0d0));
  for (let i = 0; i < 6; i++) add(g, box(0.03, r * 1.24, 0.03), lam(0xd0d0d0), [0, 0, 0], [(i / 6) * Math.PI, 0, 0]);
  add(g, cyl(0.09, 0.09, 0.22, 8).rotateZ(Math.PI / 2), lam(0x9a9a9a));
  g.position.set(...pos);
  parent.add(g);
  return g;
}

// ------------------------------------------------------------------ people

interface Rider {
  jacket: number;
  skin: number;
  pants: number;
  hat?: number;
  beard?: number;
}

/** A seated rider (feet forward, hands out to bars at z = reach). */
function rider(parent: THREE.Object3D, r: Rider, seat: V3, reach: number, barY: number): void {
  const [x, y, z] = seat;
  // Hips, thighs forward, shins down to the pegs.
  add(parent, capsule(0.17, 0.1), lam(r.pants), [x, y + 0.1, z], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) {
    add(parent, capsule(0.12, 0.42), lam(r.pants), [x + s * 0.2, y + 0.08, z + 0.3], [Math.PI / 2 - 0.2, 0, 0], s < 0 ? 'legL' : 'legR');
    add(parent, capsule(0.1, 0.38), lam(r.pants), [x + s * 0.24, y - 0.3, z + 0.55], [0.2, 0, 0]);
    add(parent, box(0.16, 0.12, 0.3), lam(0x2a1d14), [x + s * 0.24, y - 0.58, z + 0.62]);
  }
  // Torso leaning forward, in a jacket.
  const lean = 0.25;
  add(parent, capsule(0.27, 0.42), lam(r.jacket), [x, y + 0.55, z + 0.08], [lean, 0, 0]);
  add(parent, box(0.6, 0.12, 0.38), lam(r.jacket), [x, y + 0.86, z + 0.15], [lean, 0, 0]); // shoulders
  // Arms out to the bars.
  for (const s of [-1, 1]) {
    const from = new THREE.Vector3(x + s * 0.32, y + 0.82, z + 0.14);
    const to = new THREE.Vector3(x + s * 0.42, barY, reach);
    const mid = from.clone().lerp(to, 0.5);
    const len = from.distanceTo(to);
    const arm = add(parent, capsule(0.09, len - 0.15), lam(r.jacket), [mid.x, mid.y, mid.z], [0, 0, 0], s < 0 ? 'armL' : 'armR');
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    add(parent, ball(0.09, 6, 4), lam(r.skin), [to.x, to.y, to.z]);
  }
  // Head, beard, bandana and hat.
  const hy = y + 1.12;
  const hz = z + 0.26;
  add(parent, cyl(0.09, 0.1, 0.12, 6), lam(r.skin), [x, hy - 0.16, hz - 0.04]);
  add(parent, ball(0.2, 8, 6), lam(r.skin), [x, hy, hz]);
  if (r.beard !== undefined) add(parent, cone(0.16, 0.26, 6), lam(r.beard), [x, hy - 0.16, hz + 0.08], [Math.PI, 0, 0]);
  add(parent, box(0.36, 0.06, 0.06), lam(0x111111), [x, hy + 0.04, hz + 0.18]); // shades
  if (r.hat !== undefined) {
    add(parent, lathe([[0, 0], [0.42, 0.0], [0.44, 0.04], [0.22, 0.05], [0.2, 0.22], [0.12, 0.26], [0, 0.25]], 10), lam(r.hat), [x, hy + 0.12, hz]);
  }
}

// ------------------------------------------------------------------ vehicles

/** A chopper motorcycle facing +z, about 2.4 long. With a rider when given one. */
export function sampleMotorcycle(paint = 0x1f1f24, who?: Rider): THREE.Group {
  const g = new THREE.Group();
  const chrome = lam(0xd6d6d6);
  spokedWheel(g, 0.42, [0, 0.42, 0.95]);
  spokedWheel(g, 0.44, [0, 0.44, -0.85]);
  // Frame: backbone, down tube and swing arm.
  add(g, cyl(0.05, 0.05, 1.4, 6), lam(0x222226), [0, 0.78, 0.05], [Math.PI / 2 - 0.1, 0, 0]);
  add(g, cyl(0.05, 0.05, 0.75, 6), lam(0x222226), [0, 0.5, 0.42], [0.5, 0, 0]);
  for (const s of [-1, 1]) add(g, cyl(0.035, 0.035, 0.9, 6), chrome, [s * 0.12, 0.47, -0.45], [Math.PI / 2 + 0.1, 0, 0]);
  // Raked forks out to the front wheel.
  for (const s of [-1, 1]) add(g, cyl(0.035, 0.035, 0.95, 6), chrome, [s * 0.1, 0.82, 0.78], [0.45, 0, 0]);
  // Teardrop tank, engine, seat, fenders.
  add(g, ball(0.25, 10, 6).scale(0.85, 0.7, 1.5), lam(paint), [0, 0.92, 0.28]);
  add(g, box(0.34, 0.32, 0.42), lam(0x5a5a60), [0, 0.52, 0.08]);
  for (const s of [-1, 1]) add(g, cyl(0.1, 0.1, 0.3, 6), chrome, [s * 0.12, 0.72, 0.08], [0, 0, s * 0.5]);
  add(g, box(0.34, 0.1, 0.62), lam(0x2a1d14), [0, 0.82, -0.28], [-0.08, 0, 0]);
  add(g, new THREE.TorusGeometry(0.47, 0.08, 4, 10, Math.PI * 0.7).rotateY(Math.PI / 2), lam(paint), [0, 0.44, -0.85], [Math.PI * 0.35, 0, 0]);
  // Exhausts down the right side.
  for (const y of [0.32, 0.44]) add(g, cyl(0.05, 0.06, 1.2, 6), chrome, [0.24, y, -0.35], [Math.PI / 2 + 0.05, 0, 0]);
  // Ape-hanger bars and a headlight.
  add(g, cyl(0.03, 0.03, 0.4, 6), chrome, [-0.2, 1.38, 1.08]);
  add(g, cyl(0.03, 0.03, 0.4, 6), chrome, [0.2, 1.38, 1.08]);
  add(g, cyl(0.03, 0.03, 0.7, 6).rotateZ(Math.PI / 2), chrome, [0, 1.58, 1.08]);
  add(g, cyl(0.12, 0.1, 0.12, 8).rotateX(Math.PI / 2), chrome, [0, 1.12, 1.22]);
  add(g, cyl(0.1, 0.1, 0.02, 8).rotateX(Math.PI / 2), glow(0xfff3c8), [0, 1.12, 1.29]);
  add(g, box(0.14, 0.08, 0.05), glow(0xc81e14), [0, 0.86, -1.22]);
  if (who) rider(g, who, [0, 0.95, -0.28], 1.08, 1.58);
  return g;
}

/** Traffic: a pickup, box van or semi facing +z, sized like the current ones. */
export function sampleTraffic(kind: 'pickup' | 'van' | 'truck', color: number): THREE.Group {
  const g = new THREE.Group();
  const paint = lam(color);
  const glass = lam(0x5f7f96, 0x0b1620);
  const dark = lam(0x1d1d22);
  const chrome = lam(0xcfcfcf);
  const lights = (front: number, back: number, y: number, x: number) => {
    for (const s of [-1, 1]) {
      add(g, box(0.34, 0.2, 0.06), glow(0xfff3c8), [s * x, y, front]);
      add(g, box(0.3, 0.26, 0.06), glow(0xc81e14), [s * x, y, back]);
    }
  };
  if (kind === 'pickup') {
    // Body with wheel arches, cab, open bed with a tailgate.
    add(g, profile(2.0, [[-2.55, 0.55], [2.55, 0.55], [2.6, 0.95], [2.5, 1.2], [1.25, 1.28], [-0.5, 1.28], [-0.5, 0.95], [-2.55, 0.95]]), paint);
    for (const s of [-1, 1]) add(g, box(0.1, 0.36, 2.05), paint, [s * 0.95, 1.12, -1.52]); // bed sides
    add(g, box(2.0, 0.36, 0.1), paint, [0, 1.12, -2.5]); // tailgate
    add(g, profile(1.9, [[1.25, 1.26], [0.75, 1.95], [-0.45, 1.95], [-0.5, 1.26]]), paint);
    add(g, profile(1.92, [[1.15, 1.32], [0.72, 1.86], [-0.38, 1.86], [-0.42, 1.32]]), glass);
    add(g, box(1.8, 0.04, 1.95), dark, [0, 0.97, -1.52]); // bed floor
    add(g, box(2.06, 0.2, 0.5), chrome, [0, 0.6, 2.55]); // bumper
    add(g, box(1.4, 0.36, 0.06), chrome, [0, 0.98, 2.6]); // grille
    add(g, box(2.06, 0.2, 0.3), chrome, [0, 0.6, -2.55]);
    for (const z of [1.6, -1.6]) for (const s of [-1, 1]) wheel(g, 0.48, 0.34, [s * 0.95, 0.48, z]);
    lights(2.6, -2.58, 1.05, 0.72);
  } else if (kind === 'van') {
    // A box van: short hood, tall box body, side mirrors.
    add(g, profile(2.05, [[-2.7, 0.5], [2.7, 0.5], [2.75, 1.1], [2.4, 1.3], [1.6, 2.3], [-2.7, 2.35]]), paint);
    add(g, profile(2.07, [[2.35, 1.38], [1.62, 2.2], [1.25, 2.2], [1.25, 1.38]]), glass);
    add(g, box(2.08, 0.1, 3.6), lam(0xffffff), [0, 1.7, -0.9]); // side stripe
    add(g, box(2.1, 0.22, 0.4), dark, [0, 0.58, 2.7]);
    add(g, box(2.1, 0.22, 0.3), dark, [0, 0.58, -2.72]);
    for (const s of [-1, 1]) add(g, box(0.1, 0.3, 0.2), dark, [s * 1.15, 1.7, 1.6]);
    for (const z of [1.75, -1.75]) for (const s of [-1, 1]) wheel(g, 0.44, 0.3, [s * 0.98, 0.44, z]);
    lights(2.76, -2.74, 0.95, 0.75);
  } else {
    // A semi: long-nose cab with a sleeper, chrome stacks and tanks, box trailer.
    const cab = new THREE.Group();
    g.add(cab);
    add(cab, profile(2.4, [[3.6, 0.8], [7.0, 0.8], [7.05, 1.6], [6.9, 2.05], [5.6, 2.2], [5.4, 3.4], [3.6, 3.5]]), paint);
    add(cab, profile(2.42, [[5.55, 2.25], [5.38, 3.2], [4.9, 3.2], [4.9, 2.25]]), glass);
    add(cab, box(1.6, 1.0, 0.08), chrome, [0, 1.45, 7.06]); // grille
    add(cab, box(2.5, 0.3, 0.4), chrome, [0, 0.85, 7.1]);
    for (const s of [-1, 1]) {
      add(cab, cyl(0.12, 0.12, 2.6, 8), chrome, [s * 1.1, 3.6, 4.3]); // stacks
      add(cab, cyl(0.32, 0.32, 1.1, 10).rotateX(Math.PI / 2), chrome, [s * 1.3, 0.9, 4.5]); // tanks
      add(cab, box(0.1, 0.4, 0.25), dark, [s * 1.3, 2.6, 5.5]); // mirrors
    }
    add(g, box(2.55, 3.1, 11.2), lam(0xe6e6e6), [0, 2.55, -1.4]);
    add(g, box(2.57, 0.4, 11.2), paint, [0, 3.3, -1.4]); // trailer band
    add(g, box(1.3, 0.35, 13), dark, [0, 0.9, -0.2]);
    for (const z of [6.2, 4.75, -4.6, -5.8]) for (const s of [-1, 1]) wheel(g, 0.5, 0.42, [s * 1.0, 0.5, z]);
    lights(7.12, -7.02, 1.05, 0.95);
    g.children.forEach((c) => (c.position.z -= 0.15));
  }
  return g;
}

/** A burnt-out wreck across the lane: a scorched sedan shell, flat tyres, smoke. */
export function sampleWreck(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Group();
  g.add(shell);
  const char = lam(0x2b2622);
  const rust = lam(0x6a3a22);
  add(shell, profile(1.85, [[-2.15, 0.35], [2.15, 0.35], [2.2, 0.75], [1.95, 0.85], [0.95, 0.95], [-1.9, 0.98], [-2.15, 0.85]]), char);
  // Caved-in roof, popped hood, empty window frames.
  add(shell, profile(1.6, [[0.9, 0.95], [0.2, 1.36], [-1.1, 1.3], [-1.5, 0.98]]), lam(0x1d1a18));
  add(shell, box(1.6, 0.06, 1.0), rust, [0, 1.05, 1.55], [-0.5, 0, 0]);
  for (const [x, z] of [[-0.6, -0.4], [0.5, 0.6], [0.2, -1.4]] as const) add(shell, box(0.5, 0.04, 0.4), rust, [x, 0.99, z], [0, x * 2, 0]);
  for (const [z, s, flat] of [[1.35, -1, true], [1.35, 1, false], [-1.35, -1, false], [-1.35, 1, true]] as const) {
    const w = wheel(shell, 0.36, 0.26, [s * 0.92, flat ? 0.28 : 0.36, z], 0x4a3a30);
    if (flat) w.scale.set(1, 0.75, 1.1);
  }
  shell.rotation.set(0, 0.55, 0.06);
  // Smouldering smoke puffs (name 'smoke' so a scene can drift them).
  for (let i = 0; i < 4; i++) {
    const puff = add(g, ball(0.3 + i * 0.12, 6, 4), glow(0x4a4744, 0.75), [0.3 - i * 0.2, 1.3 + i * 0.5, 0.9 - i * 0.3], [i, i * 2, 0], 'smoke');
    puff.renderOrder = 3;
  }
  add(g, cone(0.25, 0.6, 5), glow(0xff8a20), [0.2, 1.15, 1.2]);
  add(g, cone(0.16, 0.4, 5), glow(0xffd040), [0.2, 1.1, 1.2]);
  return g;
}

// ------------------------------------------------------------------ enemies

/** A biker outlaw on a chopper, holding a revolver. Built facing +z like the current one. */
export function sampleOutlaw(): THREE.Group {
  const g = new THREE.Group();
  const bike = sampleMotorcycle(0x6b1f1a, { jacket: 0x5a3622, skin: 0xd8a77a, pants: 0x2b3a55, hat: 0x3a2a1a, beard: 0x6b4a2a });
  g.add(bike);
  // Revolver in the right hand, pointing forward.
  add(g, box(0.07, 0.12, 0.42), lam(0x3a3a40), [0.46, 1.62, 1.2]);
  add(g, box(0.06, 0.16, 0.08), lam(0x5a3a22), [0.46, 1.52, 1.02]);
  return g;
}

/** A cat's head: round, muzzle, ears with pink insides, big eyes, whiskers. */
function catHead(parent: THREE.Object3D, fur: number, eye: number, r: number, pos: V3, stripes = 0): void {
  const [x, y, z] = pos;
  add(parent, ball(r, 10, 8).scale(1.1, 0.95, 1), lam(fur), [x, y, z]);
  add(parent, ball(r * 0.45, 8, 6).scale(1.3, 0.8, 0.9), lam(0xfff1e2), [x, y - r * 0.35, z + r * 0.72]);
  add(parent, cone(r * 0.12, r * 0.12, 3), lam(0xff8aa0), [x, y - r * 0.12, z + r * 1.0], [Math.PI, 0, 0]);
  for (const s of [-1, 1]) {
    add(parent, cone(r * 0.42, r * 0.75, 4), lam(fur), [x + s * r * 0.58, y + r * 0.88, z], [0, Math.PI / 4, s * -0.3]);
    add(parent, cone(r * 0.26, r * 0.5, 4), lam(0xff9ab0), [x + s * r * 0.56, y + r * 0.84, z + r * 0.12], [0, Math.PI / 4, s * -0.3]);
    add(parent, ball(r * 0.26, 8, 6), glow(eye), [x + s * r * 0.4, y + r * 0.15, z + r * 0.78]);
    add(parent, box(r * 0.08, r * 0.34, r * 0.05), glow(0x101010), [x + s * r * 0.4, y + r * 0.15, z + r * 1.02]);
    for (const k of [-1, 1]) add(parent, box(r * 0.9, 0.012, 0.012), lam(0xffffff), [x + s * r * 0.8, y - r * 0.3 + k * r * 0.08, z + r * 0.8], [0, 0, s * k * 0.15]);
  }
  if (stripes) for (const k of [-1, 0, 1]) add(parent, box(r * 0.12, r * 0.06, r * 0.5), lam(stripes), [x + k * r * 0.3, y + r * 0.9, z + r * 0.25], [0.3, k * 0.4, 0]);
}

/** A saucer: lathe hull, rim ring, lights (named 'light'), glass dome and a beam (named 'charge'). */
function saucer(parent: THREE.Object3D, r: number, hull: number, rim: number, nLights: number): void {
  const k = r / 2.4;
  add(parent, lathe([[0.4 * k, -0.6 * k], [1.4 * k, -0.42 * k], [2.4 * k, -0.08 * k], [2.45 * k, 0.05 * k], [2.0 * k, 0.3 * k], [1.15 * k, 0.42 * k], [0, 0.44 * k]], 24), lam(hull));
  add(parent, new THREE.TorusGeometry(2.4 * k, 0.12 * k, 4, 32).rotateX(Math.PI / 2), lam(rim));
  add(parent, cyl(0.55 * k, 0.75 * k, 0.24 * k, 12), lam(rim), [0, -0.66 * k, 0]);
  add(parent, cyl(0.45 * k, 0.45 * k, 0.04, 12), glow(0x9ff0ff), [0, -0.79 * k, 0]);
  // Own material: the fight turns these lights pink while the ship charges.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe040 });
  for (let i = 0; i < nLights; i++) {
    const a = (i / nLights) * Math.PI * 2;
    add(parent, ball(0.16 * k, 6, 4), lightMat, [Math.cos(a) * 2.18 * k, -0.06 * k, Math.sin(a) * 2.18 * k], [0, 0, 0], 'light');
  }
  const dome = add(parent, ball(1.1 * k, 16, 8).scale(1, 0.9, 1), glow(0x9ff0ff, 0.35), [0, 0.38 * k, 0]);
  dome.renderOrder = 2;
  const beam = add(parent, cone(1.3 * k, 6 * k, 16), glow(0xff40ff, 0.3), [0, -3.6 * k, 0], [0, 0, 0], 'charge');
  beam.visible = false;
}

/** An alien cat in its saucer, with a little antenna. */
export function sampleCatship(): THREE.Group {
  const g = new THREE.Group();
  saucer(g, 2.4, 0xa6aec6, 0x4f5d84, 8);
  // Tabby pilot in a space collar, sitting in the dome.
  add(g, cyl(0.42, 0.52, 0.5, 10), lam(0x3b4f8a), [0, 0.55, 0]);
  add(g, new THREE.TorusGeometry(0.42, 0.08, 4, 12).rotateX(Math.PI / 2), lam(0xffd23f), [0, 0.8, 0]);
  catHead(g, 0xff9a3c, 0x40ff60, 0.6, [0, 1.25, 0.05], 0xc8621a);
  add(g, cyl(0.02, 0.02, 0.5, 4), lam(0x9a9a9a), [0.25, 2.05, -0.05], [0, 0, -0.25]);
  add(g, ball(0.09, 6, 4), glow(0x40ff60), [0.32, 2.3, -0.05]);
  return g;
}

/** The Cat Queen's mothership: a big layered saucer, the white queen with a crown, cape and gem. */
export function sampleMothership(): THREE.Group {
  const g = new THREE.Group();
  saucer(g, 8.6, 0x8a8fb0, 0x5a3f8a, 18);
  // A second deck with glowing windows.
  add(g, lathe([[3.6, 0], [3.8, 0.35], [3.2, 0.7], [0, 0.72]], 24), lam(0x6f7396), [0, 1.2, 0]);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add(g, box(0.5, 0.22, 0.08), glow(0x9ff0ff), [Math.cos(a) * 3.72, 1.42, Math.sin(a) * 3.72], [0, -a + Math.PI / 2, 0]);
  }
  // Fins on the rim.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(g, box(0.25, 1.2, 1.8), lam(0x5a3f8a), [Math.cos(a) * 7.6, 0.6, Math.sin(a) * 7.6], [0, -a, 0]);
  }
  // The Queen: a purple cape, white fur, blue eyes, gold crown with gems.
  add(g, cyl(1.6, 2.3, 2.0, 12), lam(0x6a2a9a), [0, 2.9, 0]);
  add(g, new THREE.TorusGeometry(1.6, 0.3, 4, 14).rotateX(Math.PI / 2), lam(0xf4f0e8), [0, 3.85, 0]);
  catHead(g, 0xf4f2ee, 0x40a0ff, 2.1, [0, 5.4, 0.1]);
  const crown = new THREE.Group();
  crown.position.set(0, 7.25, 0);
  crown.scale.setScalar(1.3);
  g.add(crown);
  add(crown, cyl(0.95, 0.85, 0.4, 10), lam(0xffd23f));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(crown, cone(0.22, 0.7, 4), lam(0xffd23f), [Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85]);
    add(crown, ball(0.12, 6, 4), glow(i % 2 ? 0xff3060 : 0x40c0ff), [Math.cos(a) * 0.98, 0, Math.sin(a) * 0.98]);
  }
  add(g, cone(0.3, 0.6, 4), glow(0xff3060), [0, 3.9, 1.75], [Math.PI, 0, 0]); // gem on the collar
  return g;
}

/** The brute: a hulking zombie farmhand in overalls, swinging a stop sign. */
export function sampleBrute(): THREE.Group {
  const g = new THREE.Group();
  const skin = lam(0x8fbf5a);
  const shirt = lam(0x8a3a2a);
  const denim = lam(0x2f5f9a);
  // Legs and boots.
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = s < 0 ? 'legL' : 'legR';
    leg.position.set(s * 0.24, 0.85, 0);
    g.add(leg);
    add(leg, capsule(0.17, 0.5), denim, [0, -0.35, 0]);
    add(leg, box(0.3, 0.18, 0.44), lam(0x3b2a1e), [0, -0.78, 0.06]);
  }
  // Barrel torso, hunched forward, overall bib and straps.
  add(g, ball(0.6, 10, 8).scale(1.05, 1.0, 0.8), shirt, [0, 1.55, 0.05], [0.25, 0, 0]);
  add(g, ball(0.52, 10, 8).scale(1.0, 0.75, 0.8), denim, [0, 1.05, 0.0]);
  add(g, box(0.62, 0.5, 0.08), denim, [0, 1.45, 0.48], [0.25, 0, 0]);
  for (const s of [-1, 1]) add(g, box(0.1, 0.7, 0.06), denim, [s * 0.25, 1.85, 0.36], [0.4, 0, 0]);
  add(g, box(0.1, 0.1, 0.04), lam(0xd8d0a0), [-0.22, 1.66, 0.54]);
  add(g, box(0.1, 0.1, 0.04), lam(0xd8d0a0), [0.22, 1.66, 0.54]);
  // Small head, low on the shoulders: brow, red eyes, jaw.
  add(g, ball(0.27, 8, 6), skin, [0, 2.2, 0.32]);
  add(g, box(0.4, 0.08, 0.14), skin, [0, 2.3, 0.52]);
  for (const s of [-1, 1]) add(g, box(0.08, 0.07, 0.04), glow(0xff2020), [s * 0.11, 2.22, 0.58]);
  add(g, box(0.32, 0.12, 0.2), lam(0x6f9a46), [0, 2.03, 0.44]);
  // Huge arms on shoulder pivots (named for the wind-up animation).
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = s < 0 ? 'armL' : 'armR';
    arm.position.set(s * 0.72, 1.85, 0.1);
    g.add(arm);
    add(arm, ball(0.26, 8, 6), shirt);
    add(arm, capsule(0.18, 0.45), skin, [s * 0.06, -0.4, 0.1], [0.35, 0, s * 0.12]);
    add(arm, capsule(0.16, 0.4), skin, [s * 0.08, -0.82, 0.38], [1.0, 0, 0]);
    add(arm, ball(0.2, 7, 5), skin, [s * 0.08, -0.95, 0.62]);
    if (s > 0) {
      // The stop sign club in the right fist.
      add(arm, cyl(0.04, 0.04, 1.8, 6), lam(0x8a8a8a), [0.08, -0.4, 0.9], [Math.PI / 2 - 0.5, 0, 0]);
      add(arm, cyl(0.42, 0.42, 0.05, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8), lam(0xd13b2c), [0.08, 0.32, 1.32], [-0.5, 0, 0]);
      add(arm, cyl(0.34, 0.34, 0.06, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8), lam(0xf2f2f2), [0.08, 0.32, 1.32], [-0.5, 0, 0]).scale.set(1, 1, 0.5);
    }
  }
  return g;
}

/** The war rig: armoured semi with a plough, spikes, stacks, a turret and a skull. Faces +z. */
export function sampleWarRig(): THREE.Group {
  const g = new THREE.Group();
  const rust = lam(0x7a2a1a);
  const steel = lam(0x6a6a70);
  const dark = lam(0x222226);
  // Cab and long nose.
  add(g, profile(3.2, [[0.6, 0.9], [3.4, 0.9], [3.45, 1.9], [3.1, 2.3], [2.2, 2.4], [2.0, 3.4], [0.6, 3.5]]), rust);
  add(g, box(2.6, 0.5, 0.08), glow(0x9ff0ff), [0, 2.85, 2.08], [-0.2, 0, 0]);
  for (let i = -2; i <= 2; i++) add(g, box(0.06, 0.6, 0.1), dark, [i * 0.5, 2.85, 2.12], [-0.2, 0, 0]); // window bars
  // Plough with spikes.
  add(g, profile(3.8, [[3.4, 0.25], [4.0, 0.25], [3.6, 1.4], [3.3, 1.4]]), steel);
  for (let i = -3; i <= 3; i++) add(g, cone(0.14, 0.7, 4), lam(0xcfcfcf), [i * 0.52, 0.8, 4.05], [Math.PI / 2, 0, 0]);
  // Skull plate on the grille.
  add(g, ball(0.5, 8, 6).scale(1, 1.05, 0.5), lam(0xeeeeee), [0, 1.65, 3.5]);
  add(g, box(0.5, 0.25, 0.2), lam(0xeeeeee), [0, 1.2, 3.48]);
  for (const s of [-1, 1]) add(g, ball(0.13, 6, 4), dark, [s * 0.2, 1.72, 3.7]);
  // Stacks, spiked wheels.
  for (const s of [-1, 1]) add(g, cyl(0.16, 0.2, 2.4, 8), dark, [s * 1.4, 3.6, 1.0]);
  for (const [x, z] of [[-1.6, 2.4], [1.6, 2.4], [-1.6, -1], [1.6, -1], [-1.6, -3.5], [1.6, -3.5]] as const) {
    const w = wheel(g, 0.75, 0.55, [x, 0.75, z], 0x5a5a60);
    add(w, cone(0.12, 0.5, 4), lam(0xcfcfcf), [Math.sign(x) * 0.45, 0, 0], [0, 0, -Math.sign(x) * Math.PI / 2]);
  }
  // Armoured trailer with plates and rivets, and the turret on top.
  add(g, box(3.4, 2.5, 5.4), lam(0x5b4a3a), [0, 2.05, -2.3]);
  for (const z of [-4.4, -3.0, -1.6, -0.2]) for (const s of [-1, 1]) add(g, box(0.08, 1.8, 1.2), steel, [s * 1.73, 2.0, z]);
  // Back of the trailer (what you see in the fight): barred doors, tail lights, a spare wheel.
  add(g, box(3.0, 2.1, 0.08), steel, [0, 2.0, -5.04]);
  add(g, box(0.06, 2.1, 0.12), dark, [0, 2.0, -5.08]);
  for (const y of [1.3, 2.0, 2.7]) add(g, box(3.0, 0.12, 0.12), dark, [0, y, -5.1]);
  for (const s of [-1, 1]) add(g, box(0.4, 0.25, 0.08), glow(0xd8261a), [s * 1.35, 0.95, -5.06]);
  add(g, box(3.6, 0.3, 0.3), steel, [0, 0.7, -5.05]);
  wheel(g, 0.6, 0.4, [0.7, 2.3, -5.3], 0x5a5a60).rotation.y = Math.PI / 2;
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.set(0, 3.5, -2.5);
  g.add(turret);
  add(turret, cyl(0.7, 0.85, 0.5, 8), steel);
  add(turret, ball(0.55, 8, 4).scale(1, 0.7, 1), dark, [0, 0.3, 0]);
  for (const s of [-1, 1]) add(turret, cyl(0.1, 0.1, 1.8, 6).rotateX(Math.PI / 2), dark, [s * 0.18, 0.35, 1.0]);
  return g;
}

/** Every sample with the current shape it would replace, for the preview page. */
export const SAMPLES = {
  outlaw: sampleOutlaw,
  catship: sampleCatship,
  mothership: sampleMothership,
  brute: sampleBrute,
  warrig: sampleWarRig,
  pickup: () => sampleTraffic('pickup', 0x2f6db0),
  van: () => sampleTraffic('van', 0xe8e2d0),
  truck: () => sampleTraffic('truck', 0xc0392b),
  motorcycle: () => sampleMotorcycle(0xd9482b, { jacket: 0x222226, skin: 0xd8a77a, pants: 0x2b3a55 }),
  wreck: sampleWreck,
} as const;
