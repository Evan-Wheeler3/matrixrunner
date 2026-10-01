import * as THREE from 'three';
import { PALETTE, flatMat, charMat, glowMat, getMaterialStyle } from './palette';
import { addInkHulls } from './comic/comicMaterials';

/**
 * Low-poly procedural models built from primitives. Every humanoid shares the
 * same rig layout so one animation function drives the player and the Agents.
 */

export interface Humanoid {
  root: THREE.Group;
  /** Everything above the hips; pitched for leaning / stumbling. */
  body: THREE.Group;
  head: THREE.Object3D;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Optional coat tail that flaps when running. */
  coat?: THREE.Object3D;
}

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A limb: group pivoting at its top, with the mesh hanging down. */
function limb(w: number, len: number, mat: THREE.Material, x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.add(box(w, len, w, mat, -len / 2));
  return g;
}

interface HumanoidStyle {
  torso: number;
  legs: number;
  arms: number;
  skin: number;
  hair: number;
  coat?: number;
  shirt?: number;
  glasses?: boolean;
}

function buildHumanoid(style: HumanoidStyle): Humanoid {
  const root = new THREE.Group();
  // The rig is authored facing +z; the game runs toward -z, so flip it.
  const rig = new THREE.Group();
  rig.rotation.y = Math.PI;
  root.add(rig);
  const torsoMat = charMat(style.torso);
  const legMat = charMat(style.legs);
  const armMat = charMat(style.arms);
  const skinMat = charMat(style.skin);
  const hairMat = charMat(style.hair);

  const body = new THREE.Group();
  body.position.y = 0.92; // hip height
  rig.add(body);

  // Torso slightly tapered: wider shoulders than waist.
  const torsoGeo = new THREE.CylinderGeometry(0.27, 0.2, 0.62, 4, 1);
  torsoGeo.rotateY(Math.PI / 4);
  torsoGeo.scale(1, 1, 0.65);
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.33;
  body.add(torso);

  if (style.shirt !== undefined) {
    // Shirt + tie visible at the collar (Agents).
    // Sharp white shirt "V" + black tie: the Agent's graphic signature.
    body.add(box(0.16, 0.3, 0.03, charMat(style.shirt), 0.5, 0, 0.13));
    body.add(box(0.045, 0.27, 0.035, charMat(0x0b0c0d), 0.48, 0, 0.145));
  }

  const head = new THREE.Group();
  head.position.y = 0.8;
  head.add(box(0.22, 0.26, 0.24, skinMat, 0));
  head.add(box(0.24, 0.08, 0.26, hairMat, 0.13));
  if (style.glasses) {
    head.add(box(0.23, 0.05, 0.03, glowMat(0x0a1a14), 0.02, 0, 0.125));
  }
  body.add(head);

  const armL = limb(0.11, 0.62, armMat, -0.33, 0.6);
  const armR = limb(0.11, 0.62, armMat, 0.33, 0.6);
  // Hands.
  armL.add(box(0.1, 0.1, 0.1, skinMat, -0.66));
  armR.add(box(0.1, 0.1, 0.1, skinMat, -0.66));
  body.add(armL, armR);

  const legL = limb(0.15, 0.9, legMat, -0.12, 0.92);
  const legR = limb(0.15, 0.9, legMat, 0.12, 0.92);
  // Shoes.
  const shoeMat = charMat(0x0a0b0c);
  legL.add(box(0.16, 0.08, 0.26, shoeMat, -0.88, 0, 0.05));
  legR.add(box(0.16, 0.08, 0.26, shoeMat, -0.88, 0, 0.05));
  rig.add(legL, legR);

  const h: Humanoid = { root, body, head, armL, armR, legL, legR };

  if (style.coat !== undefined) {
    // Long coat tail hanging from the waist, pivoting at the top so it flaps.
    const coat = new THREE.Group();
    coat.position.set(0, 0.05, 0);
    const tail = box(0.44, 0.62, 0.3, charMat(style.coat), -0.31, 0, -0.02);
    coat.add(tail);
    body.add(coat);
    h.coat = coat;
  }

  // Comic look: bold inked silhouette around every body part.
  if (getMaterialStyle() === 'comic') addInkHulls(rig);
  return h;
}

export function buildRunner(): Humanoid {
  return buildHumanoid({
    torso: PALETTE.coat,
    legs: PALETTE.pants,
    arms: PALETTE.coat,
    skin: PALETTE.skin,
    hair: PALETTE.hair,
    coat: PALETTE.coatTail,
    glasses: true,
  });
}

export function buildAgent(): Humanoid {
  return buildHumanoid({
    torso: PALETTE.suit,
    legs: PALETTE.suit,
    arms: PALETTE.suit,
    skin: PALETTE.skin,
    hair: PALETTE.hair,
    shirt: PALETTE.shirt,
    glasses: true,
  });
}

export type Pose = 'run' | 'jump' | 'slide' | 'stumble' | 'idle' | 'call';

/**
 * Procedural animation. `phase` advances with distance travelled so stride
 * matches speed; `blend` smooths pose changes.
 */
export function animateHumanoid(h: Humanoid, pose: Pose, phase: number, t: number): void {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  let legSwing = 0;
  let armSwing = 0;
  let bodyPitch = 0;
  let bodyY = 0.92;
  let bob = 0;
  let coatFlap = 0.4;
  let armSpreadL = 0;
  let armSpreadR = 0;
  let legLBase = 0;
  let legRBase = 0;
  let headPitch = 0;

  switch (pose) {
    case 'run':
      legSwing = 0.95;
      armSwing = 0.85;
      bodyPitch = 0.22;
      bob = Math.abs(c) * 0.08;
      coatFlap = 0.7 + 0.25 * Math.sin(phase * 2);
      break;
    case 'jump':
      legLBase = -0.9;
      legRBase = 0.3;
      armSpreadL = 0.5;
      armSpreadR = 0.5;
      bodyPitch = 0.15;
      coatFlap = 1.1;
      break;
    case 'slide':
      bodyPitch = -0.9;
      bodyY = 0.42;
      legLBase = -1.35;
      legRBase = -1.1;
      armSpreadL = 0.9;
      armSpreadR = 0.4;
      coatFlap = 1.4;
      headPitch = 0.6;
      break;
    case 'stumble':
      legSwing = 0.6;
      armSwing = 1.3;
      bodyPitch = 0.55 + 0.15 * Math.sin(t * 25);
      bob = Math.abs(c) * 0.05;
      armSpreadL = 0.7;
      armSpreadR = 0.7;
      coatFlap = 0.9;
      break;
    case 'call':
      bodyPitch = 0.05;
      armSpreadR = 0;
      coatFlap = 0.15 + 0.05 * Math.sin(t * 2);
      break;
    case 'idle':
      coatFlap = 0.1 + 0.05 * Math.sin(t * 2);
      break;
  }

  h.body.position.y = bodyY + bob;
  h.body.rotation.x = bodyPitch;
  h.head.rotation.x = headPitch - bodyPitch * 0.5;
  h.legL.rotation.x = legLBase + s * legSwing;
  h.legR.rotation.x = legRBase - s * legSwing;
  h.legL.position.y = h.legR.position.y = bodyY + bob;
  h.armL.rotation.x = -s * armSwing - armSpreadL * 0.5;
  h.armR.rotation.x = s * armSwing - armSpreadR * 0.5;
  h.armL.rotation.z = -armSpreadL * 0.4;
  h.armR.rotation.z = armSpreadR * 0.4;
  if (pose === 'call') {
    // Receiver held to the ear.
    h.armR.rotation.x = -2.4;
    h.armR.rotation.z = -0.5;
  }
  if (h.coat) h.coat.rotation.x = coatFlap;
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

/** Shared materials for obstacles (built once, reused by every pooled instance). */
export class ObstacleMaterials {
  readonly concrete = flatMat(PALETTE.concrete);
  readonly hazard: THREE.Material;
  readonly crate = flatMat(PALETTE.crate);
  readonly crateDark = flatMat(PALETTE.crateDark);
  readonly metal = flatMat(PALETTE.metal, { metalness: 0.5, roughness: 0.5 });
  readonly signBoard = flatMat(PALETTE.signBoard);
  readonly carBody = PALETTE.cars.map((c) => flatMat(c, { roughness: 0.45, metalness: 0.3 }));
  readonly carGlass = flatMat(0x0a1216, { roughness: 0.2, metalness: 0.6 });
  readonly tyre = flatMat(0x0a0a0a);
  readonly headlight = glowMat(0xfff2c8);
  readonly taillight = glowMat(PALETTE.neon.red);
  readonly grate = flatMat(0x1a1d1f, { metalness: 0.6, roughness: 0.4 });
  readonly steam = new THREE.MeshBasicMaterial({ color: 0xbfd8d4, transparent: true, opacity: 0.35, depthWrite: false });
  readonly neonGreen = glowMat(PALETTE.neon.green);
  readonly neonMagenta = glowMat(PALETTE.neon.magenta);
  readonly neonAmber = glowMat(PALETTE.neon.amber);

  constructor(hazardTex: THREE.Texture) {
    this.hazard = flatMat(0xffffff, { map: hazardTex });
  }
}

/** Low concrete barrier – tap jump to clear. */
export function buildBarrierLow(m: ObstacleMaterials, width: number): THREE.Group {
  const g = new THREE.Group();
  // Jersey-barrier profile: wide base, narrow top.
  const geo = new THREE.CylinderGeometry(0.16, 0.32, 0.8, 4, 1);
  geo.rotateY(Math.PI / 4);
  geo.scale(1, 1, 1);
  const base = new THREE.Mesh(geo, m.concrete);
  base.scale.set(width / 0.45, 1, 1);
  base.position.y = 0.4;
  g.add(base);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, 0.14, 0.02), m.hazard);
  stripe.position.set(0, 0.55, 0.16);
  g.add(stripe);
  return g;
}

/** Stacked crates – needs a full (held) jump. */
export function buildCrateHigh(m: ObstacleMaterials, width: number): THREE.Group {
  const g = new THREE.Group();
  const w = width * 0.48;
  const a = box(w, 0.6, 0.85, m.crate, 0.3, -w / 2 - 0.02);
  const b = box(w, 0.6, 0.85, m.crateDark, 0.3, w / 2 + 0.02);
  const c = box(w * 1.1, 0.55, 0.8, m.crate, 0.875, 0.05);
  c.rotation.y = 0.08;
  g.add(a, b, c);
  // Amber warning lamp on top so it reads in the fog.
  const lamp = box(0.12, 0.1, 0.12, m.neonAmber, 1.2, 0.3);
  g.add(lamp);
  return g;
}

/** Overhead sign on a gantry – slide under. Spans `lanes` lanes. */
export function buildOverhead(m: ObstacleMaterials, span: number, signColor: 'green' | 'magenta'): THREE.Group {
  const g = new THREE.Group();
  const postH = 3.6;
  g.add(box(0.15, postH, 0.15, m.metal, postH / 2, -span / 2));
  g.add(box(0.15, postH, 0.15, m.metal, postH / 2, span / 2));
  // The bar you slide under (bottom at ~1.05 m).
  g.add(box(span, 0.18, 0.2, m.metal, 1.14));
  // Sign board above, with neon trim.
  g.add(box(span * 0.9, 1.0, 0.12, m.signBoard, 1.9));
  const trim = signColor === 'green' ? m.neonGreen : m.neonMagenta;
  g.add(box(span * 0.9, 0.06, 0.14, trim, 2.42));
  g.add(box(span * 0.9, 0.06, 0.14, trim, 1.38));
  g.add(box(span * 0.5, 0.18, 0.14, trim, 1.9));
  return g;
}

/** Parked car blocking a lane – switch lanes. Faces the player. */
export function buildCar(m: ObstacleMaterials, variant: number): THREE.Group {
  const g = new THREE.Group();
  const body = m.carBody[variant % m.carBody.length];
  g.add(box(1.9, 0.6, 4.1, body, 0.55));
  const cabinGeo = new THREE.CylinderGeometry(0.7, 0.95, 0.5, 4, 1);
  cabinGeo.rotateY(Math.PI / 4);
  cabinGeo.scale(1.3, 1, 1.9);
  const cabin = new THREE.Mesh(cabinGeo, m.carGlass);
  cabin.position.set(0, 1.1, 0.2);
  g.add(cabin);
  for (const x of [-0.85, 0.85]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8), m.tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.32, z);
      g.add(wheel);
    }
  }
  // Rear faces the player (+z): tail lights.
  g.add(box(0.4, 0.12, 0.04, m.taillight, 0.7, -0.65, 2.06));
  g.add(box(0.4, 0.12, 0.04, m.taillight, 0.7, 0.65, 2.06));
  g.add(box(0.3, 0.1, 0.04, m.headlight, 0.65, -0.65, -2.06));
  g.add(box(0.3, 0.1, 0.04, m.headlight, 0.65, 0.65, -2.06));
  return g;
}

/** Steam vent: grate + periodic plume. The plume mesh is child index 1. */
export function buildVent(m: ObstacleMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.6, 0.06, 1.4, m.grate, 0.03));
  const plumeGeo = new THREE.CylinderGeometry(0.9, 0.45, 2.8, 7, 1, true);
  const plume = new THREE.Mesh(plumeGeo, m.steam);
  plume.position.y = 1.4;
  plume.name = 'plume';
  g.add(plume);
  return g;
}

/** Final-chunk payphone booth with a glowing sign. */
export function buildPayphone(): THREE.Group {
  const g = new THREE.Group();
  const frame = flatMat(0x2d3438, { metalness: 0.4, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5fd8b8, transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2, depthWrite: false });
  const glow = glowMat(PALETTE.neon.green);
  const w = 1.3;
  const h = 2.5;
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-w / 2, w / 2]) g.add(box(0.08, h, 0.08, frame, h / 2, x, z));
  }
  g.add(box(w + 0.1, 0.12, w + 0.1, frame, h + 0.06));
  // Back and sides glass.
  g.add(box(w, h - 0.3, 0.03, glass, h / 2, 0, -w / 2));
  g.add(box(0.03, h - 0.3, w, glass, h / 2, -w / 2, 0));
  g.add(box(0.03, h - 0.3, w, glass, h / 2, w / 2, 0));
  // Phone unit on the back wall.
  g.add(box(0.36, 0.55, 0.14, flatMat(0x1c2124), 1.45, 0, -w / 2 + 0.1));
  g.add(box(0.08, 0.3, 0.08, flatMat(0x0d0f10), 1.5, -0.12, -w / 2 + 0.2));
  // Sign.
  g.add(box(w + 0.1, 0.25, 0.06, glow, h + 0.28, 0, w / 2));
  const light = new THREE.PointLight(PALETTE.neon.green, 6, 9, 1.6);
  light.position.set(0, h - 0.2, 0);
  g.add(light);
  return g;
}
