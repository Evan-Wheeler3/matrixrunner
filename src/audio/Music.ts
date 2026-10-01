import { CONFIG } from '../config';

/**
 * Procedural chase music: a low pulsing synth loop whose layers open up with
 * `intensity` (0 = brooding pad + soft pulse, 1 = full chase with kick, hats
 * and arpeggio). Uses the standard lookahead scheduler pattern so timing stays
 * tight regardless of frame rate.
 */

const M = CONFIG.audio.music;
// A-minor-ish progression, one chord per bar: Am, F, Dm, E.
const ROOTS = [45, 41, 38, 40]; // MIDI notes (A2, F2, D2, E2)
const CHORDS = [
  [0, 3, 7, 12],
  [0, 4, 7, 12],
  [0, 3, 7, 10],
  [0, 4, 7, 11],
];

const midiToHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private bassFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private padOscs: OscillatorNode[] = [];
  private playing = false;
  private nextTime = 0;
  private step = 0;
  private timer: number | null = null;
  /** Target and smoothed intensity 0..1. */
  private target = 0;
  intensity = 0;

  attach(ctx: AudioContext, out: GainNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.Q.value = 6;
    this.bassFilter.frequency.value = 300;
    this.bassFilter.connect(this.out);
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 700;
    this.padGain.connect(padFilter).connect(this.out);
    if (this.playing) this.begin();
  }

  setIntensity(v: number): void {
    this.target = Math.max(0, Math.min(1, v));
  }

  start(intensity = 0): void {
    this.target = this.intensity = intensity;
    if (this.playing) return;
    this.playing = true;
    if (this.ctx) this.begin();
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(0, t, 0.4);
    for (const o of this.padOscs) o.stop(t + 2);
    this.padOscs = [];
  }

  private begin(): void {
    const ctx = this.ctx!;
    this.nextTime = ctx.currentTime + 0.1;
    this.step = 0;
    // Sustained pad: two detuned saws, retuned each bar.
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.value = midiToHz(ROOTS[0] + 12);
      o.connect(this.padGain);
      o.start();
      this.padOscs.push(o);
    }
    this.padGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const sixteenth = 60 / M.bpm / 4;
    // Smooth intensity changes so layers fade rather than pop.
    this.intensity += (this.target - this.intensity) * 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
    this.bassFilter.frequency.setTargetAtTime(260 + this.intensity * 1600, ctx.currentTime, 0.2);
  }

  private playStep(step: number, t: number, dur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const root = ROOTS[bar];
    const k = this.intensity;

    if (s === 0) {
      for (const o of this.padOscs) o.frequency.setTargetAtTime(midiToHz(root + 12 + CHORDS[bar][2]), t, 0.3);
    }
    // Bass pulse: steady 8ths, 16ths once the chase heats up; octave pop on the off-beat.
    if (s % 2 === 0 || k > 0.55) {
      const note = root + (s % 8 === 6 && k > 0.3 ? 12 : 0);
      this.synth('sawtooth', midiToHz(note), t, dur * 0.9, 0.16 + k * 0.08, this.bassFilter);
    }
    // Kick on quarters.
    if (k > 0.2 && s % 4 === 0) this.kick(t, 0.5 + k * 0.4);
    // Hats: 8ths, then 16ths.
    if (k > 0.4 && (s % 2 === 1 || k > 0.75)) this.hat(t, s % 4 === 2 ? 0.07 : 0.04);
    // Snare-ish clap on 2 and 4 at high intensity.
    if (k > 0.65 && (s === 4 || s === 12)) this.clap(t);
    // Arpeggio of chord tones.
    if (k > 0.5 && s % 2 === 0) {
      const chord = CHORDS[bar];
      const note = root + 24 + chord[(s / 2) % chord.length];
      this.synth('square', midiToHz(note), t, dur * 0.6, 0.03 + (k - 0.5) * 0.05, this.out);
    }
  }

  private synth(type: OscillatorType, freq: number, t: number, dur: number, gain: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private hat(t: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  private clap(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.16);
  }
}
