import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { style, activeGrade, onStyleChange, tickBoil } from './LookStyle';
import { FX_LAYER, GROUND_LAYER, RAIN_LAYER, reflectionUniforms } from './materials';

/**
 * Graphic-noir render pipeline.
 *
 *  1. Reflection  (high quality) – the `world` group is mirrored in Y and
 *     rendered at half resolution without ground/rain. Wet-ground materials
 *     sample it at their own screen position: an exact planar reflection.
 *  2. Scene       – HDR color + depth (MSAA on high quality).
 *  3. Ink         – thin ink lines from depth only: silhouettes from relative
 *     depth jumps, creases from the depth second derivative. Cheap (no extra
 *     scene pass) and restrained, so it reads as graphic novel, not cartoon.
 *  4. Bloom       – UnrealBloomPass over the HDR result (neon, lamps, windows).
 *  5. Final       – exposure + ACES filmic tone map, grade (lift/gain tint,
 *     saturation, contrast), chromatic aberration, lens rain, film grain,
 *     vignette, lightning, sprint speed lines.
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const INK_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uThickness;
uniform float uDepthTh;
uniform float uCreaseTh;
uniform float uInk;
uniform vec3 uInkColor;
uniform float uBoilAmount;
uniform vec2 uBoilSeed;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float viewZ(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  return (uNear * uFar) / (uFar - z * (uFar - uNear));
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  if (uInk <= 0.001) { gl_FragColor = vec4(col, 1.0); return; }
  vec2 frag = vUv * uRes;
  vec2 wob = (vec2(vnoise(frag / 40.0 + uBoilSeed * 7.0), vnoise(frag / 40.0 + 19.0 + uBoilSeed * 5.0)) - 0.5) * 2.0 * uBoilAmount;
  vec2 uv = vUv + wob / uRes;
  float t = uThickness * (0.8 + 0.4 * vnoise(frag / 80.0));
  vec2 px = vec2(t) / uRes;

  float c = viewZ(uv);
  float l = viewZ(uv - vec2(px.x, 0.0));
  float r = viewZ(uv + vec2(px.x, 0.0));
  float d = viewZ(uv - vec2(0.0, px.y));
  float u = viewZ(uv + vec2(0.0, px.y));

  // Silhouette: a neighbour is much farther away (line lands on the nearer object).
  float jump = max(max(l, r), max(d, u)) - c;
  float sil = smoothstep(uDepthTh, uDepthTh * 2.5, jump / c);
  // Crease: the depth slope changes (second derivative), normalised by distance.
  float crease = (abs(l + r - 2.0 * c) + abs(d + u - 2.0 * c)) / c;
  float cr = smoothstep(uCreaseTh * 0.02, uCreaseTh * 0.05, crease) * 0.55;
  float edge = max(sil, cr);
  // Fade with distance so the far city reads as atmosphere, not linework.
  edge *= 1.0 - smoothstep(25.0, 110.0, c);
  // Don't ink the sky.
  edge *= step(texture2D(tDepth, vUv).x, 0.9999);
  col = mix(col, uInkColor * col * 0.15, clamp(edge * uInk, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uGradeAmount;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
uniform float uLensRain;
uniform float uFlash;
uniform float uSpeedLines;
uniform vec3 uInkColor;
uniform float uAspect;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Narkowicz ACES fit.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Raindrops sitting on / sliding down the lens. Returns uv offset; w = rim darkening.
vec3 lensDrops(vec2 uv, float scale, float speed, float seed) {
  vec2 g = vec2(uv.x * uAspect, uv.y) * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id + seed);
  if (h < 0.78) return vec3(0.0);
  float life = fract(uTime * speed * (0.3 + h) + h * 9.0);
  vec2 c = vec2(hash(id + seed + 3.1) - 0.5, 0.35 - life * 0.7) * 0.6;
  float rad = 0.12 + 0.12 * hash(id + seed + 7.7);
  vec2 dv = f - c;
  dv.y *= 1.25;
  float dist = length(dv);
  float m = smoothstep(rad, rad * 0.75, dist) * smoothstep(1.0, 0.85, life);
  return vec3(-dv / rad * 0.035 * m, smoothstep(rad * 0.7, rad, dist) * m);
}

void main() {
  vec2 uv = vUv;
  float rim = 0.0;
  if (uLensRain > 0.001) {
    vec3 a = lensDrops(uv, 9.0, 0.05, 1.0);
    vec3 b = lensDrops(uv + 0.37, 16.0, 0.08, 5.0);
    uv += (a.xy + b.xy) * uLensRain;
    rim = (a.z + b.z) * uLensRain;
  }
  // Chromatic aberration grows toward the frame edge.
  vec2 cdir = (uv - 0.5);
  float ca = uCA * dot(cdir, cdir) * 4.0;
  vec3 col;
  col.r = texture2D(tColor, uv + cdir * ca).r;
  col.g = texture2D(tColor, uv).g;
  col.b = texture2D(tColor, uv - cdir * ca).b;

  col *= uExposure;
  col += vec3(uFlash * 0.35);
  col = aces(col);

  // Grade: lift shadows toward one tint, gain highlights toward another.
  vec3 graded = col;
  float lum = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = mix(vec3(lum), graded, uSaturation);
  graded = (graded - 0.5) * uContrast + 0.5;
  graded = graded * mix(vec3(1.0), uGain, 0.6) + uLift * (1.0 - smoothstep(0.0, 0.6, lum)) * 0.35;
  col = mix(col, clamp(graded, 0.0, 1.0), uGradeAmount);

  col *= 1.0 - rim * 0.25;

  // Sprint speed lines: thin light streaks at the frame edges (graphic-novel accent).
  if (uSpeedLines > 0.001) {
    vec2 c = (vUv - vec2(0.5, 0.55)) * vec2(uAspect, 1.0);
    float ang = atan(c.y, c.x);
    float streak = step(0.92, hash(vec2(floor(ang * 110.0), floor(uTime * 14.0))));
    col += vec3(0.75, 0.9, 0.85) * smoothstep(0.45, 0.95, length(c)) * streak * uSpeedLines * 0.35;
  }

  float v = length((vUv - 0.5) * vec2(uAspect, 1.0));
  col *= 1.0 - smoothstep(0.4, 1.15, v) * uVignette;
  col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class LookPipeline {
  private sceneTarget: THREE.WebGLRenderTarget;
  private reflTarget: THREE.WebGLRenderTarget;
  private inkTarget: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private inkQuad: THREE.Mesh;
  private finalQuad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private inkU;
  private finalU;
  private width = 1;
  private height = 1;
  private time = 0;
  private shadowsPrimed = false;
  private unsubscribe: () => void;
  /** Lightning wash 0..1 (decays automatically). */
  flash = 0;
  /** Sprint speed lines 0..1 (set by the scene). */
  speedLines = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depth, samples: 4 });
    this.reflTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.inkTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.85);

    this.inkU = {
      tColor: { value: this.sceneTarget.texture },
      tDepth: { value: depth as THREE.Texture },
      uRes: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 300 },
      uThickness: { value: 1 },
      uDepthTh: { value: 0.04 },
      uCreaseTh: { value: 0.6 },
      uInk: { value: 0.5 },
      uInkColor: { value: new THREE.Color() },
      uBoilAmount: { value: 0 },
      uBoilSeed: { value: new THREE.Vector2() },
    };
    this.finalU = {
      tColor: { value: this.inkTarget.texture },
      uRes: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uExposure: { value: 1 },
      uLift: { value: new THREE.Color() },
      uGain: { value: new THREE.Color() },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uGradeAmount: { value: 0.7 },
      uCA: { value: 0.002 },
      uGrain: { value: 0.05 },
      uVignette: { value: 0.4 },
      uLensRain: { value: 0.5 },
      uFlash: { value: 0 },
      uSpeedLines: { value: 0 },
      uInkColor: { value: new THREE.Color() },
      uAspect: { value: 1 },
    };
    const quad = new THREE.PlaneGeometry(2, 2);
    this.inkQuad = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: INK_FRAG, uniforms: this.inkU, depthTest: false, depthWrite: false }));
    this.finalQuad = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: FINAL_FRAG, uniforms: this.finalU, depthTest: false, depthWrite: false }));
    for (const q of [this.inkQuad, this.finalQuad]) {
      q.frustumCulled = false;
      this.quadScene.add(q);
    }

    this.unsubscribe = onStyleChange(() => this.syncStyle());
    this.syncStyle();
  }

  private get high(): boolean {
    return style.quality === 'high';
  }

  private syncStyle(): void {
    const g = activeGrade();
    const i = this.inkU;
    i.uThickness.value = style.outlineThickness;
    i.uDepthTh.value = style.depthEdgeThreshold;
    i.uCreaseTh.value = style.normalEdgeThreshold;
    i.uInk.value = style.inkLines;
    i.uInkColor.value.set(g.ink);
    i.uBoilAmount.value = style.boil ? style.boilAmount : 0;
    const f = this.finalU;
    f.uExposure.value = style.exposure;
    f.uLift.value.set(g.shadows);
    f.uGain.value.set(g.highlights);
    f.uSaturation.value = g.saturation;
    f.uContrast.value = g.contrast;
    f.uGradeAmount.value = style.gradeAmount;
    f.uCA.value = style.chromaticAberration;
    f.uGrain.value = style.filmGrain;
    f.uVignette.value = style.vignette;
    f.uLensRain.value = style.lensRain;
    f.uInkColor.value.set(g.ink);
    this.bloom.strength = style.bloomStrength;
    this.bloom.radius = style.bloomRadius;
    this.bloom.threshold = style.bloomThreshold;
    reflectionUniforms.uReflStrength.value = style.reflections;
    reflectionUniforms.uWetness.value = style.wetness;
    this.setSize(this.width, this.height);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * pr));
    const h = Math.max(1, Math.floor(height * pr));
    this.sceneTarget.setSize(w, h);
    this.sceneTarget.samples = this.high ? 4 : 0;
    this.inkTarget.setSize(w, h);
    this.reflTarget.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.bloom.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.inkU.uRes.value.set(w, h);
    this.finalU.uRes.value.set(w, h);
    this.finalU.uAspect.value = w / h;
    reflectionUniforms.uScreen.value.set(w, h);
  }

  lightning(strength = 1): void {
    this.flash = Math.max(this.flash, strength);
  }

  /**
   * @param world the group mirrored for reflections (everything except the camera-locked bits).
   */
  render(scene: THREE.Scene, world: THREE.Object3D, camera: THREE.PerspectiveCamera, dt: number): void {
    const r = this.renderer;
    this.time += dt;
    const boil = tickBoil(this.time);
    this.inkU.uBoilSeed.value.set(boil * 1.37, boil * 2.11);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.finalU.uFlash.value = this.flash;
    this.finalU.uTime.value = this.time;
    this.finalU.uSpeedLines.value = this.speedLines * style.speedLines;
    this.inkU.uNear.value = camera.near;
    this.inkU.uFar.value = camera.far;
    reflectionUniforms.uTime.value = this.time;

    const prevMask = camera.layers.mask;

    // 1. Mirrored reflection pass (previous frame's shadow map is reused).
    const useRefl = this.high && style.reflections > 0.01;
    reflectionUniforms.uHasReflection.value = useRefl ? 1 : 0;
    reflectionUniforms.tReflection.value = useRefl ? this.reflTarget.texture : null;
    if (useRefl && !this.shadowsPrimed) {
      // The shadow map only exists after its first update; build it before the
      // reflection pass samples it.
      r.shadowMap.enabled = this.high && style.shadows;
      r.shadowMap.needsUpdate = true;
      this.shadowsPrimed = true;
    }
    if (useRefl) {
      camera.layers.set(0);
      camera.layers.enable(FX_LAYER);
      world.scale.y = -1;
      world.updateMatrixWorld(true);
      r.setRenderTarget(this.reflTarget);
      r.clear();
      r.render(scene, camera);
      world.scale.y = 1;
      world.updateMatrixWorld(true);
    }

    // 2. Main scene pass (shadows refresh here).
    camera.layers.set(0);
    camera.layers.enable(FX_LAYER);
    camera.layers.enable(GROUND_LAYER);
    camera.layers.enable(RAIN_LAYER);
    r.shadowMap.enabled = this.high && style.shadows;
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.sceneTarget);
    r.clear();
    r.render(scene, camera);
    camera.layers.mask = prevMask;

    // 3. Ink composite.
    this.inkQuad.visible = true;
    this.finalQuad.visible = false;
    r.setRenderTarget(this.inkTarget);
    r.render(this.quadScene, this.quadCamera);

    // 4. Bloom (adds into inkTarget).
    if (style.bloomStrength > 0.01) this.bloom.render(r, this.inkTarget, this.inkTarget, dt, false);

    // 5. Final grade to screen.
    this.inkQuad.visible = false;
    this.finalQuad.visible = true;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.unsubscribe();
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.reflTarget.dispose();
    this.inkTarget.dispose();
    this.bloom.dispose();
    for (const q of [this.inkQuad, this.finalQuad]) (q.material as THREE.Material).dispose();
    this.inkQuad.geometry.dispose();
    reflectionUniforms.tReflection.value = null;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.autoUpdate = true;
  }
}
