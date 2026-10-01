import * as THREE from 'three';
import { comicMat } from './comic/comicMaterials';

/** Limited palette: desaturated concrete + a handful of neon accents. */
const CLASSIC_PALETTE = {
  asphalt: 0x15191c,
  concrete: 0x2a2f33,
  concreteDark: 0x1b1f22,
  building: [0x2a3138, 0x313a40, 0x252c31, 0x363c40, 0x2c353a],
  coat: 0x15181a,
  coatTail: 0x111315,
  pants: 0x121416,
  skin: 0xb48a6e,
  hair: 0x0b0b0b,
  suit: 0x23272b,
  shirt: 0xd8dcd6,
  hazardYellow: 0xd9b23a,
  crate: 0x3a2f22,
  crateDark: 0x241d15,
  metal: 0x3c4247,
  signBoard: 0x101418,
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
 * Comic palette: paper-toned, warm grays, deep ink reserved for key shapes
 * (Agents' suits, the hero's coat) and a few saturated accents.
 */
const COMIC_PALETTE: Palette = {
  asphalt: 0x8f908b,
  concrete: 0xc9c3b6,
  concreteDark: 0x9a968d,
  building: [0xe8e2d6, 0xd6d8d6, 0xeee6da, 0xcfd4d6, 0xe2dcd0],
  coat: 0x2e3a46,
  coatTail: 0x25303a,
  pants: 0x23262c,
  skin: 0xe6b996,
  hair: 0x17161a,
  suit: 0x1a1b20,
  shirt: 0xf6f3ea,
  hazardYellow: 0xf2c230,
  crate: 0xc9a66b,
  crateDark: 0xa7834e,
  metal: 0x9aa3a6,
  signBoard: 0x1d2028,
  cars: [0x4fa3a8, 0xd0584f, 0xe0c25a],
  neon: {
    green: 0x2bea7c,
    teal: 0x1fd2d6,
    magenta: 0xf0359a,
    amber: 0xffb53d,
    red: 0xff4040,
  },
  window: [0xf7c948, 0x9ff0d8, 0xfbe08a, 0xf5b942],
};

export type MaterialStyle = 'classic' | 'comic';
let materialStyle: MaterialStyle = 'classic';

/**
 * Active palette. An ES-module live binding: importers always see the
 * current value after setMaterialStyle().
 */
export let PALETTE: Palette = CLASSIC_PALETTE;
export let NEON_LIST: number[] = Object.values(PALETTE.neon).slice(0, 4);

/** Switch the material factory + palette used by every model builder. */
export function setMaterialStyle(s: MaterialStyle): void {
  materialStyle = s;
  PALETTE = s === 'comic' ? COMIC_PALETTE : CLASSIC_PALETTE;
  NEON_LIST = [PALETTE.neon.green, PALETTE.neon.teal, PALETTE.neon.magenta, PALETTE.neon.amber];
}

export function getMaterialStyle(): MaterialStyle {
  return materialStyle;
}

/** Solid surface material: flat-shaded standard (classic) or toon + hatching (comic). */
export function flatMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Material {
  if (materialStyle === 'comic') return comicMat(color, { map: opts.map ?? undefined });
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
}

/** Material for characters: like flatMat, but comic hatching sticks to the limb (object space). */
export function charMat(color: number): THREE.Material {
  if (materialStyle === 'comic') return comicMat(color, { objectSpace: true });
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0.05 });
}

/** Unlit glowing material for neon, lights and emissive details. */
export function glowMat(color: number, opts: Partial<THREE.MeshBasicMaterialParameters> = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
