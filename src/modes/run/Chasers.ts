import * as THREE from 'three';
import { CONFIG } from '../../config';
import { animateHumanoid, buildAgent, type Humanoid } from '../../render/models';
import type { Player } from './Player';

const C = CONFIG.chase;

/**
 * The pursuing Agents. Gameplay is driven by a single number – the gap (in
 * meters) between the player and the lead Agent – and the models are simply
 * placed that far behind the player.
 */
export class Chasers {
  readonly group = new THREE.Group();
  private agents: { model: Humanoid; x: number; offset: number; phase: number; laneBias: number }[] = [];
  gap: number;
  /** When true (at the payphone) Agents walk in at a fixed closing speed instead of pacing the player. */
  closingIn = false;
  private time = 0;

  constructor(count: number, startGap: number) {
    this.gap = startGap;
    for (let i = 0; i < count; i++) {
      const model = buildAgent();
      this.group.add(model.root);
      this.agents.push({
        model,
        x: 0,
        // Followers trail the leader slightly.
        offset: i * 1.6,
        phase: i * 1.7,
        laneBias: i === 0 ? 0 : i % 2 === 1 ? -1.6 : 1.6,
      });
    }
  }

  get danger(): number {
    return THREE.MathUtils.clamp(1 - this.gap / C.dangerGap, 0, 1);
  }

  /** Lose a chunk of gap on a stumble (on top of the slowdown itself). */
  onStumble(): void {
    this.gap -= C.stumbleGapPenalty;
  }

  update(dt: number, player: Player): void {
    this.time += dt;
    // Agents pace the player's cruise speed (not sprint/stumble), so the gap
    // only changes when you sprint, stumble, or stop.
    const agentSpeed = this.closingIn ? C.callApproachSpeed : player.cruiseSpeed * C.agentSpeedRatio;
    const relative = this.closingIn ? -agentSpeed : player.speed - agentSpeed;
    this.gap = Math.min(C.maxGap, this.gap + relative * dt);

    for (const a of this.agents) {
      // Drift toward the player's x with a lag, offset per agent so they fan out.
      const targetX = THREE.MathUtils.clamp(player.x + a.laneBias, -CONFIG.lanes.width * 1.2, CONFIG.lanes.width * 1.2);
      a.x += (targetX - a.x) * Math.min(1, dt * 2.5);
      a.phase += (this.closingIn ? C.callApproachSpeed : agentSpeed) * dt * 0.62;
      const d = player.d - Math.max(0.6, this.gap) - a.offset;
      a.model.root.position.set(a.x, 0, -d);
      animateHumanoid(a.model, 'run', a.phase, this.time);
    }
  }
}
