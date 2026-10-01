import * as THREE from 'three';
import { CONFIG, type MissionDef } from '../../config';
import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { disposeObject } from '../../core/dispose';
import { setMaterialStyle } from '../../render/palette';
import { animateHumanoid, buildAgent, type Humanoid } from '../../render/models';
import { ComicPipeline } from '../../render/comic/ComicPipeline';
import { style, onStyleChange } from '../../render/comic/ComicStyle';
import { Track, laneX, OBSTACLE_SPECS } from '../run/Track';
import { Player } from '../run/Player';
import { ComicWorld } from './ComicWorld';
import { ComicStreet } from './ComicStreet';
import { StylePanel } from '../../ui/StylePanel';
import { ComicFX } from '../../ui/ComicFX';
import { Screen, el } from '../../ui/dom';

/**
 * STYLE TEST: a standalone street run rendered with the comic/ink pipeline,
 * for art-direction review. The player is controllable, obstacles cause
 * stumbles (with comic FX) but there's no fail state. One Agent runs
 * alongside so the character look can be judged up close.
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
  private world!: ComicWorld;
  private track!: Track;
  private player!: Player;
  private agent!: Humanoid;
  private agentX = 0;
  private agentPhase = 0;
  private shadows: { mesh: THREE.Mesh; target: () => THREE.Vector3 }[] = [];
  private pipeline!: ComicPipeline;
  private panel!: StylePanel;
  private fx!: ComicFX;
  private hud!: Screen;
  private frozen = false;
  private lightningTimer = 4;
  private speedLines = 0;
  private lastDt = 0;
  private time = 0;
  private unsubscribe: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private ctx: GameContext) {}

  enter(): void {
    setMaterialStyle('comic');
    this.frozen = false;
    this.time = 0;
    this.lightningTimer = 9;
    this.applyQuality();

    this.world = new ComicWorld(this.ctx.width / this.ctx.height);
    this.track = new Track(TEST_MISSION, (slots) => new ComicStreet(slots));
    const audio = this.ctx.audio;
    this.player = new Player(1, TEST_MISSION.length, {
      onLand: (impact) => {
        if (impact > 6) this.world.chase.addShake(Math.min(0.25, impact * 0.018));
        if (impact > 9) this.popAtPlayer('SPLSH!', { color: '#9ff0d8', size: 30 });
        audio.land(impact);
      },
      onJump: () => audio.jump(),
      onSlide: () => {
        audio.slide();
        this.popAtPlayer('SKRRT', { burst: false, size: 26 });
      },
      onSprint: () => {
        audio.sprint();
        this.popAtPlayer('WHOOSH', { burst: false, size: 34, color: '#1fd2d6' });
      },
      onStep: () => audio.footstep(),
    });
    this.agent = buildAgent();
    this.world.scene.add(this.track.group, this.player.model.root, this.agent.root);
    const playerPos = new THREE.Vector3();
    const agentPos = new THREE.Vector3();
    this.shadows = [
      { mesh: this.world.makeShadow(1.3), target: () => playerPos.copy(this.player.model.root.position) },
      { mesh: this.world.makeShadow(1.3), target: () => agentPos.copy(this.agent.root.position) },
    ];
    this.track.update(0, 0);

    this.pipeline = new ComicPipeline(this.ctx.renderer);
    this.pipeline.setSize(this.ctx.width, this.ctx.height);
    this.unsubscribe = onStyleChange(() => this.applyQuality());

    this.hud = new Screen(this.ctx.uiRoot, 'style-hud');
    this.hud.root.appendChild(
      el('div', 'comic-caption', 'STYLE TEST — <b>A/D</b> lanes · <b>W</b> jump · <b>S</b> slide · <b>Shift</b> sprint · <b>F2</b> style panel · <b>L</b> lightning · <b>P</b> freeze · <b>Esc</b> menu'),
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
    (this.track.env as ComicStreet).dispose();
    this.world.dispose();
    disposeObject(this.world.scene);
    this.world.scene.clear();
    setMaterialStyle('classic');
    this.ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
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
    this.pipeline.lightning(1);
    this.world.flash = 1;
    this.ctx.audio.thunder(0.4 + Math.random() * 0.9);
    // Classic double flicker.
    window.setTimeout(() => {
      this.pipeline?.lightning(0.7);
      if (this.world) this.world.flash = 0.7;
    }, 140);
  }

  private popAtPlayer(word: string, opts: Parameters<ComicFX['pop']>[3] = {}): void {
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

    // Obstacles stumble you (with a comic impact burst) but never end the test.
    if (!p.isInvulnerable) {
      const hit = this.track.findHit(p.bounds(), p.d, prevD - P.halfDepth);
      if (hit && p.stumble()) {
        this.world.chase.addShake(0.35);
        this.ctx.audio.stumble();
        this.popAtPlayer(Math.random() < 0.5 ? 'THUD!' : 'WHAM!', { color: '#f0359a', size: 46 });
        if (OBSTACLE_SPECS[hit.kind].solid) {
          const free = [p.lane - 1, p.lane + 1].filter((l) => l >= 0 && l < CONFIG.lanes.count).find((l) => !this.track.laneBlocked(l, hit.d));
          if (free !== undefined) p.setLane(free);
        }
      }
    }

    // The Agent runs a lane over, just behind the runner – close enough to judge the look.
    const agentLane = p.lane === 2 ? 1 : p.lane + 1;
    this.agentX += (laneX(agentLane) - this.agentX) * Math.min(1, dt * 3);
    this.agentPhase += p.speed * dt * 0.62;
    const agentD = p.d - 0.9 - Math.sin(this.time * 0.7) * 0.6;
    this.agent.root.position.set(this.agentX, 0, -agentD);
    animateHumanoid(this.agent, 'run', this.agentPhase + 1.3, this.time);
    for (const s of this.shadows) {
      const t = s.target();
      s.mesh.position.set(t.x, 0.03, t.z);
      const k = Math.max(0.4, 1 - t.y * 0.25);
      s.mesh.scale.set(k, k, k);
    }

    // Loop the street before the payphone end of the test mission.
    if (p.d > TEST_MISSION.length - 80) this.ctx.states.change(StateId.STYLE_TEST);

    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      const [a, b] = CONFIG.audio.lightningInterval;
      this.lightningTimer = a + Math.random() * (b - a);
      this.strikeLightning();
    }

    this.world.update(dt, { x: p.x, y: p.y, d: p.d, speed: p.speed, cruise: p.cruiseSpeed });
    this.speedLines += ((p.sprintTimer > 0 ? 1 : 0) - this.speedLines) * Math.min(1, dt * 8);
    this.pipeline.speedLines = this.speedLines;

    const audio = this.ctx.audio;
    audio.music.setIntensity(0.45 + (p.sprintTimer > 0 ? 0.4 : 0));
    audio.update(dt, 0);
    const fps = this.hud.root.querySelector('.hud-fps');
    if (fps) fps.textContent = `${Math.round(this.ctx.fps)} fps`;
  }

  render(): void {
    // Rendering (and line boil) continues while frozen so the look can be inspected.
    this.pipeline.render(this.world.scene, this.world.camera, this.lastDt);
  }
}
