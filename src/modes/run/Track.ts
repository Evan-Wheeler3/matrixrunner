import * as THREE from 'three';
import { CONFIG, type MissionDef } from '../../config';
import { Rng, subSeed } from '../../core/rng';
import {
  ObstacleMaterials,
  buildBarrierLow,
  buildCar,
  buildCrateHigh,
  buildOverhead,
  buildPayphone,
  buildVent,
} from '../../render/models';
import { CityEnvironment } from './CityEnvironment';
import { flatMat } from '../../render/palette';

/**
 * The run's level: a seeded sequence of fixed-length chunks streamed in ahead
 * of the player and recycled behind them, ending at the payphone.
 *
 * Coordinates: "distance" d increases along the run; world z = -d. Lanes are
 * indexed 0..2 left to right.
 */

export type ObstacleKind = 'barrierLow' | 'crateHigh' | 'overhead' | 'car' | 'vent';

/** Collision volume per kind, relative to the obstacle's (x, d) center. */
interface ObstacleSpec {
  halfWidth: number;
  halfDepth: number;
  yMin: number;
  yMax: number;
  /** Solid lane blockers shove the player into another lane when hit. */
  solid: boolean;
  /** What the player should do – used by HUD hints / danger sense later. */
  answer: 'jump' | 'highJump' | 'slide' | 'dodge';
}

export const OBSTACLE_SPECS: Record<ObstacleKind, ObstacleSpec> = {
  barrierLow: { halfWidth: 1.1, halfDepth: 0.22, yMin: 0, yMax: 0.8, solid: false, answer: 'jump' },
  crateHigh: { halfWidth: 1.05, halfDepth: 0.42, yMin: 0, yMax: 1.15, solid: false, answer: 'highJump' },
  overhead: { halfWidth: 1.3, halfDepth: 0.12, yMin: 1.02, yMax: 4, solid: false, answer: 'slide' },
  car: { halfWidth: 0.95, halfDepth: 2.05, yMin: 0, yMax: 1.45, solid: true, answer: 'dodge' },
  vent: { halfWidth: 0.75, halfDepth: 0.65, yMin: 0, yMax: 2.8, solid: false, answer: 'dodge' },
};

/** Steam vent cycle: on for `ventOn` seconds out of every `ventPeriod`. */
const VENT_PERIOD = 2.2;
const VENT_ON = 1.1;

export interface Obstacle {
  kind: ObstacleKind;
  /** Lanes covered (overhead gantries can span all three). */
  lanes: number[];
  x: number;
  halfWidth: number;
  d: number;
  mesh: THREE.Object3D;
  /** Already caused a stumble – never hits twice. */
  hit: boolean;
  /** Vent timing offset so neighbouring vents aren't in sync. */
  phase: number;
  poolKey: string;
}

interface Chunk {
  index: number;
  startD: number;
  slot: number;
  obstacles: Obstacle[];
}

/** Scenery that fills each streamed chunk (street, apartment, rooftop, comic street...). */
export interface SceneryProvider {
  readonly group: THREE.Object3D;
  buildSlot(slot: number, startD: number, length: number, rng: Rng): void;
  clearSlot(slot: number): void;
  /** Optional per-frame animation (puddle ripples, flicker...). */
  update?(dt: number, playerD: number): void;
}

export function laneX(lane: number): number {
  return (lane - (CONFIG.lanes.count - 1) / 2) * CONFIG.lanes.width;
}

export class Track {
  readonly group = new THREE.Group();
  readonly env: SceneryProvider;
  readonly payphoneD: number;
  readonly payphone: THREE.Group;
  private readonly totalChunks: number;
  private chunks: Chunk[] = [];
  private nextChunk = 0;
  private freeSlots: number[] = [];
  private pools = new Map<string, THREE.Object3D[]>();
  private mats: ObstacleMaterials;
  /** Distance of the next obstacle row (carried across chunk boundaries). */
  private nextRowD: number;
  private rowRng: Rng;
  private time = 0;

  constructor(
    private mission: MissionDef,
    sceneryFactory: (slots: number) => SceneryProvider = (slots) => new CityEnvironment(slots),
  ) {
    const { chunkLength, chunksAhead, chunksBehind, safeStartChunks } = CONFIG.level;
    this.payphoneD = mission.length;
    this.totalChunks = Math.ceil((this.payphoneD + 30) / chunkLength);
    const slots = chunksAhead + chunksBehind + 2;
    this.env = sceneryFactory(slots);
    for (let i = slots - 1; i >= 0; i--) this.freeSlots.push(i);
    this.group.add(this.env.group);
    this.mats = new ObstacleMaterials();
    this.rowRng = new Rng(subSeed(mission.seed, 9999));
    this.nextRowD = safeStartChunks * chunkLength + 10;

    // Hand-placed finale: the payphone booth and a dead-end wall behind it.
    this.payphone = buildPayphone();
    this.payphone.position.set(0, 0, -(this.payphoneD + 0.9));
    this.group.add(this.payphone);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 4), flatMat(0x161b1f));
    wall.position.set(0, 20, -(this.payphoneD + 9));
    this.group.add(wall);
    const warn = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0x39ff8a }));
    warn.position.set(0, 5.5, -(this.payphoneD + 6.9));
    this.group.add(warn);
  }

  /** Stream chunks in/out around the player and animate obstacles. */
  update(playerD: number, dt: number): void {
    this.time += dt;
    const { chunkLength, chunksAhead, chunksBehind } = CONFIG.level;
    const despawnBehind = () => {
      while (this.chunks.length && this.chunks[0].startD + chunkLength < playerD - chunksBehind * chunkLength) {
        this.despawnChunk(this.chunks.shift()!);
      }
    };
    despawnBehind();
    // Chunks are always generated in order (the row RNG is sequential). If the
    // player jumps far ahead, skipped chunks are generated and immediately recycled.
    while (this.nextChunk < this.totalChunks && this.nextChunk * chunkLength < playerD + chunksAhead * chunkLength) {
      this.spawnChunk(this.nextChunk++);
      despawnBehind();
    }
    this.env.update?.(dt, playerD);
    this.mats.update(this.time);
    // Animate vent plumes; hide obstacles the runner has passed so the chase
    // camera (which trails ~6 m behind) never drives through a sign or car.
    for (const chunk of this.chunks) {
      for (const o of chunk.obstacles) {
        if (o.mesh.visible && o.d + OBSTACLE_SPECS[o.kind].halfDepth < playerD - 0.6) o.mesh.visible = false;
        if (o.kind !== 'vent' || !o.mesh.visible) continue;
        const plume = (o.mesh.userData.plume ??= o.mesh.getObjectByName('plume')) as THREE.Object3D;
        (plume.userData.update as (dt: number, t: number, on: boolean) => void)(dt, this.time + o.phase, this.ventActive(o));
      }
    }
  }

  ventActive(o: Obstacle): boolean {
    return (this.time + o.phase) % VENT_PERIOD < VENT_ON;
  }

  /** Every live obstacle whose center is within `range` of distance d. */
  *obstaclesNear(d: number, range: number): Generator<Obstacle> {
    for (const chunk of this.chunks) {
      if (chunk.startD > d + range || chunk.startD + CONFIG.level.chunkLength < d - range - 5) continue;
      for (const o of chunk.obstacles) {
        if (Math.abs(o.d - d) <= range + OBSTACLE_SPECS[o.kind].halfDepth) yield o;
      }
    }
  }

  /**
   * Swept AABB test: the player's box moving from `prevD` to its current
   * distance against nearby obstacles. Returns the first un-hit obstacle
   * touched (and marks it hit), or null.
   */
  findHit(b: { minX: number; maxX: number; minY: number; maxY: number; maxD: number }, d: number, prevMinD: number): Obstacle | null {
    for (const o of this.obstaclesNear(d, 4)) {
      if (o.hit) continue;
      const spec = OBSTACLE_SPECS[o.kind];
      if (o.kind === 'vent' && !this.ventActive(o)) continue;
      const overlapX = b.maxX > o.x - o.halfWidth && b.minX < o.x + o.halfWidth;
      const overlapD = b.maxD > o.d - spec.halfDepth && prevMinD < o.d + spec.halfDepth;
      const overlapY = b.maxY > spec.yMin && b.minY < spec.yMax;
      if (overlapX && overlapD && overlapY) {
        o.hit = true;
        return o;
      }
    }
    return null;
  }

  /** Is a lane occupied by a solid obstacle overlapping distance d? */
  laneBlocked(lane: number, d: number): boolean {
    for (const o of this.obstaclesNear(d, 3)) {
      if (OBSTACLE_SPECS[o.kind].solid && o.lanes.includes(lane) && Math.abs(o.d - d) < OBSTACLE_SPECS[o.kind].halfDepth + 0.8) return true;
    }
    return false;
  }

  private spawnChunk(index: number): void {
    const { chunkLength } = CONFIG.level;
    const slot = this.freeSlots.pop();
    if (slot === undefined) throw new Error('Track: ran out of chunk slots');
    const startD = index * chunkLength;
    const rng = new Rng(subSeed(this.mission.seed, index));
    this.env.buildSlot(slot, startD, chunkLength, rng);
    const chunk: Chunk = { index, startD, slot, obstacles: [] };

    // Obstacle rows – placed from a single sequential RNG so the layout is
    // fully determined by the mission seed.
    const endD = startD + chunkLength;
    const lastRowD = this.payphoneD - 45;
    while (this.nextRowD < endD) {
      const d = this.nextRowD;
      const progress = d / this.payphoneD;
      const density = Math.min(1, this.mission.density + progress * 0.2);
      const spacing = THREE.MathUtils.lerp(CONFIG.level.rowSpacingSparse, CONFIG.level.rowSpacingDense, density);
      let extra = 0;
      if (d < lastRowD) extra = this.placeRow(chunk, d, density);
      this.nextRowD += spacing * this.rowRng.range(0.85, 1.25) + extra;
    }
    this.chunks.push(chunk);
  }

  /**
   * Place one row of obstacles. Every pattern leaves a way through: either a
   * free lane, or obstacles that can all be jumped/slid.
   * Returns extra spacing to add after this row (cars are long).
   */
  private placeRow(chunk: Chunk, d: number, density: number): number {
    const r = this.rowRng;
    const lanes = [0, 1, 2];
    const roll = r.next();
    const pickLanes = (n: number) => [...lanes].sort(() => r.next() - 0.5).slice(0, n);

    if (roll < 0.22) {
      for (const l of pickLanes(r.int(1, density > 0.6 ? 3 : 2))) this.addObstacle(chunk, 'barrierLow', [l], d);
    } else if (roll < 0.36) {
      this.addObstacle(chunk, 'overhead', lanes, d);
    } else if (roll < 0.5) {
      for (const l of pickLanes(r.int(1, 2))) this.addObstacle(chunk, 'crateHigh', [l], d);
    } else if (roll < 0.7) {
      const blocked = pickLanes(r.chance(0.35 + density * 0.3) ? 2 : 1);
      for (const l of blocked) this.addObstacle(chunk, 'car', [l], d);
      return 4;
    } else if (roll < 0.84) {
      const [ventLane, other] = pickLanes(2);
      this.addObstacle(chunk, 'vent', [ventLane], d);
      if (r.chance(density)) this.addObstacle(chunk, 'barrierLow', [other], d);
    } else {
      // Mixed: one car, overhead over one other lane, the third lane free or low barrier.
      const [carLane, slideLane, thirdLane] = pickLanes(3);
      this.addObstacle(chunk, 'car', [carLane], d);
      this.addObstacle(chunk, 'overhead', [slideLane], d);
      if (r.chance(density * 0.6)) this.addObstacle(chunk, 'barrierLow', [thirdLane], d);
      return 4;
    }
    return 0;
  }

  private addObstacle(chunk: Chunk, kind: ObstacleKind, lanes: number[], d: number): void {
    const x = lanes.reduce((sum, l) => sum + laneX(l), 0) / lanes.length;
    const span = lanes.length * CONFIG.lanes.width;
    const halfWidth = kind === 'overhead' ? span / 2 : OBSTACLE_SPECS[kind].halfWidth;
    const variant = kind === 'car' ? this.rowRng.int(0, 3) : kind === 'overhead' ? this.rowRng.int(0, 1) : 0;
    const poolKey = `${kind}:${lanes.length}:${variant}`;
    const mesh = this.acquire(poolKey, () => this.buildMesh(kind, span, variant));
    mesh.position.set(x, 0, -d);
    mesh.rotation.y = kind === 'car' ? this.rowRng.range(-0.06, 0.06) : 0;
    chunk.obstacles.push({ kind, lanes, x, halfWidth, d, mesh, hit: false, phase: this.rowRng.range(0, VENT_PERIOD), poolKey });
  }

  private buildMesh(kind: ObstacleKind, span: number, variant: number): THREE.Object3D {
    const m = this.mats;
    switch (kind) {
      case 'barrierLow':
        return buildBarrierLow(m, 2.2);
      case 'crateHigh':
        return buildCrateHigh(m, 2.1);
      case 'overhead':
        return buildOverhead(m, span);
      case 'car':
        return buildCar(m, variant);
      case 'vent':
        return buildVent(m);
    }
  }

  private acquire(key: string, build: () => THREE.Object3D): THREE.Object3D {
    const pool = this.pools.get(key);
    const mesh = pool?.pop() ?? build();
    mesh.visible = true;
    if (!mesh.parent) this.group.add(mesh);
    return mesh;
  }

  private despawnChunk(chunk: Chunk): void {
    this.env.clearSlot(chunk.slot);
    this.freeSlots.push(chunk.slot);
    for (const o of chunk.obstacles) {
      o.mesh.visible = false;
      let pool = this.pools.get(o.poolKey);
      if (!pool) this.pools.set(o.poolKey, (pool = []));
      pool.push(o.mesh);
    }
  }
}
