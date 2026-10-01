import * as THREE from 'three';
import { CONFIG } from '../../config';

/**
 * Live "graphic noir" style state shared by every look material and the post
 * pipeline. `style` starts as a copy of CONFIG.style and is edited by the
 * style panel; call applyStyle() after changes. Shader uniforms are shared
 * objects, so updates reach every material without recompiling.
 */

export interface GradePreset {
  label: string;
  /** Lift (shadows) and gain (highlights) tints. */
  shadows: number;
  highlights: number;
  saturation: number;
  contrast: number;
  /** Fog / atmospheric haze color. */
  fog: number;
  skyTop: number;
  skyHorizon: number;
  /** City light bouncing off the underside of the clouds. */
  cityGlow: number;
  /** Ink line + hatching color. */
  ink: number;
  /** Moon key light color. */
  moon: number;
  /** Character rim-light color. */
  rim: number;
}

export const GRADES: Record<string, GradePreset> = {
  matrix: {
    label: 'Matrix Green', shadows: 0x0c2a1c, highlights: 0xe2ffe9, saturation: 0.82, contrast: 1.12,
    fog: 0x30443d, skyTop: 0x040d0a, skyHorizon: 0x22403a, cityGlow: 0x4f8466, ink: 0x040806, moon: 0xc4ecdc, rim: 0x8fffc8,
  },
  noir: {
    label: 'Cold Noir', shadows: 0x121e28, highlights: 0xf2f5f8, saturation: 0.55, contrast: 1.2,
    fog: 0x30363d, skyTop: 0x05070b, skyHorizon: 0x262e36, cityGlow: 0x67606e, ink: 0x040508, moon: 0xd2dceb, rim: 0xbfd8ff,
  },
  neon: {
    label: 'Neon Dusk', shadows: 0x1d1030, highlights: 0xffeaf5, saturation: 1.12, contrast: 1.06,
    fog: 0x352c46, skyTop: 0x090514, skyHorizon: 0x3c2a4c, cityGlow: 0x8f4c80, ink: 0x07050a, moon: 0xe2d4ff, rim: 0xff8fd8,
  },
  sodium: {
    label: 'Sodium Rain', shadows: 0x2a1a0e, highlights: 0xfff1da, saturation: 0.9, contrast: 1.1,
    fog: 0x3e3329, skyTop: 0x0c0806, skyHorizon: 0x4a3420, cityGlow: 0x9c6c3a, ink: 0x080604, moon: 0xffe2c4, rim: 0xffc070,
  },
};

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;
type StyleConfig = { -readonly [K in keyof typeof CONFIG.style]: Widen<(typeof CONFIG.style)[K]> };

/** Mutable live copy of the style config. */
export const style: StyleConfig = { ...CONFIG.style } as StyleConfig;

export function activeGrade(): GradePreset {
  return GRADES[style.grade] ?? GRADES.matrix;
}

/** Uniforms shared by all look surface materials. */
export const surfaceUniforms = {
  uInk: { value: new THREE.Color() },
  uHatchSpacing: { value: 0.08 },
  uHatchStrength: { value: 0.3 },
  uHatchThreshold: { value: 0.32 },
  uBoil: { value: new THREE.Vector2() },
  uBoilAmount: { value: 0 },
  uRimColor: { value: new THREE.Color() },
  uRimStrength: { value: 0.5 },
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function onStyleChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyStyle(): void {
  const g = activeGrade();
  surfaceUniforms.uInk.value.set(g.ink);
  surfaceUniforms.uHatchSpacing.value = style.hatchSpacing;
  surfaceUniforms.uHatchStrength.value = style.hatchStrength;
  surfaceUniforms.uHatchThreshold.value = style.hatchThreshold;
  surfaceUniforms.uBoilAmount.value = style.boil ? style.boilAmount : 0;
  surfaceUniforms.uRimColor.value.set(g.rim);
  surfaceUniforms.uRimStrength.value = style.rimLight;
  for (const fn of listeners) fn();
}

let lastBoilFrame = -1;
const BOIL_POSES = [
  [0, 0],
  [0.37, 0.61],
  [0.73, 0.19],
];
/** Advance the (optional) line boil; returns the current pose index. */
export function tickBoil(time: number): number {
  const frame = style.boil ? Math.floor(time * style.boilFps) % 3 : 0;
  if (frame !== lastBoilFrame) {
    lastBoilFrame = frame;
    surfaceUniforms.uBoil.value.set(BOIL_POSES[frame][0], BOIL_POSES[frame][1]);
  }
  return frame;
}

export function exportStyle(): string {
  return JSON.stringify(style, null, 2);
}

applyStyle();
