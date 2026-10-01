import * as THREE from 'three';

/**
 * A fixed set of real point lights reassigned every frame to the most
 * important light sources near the runner (street lamps, neon signs).
 *
 * Forward rendering pays per light per pixel and recompiles shaders when the
 * light count changes, so the pool size is constant; scenery just registers
 * many cheap "candidates" and only the best few become real lights.
 */

export interface LightCandidate {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

interface Slot {
  light: THREE.PointLight;
  cand: LightCandidate | null;
  fade: number;
}

export class LightPool {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private scored: { c: LightCandidate; score: number }[] = [];

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      this.group.add(light);
      this.slots.push({ light, cand: null, fade: 0 });
    }
  }

  /**
   * @param candidates all candidate lights currently streamed in
   * @param focusZ world z of the runner (lights ahead score higher)
   */
  update(candidates: Iterable<LightCandidate>, focusZ: number, dt: number): void {
    this.scored.length = 0;
    for (const c of candidates) {
      const ahead = focusZ - c.z; // > 0 = in front of the runner
      if (ahead < -10 || ahead > 70) continue;
      const score = c.intensity / (1 + Math.abs(ahead - 8) / 14);
      this.scored.push({ c, score });
    }
    this.scored.sort((a, b) => b.score - a.score);
    const wanted = new Set(this.scored.slice(0, this.slots.length).map((s) => s.c));

    // Release slots whose candidate dropped out; keep the rest stable.
    for (const s of this.slots) if (s.cand && !wanted.has(s.cand)) s.cand = null;
    const assigned = new Set(this.slots.map((s) => s.cand).filter(Boolean));
    for (const c of wanted) {
      if (assigned.has(c)) continue;
      const free = this.slots.find((s) => !s.cand);
      if (!free) break;
      free.cand = c;
      free.fade = 0;
      free.light.position.set(c.x, c.y, c.z);
      free.light.color.set(c.color);
      free.light.distance = c.distance;
    }
    for (const s of this.slots) {
      s.fade = Math.min(1, s.fade + dt * 3);
      s.light.intensity = s.cand ? s.cand.intensity * s.fade : 0;
    }
  }
}
