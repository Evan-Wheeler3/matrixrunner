import * as THREE from 'three';
import { surfaceUniforms, activeGrade, onStyleChange, style } from './LookStyle';

/**
 * Graphic-noir surface materials.
 *
 * Base: MeshStandardMaterial (PBR, smooth shading, reacts to the city env map
 * and point lights). `onBeforeCompile` adds a restrained graphic-novel layer:
 * fine cross-hatching that appears only in the deepest shadows, locked to
 * world space (or object space for characters) so it never swims.
 */

/** Render layers. 0 = solids (default). */
export const FX_LAYER = 1; // transparent FX: light cones, steam, glows
export const GROUND_LAYER = 2; // wet ground: excluded from the reflection pass
export const RAIN_LAYER = 3; // rain streaks: excluded from reflections

const VERT_DECL = /* glsl */ `
varying vec3 vLookPos;
varying vec3 vLookNormal;
`;

const VERT_BODY = /* glsl */ `
#ifdef LOOK_OBJECT_SPACE
  vLookPos = transformed;
  vLookNormal = objectNormal;
#else
  vec4 lookWorld = vec4(transformed, 1.0);
  vec3 lookN = objectNormal;
  #ifdef USE_INSTANCING
    lookWorld = instanceMatrix * lookWorld;
    lookN = mat3(instanceMatrix) * lookN;
  #endif
  lookWorld = modelMatrix * lookWorld;
  vLookPos = lookWorld.xyz;
  vLookNormal = mat3(modelMatrix) * lookN;
#endif
`;

const FRAG_DECL = /* glsl */ `
uniform vec3 uInk;
uniform float uHatchSpacing;
uniform float uHatchStrength;
uniform float uHatchThreshold;
uniform float uBoilAmount;
uniform vec2 uBoil;
uniform vec3 uRimColor;
uniform float uRimStrength;
varying vec3 vLookPos;
varying vec3 vLookNormal;

float lookStroke(vec2 p, float ang, float width) {
  float c = p.x * cos(ang) + p.y * sin(ang);
  c += sin(p.x * sin(ang) - p.y * cos(ang) + uBoil.x * 6.2831) * 0.08 * uBoilAmount;
  float fw = fwidth(c);
  float d = abs(fract(c) - 0.5);
  float line = 1.0 - smoothstep(width - fw, width + fw, d);
  return mix(line, 2.0 * width, smoothstep(0.3, 0.7, fw));
}

// Ink coverage for relative light level 'shade': only the deepest shadows get marks.
float lookHatch(float shade) {
  vec3 an = abs(normalize(vLookNormal));
  vec2 p = (an.x > an.y && an.x > an.z) ? vLookPos.zy : ((an.y > an.z) ? vLookPos.xz : vLookPos.xy);
  p = p / uHatchSpacing + uBoil;
  float m1 = 1.0 - smoothstep(uHatchThreshold - 0.08, uHatchThreshold + 0.04, shade);
  float m2 = 1.0 - smoothstep(uHatchThreshold * 0.5 - 0.05, uHatchThreshold * 0.5 + 0.03, shade);
  float ink = lookStroke(p, 0.785, 0.07) * m1;
  ink = max(ink, lookStroke(p, -0.785, 0.07) * m2);
  return clamp(ink * uHatchStrength, 0.0, 1.0);
}
`;

// Fresnel rim on characters so dark clothing still reads against a dark street.
const FRAG_RIM = /* glsl */ `
#ifdef LOOK_OBJECT_SPACE
  {
    float rimNdv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
    gl_FragColor.rgb += uRimColor * pow(1.0 - rimNdv, 3.0) * uRimStrength;
  }
#endif
`;

const FRAG_HATCH = /* glsl */ `
#ifndef LOOK_NO_HATCH
  {
    float lookShade = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.004);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, lookHatch(lookShade));
  }
#endif
`;

function injectCommon(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, surfaceUniforms);
  shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
  shader.fragmentShader = FRAG_DECL + shader.fragmentShader;
}

export interface LitOptions extends Partial<THREE.MeshStandardMaterialParameters> {
  /** Hatch in object space (characters / moving things). */
  objectSpace?: boolean;
  noHatch?: boolean;
}

/** PBR surface with the graphic-noir hatching layer. */
export function litMat(color: number | THREE.Color, opts: LitOptions = {}): THREE.MeshStandardMaterial {
  const { objectSpace, noHatch, ...params } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.8, ...params });
  mat.defines = { ...(objectSpace ? { LOOK_OBJECT_SPACE: '' } : {}), ...(noHatch ? { LOOK_NO_HATCH: '' } : {}) };
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FRAG_HATCH + FRAG_RIM);
  };
  mat.customProgramCacheKey = () => `look:${objectSpace ? 'o' : 'w'}:${noHatch ? 'n' : 'h'}`;
  return mat;
}

// -----------------------------------------------------------------------------
// Facades: PBR maps sampled with world-space UVs
// -----------------------------------------------------------------------------

export interface FacadeSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** g = roughness, b = metalness (three.js ORM convention). */
  orm: THREE.Texture;
  emissive: THREE.Texture;
  /** Meters covered by one tile horizontally / one upper-floor module vertically. */
  tileWidth: number;
  moduleHeight: number;
}

const FACADE_DECL = /* glsl */ `
uniform sampler2D uFAlbedo;
uniform sampler2D uFNormal;
uniform sampler2D uFOrm;
uniform sampler2D uFEmissive;
uniform vec2 uFTile;
uniform float uGroundFloor;
uniform float uEmissiveBoost;
`;

const FACADE_UV = /* glsl */ `
  vec3 fWorldN = normalize(vLookNormal);
  vec3 fan = abs(fWorldN);
  bool fRoof = fan.y > 0.6;
  bool fXFacing = fan.x > fan.z;
  float fu = (fXFacing ? vLookPos.z : vLookPos.x) / uFTile.x;
  // Texture layout: bottom 25% = ground floor, top 75% = repeating two-storey module.
  float fv = vLookPos.y < uGroundFloor
    ? clamp(vLookPos.y / uGroundFloor, 0.002, 0.998) * 0.25
    : 0.25 + fract((vLookPos.y - uGroundFloor) / uFTile.y) * 0.75;
  vec2 fuv = vec2(fu, fv);
  vec4 fAlbedo = fRoof ? vec4(0.32, 0.33, 0.33, 1.0) : texture2D(uFAlbedo, fuv);
  diffuseColor.rgb *= fAlbedo.rgb;
`;

const FACADE_ROUGH = /* glsl */ `
  vec4 fOrm = fRoof ? vec4(1.0, 0.8, 0.0, 1.0) : texture2D(uFOrm, fuv);
  roughnessFactor = fOrm.g;
`;

const FACADE_METAL = /* glsl */ `
  metalnessFactor = fOrm.b;
`;

const FACADE_NORMAL = /* glsl */ `
  if (!fRoof) {
    vec3 tn = texture2D(uFNormal, fuv).xyz * 2.0 - 1.0;
    vec3 T = fXFacing ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 B = vec3(0.0, 1.0, 0.0);
    vec3 wn = normalize(T * tn.x + B * tn.y + fWorldN * tn.z);
    normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  }
`;

const FACADE_EMISSIVE = /* glsl */ `
  if (!fRoof) totalEmissiveRadiance += texture2D(uFEmissive, fuv).rgb * uEmissiveBoost;
`;

/** Building facade: brick/concrete/glass detail from drawn PBR maps at a constant world scale. */
export function facadeMat(set: FacadeSet): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 0.9 });
  const uniforms = {
    uFAlbedo: { value: set.albedo },
    uFNormal: { value: set.normal },
    uFOrm: { value: set.orm },
    uFEmissive: { value: set.emissive },
    uFTile: { value: new THREE.Vector2(set.tileWidth, set.moduleHeight) },
    uGroundFloor: { value: 4.2 },
    uEmissiveBoost: { value: 0.6 },
  };
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = FACADE_DECL + shader.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FACADE_UV)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FACADE_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FACADE_METAL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FACADE_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FACADE_EMISSIVE)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FRAG_HATCH);
  };
  mat.customProgramCacheKey = () => 'look:facade';
  return mat;
}

// -----------------------------------------------------------------------------
// Wet ground with screen-space planar reflections
// -----------------------------------------------------------------------------

/** Shared reflection inputs (set by the pipeline every frame). */
export const reflectionUniforms = {
  tReflection: { value: null as THREE.Texture | null },
  uScreen: { value: new THREE.Vector2(1, 1) },
  uReflStrength: { value: 0.85 },
  uWetness: { value: 0.8 },
  uHasReflection: { value: 0 },
  uTime: { value: 0 },
};

const GROUND_DECL = /* glsl */ `
uniform sampler2D tReflection;
uniform vec2 uScreen;
uniform float uReflStrength;
uniform float uWetness;
uniform float uHasReflection;
uniform float uTime;

// Expanding rain-ripple rings on a grid of cells (world-space xz).
vec2 lookRipple(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float t = fract(uTime * 0.9 + h);
  vec2 c = vec2(fract(h * 7.1), fract(h * 3.7)) - 0.5;
  vec2 d = f - c * 0.6;
  float r = length(d);
  float ring = sin((r - t * 0.45) * 60.0) * (1.0 - t) * smoothstep(0.45 * t + 0.06, 0.45 * t, r);
  return d / max(r, 1e-3) * ring;
}
`;

const GROUND_BODY = /* glsl */ `
  {
    float puddle = texture2D(roughnessMap, vRoughnessMapUv).r;
    float wet = clamp(uWetness * (0.45 + puddle * 0.8), 0.0, 1.0);
    vec2 rip = (lookRipple(vLookPos.xz * 3.0) + lookRipple(vLookPos.xz * 1.7 + 4.0)) * (0.4 + puddle);
    vec3 vn = normalize(normal + vec3(rip.x, 0.0, rip.y) * 0.15);
    vec3 viewDir = normalize(vViewPosition);
    float ndv = clamp(dot(viewDir, vn), 0.0, 1.0);
    float fres = mix(0.22, 1.0, pow(1.0 - ndv, 3.0));
    // Wet surfaces get darker and more saturated.
    gl_FragColor.rgb *= mix(1.0, 0.55, wet);
    if (uHasReflection > 0.5) {
      vec2 suv = gl_FragCoord.xy / uScreen + vn.xy * 0.035 + rip * 0.012;
      // Rough wet asphalt smears reflections into vertical streaks.
      float spread = mix(0.004, 0.03, roughnessFactor) * (1.0 - puddle * 0.75);
      vec3 refl = texture2D(tReflection, suv).rgb * 0.3;
      refl += texture2D(tReflection, suv + vec2(0.0, spread)).rgb * 0.22;
      refl += texture2D(tReflection, suv - vec2(0.0, spread)).rgb * 0.22;
      refl += texture2D(tReflection, suv + vec2(spread * 0.15, spread * 2.2)).rgb * 0.13;
      refl += texture2D(tReflection, suv - vec2(spread * 0.15, spread * 2.2)).rgb * 0.13;
      gl_FragColor.rgb += refl * fres * wet * uReflStrength;
    }
  }
`;

/** Wet asphalt / pavement: PBR maps (map, normal, ORM with puddle mask in R) + mirrored reflections. */
export function wetGroundMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.5, ...params });
  mat.defines = { LOOK_NO_HATCH: '' };
  mat.onBeforeCompile = (shader) => {
    injectCommon(shader);
    Object.assign(shader.uniforms, reflectionUniforms);
    shader.fragmentShader = GROUND_DECL + shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + GROUND_BODY);
  };
  mat.customProgramCacheKey = () => 'look:ground';
  return mat;
}

// -----------------------------------------------------------------------------
// Character silhouettes
// -----------------------------------------------------------------------------

export const hullMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
onStyleChange(() => hullMaterial.color.set(activeGrade().ink));
hullMaterial.color.set(activeGrade().ink);

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Thin inverted-hull outline on every mesh under `root` – the graphic-novel
 * silhouette. Scaled per axis for a constant thickness in meters.
 */
export function addInkHulls(root: THREE.Object3D, thickness = style.hullThickness): void {
  if (thickness <= 0) return;
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
    hull.position.set(_center.x * (1 - sx), _center.y * (1 - sy), _center.z * (1 - sz));
    hull.castShadow = false;
    mesh.add(hull);
  }
}

/** Put an object (and children) on a render layer. */
export function setLayer(root: THREE.Object3D, layer: number): void {
  root.traverse((o) => o.layers.set(layer));
}
