import * as THREE from 'three';
import { lit } from './materials';
import type { AnimalKind } from '../game/animals';
import { modelsWanted } from './models';

/**
 * Code-built crossing animals: a black-and-white cow and a giant armadillo,
 * head toward +z. Medium and High get the detailed versions; Low gets a
 * couple of boxes. Legs are named 'leg' so the drive view can walk them, and
 * a ring of 'stars' spins over a bumped (dazed) animal.
 */
const lam = (color: number) => lit({ color });

function part(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  g.add(m);
  return m;
}

/** A leg that swings from the hip (its pivot is at the top). */
function leg(g: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number): void {
  const pivot = new THREE.Group();
  pivot.name = 'leg';
  pivot.position.set(x, y, z);
  part(pivot, new THREE.BoxGeometry(w, h, w), mat, 0, -h / 2, 0);
  g.add(pivot);
}

function cow(detailed: boolean): THREE.Group {
  const g = new THREE.Group();
  const white = lam(0xf4f1ea);
  const black = lam(0x1d1b1a);
  if (!detailed) {
    part(g, new THREE.BoxGeometry(1.1, 1, 2.2), white, 0, 1.3, 0);
    part(g, new THREE.BoxGeometry(0.6, 0.6, 0.6), black, 0, 1.6, 1.3);
    part(g, new THREE.BoxGeometry(1, 0.8, 1.9), black, 0, 0.4, 0);
    return g;
  }
  part(g, new THREE.BoxGeometry(1.1, 1, 2.2), white, 0, 1.3, 0);
  // Black patches on both sides and the back.
  for (const [x, y, z, w, h, d] of [
    [0.56, 1.35, 0.3, 0.04, 0.6, 0.7],
    [-0.56, 1.2, -0.5, 0.04, 0.5, 0.8],
    [0.56, 1.15, -0.7, 0.04, 0.4, 0.5],
    [0.1, 1.81, -0.2, 0.6, 0.04, 0.7],
  ]) part(g, new THREE.BoxGeometry(w, h, d), black, x, y, z);
  part(g, new THREE.BoxGeometry(0.62, 0.6, 0.7), white, 0, 1.6, 1.35);
  part(g, new THREE.BoxGeometry(0.5, 0.32, 0.22), lam(0xf0a0a8), 0, 1.42, 1.78); // snout
  const eye = new THREE.MeshBasicMaterial({ color: 0x111111 });
  part(g, new THREE.BoxGeometry(0.08, 0.1, 0.04), eye, -0.18, 1.75, 1.7);
  part(g, new THREE.BoxGeometry(0.08, 0.1, 0.04), eye, 0.18, 1.75, 1.7);
  const horn = lam(0xe8dcc0);
  for (const s of [-1, 1]) {
    const hrn = part(g, new THREE.ConeGeometry(0.07, 0.3, 5), horn, s * 0.28, 2.0, 1.3);
    hrn.rotation.z = -s * 0.5;
    part(g, new THREE.BoxGeometry(0.22, 0.12, 0.08), black, s * 0.42, 1.82, 1.25); // ears
  }
  part(g, new THREE.SphereGeometry(0.18, 8, 6), lam(0xf0a0a8), 0, 0.78, -0.4); // udder
  const tail = part(g, new THREE.BoxGeometry(0.08, 0.8, 0.08), black, 0, 1.3, -1.12);
  tail.rotation.x = 0.25;
  for (const [x, z] of [
    [-0.38, 0.8],
    [0.38, 0.8],
    [-0.38, -0.8],
    [0.38, -0.8],
  ]) leg(g, 0.22, 0.85, x < 0 && z > 0 ? black : white, x, 0.85, z);
  return g;
}

function armadillo(detailed: boolean): THREE.Group {
  const g = new THREE.Group();
  const shell = lam(0xa4896a);
  const band = lam(0x7d6650);
  const skin = lam(0xc9a988);
  if (!detailed) {
    const body = part(g, new THREE.SphereGeometry(1.2, 8, 6), shell, 0, 0.9, 0);
    body.scale.set(0.8, 0.75, 1.2);
    part(g, new THREE.ConeGeometry(0.35, 0.9, 6).rotateX(Math.PI / 2), skin, 0, 0.7, 1.6);
    return g;
  }
  // A domed shell in bands, open underneath.
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const r = 1 - (t - 0.5) ** 2 * 1.4;
    const ring = part(g, new THREE.CylinderGeometry(r, r, 2.4 / bands + 0.02, 12, 1, true, -Math.PI / 2, Math.PI), i % 2 ? band : shell, 0, 0.55, -1.2 + (i + 0.5) * (2.4 / bands));
    ring.rotation.x = -Math.PI / 2; // the half that stays is the top
    ring.scale.set(1, 1, 1.05);
    (ring.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }
  part(g, new THREE.SphereGeometry(0.42, 10, 8), shell, 0, 0.75, 1.3).scale.set(1, 0.8, 1.1); // head plate
  const snout = part(g, new THREE.ConeGeometry(0.22, 0.8, 8).rotateX(Math.PI / 2), skin, 0, 0.6, 1.85);
  snout.rotation.x = 0.15;
  part(g, new THREE.SphereGeometry(0.08, 6, 4), lam(0x5a3a2a), 0, 0.55, 2.25); // nose
  for (const s of [-1, 1]) {
    const ear = part(g, new THREE.ConeGeometry(0.12, 0.35, 5), skin, s * 0.25, 1.1, 1.25);
    ear.rotation.z = -s * 0.3;
    part(g, new THREE.BoxGeometry(0.07, 0.09, 0.04), new THREE.MeshBasicMaterial({ color: 0x111111 }), s * 0.22, 0.85, 1.62);
  }
  const tail = part(g, new THREE.ConeGeometry(0.18, 1.3, 7).rotateX(-Math.PI / 2), band, 0, 0.45, -1.75);
  tail.rotation.x = 0.25;
  for (const [x, z] of [
    [-0.6, 0.75],
    [0.6, 0.75],
    [-0.6, -0.75],
    [0.6, -0.75],
  ]) leg(g, 0.26, 0.5, skin, x, 0.5, z);
  return g;
}

/** Little stars that spin over a bumped animal's head (hidden until it is bumped). */
function stars(y: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stars';
  g.position.y = y;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe14a });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    part(g, new THREE.OctahedronGeometry(0.16), mat, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
  }
  g.visible = false;
  return g;
}

export function makeAnimal(kind: AnimalKind, detailed = modelsWanted()): THREE.Group {
  const g = kind === 'cow' ? cow(detailed) : armadillo(detailed);
  g.add(stars(kind === 'cow' ? 2.5 : 1.8));
  if (kind === 'armadillo') g.scale.setScalar(1.25);
  return g;
}
