import * as THREE from 'three';
import { litMat } from './look/materials';

/** Original flat-shaded palette (legacy run mode until the noir look rolls out). */
const CLASSIC_PALETTE = {
  asphalt: 0x15191c,
  concrete: 0x2a2f33,
  concreteDark: 0x1b1f22,
  building: [0x2a3138, 0x313a40, 0x252c31, 0x363c40, 0x2c353a],
  coat: 0x15181a,
  pants: 0x121416,
  skin: 0xb48a6e,
  skinAgent: 0xc9a58a,
  hair: 0x0b0b0b,
  suit: 0x23272b,
  shirt: 0xd8dcd6,
  metal: 0x3c4247,
  cars: [0x2b3a40, 0x3a2a2e, 0x2a2f24],
  neon: {
    green: 0x39ff8a,
    teal: 0x2de2e6,
    magenta: 0xff2fb4,
    amber: 0xffb347,
    red: 0xff3b3b,
  },
  window: [0xffcf8a, 0x9ff0d8, 0x7fd3ff, 0xffe3b0],
};

export type Palette = typeof CLASSIC_PALETTE;

/**
 * Graphic-noir palette: grounded materials (leather, wool suits, painted
 * metal) – color mostly comes from textures, lights and the grade.
 */
const NOIR_PALETTE: Palette = {
  asphalt: 0x2c2d2e,
  concrete: 0x8a8780,
  concreteDark: 0x4a4845,
  building: [0xffffff, 0xe6ebe8, 0xf3ece4, 0xdce3e6, 0xeee8de],
  coat: 0x23272c,
  pants: 0x24262a,
  skin: 0xc4977a,
  skinAgent: 0xd0a88b,
  hair: 0x121112,
  suit: 0x222429,
  shirt: 0xeceeec,
  metal: 0x7d868b,
  cars: [0x1c3a48, 0x5a1a1f, 0x2a2d31, 0x9c968a],
  neon: {
    green: 0x3dff9a,
    teal: 0x2de8ec,
    magenta: 0xff3fae,
    amber: 0xffb347,
    red: 0xff4040,
  },
  window: [0xffcf7a, 0xffe2b0, 0xbff5ff, 0xffb25c],
};

export type MaterialStyle = 'classic' | 'noir';
let materialStyle: MaterialStyle = 'classic';

/** Active palette (ES-module live binding: importers see updates). */
export let PALETTE: Palette = CLASSIC_PALETTE;
export let NEON_LIST: number[] = [PALETTE.neon.green, PALETTE.neon.teal, PALETTE.neon.magenta, PALETTE.neon.amber];

/** Switch the material factory + palette used by every model builder. */
export function setMaterialStyle(s: MaterialStyle): void {
  materialStyle = s;
  PALETTE = s === 'noir' ? NOIR_PALETTE : CLASSIC_PALETTE;
  NEON_LIST = [PALETTE.neon.green, PALETTE.neon.teal, PALETTE.neon.magenta, PALETTE.neon.amber];
}

export function getMaterialStyle(): MaterialStyle {
  return materialStyle;
}

/** Solid surface: PBR + hatching (noir) or flat-shaded standard (classic). */
export function flatMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  if (materialStyle === 'noir') return litMat(color, opts);
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts, envMapIntensity: 0 });
}

/** Character material: like flatMat, but hatching sticks to the limb (object space). */
export function charMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  if (materialStyle === 'noir') return litMat(color, { ...opts, objectSpace: true });
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0.05, side: opts.side ?? THREE.FrontSide });
}

/** Unlit glowing material for neon, lights and emissive details. */
export function glowMat(color: number, opts: Partial<THREE.MeshBasicMaterialParameters> = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
