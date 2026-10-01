import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { activeGrade } from './LookStyle';

/**
 * Image-based lighting + sky.
 *
 * The environment map is rendered once from a tiny procedural "city at
 * night" scene (dark gradient dome, scattered warm windows, neon panels) and
 * prefiltered with PMREM. It gives glass, car paint, wet surfaces and leather
 * believable reflections without any image assets.
 */
export function buildEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const g = activeGrade();
  const scene = new THREE.Scene();
  const rng = new Rng(1234);

  // Gradient dome via vertex colors.
  const dome = new THREE.SphereGeometry(50, 32, 16);
  const colors: number[] = [];
  const top = new THREE.Color(g.skyTop);
  const hor = new THREE.Color(g.skyHorizon).multiplyScalar(1.4);
  const ground = new THREE.Color(0x0b0d0e);
  const pos = dome.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(ground, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // City lights around the horizon: warm windows and a few strong neon panels.
  const panel = new THREE.PlaneGeometry(1, 1);
  const neon = [0x3dff9a, 0x2de8ec, 0xff3fae, 0xffb347];
  for (let i = 0; i < 110; i++) {
    const a = rng.range(0, Math.PI * 2);
    const y = rng.range(-2, 14);
    const isNeon = rng.chance(0.12);
    const color = new THREE.Color(isNeon ? rng.pick(neon) : rng.pick([0xffcf8a, 0xffe2b0, 0xbfe8ff])).multiplyScalar(isNeon ? 2.5 : 0.9);
    const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    const r = 40;
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.lookAt(0, y, 0);
    m.scale.set(isNeon ? rng.range(1, 3) : rng.range(0.6, 1.6), isNeon ? rng.range(2, 6) : rng.range(0.8, 1.4), 1);
    scene.add(m);
  }
  // Soft overhead city glow.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(30, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(g.cityGlow).multiplyScalar(0.12), side: THREE.DoubleSide }));
  glow.position.y = 30;
  glow.rotation.x = Math.PI / 2;
  scene.add(glow);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  return env;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uMoonColor;
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uFlash;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
  // Cloud deck projected onto a plane overhead; drifts slowly.
  vec2 cp = d.xz / max(h + 0.12, 0.05) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float cloud = smoothstep(0.42, 0.85, fbm(cp));
  // Clouds are lit from below by the city, more strongly near the horizon.
  vec3 cloudCol = mix(uGlow * 0.55, uGlow * 0.18, smoothstep(0.0, 0.6, h));
  col = mix(col, cloudCol, cloud * 0.85 * smoothstep(-0.05, 0.08, h));
  // Moon: soft halo + disc, dimmed by cloud cover.
  float md = max(dot(d, normalize(uMoonDir)), 0.0);
  col += uMoonColor * (pow(md, 600.0) * 3.0 + pow(md, 18.0) * 0.12) * (1.0 - cloud * 0.7);
  // Lightning lights the clouds from inside.
  col += uGlow * uFlash * (0.6 + cloud * 2.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Big sky dome that follows the camera. Rendered first, at the far plane. */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uMoonColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0.35, 0.45, -1) },
    uTime: { value: 0 },
    uFlash: { value: 0 },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.syncGrade();
  }

  syncGrade(): void {
    const g = activeGrade();
    this.uniforms.uTop.value.set(g.skyTop);
    this.uniforms.uHorizon.value.set(g.skyHorizon);
    this.uniforms.uGlow.value.set(g.cityGlow);
    this.uniforms.uMoonColor.value.set(g.moon);
  }

  update(dt: number, camPos: THREE.Vector3, flash: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uFlash.value = flash;
    this.mesh.position.copy(camPos);
  }
}
