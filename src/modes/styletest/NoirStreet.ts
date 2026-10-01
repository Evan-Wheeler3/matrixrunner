import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CONFIG } from '../../config';
import { Rng } from '../../core/rng';
import { PALETTE, NEON_LIST } from '../../render/palette';
import { InstanceLayer } from '../../render/InstanceLayer';
import { litMat, facadeMat, FX_LAYER } from '../../render/look/materials';
import { FACADE_STYLES, facadeSet, signFace, shaftTexture, puffTexture } from '../../render/look/textures';
import type { LightCandidate } from '../../render/look/LightPool';
import type { SceneryProvider } from '../run/Track';

/**
 * Street-level scenery for the graphic-noir look: PBR facade slabs with real
 * relief (cornices, ledges, awnings, rooftop tanks), a second row of tall
 * towers behind for a deep skyline, neon blade signs, street lamps with light
 * shafts, props, overhead wires and ground mist. Fully instanced; each chunk
 * also registers light candidates for the LightPool.
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
  ['CLUB', 2],
];

/** Tapered lamp post with its origin at the base. */
function postGeometry(): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0.11, 0), new THREE.Vector2(0.11, 0.35), new THREE.Vector2(0.07, 0.45), new THREE.Vector2(0.055, 6.2), new THREE.Vector2(0.001, 6.25)];
  return new THREE.LatheGeometry(pts, 12);
}

function hydrantGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.14, 0), new THREE.Vector2(0.14, 0.06), new THREE.Vector2(0.1, 0.08), new THREE.Vector2(0.1, 0.5),
    new THREE.Vector2(0.13, 0.52), new THREE.Vector2(0.12, 0.58), new THREE.Vector2(0.06, 0.7), new THREE.Vector2(0.001, 0.72),
  ];
  return new THREE.LatheGeometry(pts, 12);
}

export class NoirStreet implements SceneryProvider {
  readonly group = new THREE.Group();
  private facades: InstanceLayer[];
  private towers: InstanceLayer;
  private trims: InstanceLayer;
  private awnings: InstanceLayer;
  private tanks: InstanceLayer;
  private signs: InstanceLayer[];
  private brackets: InstanceLayer;
  private posts: InstanceLayer;
  private arms: InstanceLayer;
  private lampHeads: InstanceLayer;
  private shafts: InstanceLayer;
  private hydrants: InstanceLayer;
  private bags: InstanceLayer;
  private wires: InstanceLayer;
  private all: InstanceLayer[];
  private mist: THREE.Sprite[][] = [];
  private lights: LightCandidate[][] = [];

  constructor(slots: number) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // origin at base
    const centerBox = new THREE.BoxGeometry(1, 1, 1);
    const rounded = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
    const cone = new THREE.CylinderGeometry(0.15, 1, 1, 16, 1, true);
    cone.translate(0, -0.5, 0);

    this.facades = FACADE_STYLES.map((name, i) => new InstanceLayer(unitBox, facadeMat(facadeSet(name, 100 + i * 17)), 6, slots));
    this.towers = new InstanceLayer(unitBox, facadeMat(facadeSet('office', 999)), 4, slots);
    this.trims = new InstanceLayer(centerBox, litMat(0x6f6b65, { roughness: 0.8 }), 28, slots);
    this.awnings = new InstanceLayer(centerBox, litMat(0xffffff, { roughness: 0.7, side: THREE.DoubleSide }), 6, slots);
    this.tanks = new InstanceLayer(new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0), litMat(0x3a3028, { roughness: 0.9 }), 3, slots);

    this.signs = SIGN_WORDS.map(([word, ci]) => {
      const neon = '#' + new THREE.Color(NEON_LIST[ci]).getHexString();
      const face = signFace(word, neon);
      return new InstanceLayer(
        rounded,
        litMat(0xffffff, { map: face.albedo, emissive: 0xffffff, emissiveMap: face.emissive, emissiveIntensity: 3.2, roughness: 0.35, noHatch: true }),
        2,
        slots,
      );
    });
    this.brackets = new InstanceLayer(centerBox, litMat(0x202326, { roughness: 0.4, metalness: 0.8 }), 6, slots);

    const metal = litMat(0x24282b, { roughness: 0.45, metalness: 0.75 });
    this.posts = new InstanceLayer(postGeometry(), metal, 3, slots);
    this.arms = new InstanceLayer(centerBox, metal, 3, slots);
    // Unlit + HDR instance colors (> 1) so lamp heads bloom in their own tint.
    this.lampHeads = new InstanceLayer(rounded, new THREE.MeshBasicMaterial({ color: 0xffffff }), 3, slots);
    this.shafts = new InstanceLayer(
      cone,
      new THREE.MeshBasicMaterial({ color: 0xffffff, map: shaftTexture(), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      3,
      slots,
    );
    this.hydrants = new InstanceLayer(hydrantGeometry(), litMat(0x8a1f1a, { roughness: 0.45, metalness: 0.2 }), 2, slots);
    this.bags = new InstanceLayer(new THREE.IcosahedronGeometry(0.4, 2), litMat(0x0b0c0d, { roughness: 0.18, metalness: 0.0, envMapIntensity: 1.2 }), 6, slots);
    this.wires = new InstanceLayer(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), new THREE.MeshBasicMaterial({ color: 0x050607 }), 10, slots);

    this.shafts.mesh.layers.set(FX_LAYER);
    this.shafts.mesh.renderOrder = 2;
    for (const l of [...this.facades, this.towers, this.trims, this.awnings, this.posts, this.hydrants, this.bags]) l.mesh.receiveShadow = true;
    for (const l of [this.posts, this.hydrants, this.bags, this.awnings]) l.mesh.castShadow = true;

    this.all = [...this.facades, this.towers, this.trims, this.awnings, this.tanks, ...this.signs, this.brackets, this.posts, this.arms, this.lampHeads, this.shafts, this.hydrants, this.bags, this.wires];
    for (const l of this.all) this.group.add(l.mesh);

    // Ground-hugging mist billboards (cheap "volumetric" fog), pooled per slot.
    const mistMat = new THREE.SpriteMaterial({ map: puffTexture(), color: 0x9fb8b0, transparent: true, opacity: 0.22, depthWrite: false });
    for (let s = 0; s < slots; s++) {
      const row: THREE.Sprite[] = [];
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(mistMat);
        sp.visible = false;
        sp.layers.set(FX_LAYER);
        this.group.add(sp);
        row.push(sp);
      }
      this.mist.push(row);
      this.lights.push([]);
    }
  }

  clearSlot(slot: number): void {
    for (const l of this.all) l.clear(slot);
    for (const sp of this.mist[slot]) sp.visible = false;
    this.lights[slot] = [];
  }

  /** All light candidates currently streamed in (for the LightPool). */
  *lightCandidates(): Generator<LightCandidate> {
    for (const row of this.lights) yield* row;
  }

  buildSlot(slot: number, startD: number, length: number, rng: Rng): void {
    this.clearSlot(slot);
    const { streetHalfWidth, sidewalkWidth } = CONFIG.level;
    const facadeX = streetHalfWidth + sidewalkWidth + 0.3;
    const lights = this.lights[slot];

    for (const side of [-1, 1]) {
      let d = startD;
      while (d < startD + length - 1) {
        const depth = Math.min(rng.range(7, 15), startD + length - d);
        const width = rng.range(9, 13);
        const height = rng.chance(0.25) ? rng.range(26, 44) : rng.range(12, 24);
        const setback = rng.range(0, 1.2);
        const innerX = facadeX + setback;
        const cx = side * (innerX + width / 2);
        const cz = -(d + depth / 2);
        rng.pick(this.facades).add(slot, _p.set(cx, 0, cz), _s.set(width, height, depth - 0.2), rng.pick(PALETTE.building));
        // Relief: roof cornice, ground-floor ledge.
        this.trims.add(slot, _p.set(cx - side * 0.2, height + 0.2, cz), _s.set(width + 0.6, 0.4, depth + 0.1), 0xffffff);
        this.trims.add(slot, _p.set(side * (innerX - 0.12) + side * width * 0.0, 4.25, cz), _s.set(0.35, 0.22, depth - 0.3), 0xffffff);
        if (rng.chance(0.3)) this.tanks.add(slot, _p.set(cx + rng.range(-2, 2), height + 0.4, cz + rng.range(-2, 2)), _s.set(1.1, 2.2, 1.1), 0xffffff);
        if (rng.chance(0.45)) {
          // Fabric awning over the sidewalk.
          _q.setFromEuler(_e.set(0, 0, side * 0.32));
          this.awnings.add(slot, _p.set(side * (innerX - 0.8), 3.55, cz), _s.set(1.7, 0.05, depth * rng.range(0.4, 0.7)), rng.pick([0x5a1f22, 0x1f3f3a, 0x3a3020, 0x252a35]), _q);
        }
        if (rng.chance(0.45)) {
          // Neon blade sign perpendicular to the facade.
          const ci = rng.int(0, this.signs.length - 1);
          const signH = rng.range(3, 4.4);
          const y = rng.range(4.8, 7.5) + signH / 2;
          const z = cz + rng.range(-depth * 0.3, depth * 0.3);
          const x = side * (innerX - 0.8);
          this.signs[ci].add(slot, _p.set(x, y, z), _s.set(0.9, signH, 0.2), 0xffffff);
          this.brackets.add(slot, _p.set(side * (innerX - 0.35), y + signH * 0.4, z), _s.set(0.7, 0.06, 0.06), 0xffffff);
          this.brackets.add(slot, _p.set(side * (innerX - 0.35), y - signH * 0.4, z), _s.set(0.7, 0.06, 0.06), 0xffffff);
          lights.push({ x: x - side * 0.6, y: y - 0.5, z, color: NEON_LIST[SIGN_WORDS[ci][1]], intensity: 9, distance: 13 });
        }
        d += depth + rng.range(0, 1);
      }
      // Back row: tall towers for a deep skyline.
      for (let i = 0; i < 2; i++) {
        const tw = rng.range(14, 22);
        const td = rng.range(12, 18);
        const th = rng.range(40, 95);
        const tx = side * (facadeX + 16 + rng.range(4, 22) + tw / 2);
        this.towers.add(slot, _p.set(tx, 0, -(startD + rng.range(0, length))), _s.set(tw, th, td), rng.pick([0xffffff, 0xdfe6ea, 0xeef0e8]));
      }
    }

    // Street lamps every 20 m on alternating sides.
    for (let i = 0; i < 2; i++) {
      const side = (Math.floor(startD / 20) + i) % 2 === 0 ? -1 : 1;
      const z = -(startD + 10 + i * 20);
      const x = side * (streetHalfWidth + 0.35);
      const hx = x - side * 1.45;
      this.posts.add(slot, _p.set(x, 0, z), _s.set(1, 1, 1), 0xffffff);
      this.arms.add(slot, _p.set(x - side * 0.75, 6.1, z), _s.set(1.6, 0.08, 0.1), 0xffffff);
      const warm = rng.chance(0.75);
      const color = warm ? 0xffc77a : PALETTE.neon.teal;
      this.lampHeads.add(slot, _p.set(hx, 6.0, z), _s.set(0.75, 0.16, 0.35), new THREE.Color(color).multiplyScalar(5));
      this.shafts.add(slot, _p.set(hx, 5.95, z), _s.set(2.4, 5.95, 2.4), warm ? 0xffd9a0 : 0x9ff6f2);
      lights.push({ x: hx, y: 5.5, z, color, intensity: 15, distance: 16 });
      if (rng.chance(0.7)) this.mist[slot][i].visible = true;
      const sp = this.mist[slot][i];
      sp.position.set(hx * 0.7, 0.9, z + rng.range(-4, 4));
      sp.scale.set(rng.range(7, 11), 2.4, 1);
    }

    // Props on the sidewalk.
    for (const side of [-1, 1]) {
      if (rng.chance(0.4)) this.hydrants.add(slot, _p.set(side * (streetHalfWidth + 0.6), 0.16, -(startD + rng.range(2, length - 2))), _s.set(1, 1, 1), 0xffffff);
      if (rng.chance(0.55)) {
        const bz = -(startD + rng.range(2, length - 2));
        for (let k = 0; k < 3; k++) {
          _q.setFromEuler(_e.set(rng.range(0, 1), rng.range(0, 6), 0));
          this.bags.add(slot, _p.set(side * (facadeX - rng.range(0.4, 0.9)), 0.36, bz + rng.range(-0.6, 0.6)), _s.set(rng.range(0.6, 0.9), rng.range(0.5, 0.7), rng.range(0.6, 0.9)), 0xffffff, _q);
        }
      }
    }
    // Spare mist in the middle of the road.
    const m3 = this.mist[slot][2];
    m3.visible = rng.chance(0.5);
    m3.position.set(rng.range(-3, 3), 0.7, -(startD + rng.range(0, length)));
    m3.scale.set(rng.range(8, 14), 2, 1);

    // Sagging overhead wires.
    if (rng.chance(0.7)) {
      const z = -(startD + rng.range(5, length - 5));
      const y0 = rng.range(9, 12);
      const span = (facadeX + 1) * 2;
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const sag = (t: number) => y0 - Math.sin(t * Math.PI) * 1.3;
        const x0 = -span / 2 + t0 * span;
        const x1 = -span / 2 + t1 * span;
        const len = Math.hypot(x1 - x0, sag(t1) - sag(t0));
        _q.setFromEuler(_e.set(0, 0, Math.atan2(sag(t1) - sag(t0), x1 - x0) - Math.PI / 2));
        this.wires.add(slot, _p.set((x0 + x1) / 2, (sag(t0) + sag(t1)) / 2, z), _s.set(1, len + 0.05, 1), 0xffffff, _q);
      }
    }
  }
}
