import * as THREE from 'three';

/**
 * Things that make it obvious you're being shot at: a thick, bright tracer you
 * can see on a phone (a plain line is one pixel wide), the red flash round the
 * screen edge, and an arrow on the edge pointing at a shooter you can't see.
 */

const TRACER_GEO = new THREE.BoxGeometry(1, 1, 1);
TRACER_GEO.userData.shared = true;

/** A glowing streak from `a` to `b`; fade it by lowering its material's opacity. */
export function tracer(a: THREE.Vector3, b: THREE.Vector3, color = 0xffc040, width = 0.22): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const m = new THREE.Mesh(TRACER_GEO, mat);
  const len = Math.max(0.01, a.distanceTo(b));
  m.position.copy(a).lerp(b, 0.5);
  m.lookAt(b);
  m.scale.set(width, width, len);
  m.renderOrder = 5;
  return m;
}

/** A bright ball where the gun went off. */
export function muzzleFlash(at: THREE.Vector3, size = 0.9): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe070, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), mat);
  m.position.copy(at);
  m.renderOrder = 5;
  return m;
}

/** The red flash round the edges of the screen when you take a hit. */
export function hurtFlash(): void {
  document.body.classList.remove('hurt');
  void document.body.offsetWidth;
  document.body.classList.add('hurt');
}

/** Short-lived effects in a scene: they fade out and are freed when done. */
export class FadingFx {
  private list: { obj: THREE.Mesh; life: number; max: number; grow: number }[] = [];
  constructor(private parent: THREE.Object3D) {}

  add(obj: THREE.Mesh, life: number, grow = 0): void {
    this.parent.add(obj);
    this.list.push({ obj, life, max: life, grow });
  }

  update(dt: number): void {
    this.list = this.list.filter((f) => {
      f.life -= dt;
      const mat = f.obj.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, f.life / f.max);
      if (f.grow) f.obj.scale.multiplyScalar(1 + f.grow * dt);
      if (f.life > 0) return true;
      this.free(f.obj);
      return false;
    });
  }

  private free(o: THREE.Mesh): void {
    this.parent.remove(o);
    (o.material as THREE.Material).dispose();
    if (!o.geometry.userData.shared) o.geometry.dispose();
  }

  dispose(): void {
    for (const f of this.list) this.free(f.obj);
    this.list = [];
  }
}

/**
 * A red 🔫 badge with an arrow on the edge of the screen, pointing at a
 * shooter who is behind you or off to the side. Hidden when the shooter is in view.
 */
export class ShooterArrow {
  private el: HTMLDivElement;
  private tmp = new THREE.Vector3();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'shot-arrow';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<span class="pointer">▲</span><span class="gun">🔫</span>';
    this.el.style.display = 'none';
    const ui = document.getElementById('ui');
    if (ui) ui.before(this.el);
    else document.body.append(this.el);
  }

  /** Points at `at` (null hides it). `urgent` makes it pulse: a shot is coming. */
  point(at: THREE.Vector3 | null, camera: THREE.Camera, urgent: boolean): void {
    if (!at) {
      this.el.style.display = 'none';
      return;
    }
    const p = this.tmp.copy(at).applyMatrix4(camera.matrixWorldInverse);
    const behind = p.z > 0;
    const ndc = this.tmp.copy(at).project(camera);
    let x = ndc.x;
    let y = ndc.y;
    if (behind) {
      x = -x;
      y = -Math.abs(y) - 1;
    }
    const inView = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.92;
    if (inView) {
      this.el.style.display = 'none';
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    // From the middle of the screen out to the edge, keeping the badge inside.
    const margin = 34;
    const dx = x * (w / 2);
    const dy = -y * (h / 2);
    const k = Math.min((w / 2 - margin) / Math.max(1e-3, Math.abs(dx)), (h / 2 - margin) / Math.max(1e-3, Math.abs(dy)));
    const sx = w / 2 + dx * k;
    const sy = h / 2 + dy * k;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    this.el.style.display = 'flex';
    this.el.classList.toggle('urgent', urgent);
    this.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -50%)`;
    (this.el.firstElementChild as HTMLElement).style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(2)}rad) translateY(-32px)`;
  }

  dispose(): void {
    this.el.remove();
  }
}
