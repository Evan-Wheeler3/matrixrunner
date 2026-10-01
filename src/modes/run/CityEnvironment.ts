import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Rng } from '../../core/rng';
import { PALETTE, NEON_LIST } from '../../render/palette';
import { glowTexture, streakTexture } from '../../render/textures';
import { InstanceLayer as Layer, FLAT } from '../../render/InstanceLayer';

/**
 * Street-level city scenery, fully instanced.
 *
 * Each scenery "layer" (building bodies, window strips, neon signs, ...) is a
 * single InstancedMesh = one draw call. The track hands out chunk *slots*; a
 * slot owns a fixed range of instances in every layer, so recycling a chunk is
 * just rewriting its matrices – no allocation while running.
 */

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class CityEnvironment {
  readonly group = new THREE.Group();
  private buildings: Layer;
  private windows: Layer;
  private neon: Layer;
  private streaks: Layer;
  private pools: Layer;
  private posts: Layer;
  private lampHeads: Layer;

  constructor(readonly slots: number) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // origin at the base so scale.y = height
    const centerBox = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.PlaneGeometry(1, 1);

    const buildingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, metalness: 0.05 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: streakTexture(),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const poolMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: glowTexture(),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3034, flatShading: true, roughness: 0.6, metalness: 0.4 });

    this.buildings = new Layer(unitBox, buildingMat, 14, slots);
    this.windows = new Layer(centerBox, glow, 160, slots);
    this.neon = new Layer(centerBox, glow, 8, slots);
    this.streaks = new Layer(plane, streakMat, 14, slots);
    this.pools = new Layer(plane, poolMat, 6, slots);
    this.posts = new Layer(unitBox, postMat, 6, slots);
    this.lampHeads = new Layer(centerBox, glow, 6, slots);
    // Ground decals render after opaque geometry and never write depth.
    this.streaks.mesh.renderOrder = 1;
    this.pools.mesh.renderOrder = 1;

    for (const layer of [this.buildings, this.windows, this.neon, this.streaks, this.pools, this.posts, this.lampHeads]) {
      this.group.add(layer.mesh);
    }
  }

  /** Remove everything a slot placed. */
  clearSlot(slot: number): void {
    for (const layer of [this.buildings, this.windows, this.neon, this.streaks, this.pools, this.posts, this.lampHeads]) layer.clear(slot);
  }

  /**
   * Fill a slot with scenery for the track segment [startD, startD + length).
   * Distance d maps to world z = -d.
   */
  buildSlot(slot: number, startD: number, length: number, rng: Rng): void {
    this.clearSlot(slot);
    const { streetHalfWidth, sidewalkWidth } = CONFIG.level;
    const facadeX = streetHalfWidth + sidewalkWidth + 0.4;

    for (const side of [-1, 1]) {
      let d = startD;
      while (d < startD + length - 1) {
        const depth = Math.min(rng.range(6, 14), startD + length - d);
        const width = rng.range(8, 14);
        const height = rng.chance(0.2) ? rng.range(30, 55) : rng.range(9, 28);
        const setback = rng.range(0, 1.6);
        const innerX = facadeX + setback;
        const cx = side * (innerX + width / 2);
        const cz = -(d + depth / 2);
        const tint = rng.pick(PALETTE.building);
        this.buildings.add(slot, _p.set(cx, 0, cz), _s.set(width, height, depth - 0.3), tint);

        // Lit window bands on the street-facing facade.
        const faceX = side * (innerX - 0.03);
        for (let y = 2.2; y < height - 1; y += rng.range(2.4, 3.6)) {
          if (!rng.chance(0.55)) continue;
          const base = rng.pick(PALETTE.window);
          _c.set(base).multiplyScalar(rng.range(0.12, 0.42));
          // A floor of window panes; some dark, some lit.
          const paneH = rng.range(0.4, 0.8);
          const paneW = rng.range(0.5, 1.2);
          const pitch = paneW + rng.range(0.5, 1.2);
          for (let z = cz - depth / 2 + pitch * 0.6; z < cz + depth / 2 - paneW * 0.5; z += pitch) {
            if (rng.chance(0.35)) continue;
            this.windows.add(slot, _p.set(faceX, y, z), _s.set(0.06, paneH, paneW), _c);
          }
        }

        // Occasionally a vertical neon sign jutting out over the sidewalk,
        // with a long smeared reflection on the wet road.
        if (rng.chance(0.38)) {
          const color = rng.pick(NEON_LIST);
          const signH = rng.range(1.8, 4.5);
          const signY = rng.range(3.2, 7);
          const sz = cz + rng.range(-depth * 0.3, depth * 0.3);
          const sx = side * (innerX - 0.6);
          this.neon.add(slot, _p.set(sx, signY + signH / 2, sz), _s.set(0.18, signH, rng.range(0.7, 1.3)), color);
          _c.set(color).multiplyScalar(0.8);
          const reflX = side * (streetHalfWidth - rng.range(0.4, 2.2));
          const reflLen = rng.range(6, 12);
          this.streaks.add(slot, _p.set(reflX, 0.025, sz + reflLen * 0.3), _s.set(rng.range(0.7, 1.4), reflLen, 1), _c, FLAT);
          // Sidewalk glow pool directly under the sign.
          this.pools.add(slot, _p.set(sx, 0.17, sz), _s.set(3.5, 3.5, 1), _c.set(color).multiplyScalar(0.5), FLAT);
        }
        d += depth + rng.range(0, 1.2);
      }
    }

    // Street lamps, alternating sides every ~20 m.
    for (let i = 0; i < 2; i++) {
      const side = (Math.floor(startD / 20) + i) % 2 === 0 ? -1 : 1;
      const z = -(startD + 10 + i * 20);
      const x = side * (streetHalfWidth + 0.35);
      this.posts.add(slot, _p.set(x, 0, z), _s.set(0.14, 6.2, 0.14), 0xffffff);
      this.posts.add(slot, _p.set(x - side * 0.7, 6.1, z), _s.set(1.5, 0.1, 0.12), 0xffffff);
      const lampColor = rng.chance(0.25) ? PALETTE.neon.teal : 0xffd9a0;
      this.lampHeads.add(slot, _p.set(x - side * 1.3, 6.05, z), _s.set(0.6, 0.08, 0.3), lampColor);
      _c.set(lampColor).multiplyScalar(0.55);
      this.pools.add(slot, _p.set(x - side * 1.3, 0.03, z), _s.set(6, 6, 1), _c, FLAT);
      _c.set(lampColor).multiplyScalar(0.35);
      this.streaks.add(slot, _p.set(x - side * 1.5, 0.026, z + 4), _s.set(0.9, 9, 1), _c, FLAT);
    }
  }
}
