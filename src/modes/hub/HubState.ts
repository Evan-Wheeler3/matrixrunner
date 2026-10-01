import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { Screen, el } from '../../ui/dom';
import { MISSIONS } from '../../config';

/**
 * PLACEHOLDER hub (milestone 1). The explorable hovership arrives in
 * milestone 4; for now this is a simple screen that launches the next mission.
 */
export class HubState implements GameState {
  readonly id = StateId.HUB;
  private screen: Screen | null = null;

  constructor(private ctx: GameContext) {}

  /** Next mission in the linear campaign (clamped to what's playable so far). */
  private nextMissionId(): number {
    const next = this.ctx.save.data.missionsCompleted + 1;
    // Only the street theme exists in milestone 1, so always offer mission 1 for now.
    return Math.min(next, 1);
  }

  enter(): void {
    const { save } = this.ctx;
    const mission = MISSIONS.find((m) => m.id === this.nextMissionId())!;
    this.screen = new Screen(this.ctx.uiRoot, 'hub-placeholder');
    const root = this.screen.root;
    root.appendChild(el('h2', 'hub-title', 'HOVERSHIP // NEBUCHET'));
    root.appendChild(el('div', 'hub-note', 'Explorable hub coming in milestone 4.'));
    root.appendChild(
      el(
        'div',
        'hub-stats',
        `XP <b>${save.data.xp}</b> &nbsp;·&nbsp; Missions cleared <b>${save.data.missionsCompleted}</b> &nbsp;·&nbsp; Runs <b>${save.data.totalRuns}</b>`,
      ),
    );
    root.appendChild(el('div', 'hub-mission', `NEXT: Mission ${mission.id} — <b>${mission.name}</b>`));
    const start = el('button', 'btn primary', 'Jack In (Enter)');
    start.addEventListener('click', () => this.launch());
    const menu = el('button', 'btn', 'Main Menu');
    menu.addEventListener('click', () => this.ctx.states.change(StateId.MAIN_MENU));
    const buttons = el('div', 'menu-buttons');
    buttons.append(start, menu);
    root.appendChild(buttons);
  }

  private launch(): void {
    this.ctx.states.change(StateId.RUN, { missionId: this.nextMissionId() });
  }

  exit(): void {
    this.screen?.destroy();
    this.screen = null;
  }

  update(): void {
    if (this.ctx.input.wasPressed('confirm')) this.launch();
  }

  render(): void {
    this.ctx.renderer.clear();
  }
}
