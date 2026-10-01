import * as THREE from 'three';

/** Limited palette: desaturated concrete + a handful of neon accents. */
export const PALETTE = {
  asphalt: 0x15191c,
  concrete: 0x2a2f33,
  concreteDark: 0x1b1f22,
  building: [0x2a3138, 0x313a40, 0x252c31, 0x363c40, 0x2c353a],
  coat: 0x15181a,
  skin: 0xb48a6e,
  suit: 0x23272b,
  shirt: 0xd8dcd6,
  hazardYellow: 0xd9b23a,
  neon: {
    green: 0x39ff8a,
    teal: 0x2de2e6,
    magenta: 0xff2fb4,
    amber: 0xffb347,
    red: 0xff3b3b,
  },
  window: [0xffcf8a, 0x9ff0d8, 0x7fd3ff, 0xffe3b0],
} as const;

export const NEON_LIST = [PALETTE.neon.green, PALETTE.neon.teal, PALETTE.neon.magenta, PALETTE.neon.amber] as const;

/** Flat-shaded standard material – the base look of every solid object. */
export function flatMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
}

/** Unlit glowing material for neon, lights and emissive details (ignores fog dimming partially). */
export function glowMat(color: number, opts: Partial<THREE.MeshBasicMaterialParameters> = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
