import * as THREE from 'three';

/**
 * Emoji pictures that follow a point in the 3D world but are drawn on the
 * screen, over the game, as plain page elements. Loot popping out of a box used
 * to be a picture inside the 3D scene, where lighting, colour grading and dark
 * edges from texture filtering could leave heavy dark smudges on it. On the
 * page it always looks the same as it does in the supplies line.
 */
export class ScreenIcons {
  private layer: HTMLDivElement;
  private tmp = new THREE.Vector3();

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'screen-icons';
    // Under the game's menus and pop-ups (#ui), over the 3D view.
    const ui = document.getElementById('ui');
    if (ui) ui.before(this.layer);
    else document.body.append(this.layer);
  }

  add(emoji: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = 'screen-icon';
    el.textContent = emoji;
    el.setAttribute('aria-hidden', 'true');
    this.layer.append(el);
    return el;
  }

  /**
   * Puts the picture over a world point at the size a `size`-metre picture
   * would be at that distance. Hidden when the point is behind the camera.
   */
  place(el: HTMLElement, at: THREE.Vector3, size: number, camera: THREE.PerspectiveCamera, opacity = 1): void {
    const p = this.tmp.copy(at).project(camera);
    if (p.z > 1 || p.z < -1) {
      el.style.visibility = 'hidden';
      return;
    }
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const dist = Math.max(0.1, at.distanceTo(camera.position));
    const px = Math.min(160, (size / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * hgt);
    el.style.visibility = 'visible';
    el.style.fontSize = `${(px * 0.8).toFixed(1)}px`;
    el.style.opacity = String(opacity);
    el.style.transform = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * hgt).toFixed(1)}px) translate(-50%, -50%)`;
  }

  remove(el: HTMLElement): void {
    el.remove();
  }

  dispose(): void {
    this.layer.remove();
  }
}
