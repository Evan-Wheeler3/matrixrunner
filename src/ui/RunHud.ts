import { CONFIG } from '../config';
import { Screen, el } from './dom';

export interface HudState {
  distance: number;
  length: number;
  gap: number;
  danger: number;
  sprintReady: boolean;
  sprintCooldown: number;
  sprinting: boolean;
  /** 0..1 progress of the payphone call, or null when not at the phone. */
  callProgress: number | null;
  callHeld: boolean;
  fps: number;
}

/** DOM overlay for the run: progress, chase gap meter, sprint, call prompt. */
export class RunHud {
  private screen: Screen;
  private progressFill: HTMLElement;
  private progressLabel: HTMLElement;
  private gapFill: HTMLElement;
  private gapLabel: HTMLElement;
  private gapBox: HTMLElement;
  private sprint: HTMLElement;
  private call: HTMLElement;
  private callFill: HTMLElement;
  private callLabel: HTMLElement;
  private dangerVignette: HTMLElement;
  private hitFlash: HTMLElement;
  private banner: HTMLElement;
  private pauseOverlay: HTMLElement;
  private fps: HTMLElement;
  private bannerTimer = 0;

  constructor(parent: HTMLElement) {
    this.screen = new Screen(parent, 'run-hud');
    const r = this.screen.root;

    this.dangerVignette = r.appendChild(el('div', 'danger-vignette'));
    this.hitFlash = r.appendChild(el('div', 'hit-flash'));

    const top = r.appendChild(el('div', 'hud-top'));
    top.appendChild(el('div', 'hud-label', 'PAYPHONE'));
    const bar = top.appendChild(el('div', 'progress-bar'));
    this.progressFill = bar.appendChild(el('div', 'progress-fill'));
    bar.appendChild(el('div', 'progress-phone', '☎'));
    this.progressLabel = top.appendChild(el('div', 'hud-value'));

    this.gapBox = r.appendChild(el('div', 'hud-gap'));
    this.gapBox.appendChild(el('div', 'hud-label', 'AGENT GAP'));
    const gapBar = this.gapBox.appendChild(el('div', 'gap-bar'));
    this.gapFill = gapBar.appendChild(el('div', 'gap-fill'));
    this.gapLabel = this.gapBox.appendChild(el('div', 'hud-value'));

    this.sprint = r.appendChild(el('div', 'hud-sprint', 'SPRINT'));

    this.call = r.appendChild(el('div', 'hud-call hidden'));
    this.callLabel = this.call.appendChild(el('div', 'call-label', 'HOLD <kbd>E</kbd> TO CALL'));
    const callBar = this.call.appendChild(el('div', 'call-bar'));
    this.callFill = callBar.appendChild(el('div', 'call-fill'));

    this.banner = r.appendChild(el('div', 'hud-banner'));
    this.pauseOverlay = r.appendChild(
      el('div', 'pause-overlay hidden', `<h2>PAUSED</h2><p>Esc — resume &nbsp;·&nbsp; Q — abort to hub</p>`),
    );
    this.fps = r.appendChild(el('div', 'hud-fps'));
  }

  showBanner(text: string, seconds = 1.4): void {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  flashHit(): void {
    this.hitFlash.classList.remove('flash');
    // Force reflow so the CSS animation restarts.
    void this.hitFlash.offsetWidth;
    this.hitFlash.classList.add('flash');
  }

  setPaused(paused: boolean): void {
    this.pauseOverlay.classList.toggle('hidden', !paused);
  }

  update(dt: number, s: HudState): void {
    const pct = Math.min(1, s.distance / s.length);
    this.progressFill.style.width = `${pct * 100}%`;
    this.progressLabel.textContent = `${Math.max(0, Math.round(s.length - s.distance))} m`;

    const gapPct = Math.max(0, s.gap) / CONFIG.chase.maxGap;
    this.gapFill.style.width = `${gapPct * 100}%`;
    this.gapLabel.textContent = `${Math.max(0, s.gap).toFixed(1)} m`;
    this.gapBox.classList.toggle('danger', s.danger > 0);
    this.dangerVignette.style.opacity = String(s.danger * 0.85);

    this.sprint.classList.toggle('ready', s.sprintReady);
    this.sprint.classList.toggle('active', s.sprinting);
    this.sprint.textContent = s.sprinting ? 'SPRINT!' : s.sprintReady ? 'SPRINT [Shift]' : `SPRINT ${s.sprintCooldown.toFixed(1)}s`;

    if (s.callProgress === null) {
      this.call.classList.add('hidden');
    } else {
      this.call.classList.remove('hidden');
      this.call.classList.toggle('held', s.callHeld);
      this.callFill.style.width = `${s.callProgress * 100}%`;
      this.callLabel.innerHTML = s.callHeld ? 'DIALING…' : 'HOLD <kbd>E</kbd> TO CALL';
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    this.fps.textContent = `${Math.round(s.fps)} fps`;
  }

  destroy(): void {
    this.screen.destroy();
  }
}
