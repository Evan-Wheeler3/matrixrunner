import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { Screen, el } from '../../ui/dom';

export interface RunResult {
  outcome: 'success' | 'caught';
  missionId: number;
  xp: number;
  distance: number;
  length: number;
  stumbles: number;
  time: number;
}

/** SUCCESS / CAUGHT summary over the frozen last frame of the run. */
export class ResultState implements GameState {
  readonly id = StateId.RESULT;
  private screen: Screen | null = null;
  private result: RunResult | null = null;
  private t = 0;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const r = params as RunResult;
    this.result = r;
    this.t = 0;
    this.screen = new Screen(this.ctx.uiRoot, `result ${r.outcome}`);
    const root = this.screen.root;
    const pct = Math.min(100, Math.round((r.distance / r.length) * 100));
    root.appendChild(el('h1', 'result-title glitch', r.outcome === 'success' ? 'CALL CONNECTED' : 'CAUGHT'));
    root.appendChild(
      el(
        'div',
        'result-sub',
        r.outcome === 'success' ? 'You hit the line. The signal pulls you out.' : 'A hand on your shoulder. The world goes white.',
      ),
    );
    root.appendChild(
      el(
        'div',
        'result-stats',
        `<div><span>Distance</span><b>${Math.round(r.distance)} m (${pct}%)</b></div>
         <div><span>Time</span><b>${r.time.toFixed(1)} s</b></div>
         <div><span>Stumbles</span><b>${r.stumbles}</b></div>
         <div class="xp"><span>XP earned</span><b>+${r.xp}</b></div>`,
      ),
    );
    const buttons = el('div', 'menu-buttons');
    const retry = el('button', 'btn', 'Retry (R)');
    retry.addEventListener('click', () => this.retry());
    const hub = el('button', 'btn primary', 'Wake Up (Enter)');
    hub.addEventListener('click', () => this.ctx.states.change(StateId.HUB));
    buttons.append(hub, retry);
    root.appendChild(buttons);
  }

  private retry(): void {
    if (this.result) this.ctx.states.change(StateId.RUN, { missionId: this.result.missionId });
  }

  exit(): void {
    this.screen?.destroy();
    this.screen = null;
  }

  update(dt: number): void {
    this.t += dt;
    // Small delay so a key held during the run doesn't instantly skip the screen.
    if (this.t < 0.6) return;
    if (this.ctx.input.wasPressed('confirm')) this.ctx.states.change(StateId.HUB);
    else if (this.ctx.input.wasPressed('retry')) this.retry();
  }

  render(): void {
    // Intentionally empty: the canvas keeps showing the run's final frame.
  }
}
