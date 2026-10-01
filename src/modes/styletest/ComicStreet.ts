import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Rng } from '../../core/rng';
import { PALETTE, NEON_LIST } from '../../render/palette';
import { InstanceLayer, FLAT } from '../../render/InstanceLayer';
import { comicMat, facadeMat, FX_LAYER } from '../../render/comic/comicMaterials';
import { FACADE_STYLES, facadeTexture, halftonePoolTexture, puddleTexture, signTexture } from '../../render/comic/comicTextures';
import { activePalette, onStyleChange } from '../../render/comic/ComicStyle';
import type { SceneryProvider } from '../run/Track';

/**
 * Street-level scenery in the comic style. Buildings are simple slabs whose
 * look comes entirely from drawn facade textures (window grids, brick lines,
 * shopfronts), so the 3D stays minimal and graphic. Fully instanced.
 */

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

const SIGN_WORDS: [string, number][] = [
  ['HOTEL', 0],
  ['BAR', 2],
  ['24H', 1],
  ['RAMEN', 3],
  ['LIVE', 0],
];

export class ComicStreet implements SceneryProvider {
  readonly group = new THREE.Group();
  private facades: InstanceLayer[];
  private cornices: InstanceLayer;
  private signs: InstanceLayer[];
  private posts: InstanceLayer;
  private lampHeads: InstanceLayer;
  private cones: InstanceLayer;
  private pools: InstanceLayer;
  private puddles: InstanceLayer[];
  private wires: InstanceLayer;
  private all: InstanceLayer[];
  private unsubscribe: () => void;

  constructor(slots: number) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // origin at base: scale.y = height
    const centerBox = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.PlaneGeometry(1, 1);
    // Light cone: open-ended, apex at the lamp.
    const cone = new THREE.ConeGeometry(1, 1, 10, 1, true);
    cone.translate(0, -0.5, 0);

    this.facades = FACADE_STYLES.map((name, i) => new InstanceLayer(unitBox, facadeMat(facadeTexture(name, 100 + i * 17)), 6, slots));
    this.cornices = new InstanceLayer(centerBox, comicMat(0xffffff), 14, slots);

    const neonCss = (n: number) => '#' + new THREE.Color(n).getHexString();
    this.signs = SIGN_WORDS.map(([word, ci]) => {
      const tex = signTexture(word, neonCss(NEON_LIST[ci]));
      return new InstanceLayer(centerBox, new THREE.MeshBasicMaterial({ map: tex }), 2, slots);
    });

    this.posts = new InstanceLayer(unitBox, comicMat(0x4a5155), 6, slots);
    this.lampHeads = new InstanceLayer(centerBox, new THREE.MeshBasicMaterial({ color: 0xffffff }), 3, slots);
    this.cones = new InstanceLayer(
      cone,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      3,
      slots,
    );
    const poolTex = halftonePoolTexture();
    this.pools = new InstanceLayer(plane, new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.8, depthWrite: false }), 10, slots);
    this.puddles = [0, 1, 2].map(
      (i) => new InstanceLayer(plane, new THREE.MeshBasicMaterial({ map: puddleTexture(40 + i), transparent: true, opacity: 0.9, depthWrite: false }), 3, slots),
    );
    this.wires = new InstanceLayer(centerBox, new THREE.MeshBasicMaterial({ color: 0x000000 }), 10, slots);

    // Ground decals and FX draw after solids and produce no ink lines.
    for (const l of [this.cones, this.pools, ...this.puddles, this.wires]) {
      l.mesh.layers.set(FX_LAYER);
      l.mesh.renderOrder = 1;
    }
    this.all = [...this.facades, this.cornices, ...this.signs, this.posts, this.lampHeads, this.cones, this.pools, ...this.puddles, this.wires];
    for (const l of this.all) this.group.add(l.mesh);

    const syncInk = () => (this.wires.mesh.material as THREE.MeshBasicMaterial).color.set(activePalette().ink);
    this.unsubscribe = onStyleChange(syncInk);
    syncInk();
  }

  clearSlot(slot: number): void {
    for (const l of this.all) l.clear(slot);
  }

  buildSlot(slot: number, startD: number, length: number, rng: Rng): void {
    this.clearSlot(slot);
    const { streetHalfWidth, sidewalkWidth } = CONFIG.level;
    const facadeX = streetHalfWidth + sidewalkWidth + 0.3;

    for (const side of [-1, 1]) {
      let d = startD;
      while (d < startD + length - 1) {
        const depth = Math.min(rng.range(7, 15), startD + length - d);
        const width = rng.range(8, 12);
        // Keep most buildings low-ish so the halftone sky stays in frame.
        const height = rng.chance(0.18) ? rng.range(26, 40) : rng.range(9, 22);
        const setback = rng.range(0, 1.4);
        const innerX = facadeX + setback;
        const cx = side * (innerX + width / 2);
        const cz = -(d + depth / 2);
        const layer = rng.pick(this.facades);
        layer.add(slot, _p.set(cx, 0, cz), _s.set(width, height, depth - 0.25), rng.pick(PALETTE.building));
        // Cornice slab: a strong graphic cap that reads against the sky.
        this.cornices.add(slot, _p.set(cx - side * 0.15, height + 0.25, cz), _s.set(width + 0.5, 0.5, depth + 0.1), 0xd9d3c6);

        if (rng.chance(0.4)) {
          // Neon blade sign perpendicular to the facade so it faces the camera.
          const signs = rng.pick(this.signs);
          const signH = rng.range(3, 4.6);
          const y = rng.range(4, 7.5) + signH / 2;
          const z = cz + rng.range(-depth * 0.3, depth * 0.3);
          const x = side * (innerX - 0.75);
          signs.add(slot, _p.set(x, y, z), _s.set(1.1, signH, 0.22), 0xffffff);
          // Halftone glow on the sidewalk and a colored puddle on the road reflecting it.
          const color = rng.pick(NEON_LIST);
          this.pools.add(slot, _p.set(x, 0.17, z + 0.5), _s.set(4.2, 4.2, 1), color, FLAT);
          const puddles = rng.pick(this.puddles);
          _q.setFromEuler(_e.set(-Math.PI / 2, 0, rng.range(-0.3, 0.3)));
          puddles.add(slot, _p.set(side * (streetHalfWidth - rng.range(0.6, 2.4)), 0.02, z + rng.range(1, 3)), _s.set(rng.range(1.6, 2.6), rng.range(2.4, 4), 1), color, _q);
        }
        d += depth + rng.range(0, 1);
      }
    }

    // Street lamps alternate sides every 20 m: post, arm, warm head, flat light cone, halftone pool.
    for (let i = 0; i < 2; i++) {
      const side = (Math.floor(startD / 20) + i) % 2 === 0 ? -1 : 1;
      const z = -(startD + 10 + i * 20);
      const x = side * (streetHalfWidth + 0.35);
      this.posts.add(slot, _p.set(x, 0, z), _s.set(0.16, 6.4, 0.16), 0xffffff);
      this.posts.add(slot, _p.set(x - side * 0.8, 6.3, z), _s.set(1.7, 0.12, 0.14), 0xffffff);
      const hx = x - side * 1.5;
      this.lampHeads.add(slot, _p.set(hx, 6.22, z), _s.set(0.7, 0.14, 0.34), PALETTE.window[0]);
      this.cones.add(slot, _p.set(hx, 6.15, z), _s.set(2.2, 6.15, 2.2), PALETTE.window[2]);
      this.pools.add(slot, _p.set(hx, 0.03, z), _s.set(5.5, 5.5, 1), PALETTE.window[0], FLAT);
    }

    // Sagging overhead wires across the street: thin ink strokes in the sky.
    if (rng.chance(0.7)) {
      const z = -(startD + rng.range(5, length - 5));
      const y0 = rng.range(9, 12);
      const span = (facadeX + 1) * 2;
      const segs = 5;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const sag = (t: number) => y0 - Math.sin(t * Math.PI) * 1.4;
        const x0 = -span / 2 + t0 * span;
        const x1 = -span / 2 + t1 * span;
        const ya = sag(t0);
        const yb = sag(t1);
        const len = Math.hypot(x1 - x0, yb - ya);
        _q.setFromEuler(_e.set(0, 0, Math.atan2(yb - ya, x1 - x0)));
        this.wires.add(slot, _p.set((x0 + x1) / 2, (ya + yb) / 2, z), _s.set(len + 0.05, 0.05, 0.05), 0xffffff, _q);
      }
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
