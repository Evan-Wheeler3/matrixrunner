import * as THREE from 'three';
import { CONFIG, type MissionDef } from '../../config';
import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { disposeObject } from '../../core/dispose';
import { setMaterialStyle } from '../../render/palette';
import { animateHumanoid, buildAgent, type Humanoid } from '../../render/models';
import { LookPipeline } from '../../render/look/LookPipeline';
import { style, onStyleChange } from '../../render/look/LookStyle';
import { Track, laneX, OBSTACLE_SPECS } from '../run/Track';
import { Player } from '../run/Player';
import { NoirWorld } from './NoirWorld';
import { NoirStreet } from './NoirStreet';
import { StylePanel } from '../../ui/StylePanel';
import { ComicFX } from '../../ui/ComicFX';
import { Screen, el } from '../../ui/dom';

/**
 * STYLE TEST: a standalone street run rendered with the graphic-noir pipeline
 * for art-direction review. Controllable runner, obstacles stumble you but
 * never fail, one Agent runs alongside to judge characters up close.
 *
 * Keys: F2 style panel · L lightning · P freeze · Esc back to menu.
 */

const TEST_MISSION: MissionDef = {
  id: 0,
  name: 'Style Test',
  theme: 'street',
  length: 4000,
  seed: 777,
  speedMult: 1,
  density: 0.4,
  agents: 1,
  startGap: 20,
  callDuration: 4,
};

const P = CONFIG.player;

export class StyleTestState implements GameState {
  readonly id = StateId.STYLE_TEST;
  private world!: NoirWorld;
  private street!: NoirStreet;
  private track!: Track;
  private player!: Player;
  private agent!: Humanoid;
  private agentX = 0;
  private agentPhase = 0;
  private pipeline!: LookPipeline;
  private panel!: StylePanel;
  private fx!: ComicFX;
  private hud!: Screen;
  private frozen = false;
  private lightningTimer = 9;
  private speedLines = 0;
  private lastDt = 1 / 60;
  private time = 0;
  private unsubscribe: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private ctx: GameContext) {}

  enter(): void {
    setMaterialStyle('noir');
    this.frozen = false;
    this.time = 0;
    this.lightningTimer = 9;

    this.pipeline = new LookPipeline(this.ctx.renderer);
    this.applyQuality();
    this.world = new NoirWorld(this.ctx.renderer, this.ctx.width / this.ctx.height);
    this.track = new Track(TEST_MISSION, (slots) => (this.street = new NoirStreet(slots)));
    const audio = this.ctx.audio;
    this.player = new Player(1, TEST_MISSION.length, {
      onLand: (impact) => {
        if (impact > 6) this.world.chase.addShake(Math.min(0.2, impact * 0.015));
        audio.land(impact);
      },
      onJump: () => audio.jump(),
      onSlide: () => audio.slide(),
      onSprint: () => audio.sprint(),
      onStep: () => audio.footstep(),
    });
    this.agent = buildAgent();
    this.world.world.add(this.track.group, this.player.model.root, this.agent.root);
    this.track.update(0, 0);

    this.unsubscribe = onStyleChange(() => this.applyQuality());

    this.hud = new Screen(this.ctx.uiRoot, 'style-hud');
    this.hud.root.appendChild(
      el('div', 'noir-caption', 'LOOK TEST &nbsp;<b>A/D</b> lanes · <b>W</b> jump · <b>S</b> slide · <b>Shift</b> sprint · <b>F2</b> look panel · <b>L</b> lightning · <b>P</b> freeze · <b>Esc</b> menu'),
    );
    this.hud.root.appendChild(el('div', 'hud-fps'));
    this.fx = new ComicFX(this.hud.root);
    this.panel = new StylePanel(this.hud.root, (action) => {
      if (action === 'lightning') this.strikeLightning();
      else this.applyQuality();
    });
    window.addEventListener('keydown', this.keyHandler);

    audio.startRain();
    audio.music.start(0.45);
  }

  exit(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.unsubscribe?.();
    this.ctx.audio.music.stop();
    this.pipeline.dispose();
    this.panel.destroy();
    this.fx.destroy();
    this.hud.destroy();
    this.world.dispose();
    disposeObject(this.world.scene);
    this.world.scene.clear();
    setMaterialStyle('classic');
    this.ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.ctx.renderer.setSize(this.ctx.width, this.ctx.height);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'F2') {
      e.preventDefault();
      this.panel.toggle();
    } else if (e.code === 'KeyL') this.strikeLightning();
    else if (e.code === 'KeyP') this.frozen = !this.frozen;
    else if (e.code === 'Escape') this.ctx.states.change(StateId.MAIN_MENU);
  }

  private applyQuality(): void {
    const pr = style.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio);
    this.ctx.renderer.setPixelRatio(pr);
    this.ctx.renderer.setSize(this.ctx.width, this.ctx.height);
    this.pipeline?.setSize(this.ctx.width, this.ctx.height);
  }

  private strikeLightning(): void {
    const hit = (k: number) => {
      this.pipeline?.lightning(k);
      if (this.world) this.world.flash = Math.max(this.world.flash, k);
    };
    hit(1);
    this.ctx.audio.thunder(0.4 + Math.random() * 0.9);
    window.setTimeout(() => hit(0.6), 140);
  }

  private popAtPlayer(word: string, opts: Parameters<ComicFX['pop']>[3] = {}): void {
    if (!style.comicFx) return;
    const p = this.player.model.root.position;
    const v = new THREE.Vector3(p.x, p.y + 2.1, p.z).project(this.world.camera);
    this.fx.pop(word, (v.x * 0.5 + 0.5) * this.ctx.width, (-v.y * 0.5 + 0.5) * this.ctx.height, opts);
  }

  resize(w: number, h: number): void {
    this.world.resize(w / h);
    this.applyQuality();
  }

  update(dt: number): void {
    this.lastDt = dt;
    if (this.frozen) return;
    this.time += dt;
    const p = this.player;
    const prevD = p.d;
    p.update(dt, this.ctx.input);
    this.track.update(p.d, dt);

    if (!p.isInvulnerable) {
      const hit = this.track.findHit(p.bounds(), p.d, prevD - P.halfDepth);
      if (hit && p.stumble()) {
        this.world.chase.addShake(0.3);
        this.ctx.audio.stumble();
        this.popAtPlayer('THUD', { color: '#e8e2d0', size: 34, burst: false });
        if (OBSTACLE_SPECS[hit.kind].solid) {
          const free = [p.lane - 1, p.lane + 1].filter((l) => l >= 0 && l < CONFIG.lanes.count).find((l) => !this.track.laneBlocked(l, hit.d));
          if (free !== undefined) p.setLane(free);
        }
      }
    }

    // The Agent runs a lane over, just behind the runner.
    const agentLane = p.lane === 2 ? 1 : p.lane + 1;
    this.agentX += (laneX(agentLane) - this.agentX) * Math.min(1, dt * 3);
    this.agentPhase += p.speed * dt * 0.62;
    const agentD = p.d - 0.9 - Math.sin(this.time * 0.7) * 0.6;
    this.agent.root.position.set(this.agentX, 0, -agentD);
    animateHumanoid(this.agent, 'run', this.agentPhase + 1.3, this.time);

    if (p.d > TEST_MISSION.length - 80) this.ctx.states.change(StateId.STYLE_TEST);

    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      const [a, b] = CONFIG.audio.lightningInterval;
      this.lightningTimer = a + Math.random() * (b - a);
      this.strikeLightning();
    }

    this.world.update(dt, { x: p.x, y: p.y, d: p.d, speed: p.speed, cruise: p.cruiseSpeed }, this.street.lightCandidates());
    this.speedLines += ((p.sprintTimer > 0 ? 1 : 0) - this.speedLines) * Math.min(1, dt * 8);
    this.pipeline.speedLines = this.speedLines;

    const audio = this.ctx.audio;
    audio.music.setIntensity(0.45 + (p.sprintTimer > 0 ? 0.4 : 0));
    audio.update(dt, 0);
    const fps = this.hud.root.querySelector('.hud-fps');
    if (fps) fps.textContent = `${Math.round(this.ctx.fps)} fps`;
  }

  render(): void {
    this.pipeline.render(this.world.scene, this.world.world, this.world.camera, this.lastDt);
  }
}
