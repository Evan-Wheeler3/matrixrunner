import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Rng } from '../../core/rng';
import { ChaseCamera, type ChaseTarget } from '../../render/ChaseCamera';
import { litMat, wetGroundMat, GROUND_LAYER, RAIN_LAYER, FX_LAYER } from '../../render/look/materials';
import { roadSet, sidewalkSet, glowTexture } from '../../render/look/textures';
import { buildEnvironmentMap, SkyDome } from '../../render/look/environment';
import { LightPool, type LightCandidate } from '../../render/look/LightPool';
import { activeGrade, onStyleChange, style } from '../../render/look/LookStyle';

const L = CONFIG.level;
const ROAD_TILE = 12;
const GROUND_LENGTH = 360;

/**
 * Frame for a street run in the graphic-noir look: IBL environment, sky dome,
 * moon key light with a player-following shadow frustum, pooled street
 * lights, wet PBR ground, rain streaks and splashes.
 *
 * Everything mirrored by the reflection pass lives under `world`.
 */
export class NoirWorld {
  readonly scene = new THREE.Scene();
  readonly world = new THREE.Group();
  readonly chase: ChaseCamera;
  readonly lightPool: LightPool;
  private sky = new SkyDome();
  private ground: THREE.Group;
  private moon: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.PointLight;
  private rain: Rain;
  private envMap: THREE.Texture;
  private unsubscribe: () => void;
  /** Lightning (0..1), decays. */
  flash = 0;

  constructor(renderer: THREE.WebGLRenderer, aspect: number) {
    this.chase = new ChaseCamera(aspect, 300);
    this.scene.add(this.world);
    this.envMap = buildEnvironmentMap(renderer);
    this.scene.environment = this.envMap;
    // IBL is mainly for reflections (glass, paint, wet ground); keep its diffuse fill low for a night look.
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.FogExp2(0xffffff, style.fogDensity);
    this.world.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x101214, 0.45);
    this.world.add(this.hemi);
    // Moon key light from behind-right of the camera; its shadow frustum follows the runner.
    this.moon = new THREE.DirectionalLight(0xffffff, 1.5);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 60;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.03;
    this.world.add(this.moon, this.moon.target);
    const rim = new THREE.DirectionalLight(0x8fe8ff, 0.5);
    rim.position.set(-6, 6, -10);
    this.world.add(rim, rim.target);

    // Soft fill from just above/behind the runner (camera side).
    this.fill = new THREE.PointLight(0xbfd6d0, 5, 9, 1.4);
    this.world.add(this.fill);

    this.lightPool = new LightPool(8);
    this.world.add(this.lightPool.group);

    this.ground = this.buildGround();
    this.world.add(this.ground);
    this.rain = new Rain();
    this.scene.add(this.rain.group); // camera-space FX: not mirrored

    this.unsubscribe = onStyleChange(() => this.syncStyle());
    this.syncStyle();
  }

  get camera(): THREE.PerspectiveCamera {
    return this.chase.camera;
  }

  private syncStyle(): void {
    const g = activeGrade();
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(g.fog);
    fog.density = style.fogDensity;
    this.hemi.color.set(g.fog).multiplyScalar(1.3);
    this.moon.color.set(g.moon);
    this.sky.syncGrade();
  }

  private buildGround(): THREE.Group {
    const g = new THREE.Group();
    const roadW = L.streetHalfWidth * 2;
    const dividers: number[] = [];
    for (let i = 1; i < CONFIG.lanes.count; i++) dividers.push(0.5 + ((i - CONFIG.lanes.count / 2) * CONFIG.lanes.width) / roadW);
    const reps = GROUND_LENGTH / ROAD_TILE;
    const road = roadSet(dividers);
    for (const t of [road.albedo, road.normal, road.orm]) t.repeat.set(1, reps);
    const roadMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, GROUND_LENGTH),
      wetGroundMat({ map: road.albedo, normalMap: road.normal, roughnessMap: road.orm, normalScale: new THREE.Vector2(0.8, 0.8) }),
    );
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.receiveShadow = true;
    roadMesh.layers.set(GROUND_LAYER);
    g.add(roadMesh);

    const walk = sidewalkSet();
    for (const t of [walk.albedo, walk.normal, walk.orm]) t.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
    const walkMat = wetGroundMat({ map: walk.albedo, normalMap: walk.normal, roughnessMap: walk.orm });
    const curbMat = litMat(0x77746e, { roughness: 0.6 });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(L.sidewalkWidth, GROUND_LENGTH), walkMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(side * (L.streetHalfWidth + L.sidewalkWidth / 2), 0.16, 0);
      w.receiveShadow = true;
      w.layers.set(GROUND_LAYER);
      g.add(w);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, GROUND_LENGTH), curbMat);
      curb.position.set(side * L.streetHalfWidth, 0.08, 0);
      curb.receiveShadow = true;
      g.add(curb);
    }
    const under = new THREE.Mesh(new THREE.PlaneGeometry(260, GROUND_LENGTH), litMat(0x161818, { roughness: 0.9, noHatch: true }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.02; // beneath road and sidewalks, fills gaps between buildings
    under.layers.set(GROUND_LAYER);
    g.add(under);
    return g;
  }

  update(dt: number, player: ChaseTarget, lights: Iterable<LightCandidate>): void {
    const pz = -player.d;
    this.ground.position.z = Math.round((pz - GROUND_LENGTH * 0.35) / ROAD_TILE) * ROAD_TILE;
    this.chase.update(dt, player);
    const cam = this.chase.camera;
    this.moon.position.set(player.x + 7, 16, pz + 10);
    this.moon.target.position.set(player.x, 0, pz - 4);
    this.fill.position.set(player.x, 2.8 + player.y, pz + 2.5);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.moon.intensity = 1.5 + this.flash * 6;
    this.hemi.intensity = 0.45 + this.flash * 2;
    this.sky.update(dt, cam.position, this.flash);
    this.lightPool.update(lights, pz, dt);
    this.rain.update(dt, cam.position, player.speed);
  }

  resize(aspect: number): void {
    this.chase.resize(aspect);
  }

  dispose(): void {
    this.unsubscribe();
    this.envMap.dispose();
  }
}

/** Rain: thin bright streaks (catch the light) + ground splash flecks around the camera. */
class Rain {
  readonly group = new THREE.Group();
  private streaks: THREE.LineSegments;
  private splashes: THREE.Points;
  private drops: Float32Array;
  private positions: Float32Array;
  private splashPos: Float32Array;
  private splashLife: Float32Array;
  private rng = new Rng(42);

  constructor() {
    const n = CONFIG.rain.drops;
    this.drops = new Float32Array(n * 3);
    this.positions = new Float32Array(n * 6);
    const colors = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const a = 0.06 + this.rng.next() * 0.16;
      colors.set([0.75, 0.85, 0.85, a, 0.75, 0.85, 0.85, 0], i * 8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.streaks.frustumCulled = false;
    this.streaks.layers.set(RAIN_LAYER);
    this.group.add(this.streaks);
    for (let i = 0; i < n; i++) this.respawn(i, new THREE.Vector3(), true);

    const sn = 260;
    this.splashPos = new Float32Array(sn * 3);
    this.splashLife = new Float32Array(sn);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.splashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.splashes = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0xbfd8d4, size: 0.18, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.splashes.frustumCulled = false;
    this.splashes.layers.set(FX_LAYER);
    this.group.add(this.splashes);
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
    const len = CONFIG.rain.streakLength * 1.6;
    const slant = Math.min(0.9, speed * 0.035);
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
      this.positions[k + 3] = this.drops[j];
      this.positions[k + 4] = this.drops[j + 1] + len;
      this.positions[k + 5] = this.drops[j + 2] - slant;
    }
    (this.streaks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // Splash flecks: short-lived points on the ground ahead of the camera.
    const sn = this.splashLife.length;
    for (let i = 0; i < sn; i++) {
      this.splashLife[i] -= dt;
      if (this.splashLife[i] <= 0) {
        this.splashLife[i] = this.rng.range(0.05, 0.18);
        this.splashPos[i * 3] = camPos.x + this.rng.range(-7, 7);
        this.splashPos[i * 3 + 1] = 0.05;
        this.splashPos[i * 3 + 2] = camPos.z - this.rng.range(2, 26);
      }
    }
    (this.splashes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
