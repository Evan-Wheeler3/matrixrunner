import * as THREE from 'three';
import { surfaceUniforms, toonRamp, activePalette, onStyleChange, style } from './ComicStyle';

/**
 * Comic surface materials.
 *
 * Built on MeshToonMaterial (flat 2–3 band lighting, works with instancing,
 * fog and instance colors for free). `onBeforeCompile` injects:
 *  - world-space hatching in shadow bands: halftone dots in the first shadow
 *    band, cross-hatching below that, a third stroke direction in the deepest
 *    shadow. World-locked so marks stick to surfaces instead of swimming.
 *  - characters use object space instead, so marks move with the limbs.
 *  - facades: window grids/brick drawn in a texture sampled with world UVs, so
 *    windows keep a constant size regardless of building scale; lit windows
 *    are unlit "glow" regions.
 */

const COMIC_VERTEX_DECL = /* glsl */ `
varying vec3 vComicPos;
varying vec3 vComicNormal;
`;

const COMIC_VERTEX_BODY = /* glsl */ `
#ifdef COMIC_OBJECT_SPACE
  vComicPos = transformed;
  vComicNormal = objectNormal;
#else
  vec4 comicWorld = vec4(transformed, 1.0);
  vec3 comicN = objectNormal;
  #ifdef USE_INSTANCING
    comicWorld = instanceMatrix * comicWorld;
    comicN = mat3(instanceMatrix) * comicN;
  #endif
  comicWorld = modelMatrix * comicWorld;
  vComicPos = comicWorld.xyz;
  vComicNormal = mat3(modelMatrix) * comicN;
#endif
`;

const COMIC_FRAGMENT_DECL = /* glsl */ `
uniform vec3 uInk;
uniform float uHatchSpacing;
uniform float uHatchStrength;
uniform float uHatchT1;
uniform float uHatchT2;
uniform float uHalftoneSize;
uniform float uBoilAmount;
uniform vec2 uBoil;
uniform vec3 uNight;
uniform float uNightAmount;
varying vec3 vComicPos;
varying vec3 vComicNormal;

// One family of parallel strokes. p is in "line units" (1 = spacing).
float comicStroke(vec2 p, float ang, float width) {
  float c = p.x * cos(ang) + p.y * sin(ang);
  // Hand wobble; the phase flips with the boil frame.
  c += sin(p.x * sin(ang) * 0.9 - p.y * cos(ang) * 0.9 + uBoil.x * 6.2831) * 0.09 * uBoilAmount;
  float fw = fwidth(c);
  float d = abs(fract(c) - 0.5);
  float line = 1.0 - smoothstep(width - fw, width + fw, d);
  // When strokes get denser than ~2px, fade to their average tone (no moire).
  return mix(line, 2.0 * width, smoothstep(0.3, 0.7, fw));
}

// Screen-space halftone dot coverage for amount 0..1 (print-like, rotated 15deg).
float comicDots(float amount) {
  vec2 g = mat2(0.966, -0.259, 0.259, 0.966) * (gl_FragCoord.xy / uHalftoneSize) + uBoil * 0.3;
  vec2 cell = fract(g) - 0.5;
  float r = sqrt(clamp(amount, 0.0, 1.0)) * 0.55;
  float d = length(cell);
  float aa = max(fwidth(d), 0.02);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

// Ink coverage for a surface with relative light level 'shade' (1 = fully lit).
float comicInk(float shade) {
  vec3 an = abs(normalize(vComicNormal));
  vec2 p = (an.x > an.y && an.x > an.z) ? vComicPos.zy : ((an.y > an.z) ? vComicPos.xz : vComicPos.xy);
  p = p / uHatchSpacing + uBoil;
  float m1 = 1.0 - smoothstep(uHatchT1 - 0.03, uHatchT1 + 0.03, shade);
  float m2 = 1.0 - smoothstep(uHatchT2 - 0.03, uHatchT2 + 0.03, shade);
  float m3 = 1.0 - smoothstep(uHatchT2 * 0.65 - 0.03, uHatchT2 * 0.65 + 0.03, shade);
  float ink = comicDots(m1 * (0.35 + (uHatchT1 - shade) * 0.8)) * m1 * 0.75;
  ink = max(ink, comicStroke(p, 0.785, mix(0.09, 0.14, m3)) * m2);
  ink = max(ink, comicStroke(p, -0.785, 0.09) * m2);
  ink = max(ink, comicStroke(p * 1.4, 0.0, 0.11) * m3);
  return clamp(ink * uHatchStrength, 0.0, 1.0);
}
`;

const COMIC_FRAGMENT_SHADE = /* glsl */ `
  float comicShade = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.002);
  #ifndef COMIC_NO_HATCH
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, comicInk(comicShade));
  #endif
`;

// --- Facade additions --------------------------------------------------------

const FACADE_FRAGMENT_DECL = /* glsl */ `
uniform sampler2D uFacadeMap;
uniform sampler2D uFacadeGlow;
uniform vec2 uFacadeTile;     // meters per texture tile (x = width, y = upper-floor module height)
uniform float uGroundFloor;   // ground-floor band height in meters
`;

const FACADE_FRAGMENT_SAMPLE = /* glsl */ `
  vec3 fan = abs(normalize(vComicNormal));
  bool facadeRoof = fan.y > 0.6;
  float fu = ((fan.x > fan.z) ? vComicPos.z : vComicPos.x) / uFacadeTile.x;
  // Texture layout: bottom 25% = ground floor (shops), top 75% = repeating upper-floor module.
  float fv = vComicPos.y < uGroundFloor
    ? clamp(vComicPos.y / uGroundFloor, 0.0, 0.999) * 0.25
    : 0.25 + fract((vComicPos.y - uGroundFloor) / uFacadeTile.y) * 0.75;
  vec2 fuv = vec2(fu, fv);
  vec4 facadeTex = facadeRoof ? vec4(0.82, 0.8, 0.76, 1.0) : texture2D(uFacadeMap, fuv);
  float facadeGlow = facadeRoof ? 0.0 : texture2D(uFacadeGlow, fuv).r;
  diffuseColor.rgb *= facadeTex.rgb;
  // Street level stays bright; upper floors sink into the night tone.
  float facadeNight = smoothstep(5.0, 26.0, vComicPos.y) * uNightAmount;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uNight * 1.6, facadeNight);
`;

const FACADE_FRAGMENT_GLOW = /* glsl */ `
  // Lit windows ignore lighting and hatching: flat warm fills.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, facadeTex.rgb * 1.15, facadeGlow);
`;

export interface ComicMatOptions {
  map?: THREE.Texture;
  /** Hatch in object space (characters / moving things). */
  objectSpace?: boolean;
  /** Skip hatching entirely (e.g. the road, which has drawn texture detail). */
  noHatch?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
}

function injectCommon(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, surfaceUniforms);
  shader.vertexShader = COMIC_VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + COMIC_VERTEX_BODY);
  shader.fragmentShader = COMIC_FRAGMENT_DECL + shader.fragmentShader;
}

/** Toon + hatching material for solid surfaces. */
export function comicMat(color: number | THREE.Color, opts: ComicMatOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp,
    map: opts.map ?? null,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  mat.defines = {};
  if (opts.objectSpace) mat.defines.COMIC_OBJECT_SPACE = '';
  if (opts.noHatch) mat.defines.COMIC_NO_HATCH = '';
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + COMIC_FRAGMENT_SHADE);
  };
  mat.customProgramCacheKey = () => `comic:${opts.objectSpace ? 'obj' : 'world'}:${opts.noHatch ? 'nohatch' : 'hatch'}`;
  return mat;
}

export interface FacadeTextures {
  map: THREE.Texture;
  glow: THREE.Texture;
  /** Meters covered by one tile horizontally / one upper-floor module vertically. */
  tileWidth: number;
  moduleHeight: number;
}

/** Building facade material: drawn window grid sampled in world space. */
export function facadeMat(tex: FacadeTextures): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonRamp });
  const uniforms = {
    uFacadeMap: { value: tex.map },
    uFacadeGlow: { value: tex.glow },
    uFacadeTile: { value: new THREE.Vector2(tex.tileWidth, tex.moduleHeight) },
    uGroundFloor: { value: 4.2 },
  };
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = FACADE_FRAGMENT_DECL + shader.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FACADE_FRAGMENT_SAMPLE)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + COMIC_FRAGMENT_SHADE + FACADE_FRAGMENT_GLOW);
  };
  mat.customProgramCacheKey = () => 'comic:facade';
  return mat;
}

// --- Ink hulls ----------------------------------------------------------------

/** Shared back-face ink material for silhouettes; recolored on palette change. */
export const hullMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
onStyleChange(() => hullMaterial.color.set(activePalette().ink));
hullMaterial.color.set(activePalette().ink);

/** Layer used for things that should NOT produce edge-detected ink lines (hulls, FX, transparent). */
export const FX_LAYER = 1;

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Add an inverted-hull outline to every mesh under `root`: a slightly larger
 * back-face-only copy drawn in ink. Scaled per axis so the outline has a
 * constant thickness in meters even on long thin limbs.
 */
export function addInkHulls(root: THREE.Object3D, thickness = style.hullThickness): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.isHull && !(m.material as THREE.Material).transparent) meshes.push(m);
  });
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    _box.copy(geo.boundingBox!);
    _box.getSize(_size);
    _box.getCenter(_center);
    const hull = new THREE.Mesh(geo, hullMaterial);
    hull.userData.isHull = true;
    const sx = (_size.x + thickness * 2) / Math.max(_size.x, 1e-3);
    const sy = (_size.y + thickness * 2) / Math.max(_size.y, 1e-3);
    const sz = (_size.z + thickness * 2) / Math.max(_size.z, 1e-3);
    hull.scale.set(sx, sy, sz);
    // Scale about the geometry's own center, not the mesh origin.
    hull.position.set(_center.x * (1 - sx), _center.y * (1 - sy), _center.z * (1 - sz));
    hull.layers.set(FX_LAYER);
    mesh.add(hull);
  }
}

/** Put an object (and children) on the FX layer: rendered, but no edge lines. */
export function setFxLayer(root: THREE.Object3D): void {
  root.traverse((o) => o.layers.set(FX_LAYER));
}
