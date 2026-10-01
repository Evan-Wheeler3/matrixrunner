import { CONFIG } from '../config';
import { Music } from './Music';

/**
 * All game audio, synthesized with WebAudio – no sample files.
 *
 * Bus layout:  sources -> (sfx | music | ambience) -> master -> destination
 * Ambience (rain) rides the sfx volume.
 *
 * Browsers block audio until a user gesture, so the AudioContext is created
 * lazily on the first key/mouse/touch event. Every public method is a no-op
 * until then, so callers never need to check.
 */

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

const A = CONFIG.audio;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private rain: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private dripTimer = 0;
  private heartTimer = 0;
  private ringTimer = 0;
  private ringing = false;
  private dialing = false;
  private dialTimer = 0;
  readonly music = new Music();
  private volumes: Volumes;
  private onUnlock: (() => void)[] = [];

  constructor(volumes: Volumes) {
    this.volumes = { ...volumes };
    const unlock = () => {
      this.unlock();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('mousedown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Run `fn` now if audio is live, otherwise as soon as it unlocks. */
  whenUnlocked(fn: () => void): void {
    if (this.ctx) fn();
    else this.onUnlock.push(fn);
  }

  private unlock(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // Gentle limiter so stacked sounds never clip harshly.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.noise = this.makeNoise(2);
    this.applyVolumes();
    this.music.attach(ctx, this.musicBus, this.noise);
    for (const fn of this.onUnlock.splice(0)) fn();
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * A.musicLevel, t, 0.05);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Slightly pinked white noise (one-pole lowpass blend) – less hissy.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.6 + white * 0.4;
      data[i] = last * 1.4;
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  /** Filtered noise burst with an attack/decay envelope. */
  private noiseHit(opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; decay: number; delay?: number; freqEnd?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + opts.decay + 0.05);
  }

  /** Oscillator blip with optional pitch sweep. */
  private tone(opts: { type?: OscillatorType; freq: number; freqEnd?: number; gain: number; attack?: number; decay: number; delay?: number; bus?: GainNode }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    osc.connect(g).connect(opts.bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + attack + opts.decay + 0.05);
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  /** Continuous rain bed: hiss layer + low wash. Idempotent. */
  startRain(level = 1): void {
    const ctx = this.ctx;
    if (!ctx) return this.whenUnlocked(() => this.startRain(level));
    if (this.rain) {
      this.rain.gain.gain.setTargetAtTime(A.rainLevel * level, ctx.currentTime, 0.5);
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(A.rainLevel * level, ctx.currentTime, 0.8);
    gain.connect(this.sfxBus);
    const nodes: AudioScheduledSourceNode[] = [];
    const layer = (type: BiquadFilterType, freq: number, q: number, g: number, rate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const lg = ctx.createGain();
      lg.gain.value = g;
      src.connect(f).connect(lg).connect(gain);
      src.start(0, Math.random() * 2);
      nodes.push(src);
    };
    layer('bandpass', 2600, 0.4, 0.55, 1.0); // hiss on surfaces
    layer('highpass', 6000, 0.3, 0.18, 1.1); // fine spray
    layer('lowpass', 380, 0.5, 0.6, 0.6); // distant wash
    this.rain = { gain, nodes };
  }

  stopRain(): void {
    if (!this.ctx || !this.rain) return;
    const { gain, nodes } = this.rain;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.3);
    for (const n of nodes) n.stop(t + 1.5);
    this.rain = null;
  }

  /** Per-frame ambience: random drips on gutters/awnings, heartbeat, phone ring. */
  update(dt: number, danger: number): void {
    if (!this.ctx) return;
    if (this.rain) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.05 + Math.random() * 0.3;
        this.tone({ freq: 1800 + Math.random() * 2400, freqEnd: 900 + Math.random() * 600, gain: 0.02 + Math.random() * 0.03, decay: 0.05 });
      }
    }
    // Heartbeat speeds up as the Agents close in.
    if (danger > 0.02) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 1.0 - danger * 0.62;
        const g = 0.25 + danger * 0.55;
        this.tone({ freq: 62, freqEnd: 40, gain: g, decay: 0.14 });
        this.tone({ freq: 55, freqEnd: 36, gain: g * 0.7, decay: 0.16, delay: 0.17 });
      }
    } else {
      this.heartTimer = 0;
    }
    // Payphone ring cadence (two short bursts, pause).
    if (this.ringing) {
      this.ringTimer -= dt;
      if (this.ringTimer <= 0) {
        this.ringTimer = 1.6;
        this.ringBurst(0);
        this.ringBurst(0.45);
      }
    }
    if (this.dialing) {
      this.dialTimer -= dt;
      if (this.dialTimer <= 0) {
        // Data chirps while the line connects.
        this.dialTimer = 0.09 + Math.random() * 0.08;
        this.tone({ type: 'square', freq: 900 + Math.random() * 1600, gain: 0.03, decay: 0.05 });
      }
    }
  }

  private ringBurst(delay: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const g = ctx.createGain();
    g.gain.value = 0;
    // 20 Hz amplitude warble = classic bell-ringer feel.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 20;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(g.gain);
    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0.06, t + 0.38);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    for (const f of [440, 480]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.42);
    }
    lfo.start(t);
    lfo.stop(t + 0.42);
    g.connect(this.sfxBus);
  }

  setRinging(on: boolean): void {
    if (on && !this.ringing) this.ringTimer = 0;
    this.ringing = on;
  }

  setDialing(on: boolean): void {
    this.dialing = on;
  }

  // -------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------

  /** Wet footstep: slap + splash. */
  footstep(intensity = 1): void {
    this.noiseHit({ type: 'bandpass', freq: 1400 + Math.random() * 900, q: 1.2, gain: 0.12 * intensity, decay: 0.07 });
    this.tone({ freq: 110, freqEnd: 60, gain: 0.09 * intensity, decay: 0.05 });
  }

  jump(): void {
    this.noiseHit({ type: 'bandpass', freq: 600, freqEnd: 2200, q: 2, gain: 0.12, attack: 0.02, decay: 0.18 });
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 12);
    this.tone({ freq: 120, freqEnd: 45, gain: 0.25 * k + 0.08, decay: 0.12 });
    this.noiseHit({ type: 'lowpass', freq: 2400, gain: 0.25 * k + 0.08, decay: 0.2 }); // splash
  }

  slide(): void {
    this.noiseHit({ type: 'bandpass', freq: 3000, freqEnd: 900, q: 0.8, gain: 0.16, attack: 0.03, decay: 0.55 });
  }

  stumble(): void {
    this.tone({ freq: 90, freqEnd: 32, gain: 0.55, decay: 0.3 });
    this.noiseHit({ type: 'lowpass', freq: 900, freqEnd: 200, gain: 0.4, decay: 0.25 });
    this.noiseHit({ type: 'highpass', freq: 3000, gain: 0.1, decay: 0.12, delay: 0.02 });
  }

  sprint(): void {
    this.noiseHit({ type: 'bandpass', freq: 400, freqEnd: 3000, q: 1.5, gain: 0.18, attack: 0.05, decay: 0.35 });
  }

  /** Thunder: crack then long rumble, delayed by the given distance-ish seconds. */
  thunder(delay = 0.6): void {
    this.noiseHit({ type: 'lowpass', freq: 1800, freqEnd: 300, gain: 0.35, decay: 0.4, delay });
    this.noiseHit({ type: 'lowpass', freq: 220, freqEnd: 60, gain: 0.7, attack: 0.15, decay: 2.8, delay: delay + 0.1 });
  }

  connected(): void {
    this.tone({ type: 'sine', freq: 660, gain: 0.15, decay: 0.12 });
    this.tone({ type: 'sine', freq: 990, gain: 0.15, decay: 0.3, delay: 0.12 });
  }

  caught(): void {
    this.tone({ type: 'sawtooth', freq: 220, freqEnd: 40, gain: 0.25, decay: 1.2 });
    this.noiseHit({ type: 'lowpass', freq: 600, freqEnd: 80, gain: 0.5, decay: 1.0 });
  }

  uiClick(): void {
    this.tone({ type: 'square', freq: 1200, freqEnd: 600, gain: 0.05, decay: 0.04 });
  }

  uiHover(): void {
    this.tone({ type: 'sine', freq: 1800, gain: 0.02, decay: 0.03 });
  }
}
