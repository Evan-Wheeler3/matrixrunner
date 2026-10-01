import * as THREE from 'three';
import { style, activePalette, onStyleChange, tickBoil } from './ComicStyle';
import { FX_LAYER } from './comicMaterials';

/**
 * Comic post-processing.
 *
 *  1. Scene pass  -> color + depth texture (all layers).
 *  2. Normal pass -> view-space normals (layer 0 only: solids. FX/transparent
 *                    objects and ink hulls are excluded so they get no lines).
 *  3. Composite   -> one fullscreen shader:
 *       ink lines from depth + normal edges (variable weight, wobbly "boil"),
 *       halftone night sky with an inked moon, palette grade, exposure,
 *       lightning wash, sprint speed lines, paper grain.
 *
 * Why this combo: edge detection gives every object consistent ink lines
 * (including instanced scenery) for one extra pass; the boil and weight
 * variation happen in the composite so lines look hand-drawn while geometry
 * motion stays perfectly smooth.
 */

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uThickness;
uniform float uDepthTh;
uniform float uNormalTh;
uniform float uBoilAmount;
uniform vec2 uBoilSeed;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uSkyInk;
uniform vec3 uTint;
uniform float uSaturation;
uniform float uHalftone;
uniform float uGrain;
uniform float uExposure;
uniform float uFlash;
uniform float uSpeedLines;
uniform float uAspect;
uniform vec3 uNight;
uniform float uNightAmount;
uniform float uSkyDark;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float viewZ(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  return (uNear * uFar) / (uFar - z * (uFar - uNear));
}
vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

// Edge strength at uv with a sample radius in pixels.
float edgeAt(vec2 uv, float radius) {
  vec2 px = radius / uRes;
  float d0 = viewZ(uv);
  vec3 n0 = normalAt(uv);
  float de = 0.0;
  float ne = 0.0;
  vec2 offs[8];
  offs[0] = vec2(1, 0); offs[1] = vec2(-1, 0); offs[2] = vec2(0, 1); offs[3] = vec2(0, -1);
  offs[4] = vec2(0.7, 0.7); offs[5] = vec2(-0.7, 0.7); offs[6] = vec2(0.7, -0.7); offs[7] = vec2(-0.7, -0.7);
  for (int i = 0; i < 8; i++) {
    vec2 suv = uv + offs[i] * px;
    // Only count neighbours that are farther away: the line lands on the
    // nearer object, so silhouettes read as that object's outline.
    float d = viewZ(suv);
    de = max(de, (d - d0) / d0);
    ne = max(ne, 1.0 - dot(n0, normalAt(suv)));
  }
  float e = smoothstep(uDepthTh, uDepthTh * 2.0, de);
  // Creases are drawn lighter than silhouettes -> natural line-weight variation.
  e = max(e, smoothstep(uNormalTh, uNormalTh * 1.6, ne) * 0.8);
  // Thin out lines in the far distance.
  e *= 1.0 - smoothstep(55.0, 150.0, d0) * 0.75;
  return e;
}

vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, uSaturation) * uTint;
}

float paper(vec2 frag) {
  // Static page texture: fibres + blotchy tooth (doesn't move with the camera).
  float n = vnoise(frag * 0.9) * 0.5 + vnoise(frag * 0.23) * 0.3 + vnoise(frag * 0.05) * 0.2;
  float fibre = smoothstep(0.75, 1.0, vnoise(vec2(frag.x * 0.04, frag.y * 0.9)));
  return n * 0.85 + fibre * 0.4;
}

void main() {
  vec2 frag = vUv * uRes;
  float rawDepth = texture2D(tDepth, vUv).x;

  // Hand-drawn wobble: displace where we look for edges by a low-frequency
  // noise field that jumps between boil poses.
  vec2 wob = vec2(vnoise(frag / 38.0 + uBoilSeed * 7.0), vnoise(frag / 38.0 + 19.0 + uBoilSeed * 5.0)) - 0.5;
  vec2 euv = vUv + wob * 2.0 * uBoilAmount / uRes;
  // Line weight varies along strokes like a brush/nib.
  float weight = uThickness * (0.7 + 0.6 * vnoise(frag / 70.0 + uBoilSeed * 3.0));
  float edge = edgeAt(euv, weight);

  vec3 col;
  if (rawDepth >= 0.99999) {
    // Sky: paper with a halftone gradient getting denser toward the top.
    float t = smoothstep(0.32, 1.0, vUv.y) * uSkyDark;
    vec2 g = mat2(0.966, -0.259, 0.259, 0.966) * (frag / uHalftone);
    float r = sqrt(t) * 0.78;
    float dd = length(fract(g) - 0.5);
    float dots = 1.0 - smoothstep(r - 0.06, r + 0.06, dd);
    col = mix(uPaper * 0.96, uSkyInk, dots);
    // Inked moon disc.
    vec2 mp = (vUv - vec2(0.8, 0.84)) * vec2(uAspect, 1.0);
    float md = length(mp);
    float moon = 1.0 - smoothstep(0.058, 0.061, md);
    col = mix(col, uPaper * 1.04, moon);
    col = mix(col, uInk, (1.0 - smoothstep(0.0, 0.004, abs(md - 0.06))));
    // A few crescent hatch strokes on the moon.
    float mh = step(0.5, fract((mp.x + mp.y) * 140.0)) * moon * smoothstep(0.0, 0.05, mp.x + 0.03);
    col = mix(col, uInk, mh * 0.5);
  } else {
    col = texture2D(tColor, vUv).rgb * uExposure;
  }

  col = grade(col);
  // Split tone: darker values drift toward the night color.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * uNight * 2.2, (1.0 - smoothstep(0.08, 0.7, lum)) * uNightAmount * 0.5);
  // Lightning washes the page to near-white, but darks stay dark -> stark silhouettes.
  col = mix(col, uPaper * 1.08, uFlash * 0.9 * smoothstep(0.05, 0.22, lum));
  col = mix(col, uInk, clamp(edge, 0.0, 1.0));

  // Sprint speed lines: radial ink streaks near the frame edges.
  if (uSpeedLines > 0.001) {
    vec2 c = (vUv - vec2(0.5, 0.55)) * vec2(uAspect, 1.0);
    float ang = atan(c.y, c.x);
    float rad = length(c);
    float streak = step(0.86, hash(vec2(floor(ang * 70.0), uBoilSeed.x)));
    float mask = smoothstep(0.38, 0.85, rad) * streak * uSpeedLines;
    col = mix(col, uInk, mask * 0.85);
  }

  // Paper grain multiplies everything, including the ink.
  float p = paper(frag);
  col *= mix(1.0, 0.82 + p * 0.3, uGrain);
  // Soft page vignette.
  float v = length((vUv - 0.5) * vec2(uAspect, 1.0));
  col *= 1.0 - smoothstep(0.55, 1.1, v) * 0.18;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Raw (linear) clear value that decodes to a normal of (0, 0, 1). */
const SKY_NORMAL = new THREE.Color().setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace);

export class ComicPipeline {
  private colorTarget: THREE.WebGLRenderTarget;
  private normalTarget: THREE.WebGLRenderTarget;
  private normalMaterial = new THREE.MeshNormalMaterial({ flatShading: true });
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms;
  /** 0..1, decays automatically. */
  flash = 0;
  /** 0..1 speed line intensity (set by the scene each frame). */
  speedLines = 0;
  private time = 0;
  private savedClear = new THREE.Color();
  private unsubscribe: () => void;
  private width = 1;
  private height = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    const depthTex = new THREE.DepthTexture(1, 1);
    depthTex.type = THREE.UnsignedIntType;
    this.colorTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depthTex });
    this.normalTarget = new THREE.WebGLRenderTarget(1, 1);

    this.uniforms = {
      tColor: { value: this.colorTarget.texture },
      tDepth: { value: depthTex as THREE.Texture },
      tNormal: { value: this.normalTarget.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 260 },
      uThickness: { value: 1.5 },
      uDepthTh: { value: 0.03 },
      uNormalTh: { value: 0.4 },
      uBoilAmount: { value: 1 },
      uBoilSeed: { value: new THREE.Vector2() },
      uInk: { value: new THREE.Color() },
      uPaper: { value: new THREE.Color() },
      uSkyInk: { value: new THREE.Color() },
      uTint: { value: new THREE.Color() },
      uSaturation: { value: 1 },
      uHalftone: { value: 7 },
      uGrain: { value: 0.35 },
      uExposure: { value: 1 },
      uFlash: { value: 0 },
      uSpeedLines: { value: 0 },
      uAspect: { value: 1 },
      uNight: { value: new THREE.Color() },
      uNightAmount: { value: 0.6 },
      uSkyDark: { value: 0.75 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.unsubscribe = onStyleChange(() => this.syncStyle());
    this.syncStyle();
  }

  private syncStyle(): void {
    const u = this.uniforms;
    const pal = activePalette();
    u.uThickness.value = style.outlineThickness;
    u.uDepthTh.value = style.depthEdgeThreshold;
    u.uNormalTh.value = style.normalEdgeThreshold;
    u.uBoilAmount.value = style.boil ? style.boilAmount : 0;
    u.uInk.value.set(pal.ink);
    u.uPaper.value.set(pal.paper);
    u.uSkyInk.value.set(pal.skyInk);
    u.uTint.value.set(pal.tint);
    u.uSaturation.value = pal.saturation;
    u.uHalftone.value = style.halftoneSize;
    u.uGrain.value = style.paperGrain;
    u.uExposure.value = style.exposure;
    u.uNight.value.set(pal.night);
    u.uNightAmount.value = style.nightAmount;
    u.uSkyDark.value = style.skyDarkness;
    this.setSize(this.width, this.height);
  }

  /** Width/height in CSS pixels. */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * pr));
    const h = Math.max(1, Math.floor(height * pr));
    this.colorTarget.setSize(w, h);
    const ns = style.quality === 'low' ? 0.5 : 1;
    this.normalTarget.setSize(Math.max(1, Math.floor(w * ns)), Math.max(1, Math.floor(h * ns)));
    this.uniforms.uRes.value.set(w, h);
    this.uniforms.uAspect.value = w / h;
  }

  /** Trigger a lightning wash (0..1). */
  lightning(strength = 1): void {
    this.flash = Math.max(this.flash, strength);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number): void {
    const r = this.renderer;
    this.time += dt;
    const boilFrame = tickBoil(this.time);
    this.uniforms.uBoilSeed.value.set(boilFrame * 1.37, boilFrame * 2.11);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.uniforms.uFlash.value = this.flash;
    this.uniforms.uSpeedLines.value = this.speedLines * style.speedLines;
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;

    // 1. Color + depth, everything visible.
    const prevMask = camera.layers.mask;
    camera.layers.enable(0);
    camera.layers.enable(FX_LAYER);
    r.setRenderTarget(this.colorTarget);
    r.clear();
    r.render(scene, camera);

    // 2. Normals of solid geometry only.
    camera.layers.set(0);
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.overrideMaterial = this.normalMaterial;
    scene.background = null;
    scene.fog = null;
    r.setRenderTarget(this.normalTarget);
    r.getClearColor(this.savedClear);
    const savedAlpha = r.getClearAlpha();
    r.setClearColor(SKY_NORMAL, 1); // "facing camera" normal for the sky
    r.clear();
    r.render(scene, camera);
    r.setClearColor(this.savedClear, savedAlpha);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    scene.fog = prevFog;
    camera.layers.mask = prevMask;

    // 3. Composite to screen.
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.unsubscribe();
    this.colorTarget.depthTexture?.dispose();
    this.colorTarget.dispose();
    this.normalTarget.dispose();
    this.normalMaterial.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.quad.geometry.dispose();
  }
}
