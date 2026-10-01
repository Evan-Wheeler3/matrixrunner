import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, charMat, getMaterialStyle } from './palette';
import { addInkHulls } from './look/materials';

/**
 * Procedural characters with a proper jointed rig (hips, spine, thighs/shins,
 * upper arms/forearms) built from smooth capsules and lathed torsos.
 *
 * The rig is authored facing +z and flipped (the game runs toward -z).
 * Rotation conventions inside the rig (rotation.x):
 *   thigh/arm  negative = swing forward     knee  positive = bend
 *   elbow      negative = bend forward      spine positive = lean forward
 */

export interface Humanoid {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  /** Long-coat panels (runner only): back flaps behind, sides follow the thighs. */
  coat?: { back: THREE.Object3D; left: THREE.Object3D; right: THREE.Object3D };
}

const HIP_H = 0.95;
const THIGH = 0.44;
const SHIN = 0.43;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;

/** Capsule hanging down from its pivot (top at y = 0). */
function limbGeo(radius: number, length: number, radiusBottom = radius): THREE.BufferGeometry {
  // Tapered capsule via lathe: hemisphere top, straight taper, hemisphere bottom.
  const pts: THREE.Vector2[] = [];
  const seg = 6;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * radius, radius - Math.cos(a) * radius));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * radiusBottom, length - radiusBottom + Math.sin(a) * radiusBottom));
  }
  const geo = new THREE.LatheGeometry(pts, 14);
  // Lathe builds along +y; flip so the limb hangs down from the pivot.
  geo.scale(1, -1, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Torso: lathed profile (waist -> chest -> shoulders -> neck), flattened front-to-back. */
function torsoGeo(waist: number, chest: number, shoulders: number, height: number, depthScale: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(waist, 0.02),
    new THREE.Vector2(waist * 1.02, height * 0.25),
    new THREE.Vector2(chest, height * 0.6),
    new THREE.Vector2(shoulders, height * 0.86),
    new THREE.Vector2(shoulders * 0.75, height * 0.96),
    new THREE.Vector2(0.07, height),
    new THREE.Vector2(0.001, height),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.scale(1, 1, depthScale);
  geo.computeVertexNormals();
  return geo;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

interface Outfit {
  top: THREE.Material;
  sleeves: THREE.Material;
  pants: THREE.Material;
  shoes: THREE.Material;
  skin: THREE.Material;
  hair: THREE.Material;
  glasses: THREE.Material;
  shirt?: THREE.Material;
  tie?: THREE.Material;
  coat?: THREE.Material;
  build: number; // shoulder width multiplier
}

function buildHumanoid(o: Outfit): Humanoid {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.rotation.y = Math.PI;
  root.add(rig);

  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  rig.add(hips);
  hips.add(mesh(new RoundedBoxGeometry(0.32 * o.build, 0.2, 0.2, 2, 0.06), o.pants, 0, -0.02, 0));

  const spine = new THREE.Group();
  spine.position.y = 0.06;
  hips.add(spine);
  const torsoH = 0.56;
  spine.add(mesh(torsoGeo(0.145, 0.19 * o.build, 0.215 * o.build, torsoH, 0.62), o.top));

  if (o.shirt && o.tie) {
    // Crisp white shirt V and tie on the chest front.
    const v = new THREE.Shape();
    v.moveTo(-0.075, 0);
    v.lineTo(0.075, 0);
    v.lineTo(0, -0.24);
    v.closePath();
    const shirt = mesh(new THREE.ShapeGeometry(v), o.shirt, 0, torsoH * 0.97, 0.122);
    shirt.rotation.x = -0.12;
    spine.add(shirt);
    const tie = mesh(new RoundedBoxGeometry(0.035, 0.22, 0.012, 1, 0.005), o.tie, 0, torsoH * 0.83, 0.128);
    tie.rotation.x = -0.12;
    spine.add(tie);
    // Lapels.
    for (const side of [-1, 1]) {
      const lap = mesh(new RoundedBoxGeometry(0.05, 0.22, 0.012, 1, 0.005), o.top, side * 0.06, torsoH * 0.84, 0.124);
      lap.rotation.set(-0.12, 0, side * 0.35);
      spine.add(lap);
    }
  }

  // Neck + head.
  spine.add(mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.1, 12), o.skin, 0, torsoH + 0.03, 0));
  const head = new THREE.Group();
  head.position.y = torsoH + 0.17;
  spine.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.112, 24, 18), o.skin);
  skull.scale.set(0.9, 1.06, 1.0);
  head.add(skull);
  const jaw = mesh(new RoundedBoxGeometry(0.15, 0.08, 0.15, 2, 0.04), o.skin, 0, -0.07, 0.02);
  head.add(jaw);
  const hair = mesh(new THREE.SphereGeometry(0.118, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), o.hair, 0, 0.012, -0.008);
  hair.scale.set(0.93, 1.05, 1.03);
  head.add(hair);
  head.add(mesh(new RoundedBoxGeometry(0.2, 0.045, 0.03, 2, 0.012), o.glasses, 0, 0.012, 0.1));
  for (const side of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.022, 8, 8), o.skin, side * 0.1, -0.005, 0));
  if (o.shirt) {
    // Earpiece coil down the neck (Agents).
    const coil = mesh(new THREE.TorusGeometry(0.03, 0.004, 4, 12, Math.PI), o.shirt, -0.1, -0.06, -0.02);
    coil.rotation.y = Math.PI / 2;
    head.add(coil);
  }

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand.
  const armUpper = limbGeo(0.055, UPPER_ARM, 0.046);
  const armLower = limbGeo(0.045, FOREARM, 0.036);
  const handGeo = new RoundedBoxGeometry(0.075, 0.1, 0.045, 2, 0.02);
  const makeArm = (side: number): [THREE.Group, THREE.Group] => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2 * o.build, torsoH * 0.88, 0);
    shoulder.add(mesh(armUpper, o.sleeves));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    elbow.add(mesh(armLower, o.sleeves));
    elbow.add(mesh(handGeo, o.skin, 0, -FOREARM - 0.04, 0));
    shoulder.add(elbow);
    spine.add(shoulder);
    return [shoulder, elbow];
  };
  const [armL, forearmL] = makeArm(-1);
  const [armR, forearmR] = makeArm(1);

  // Legs: hip pivot -> thigh -> knee pivot -> shin -> shoe.
  const thighGeo = limbGeo(0.078, THIGH, 0.06);
  const shinGeo = limbGeo(0.06, SHIN, 0.045);
  const shoeGeo = new RoundedBoxGeometry(0.11, 0.085, 0.27, 2, 0.035);
  const makeLeg = (side: number): [THREE.Group, THREE.Group] => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.05, 0);
    hip.add(mesh(thighGeo, o.pants));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    knee.add(mesh(shinGeo, o.pants));
    knee.add(mesh(shoeGeo, o.shoes, 0, -SHIN - 0.0, 0.06));
    hip.add(knee);
    hips.add(hip);
    return [hip, knee];
  };
  const [legL, shinL] = makeLeg(-1);
  const [legR, shinR] = makeLeg(1);

  const h: Humanoid = { root, hips, spine, head, armL, armR, forearmL, forearmR, legL, legR, shinL, shinR };

  if (o.coat) {
    // Long coat: three open panels hinged at the waist so they swing.
    const panel = (start: number, length: number) => {
      const geo = new THREE.CylinderGeometry(0.17 * o.build, 0.29 * o.build, 0.82, 12, 2, true, start, length);
      geo.translate(0, -0.41, 0);
      geo.scale(1, 1, 0.75);
      const g = new THREE.Group();
      g.position.y = 0.08;
      g.add(mesh(geo, o.coat!));
      hips.add(g);
      return g;
    };
    h.coat = {
      back: panel(Math.PI - 1.25, 2.5),
      left: panel(Math.PI + 1.25, 0.95),
      right: panel(Math.PI - 2.2, 0.95),
    };
    // Coat body over the torso + raised collar.
    spine.add(mesh(torsoGeo(0.16, 0.2 * o.build, 0.225 * o.build, torsoH * 0.95, 0.66), o.coat));
    const collar = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.09, 14, 1, true), o.coat, 0, torsoH * 0.98, -0.01);
    spine.add(collar);
  }

  if (getMaterialStyle() === 'noir') addInkHulls(rig);
  return h;
}

export function buildRunner(): Humanoid {
  const leather = charMat(PALETTE.coat, { roughness: 0.32, metalness: 0.1, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  return buildHumanoid({
    top: charMat(0x1a1c1f, { roughness: 0.8 }),
    sleeves: leather,
    pants: charMat(PALETTE.pants, { roughness: 0.75 }),
    shoes: charMat(0x0c0d0e, { roughness: 0.35, metalness: 0.1 }),
    skin: charMat(PALETTE.skin, { roughness: 0.55 }),
    hair: charMat(PALETTE.hair, { roughness: 0.6 }),
    glasses: charMat(0x050607, { roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }),
    coat: leather,
    build: 1.0,
  });
}

export function buildAgent(): Humanoid {
  const suit = charMat(PALETTE.suit, { roughness: 0.55, metalness: 0.02 });
  return buildHumanoid({
    top: suit,
    sleeves: suit,
    pants: suit,
    shoes: charMat(0x050506, { roughness: 0.2, metalness: 0.15 }),
    skin: charMat(PALETTE.skinAgent, { roughness: 0.5 }),
    hair: charMat(0x2a2018, { roughness: 0.55 }),
    glasses: charMat(0x050607, { roughness: 0.04, metalness: 0.95, envMapIntensity: 1.8 }),
    shirt: charMat(PALETTE.shirt, { roughness: 0.6 }),
    tie: charMat(0x0b0c0e, { roughness: 0.4 }),
    build: 1.08,
  });
}

export type Pose = 'run' | 'jump' | 'slide' | 'stumble' | 'idle' | 'call';

const lerp = THREE.MathUtils.lerp;

/**
 * Procedural animation. `phase` advances with distance so stride matches
 * speed; poses blend via simple targets (called every frame).
 */
export function animateHumanoid(h: Humanoid, pose: Pose, phase: number, t: number): void {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  // Knee bend peaks while that leg swings forward (recovery phase).
  const kneeL = 0.15 + Math.pow(Math.max(0, c), 1.4) * 1.35;
  const kneeR = 0.15 + Math.pow(Math.max(0, -c), 1.4) * 1.35;

  let hipY = HIP_H;
  let lean = 0.06;
  let twist = 0;
  let legL = 0,
    legR = 0,
    shinL = 0.05,
    shinR = 0.05;
  let armL = 0.05,
    armR = 0.05,
    armLz = 0.08,
    armRz = -0.08,
    foreL = -0.15,
    foreR = -0.15;
  let headX = 0;
  let coatBack = 0.1;

  switch (pose) {
    case 'run':
      hipY = HIP_H - 0.05 + Math.abs(c) * 0.06;
      lean = 0.28;
      twist = s * 0.14;
      legL = -s * 0.85 - 0.1;
      legR = s * 0.85 - 0.1;
      shinL = kneeL;
      shinR = kneeR;
      armL = s * 0.75;
      armR = -s * 0.75;
      foreL = -1.35 + s * 0.15;
      foreR = -1.35 - s * 0.15;
      coatBack = 0.55 + 0.18 * Math.sin(phase * 2);
      headX = -0.18;
      break;
    case 'jump':
      hipY = HIP_H;
      lean = 0.15;
      legL = -1.15;
      shinL = 1.55;
      legR = 0.35;
      shinR = 1.0;
      armL = -0.9;
      armR = 0.5;
      armLz = 0.45;
      armRz = -0.45;
      foreL = -0.8;
      foreR = -0.5;
      coatBack = 1.05;
      break;
    case 'slide':
      hipY = 0.4;
      lean = -0.78;
      legL = -1.45;
      shinL = 0.12;
      legR = -0.85;
      shinR = 1.95;
      armL = -1.1;
      foreL = -0.4;
      armR = 0.75;
      armRz = -0.5;
      foreR = -0.2;
      headX = 0.55;
      coatBack = 1.35;
      break;
    case 'stumble':
      hipY = HIP_H - 0.06 + Math.abs(c) * 0.04;
      lean = 0.65 + 0.12 * Math.sin(t * 22);
      legL = -s * 0.6;
      legR = s * 0.6;
      shinL = kneeL * 0.8;
      shinR = kneeR * 0.8;
      armL = -1.5 + Math.sin(t * 18) * 0.5;
      armR = -1.1 + Math.cos(t * 16) * 0.5;
      armLz = 0.6;
      armRz = -0.6;
      foreL = -0.6;
      foreR = -0.6;
      coatBack = 0.9;
      break;
    case 'call':
      armR = -2.35;
      armRz = -0.35;
      foreR = -2.0;
      headX = 0.15;
      coatBack = 0.08 + 0.04 * Math.sin(t * 2);
      break;
    case 'idle':
      hipY = HIP_H + Math.sin(t * 2.2) * 0.005;
      coatBack = 0.08 + 0.04 * Math.sin(t * 2);
      break;
  }

  h.hips.position.y = lerp(h.hips.position.y, hipY, 0.5);
  h.spine.rotation.x = lerp(h.spine.rotation.x, lean, 0.4);
  h.spine.rotation.y = twist;
  h.head.rotation.x = headX;
  h.legL.rotation.x = legL;
  h.legR.rotation.x = legR;
  h.shinL.rotation.x = shinL;
  h.shinR.rotation.x = shinR;
  h.armL.rotation.set(armL, 0, armLz);
  h.armR.rotation.set(armR, 0, armRz);
  h.forearmL.rotation.x = foreL;
  h.forearmR.rotation.x = foreR;
  if (h.coat) {
    h.coat.back.rotation.x = lerp(h.coat.back.rotation.x, coatBack, 0.3);
    // Side panels are pushed by the thighs when they swing forward.
    h.coat.left.rotation.x = Math.min(0, legL) * 0.75;
    h.coat.right.rotation.x = Math.min(0, legR) * 0.75;
  }
}
