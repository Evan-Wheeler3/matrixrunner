import * as THREE from 'three';
import { CONFIG } from '../config';
import { Input } from './Input';
import { StateMachine, StateId, type GameState } from './StateMachine';
import { Save } from '../save/Save';
import { AudioEngine } from '../audio/AudioEngine';

/**
 * Shared services handed to every state. States never reach for globals –
 * everything they need comes through here.
 */
export interface GameContext {
  renderer: THREE.WebGLRenderer;
  input: Input;
  save: Save;
  audio: AudioEngine;
  states: StateMachine;
  /** DOM layer above the canvas; each state mounts its own root inside it. */
  uiRoot: HTMLElement;
  width: number;
  height: number;
  /** Smoothed frames per second (debug readout). */
  fps: number;
}

/** Longest frame we simulate; anything slower (tab switch, hitch) is clamped. */
const MAX_DT = 1 / 20;

export class Game {
  readonly ctx: GameContext;
  private lastTime = 0;

  constructor(canvasParent: HTMLElement, uiRoot: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    renderer.setClearColor(CONFIG.render.clearColor);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    canvasParent.appendChild(renderer.domElement);

    const save = new Save();
    this.ctx = {
      renderer,
      input: new Input(renderer.domElement),
      save,
      audio: new AudioEngine(save.data.settings.volumes),
      states: new StateMachine(),
      uiRoot,
      width: window.innerWidth,
      height: window.innerHeight,
      fps: 60,
    };

    window.addEventListener('resize', () => this.onResize());
    // Every UI button gets a click/hover blip.
    uiRoot.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.ctx.audio.uiClick();
    });
    uiRoot.addEventListener('mouseover', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (btn && !btn.contains(e.relatedTarget as Node)) this.ctx.audio.uiHover();
    });
    this.onResize();
  }

  register(...states: GameState[]): void {
    for (const s of states) this.ctx.states.register(s);
  }

  start(initial: StateId): void {
    this.ctx.states.change(initial);
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.frame(t);
    });
  }

  private frame = (time: number): void => {
    const rawDt = (time - this.lastTime) / 1000;
    const dt = Math.min(rawDt, MAX_DT);
    this.lastTime = time;
    if (rawDt > 0) this.ctx.fps += (1 / rawDt - this.ctx.fps) * 0.05;

    const { states, input } = this.ctx;
    states.flush();
    const state = states.current;
    if (state) {
      state.update(dt);
      state.render();
    }
    input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.width = w;
    this.ctx.height = h;
    this.ctx.renderer.setSize(w, h);
    this.ctx.states.current?.resize?.(w, h);
  }
}
