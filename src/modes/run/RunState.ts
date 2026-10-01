import { CONFIG, MISSIONS, type MissionDef } from '../../config';
import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { disposeObject } from '../../core/dispose';
import { RunHud } from '../../ui/RunHud';
import { RunWorld } from './RunWorld';
import { Track, OBSTACLE_SPECS, type Obstacle } from './Track';
import { Player } from './Player';
import { Chasers } from './Chasers';
import type { RunResult } from './ResultState';

/**
 * RUN mode: auto-run down a seeded street toward the payphone while Agents
 * close in. Phases:
 *   running -> braking (auto-steer into the booth) -> calling (hold E)
 *   -> success | caught (either can also be reached via gap <= 0)
 */
type Phase = 'running' | 'braking' | 'calling' | 'caught' | 'success';

export interface RunParams {
  missionId: number;
}

const P = CONFIG.player;

export class RunState implements GameState {
  readonly id = StateId.RUN;
  private mission!: MissionDef;
  private world!: RunWorld;
  private track!: Track;
  private player!: Player;
  private chasers!: Chasers;
  private hud!: RunHud;
  private phase: Phase = 'running';
  private paused = false;
  private callProgress = 0;
  private endTimer = 0;
  private runTime = 0;
  private stumbles = 0;
  private brakeDecel = 0;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const { missionId } = (params as RunParams | undefined) ?? { missionId: 1 };
    this.mission = MISSIONS.find((m) => m.id === missionId) ?? MISSIONS[0];
    this.phase = 'running';
    this.paused = false;
    this.callProgress = 0;
    this.endTimer = 0;
    this.runTime = 0;
    this.stumbles = 0;

    this.world = new RunWorld(this.ctx.width / this.ctx.height);
    this.track = new Track(this.mission);
    this.player = new Player(this.mission.speedMult, this.mission.length, {
      onLand: (impact) => {
        if (impact > 6) this.world.addShake(Math.min(0.25, impact * 0.018));
      },
    });
    this.chasers = new Chasers(this.mission.agents, this.mission.startGap);
    this.world.scene.add(this.track.group, this.player.model.root, this.chasers.group);
    this.hud = new RunHud(this.ctx.uiRoot);
    this.hud.showBanner(`MISSION ${this.mission.id} — ${this.mission.name.toUpperCase()}`, 2.2);

    // Pre-stream the first chunks so frame one isn't empty.
    this.track.update(0, 0);
  }

  exit(): void {
    this.hud.destroy();
    disposeObject(this.world.scene);
    this.world.scene.clear();
  }

  resize(w: number, h: number): void {
    this.world.resize(w / h);
  }

  update(rawDt: number): void {
    const { input } = this.ctx;
    const canPause = this.phase === 'running' || this.phase === 'braking' || this.phase === 'calling';
    if (canPause && input.wasPressed('pause')) {
      this.paused = !this.paused;
      this.hud.setPaused(this.paused);
    }
    if (this.paused) {
      if (input.wasPressed('quit')) this.ctx.states.change(StateId.HUB);
      return;
    }

    // Slow-motion beat when caught.
    const dt = this.phase === 'caught' ? rawDt * 0.35 : rawDt;
    if (this.phase !== 'caught' && this.phase !== 'success') this.runTime += dt;

    const prevD = this.player.d;
    this.player.update(dt, input);
    this.track.update(this.player.d, dt);
    if (this.phase === 'running') this.checkCollisions(prevD);
    this.chasers.update(dt, this.player);
    this.updatePhase(dt);

    this.world.update(dt, { x: this.player.x, y: this.player.y, d: this.player.d, speed: this.player.speed, cruise: this.player.cruiseSpeed }, input.mouseDX, input.mouseDY);

    this.hud.update(rawDt, {
      distance: this.player.d,
      length: this.mission.length,
      gap: this.chasers.gap,
      danger: this.chasers.danger,
      sprintReady: this.player.sprintCooldown <= 0,
      sprintCooldown: this.player.sprintCooldown,
      sprinting: this.player.sprintTimer > 0,
      callProgress: this.phase === 'calling' || this.phase === 'braking' ? this.callProgress : null,
      callHeld: this.phase === 'calling' && input.isDown('interact'),
      fps: this.ctx.fps,
    });
  }

  private updatePhase(dt: number): void {
    const p = this.player;
    const stopD = this.track.payphoneD - 0.6;

    if ((this.phase === 'running' || this.phase === 'braking' || this.phase === 'calling') && this.chasers.gap <= 0) {
      this.phase = 'caught';
      p.controlsEnabled = false;
      p.speedOverride = 0;
      this.endTimer = 1.4;
      this.hud.showBanner('CAUGHT', 2);
      this.world.addShake(0.5);
      return;
    }

    switch (this.phase) {
      case 'running':
        if (p.d >= this.track.payphoneD - CONFIG.call.brakeDistance) {
          // Hand control to the game: steer into the booth and brake to a stop.
          this.phase = 'braking';
          p.controlsEnabled = false;
          p.setLane(1);
          this.chasers.closingIn = true;
          const remaining = Math.max(0.5, stopD - p.d);
          this.brakeDecel = (p.speed * p.speed) / (2 * remaining);
          this.hud.showBanner('GET TO THE PHONE', 1.2);
        }
        break;
      case 'braking': {
        const remaining = Math.max(0, stopD - p.d);
        p.speedOverride = Math.sqrt(2 * this.brakeDecel * remaining);
        if (remaining < 0.05 || p.speed < 0.3) {
          p.speedOverride = 0;
          p.speed = 0;
          this.phase = 'calling';
        }
        break;
      }
      case 'calling': {
        p.pose = 'call';
        const duration = this.mission.callDuration;
        if (this.ctx.input.isDown('interact')) this.callProgress += dt / duration;
        else this.callProgress = Math.max(0, this.callProgress - CONFIG.call.releaseDecay * dt);
        if (this.callProgress >= 1) {
          this.callProgress = 1;
          this.phase = 'success';
          this.endTimer = 1.0;
          this.chasers.closingIn = false;
          this.hud.showBanner('CONNECTED', 2);
        }
        break;
      }
      case 'caught':
      case 'success':
        this.endTimer -= dt;
        if (this.phase === 'success') this.chasers.gap += dt * 20; // Agents lunge at empty air
        if (this.endTimer <= 0) this.finish();
        break;
    }
  }

  /**
   * Swept AABB test between the player (from last frame's distance to now)
   * and nearby obstacles. Hits cause a stumble, never an instant fail.
   */
  private checkCollisions(prevD: number): void {
    const p = this.player;
    if (p.isInvulnerable) return;
    const b = p.bounds();
    const sweepMin = prevD - P.halfDepth;
    for (const o of this.track.obstaclesNear(p.d, 4)) {
      if (o.hit) continue;
      const spec = OBSTACLE_SPECS[o.kind];
      if (o.kind === 'vent' && !this.track.ventActive(o)) continue;
      const overlapX = b.maxX > o.x - o.halfWidth && b.minX < o.x + o.halfWidth;
      const overlapD = b.maxD > o.d - spec.halfDepth && sweepMin < o.d + spec.halfDepth;
      const overlapY = b.maxY > spec.yMin && b.minY < spec.yMax;
      if (overlapX && overlapD && overlapY) {
        o.hit = true;
        this.onHit(o);
        return;
      }
    }
  }

  private onHit(o: Obstacle): void {
    const p = this.player;
    if (!p.stumble()) return;
    this.stumbles++;
    this.chasers.onStumble();
    this.hud.flashHit();
    this.world.addShake(0.35);

    if (OBSTACLE_SPECS[o.kind].solid) {
      if (p.isChangingLane) {
        // Clipped the side of a car while changing lanes: bounce back.
        p.bounceBack();
      } else {
        // Ran straight into it: get shoved into a free neighbouring lane (prefer center).
        const options = [p.lane - 1, p.lane + 1]
          .filter((l) => l >= 0 && l < CONFIG.lanes.count)
          .sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
        const free = options.find((l) => !this.track.laneBlocked(l, o.d));
        if (free !== undefined) p.setLane(free);
      }
    }
  }

  private finish(): void {
    const success = this.phase === 'success';
    const progress = Math.min(1, this.player.d / this.mission.length);
    const xp = success
      ? CONFIG.xp.successBase + CONFIG.xp.perMissionBonus * (this.mission.id - 1)
      : Math.round(CONFIG.xp.successBase * CONFIG.xp.caughtFraction * progress);

    const save = this.ctx.save;
    save.data.xp += xp;
    save.data.totalRuns += 1;
    if (success) save.data.missionsCompleted = Math.max(save.data.missionsCompleted, this.mission.id);
    save.write();

    const result: RunResult = {
      outcome: success ? 'success' : 'caught',
      missionId: this.mission.id,
      xp,
      distance: this.player.d,
      length: this.mission.length,
      stumbles: this.stumbles,
      time: this.runTime,
    };
    this.ctx.states.change(StateId.RESULT, result);
  }

  render(): void {
    this.ctx.renderer.render(this.world.scene, this.world.camera);
  }
}
