import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { Input } from '../../core/Input';
import { animateHumanoid, buildRunner, type Humanoid, type Pose } from '../../render/models';
import { laneX } from './Track';

const P = CONFIG.player;

/** Axis-aligned bounds of the player in (x, y, d) space. */
export interface PlayerBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minD: number;
  maxD: number;
}

export interface PlayerEvents {
  onLand?(impactSpeed: number): void;
  onJump?(): void;
  onSlide?(): void;
  onSprint?(): void;
}

/**
 * The runner: auto-runs forward, switches lanes, jumps (variable height),
 * slides, sprints, and stumbles. All movement is kinematic – no physics engine.
 */
export class Player {
  readonly model: Humanoid;
  lane = 1;
  private prevLane = 1;
  x = 0;
  y = 0;
  vy = 0;
  /** Distance travelled along the track. */
  d = 0;
  speed = 0;
  grounded = true;
  sliding = false;
  private slideTimer = 0;
  private fastFall = false;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private coyote = 0;
  stumbleTimer = 0;
  private graceTimer = 0;
  sprintTimer = 0;
  sprintCooldown = 0;
  /** When false, input is ignored (braking into the payphone, caught, ...). */
  controlsEnabled = true;
  /** Speed the player would run at with no sprint/stumble; Agents pace off this. */
  cruiseSpeed = 0;
  /** Override target speed (used while braking). null = normal running. */
  speedOverride: number | null = null;
  private animPhase = 0;
  private time = 0;
  pose: Pose = 'run';

  constructor(
    private speedMult: number,
    private runLength: number,
    private events: PlayerEvents = {},
  ) {
    this.model = buildRunner();
    this.cruiseSpeed = this.speed = P.baseSpeed * speedMult;
  }

  get height(): number {
    return this.sliding ? P.slideHeight : P.height;
  }

  get isStumbling(): boolean {
    return this.stumbleTimer > 0;
  }

  get isInvulnerable(): boolean {
    return this.graceTimer > 0;
  }

  bounds(): PlayerBounds {
    return {
      minX: this.x - P.halfWidth,
      maxX: this.x + P.halfWidth,
      minY: this.y,
      maxY: this.y + this.height,
      minD: this.d - P.halfDepth,
      maxD: this.d + P.halfDepth,
    };
  }

  /** Move toward a lane (clamped). Returns true if the lane actually changed. */
  setLane(lane: number): boolean {
    const clamped = THREE.MathUtils.clamp(lane, 0, CONFIG.lanes.count - 1);
    if (clamped === this.lane) return false;
    this.prevLane = this.lane;
    this.lane = clamped;
    return true;
  }

  /** Was the player mid lane-change (not yet near the target lane's center)? */
  get isChangingLane(): boolean {
    return Math.abs(this.x - laneX(this.lane)) > 0.25;
  }

  /** Undo the last lane change (bounced off the side of a solid obstacle). */
  bounceBack(): void {
    const l = this.lane;
    this.lane = this.prevLane;
    this.prevLane = l;
  }

  /** Hit an obstacle: slow down briefly. Ignored while in post-hit grace. */
  stumble(): boolean {
    if (this.graceTimer > 0) return false;
    this.stumbleTimer = P.stumbleDuration;
    this.graceTimer = P.stumbleGrace;
    this.sprintTimer = 0;
    this.speed = Math.min(this.speed, this.cruiseSpeed * P.stumbleSpeedMult);
    return true;
  }

  update(dt: number, input: Input): void {
    this.time += dt;
    this.updateTimers(dt);
    if (this.controlsEnabled) this.handleInput(input);
    this.updateSpeed(dt);
    this.updateVertical(dt, input);

    // Lateral movement toward the target lane at a fixed speed (snappy, readable).
    const tx = laneX(this.lane);
    const lateralSpeed = CONFIG.lanes.width / CONFIG.lanes.switchTime;
    const dx = tx - this.x;
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), lateralSpeed * dt);

    this.d += this.speed * dt;
    this.updateModel(dt, dx);
  }

  private updateTimers(dt: number): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = Math.max(0, this.slideBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
    this.graceTimer = Math.max(0, this.graceTimer - dt);
    this.sprintTimer = Math.max(0, this.sprintTimer - dt);
    this.sprintCooldown = Math.max(0, this.sprintCooldown - dt);
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.sliding = false;
    }
  }

  private handleInput(input: Input): void {
    if (input.wasPressed('left')) this.setLane(this.lane - 1);
    if (input.wasPressed('right')) this.setLane(this.lane + 1);
    if (input.wasPressed('jump')) this.jumpBuffer = P.inputBufferTime;
    if (input.wasPressed('slide')) {
      this.slideBuffer = P.inputBufferTime;
      if (!this.grounded) this.fastFall = true;
    }
    if (input.wasPressed('sprint') && this.sprintCooldown <= 0 && !this.isStumbling) {
      this.sprintTimer = P.sprintDuration;
      this.sprintCooldown = P.sprintCooldown;
      this.events.onSprint?.();
    }

    // Buffered actions resolve as soon as they become possible.
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.sliding = false;
      this.fastFall = false;
      this.vy = P.jumpVelocity;
      this.events.onJump?.();
    } else if (this.slideBuffer > 0 && this.grounded && !this.sliding) {
      this.slideBuffer = 0;
      this.sliding = true;
      this.slideTimer = P.slideDuration;
      this.events.onSlide?.();
    }
  }

  private updateSpeed(dt: number): void {
    // Gentle speed ramp across the run.
    const progress = THREE.MathUtils.clamp(this.d / this.runLength, 0, 1);
    this.cruiseSpeed = P.baseSpeed * this.speedMult * THREE.MathUtils.lerp(1, P.maxSpeedMultiplier, progress);
    let target = this.cruiseSpeed;
    if (this.sprintTimer > 0) target *= P.sprintMultiplier;
    if (this.stumbleTimer > 0) target *= P.stumbleSpeedMult;
    if (this.speedOverride !== null) target = this.speedOverride;
    if (target < this.speed) this.speed = Math.max(target, this.speed - P.speedRecoverAccel * 3 * dt);
    else this.speed = Math.min(target, this.speed + P.speedRecoverAccel * dt);
  }

  private updateVertical(dt: number, input: Input): void {
    if (this.grounded) return;
    let g = P.gravity;
    // Releasing jump early cuts the rise short: tap = hop, hold = full jump.
    if (this.vy > 0 && !(this.controlsEnabled && input.isDown('jump'))) g *= P.jumpCutGravityMult;
    if (this.fastFall) g *= P.fastFallGravityMult;
    this.vy -= g * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      const impact = -this.vy;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.fastFall = false;
      this.events.onLand?.(impact);
    }
  }

  private updateModel(dt: number, lateralDelta: number): void {
    // Stride phase advances with distance so feet don't skate.
    this.animPhase += this.speed * dt * 0.62;
    if (!this.grounded) this.pose = 'jump';
    else if (this.sliding) this.pose = 'slide';
    else if (this.isStumbling) this.pose = 'stumble';
    else if (this.speed < 0.5) this.pose = this.pose === 'call' ? 'call' : 'idle';
    else this.pose = 'run';
    animateHumanoid(this.model, this.pose, this.animPhase, this.time);
    this.model.root.position.set(this.x, this.y, -this.d);
    // Lean into lane changes.
    this.model.root.rotation.z = THREE.MathUtils.clamp(-lateralDelta * 0.18, -0.25, 0.25);
    // Blink while invulnerable after a hit.
    this.model.root.visible = !(this.graceTimer > 0 && this.stumbleTimer <= 0 && Math.floor(this.time * 16) % 2 === 0);
  }
}
