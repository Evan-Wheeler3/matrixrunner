import * as THREE from 'three';
import { CONFIG } from '../../config';

/**
 * Live comic-style state shared by every comic material and the post pass.
 *
 * `style` starts as a copy of CONFIG.style and is mutated by the debug panel.
 * Shader uniforms are single shared objects, so changing a value here updates
 * every material at once with no recompiles. Call `applyStyle()` after edits.
 */

export interface PalettePreset {
  label: string;
  /** Page color: highlights, haze, lightning wash. */
  paper: number;
  /** Line work and hatching. */
  ink: number;
  /** Distance haze (fog color). */
  haze: number;
  /** Halftone sky dots. */
  skyInk: number;
  /** Post grade: saturation multiplier and RGB tint. */
  saturation: number;
  tint: number;
  /** Split-tone color pushed into shadows/upper floors – where the "night" lives. */
  night: number;
}

export const PALETTES: Record<string, PalettePreset> = {
  neonNoir: { label: 'Neon Noir', paper: 0xefe8d8, ink: 0x14151b, haze: 0xc9cfcf, skyInk: 0x163545, saturation: 1.15, tint: 0xffffff, night: 0x3d5f78 },
  pulp: { label: 'Sepia Pulp', paper: 0xf1e2c0, ink: 0x2a1a10, haze: 0xdcc8a0, skyInk: 0x5a2e1e, saturation: 0.75, tint: 0xfff0d8, night: 0x6b4a36 },
  blueprint: { label: 'Cold Blueprint', paper: 0xe2ebed, ink: 0x0d1d2b, haze: 0xc6d6de, skyInk: 0x123e5c, saturation: 0.85, tint: 0xe8f4ff, night: 0x2c5675 },
  inkOnly: { label: 'Ink Only (mono)', paper: 0xf0efea, ink: 0x101010, haze: 0xd6d4ce, skyInk: 0x262626, saturation: 0.0, tint: 0xffffff, night: 0x555555 },
  acid: { label: 'Acid Green', paper: 0xe9f0dc, ink: 0x0c1a12, haze: 0xc8d6bc, skyInk: 0x123d26, saturation: 1.25, tint: 0xf0ffe8, night: 0x2f5a46 },
};

type StyleConfig = { -readonly [K in keyof typeof CONFIG.style]: (typeof CONFIG.style)[K] extends boolean ? boolean : (typeof CONFIG.style)[K] extends number ? number : (typeof CONFIG.style)[K] };

/** Mutable live copy of the style config. */
export const style: StyleConfig = { ...CONFIG.style } as StyleConfig;

export function activePalette(): PalettePreset {
  return PALETTES[style.palette] ?? PALETTES.neonNoir;
}

/** Uniforms shared by all comic surface materials. */
export const surfaceUniforms = {
  uInk: { value: new THREE.Color() },
  uHatchSpacing: { value: 0.1 },
  uHatchStrength: { value: 0.8 },
  uHatchT1: { value: 0.7 },
  uHatchT2: { value: 0.45 },
  uHalftoneSize: { value: 7 },
  /** Per-boil-frame random offset (changes ~10x/s when boil is on). */
  uBoil: { value: new THREE.Vector2() },
  uBoilAmount: { value: 1 },
  /** Night tone + how strongly facades fall into it with height. */
  uNight: { value: new THREE.Color() },
  uNightAmount: { value: 0.6 },
};

/** 4-texel toon ramp; texel values are rewritten when `lightBands` changes. */
export const toonRamp = (() => {
  const data = new Uint8Array(4 * 4);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
})();

function writeRamp(bands: number): void {
  // Ramp index ~ (N·L * 0.5 + 0.5): texel boundaries at N·L = -0.5, 0, 0.5.
  // Shadow bands stay fairly light: darkness is carried by hatching, not by color.
  const levels = bands <= 2 ? [0.62, 0.62, 1, 1] : [0.58, 0.58, 0.8, 1];
  const d = toonRamp.image.data as Uint8Array;
  levels.forEach((v, i) => d.set([v * 255, v * 255, v * 255, 255], i * 4));
  toonRamp.needsUpdate = true;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to style changes (pipeline + scenes use this for fog, exposure, etc.). */
export function onStyleChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Push `style` into the shared uniforms and notify listeners. */
export function applyStyle(): void {
  const pal = activePalette();
  surfaceUniforms.uInk.value.set(pal.ink);
  surfaceUniforms.uHatchSpacing.value = style.hatchSpacing;
  surfaceUniforms.uHatchStrength.value = style.hatchStrength;
  surfaceUniforms.uHatchT1.value = style.hatchThreshold1;
  surfaceUniforms.uHatchT2.value = style.hatchThreshold2;
  surfaceUniforms.uHalftoneSize.value = style.halftoneSize;
  surfaceUniforms.uBoilAmount.value = style.boilAmount;
  surfaceUniforms.uNight.value.set(pal.night);
  surfaceUniforms.uNightAmount.value = style.nightAmount;
  writeRamp(style.lightBands);
  for (const fn of listeners) fn();
}

let lastBoilFrame = -1;
/** Advance line boil. Called once per frame by the pipeline. */
export function tickBoil(time: number): number {
  const frame = style.boil ? Math.floor(time * style.boilFps) % 3 : 0;
  if (frame !== lastBoilFrame) {
    lastBoilFrame = frame;
    // Fixed offsets per pose so the boil cycles A-B-C rather than random noise.
    const poses = [
      [0, 0],
      [0.37, 0.61],
      [0.73, 0.19],
    ];
    surfaceUniforms.uBoil.value.set(poses[frame][0], poses[frame][1]);
  }
  return frame;
}

/** Export the current live style as a pasteable config snippet. */
export function exportStyle(): string {
  return JSON.stringify(style, null, 2);
}

applyStyle();
