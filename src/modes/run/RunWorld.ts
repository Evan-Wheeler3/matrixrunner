import * as THREE from 'three';
import { CONFIG } from '../../config';
import { PALETTE } from '../../render/palette';
import { roadTexture, sidewalkTexture } from '../../render/textures';
import { Rng } from '../../core/rng';
import { ChaseCamera, type ChaseTarget } from '../../render/ChaseCamera';

const L = CONFIG.level;

/** Length of one road texture tile in meters (ground snaps to multiples of this). */
const ROAD_TILE = 12;
const GROUND_LENGTH = 360;

/**
 * Everything that frames the run but isn't gameplay: scene, fog, lights,
 * ground, rain and the chase camera.
 */
export class RunWorld {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private chase: ChaseCamera;
  private ground: THREE.Group;
  private rain: Rain;
  private keyLight: THREE.PointLight;
  private fillLight: THREE.PointLight;

  constructor(aspect: number) {
    this.scene.background = new THREE.Color(CONFIG.render.fogColor);
    this.scene.fog = new THREE.FogExp2(CONFIG.render.fogColor, CONFIG.render.fogDensity);
    this.chase = new ChaseCamera(aspect);
    this.camera = this.chase.camera;

    // Dim cold ambient + a moonlight key so silhouettes read; neon does the rest.
    this.scene.add(new THREE.HemisphereLight(0x4a6a76, 0x0a0c0e, 1.3));
    const moon = new THREE.DirectionalLight(0x8fb6c8, 0.7);
    moon.position.set(-6, 20, 10);
    this.scene.add(moon);
    // Teal light that travels just ahead of the player so obstacles pop out of the fog.
    this.keyLight = new THREE.PointLight(PALETTE.neon.teal, 7, 34, 1.1);
    this.scene.add(this.keyLight);
    // Cool fill from just behind/above the player (camera side) so the runner
    // reads as a figure rather than a black cutout.
    this.fillLight = new THREE.PointLight(0xa8c4d0, 6, 9, 1.5);
    this.scene.add(this.fillLight);

    this.ground = this.buildGround();
    this.scene.add(this.ground);
    this.rain = new Rain();
    this.scene.add(this.rain.mesh);
  }

  private buildGround(): THREE.Group {
    const g = new THREE.Group();
    const roadW = L.streetHalfWidth * 2;
    // Lane dividers in normalized road-texture coordinates.
    const dividers: number[] = [];
    for (let i = 1; i < CONFIG.lanes.count; i++) {
      const x = (i - CONFIG.lanes.count / 2) * CONFIG.lanes.width;
      dividers.push(0.5 + x / roadW);
    }
    const roadTex = roadTexture(dividers);
    roadTex.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, GROUND_LENGTH),
      // Low roughness so the moving teal key light leaves a wet sheen.
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.45, metalness: 0.15 }),
    );
    road.rotation.x = -Math.PI / 2;
    g.add(road);

    const walkTex = sidewalkTexture();
    walkTex.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
    const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.6, metalness: 0.05 });
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(L.sidewalkWidth, 0.16, GROUND_LENGTH), walkMat);
      walk.position.set(side * (L.streetHalfWidth + L.sidewalkWidth / 2), 0.08, 0);
      g.add(walk);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, GROUND_LENGTH), new THREE.MeshStandardMaterial({ color: 0x3a3f42, flatShading: true }));
      curb.position.set(side * L.streetHalfWidth, 0.09, 0);
      g.add(curb);
    }
    // Wide dark underlay so gaps between buildings never show the void.
    const under = new THREE.Mesh(new THREE.PlaneGeometry(200, GROUND_LENGTH), new THREE.MeshStandardMaterial({ color: 0x0b0e10 }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.02;
    g.add(under);
    return g;
  }

  addShake(amount: number): void {
    this.chase.addShake(amount);
  }

  /** Update camera, ground and rain around the player. */
  update(dt: number, player: ChaseTarget): void {
    const pz = -player.d;
    // Ground snaps by whole texture tiles so the pattern stays world-locked.
    this.ground.position.z = Math.round((pz - GROUND_LENGTH * 0.35) / ROAD_TILE) * ROAD_TILE;
    this.chase.update(dt, player);
    this.keyLight.position.set(player.x * 0.5, 7, pz - 12);
    this.fillLight.position.set(player.x, 2.6 + player.y, pz + 2.2);
    this.rain.update(dt, this.camera.position, player.speed);
  }

  resize(aspect: number): void {
    this.chase.resize(aspect);
  }
}

/**
 * Rain as line-segment streaks in a box around the camera. Each drop's streak
 * is slanted by the player's forward speed so it reads as motion.
 */
class Rain {
  readonly mesh: THREE.LineSegments;
  private drops: Float32Array; // x, y, z per drop (world space)
  private positions: Float32Array;
  private rng = new Rng(42);

  constructor() {
    const n = CONFIG.rain.drops;
    this.drops = new Float32Array(n * 3);
    this.positions = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ color: 0x9fc9c4, transparent: true, opacity: 0.32, depthWrite: false });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.respawn(i, new THREE.Vector3(), true);
  }

  private respawn(i: number, around: THREE.Vector3, anyHeight: boolean): void {
    const R = CONFIG.rain.areaRadius;
    const r = this.rng;
    this.drops[i * 3] = around.x + r.range(-R * 0.6, R * 0.6);
    this.drops[i * 3 + 1] = anyHeight ? r.range(0, CONFIG.rain.height) : CONFIG.rain.height * r.range(0.8, 1);
    // Bias drops ahead of the camera (that's where we're looking).
    this.drops[i * 3 + 2] = around.z - r.range(-4, R * 1.4);
  }

  update(dt: number, camPos: THREE.Vector3, speed: number): void {
    const n = CONFIG.rain.drops;
    const fall = CONFIG.rain.fallSpeed * dt;
    const len = CONFIG.rain.streakLength;
    // Relative motion slants the streak toward the camera.
    const slant = Math.min(0.8, speed * 0.03);
    const R = CONFIG.rain.areaRadius;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      this.drops[j + 1] -= fall;
      const dz = this.drops[j + 2] - camPos.z;
      if (this.drops[j + 1] < 0 || dz > 6 || dz < -R * 1.6) this.respawn(i, camPos, this.drops[j + 1] >= 0);
      const x = this.drops[j];
      const y = this.drops[j + 1];
      const z = this.drops[j + 2];
      const k = i * 6;
      this.positions[k] = x;
      this.positions[k + 1] = y;
      this.positions[k + 2] = z;
      this.positions[k + 3] = x;
      this.positions[k + 4] = y + len;
      this.positions[k + 5] = z - slant;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
