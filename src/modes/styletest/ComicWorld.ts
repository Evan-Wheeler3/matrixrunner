import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Rng } from '../../core/rng';
import { PALETTE } from '../../render/palette';
import { ChaseCamera, type ChaseTarget } from '../../render/ChaseCamera';
import { comicMat, FX_LAYER } from '../../render/comic/comicMaterials';
import { comicRoadTexture, comicSidewalkTexture, shadowBlobTexture, skylineTexture } from '../../render/comic/comicTextures';
import { activePalette, onStyleChange, style } from '../../render/comic/ComicStyle';

const L = CONFIG.level;
const ROAD_TILE = 12;
const GROUND_LENGTH = 360;

/**
 * Comic-style frame for a street run: bright key lighting, pale haze, inked
 * ground, pencil-stroke rain, and flat cut-out skyline layers for parallax.
 */
export class ComicWorld {
  readonly scene = new THREE.Scene();
  readonly chase: ChaseCamera;
  private ground: THREE.Group;
  private rain: PencilRain;
  private skyline: THREE.Mesh[] = [];
  private neonA: THREE.PointLight;
  private neonB: THREE.PointLight;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private shadowTex = shadowBlobTexture();
  private unsubscribe: () => void;
  /** Extra light during a lightning flash (0..1). */
  flash = 0;

  constructor(aspect: number) {
    this.chase = new ChaseCamera(aspect, 280);
    this.chase.camera.layers.enable(FX_LAYER);
    this.scene.fog = new THREE.FogExp2(0xffffff, style.fogDensity);
    this.scene.background = new THREE.Color();

    // Bright, readable light: warm key from behind the camera, cool rim from ahead.
    this.hemi = new THREE.HemisphereLight(0xfff3df, 0x8d93a0, 1.6);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0d6, 2.6);
    this.key.position.set(5, 10, 7);
    this.scene.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight(0x9fe8ff, 1.0);
    rim.position.set(-6, 5, -9);
    this.scene.add(rim, rim.target);
    // Two neon washes that travel ahead of the runner (teal left, magenta right).
    this.neonA = new THREE.PointLight(PALETTE.neon.teal, 10, 20, 1.3);
    this.neonB = new THREE.PointLight(PALETTE.neon.magenta, 10, 20, 1.3);
    this.scene.add(this.neonA, this.neonB);

    this.ground = this.buildGround();
    this.scene.add(this.ground);
    this.buildSkyline();
    this.rain = new PencilRain();
    this.scene.add(this.rain.mesh);

    this.unsubscribe = onStyleChange(() => this.syncStyle());
    this.syncStyle();
  }

  get camera(): THREE.PerspectiveCamera {
    return this.chase.camera;
  }

  private syncStyle(): void {
    const pal = activePalette();
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(pal.haze);
    fog.density = style.fogDensity;
    (this.scene.background as THREE.Color).set(pal.haze);
    this.rain.setColor(pal.ink);
  }

  private buildGround(): THREE.Group {
    const g = new THREE.Group();
    const roadW = L.streetHalfWidth * 2;
    const dividers: number[] = [];
    for (let i = 1; i < CONFIG.lanes.count; i++) dividers.push(0.5 + ((i - CONFIG.lanes.count / 2) * CONFIG.lanes.width) / roadW);
    const roadTex = comicRoadTexture(dividers);
    roadTex.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, GROUND_LENGTH), comicMat(0xffffff, { map: roadTex, noHatch: true }));
    road.rotation.x = -Math.PI / 2;
    g.add(road);

    const walkTex = comicSidewalkTexture();
    walkTex.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
    const walkMat = comicMat(0xffffff, { map: walkTex, noHatch: true });
    const curbMat = comicMat(0xd8d2c4);
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(L.sidewalkWidth, 0.16, GROUND_LENGTH), walkMat);
      walk.position.set(side * (L.streetHalfWidth + L.sidewalkWidth / 2), 0.08, 0);
      g.add(walk);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, GROUND_LENGTH), curbMat);
      curb.position.set(side * L.streetHalfWidth, 0.1, 0);
      g.add(curb);
    }
    const under = new THREE.Mesh(new THREE.PlaneGeometry(220, GROUND_LENGTH), comicMat(0xb5b0a5, { noHatch: true }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.02;
    g.add(under);
    return g;
  }

  /** Two flat skyline cut-outs far down the street; they slide slightly with lateral camera moves. */
  private buildSkyline(): void {
    const layers = [
      { seed: 3, fill: '#aeb9bd', win: '#f3e2a6', chance: 0.12, dist: 230, w: 640, h: 160, y: 46 },
      { seed: 8, fill: '#8f9ba1', win: '#f7c948', chance: 0.18, dist: 175, w: 520, h: 130, y: 30 },
    ];
    for (const l of layers) {
      const tex = skylineTexture(l.seed, l.fill, l.win, l.chance);
      tex.repeat.x = 2;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h), mat);
      mesh.userData = { dist: l.dist, y: l.y };
      mesh.layers.set(FX_LAYER);
      this.skyline.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Flat inked ellipse under a character (no real shadow maps – cheaper and more graphic). */
  makeShadow(size = 1): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size * 0.7),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.layers.set(FX_LAYER);
    m.renderOrder = 2;
    this.scene.add(m);
    return m;
  }

  update(dt: number, player: ChaseTarget): void {
    const pz = -player.d;
    this.ground.position.z = Math.round((pz - GROUND_LENGTH * 0.35) / ROAD_TILE) * ROAD_TILE;
    this.chase.update(dt, player);
    const cam = this.chase.camera;
    for (const s of this.skyline) {
      const { dist, y } = s.userData as { dist: number; y: number };
      // Distant layers barely move sideways = parallax depth.
      s.position.set(cam.position.x * (1 - 40 / dist), y, cam.position.z - dist);
    }
    this.key.position.set(5 + player.x, 10, pz + 7);
    this.key.target.position.set(player.x, 0, pz);
    this.neonA.position.set(-3.5, 4, pz - 14);
    this.neonB.position.set(3.5, 4, pz - 26);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.hemi.intensity = 1.6 + this.flash * 3;
    this.rain.update(dt, cam.position, player.speed);
  }

  resize(aspect: number): void {
    this.chase.resize(aspect);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/**
 * Rain as long tapered pencil strokes: each streak fades from transparent at
 * the top to graphite at the bottom (per-vertex alpha).
 */
class PencilRain {
  readonly mesh: THREE.LineSegments;
  private drops: Float32Array;
  private positions: Float32Array;
  private rng = new Rng(42);
  private mat: THREE.LineBasicMaterial;

  constructor() {
    const n = CONFIG.rain.drops;
    this.drops = new Float32Array(n * 3);
    this.positions = new Float32Array(n * 6);
    const colors = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const a = 0.25 + this.rng.next() * 0.45;
      colors.set([1, 1, 1, a, 1, 1, 1, 0], i * 8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 3;
    for (let i = 0; i < n; i++) this.respawn(i, new THREE.Vector3(), true);
  }

  setColor(c: number): void {
    this.mat.color.set(c);
  }

  private respawn(i: number, around: THREE.Vector3, anyHeight: boolean): void {
    const R = CONFIG.rain.areaRadius;
    const r = this.rng;
    this.drops[i * 3] = around.x + r.range(-R * 0.6, R * 0.6);
    this.drops[i * 3 + 1] = anyHeight ? r.range(0, CONFIG.rain.height) : CONFIG.rain.height * r.range(0.8, 1);
    this.drops[i * 3 + 2] = around.z - r.range(-4, R * 1.4);
  }

  update(dt: number, camPos: THREE.Vector3, speed: number): void {
    const n = CONFIG.rain.drops;
    const fall = CONFIG.rain.fallSpeed * dt;
    const len = CONFIG.rain.streakLength * 2.6; // long pencil strokes
    const slant = Math.min(1.2, speed * 0.045);
    const R = CONFIG.rain.areaRadius;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      this.drops[j + 1] -= fall;
      const dz = this.drops[j + 2] - camPos.z;
      if (this.drops[j + 1] < 0 || dz > 6 || dz < -R * 1.6) this.respawn(i, camPos, this.drops[j + 1] >= 0);
      const k = i * 6;
      this.positions[k] = this.drops[j];
      this.positions[k + 1] = this.drops[j + 1];
      this.positions[k + 2] = this.drops[j + 2];
      this.positions[k + 3] = this.drops[j] + 0.08;
      this.positions[k + 4] = this.drops[j + 1] + len;
      this.positions[k + 5] = this.drops[j + 2] - slant;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
