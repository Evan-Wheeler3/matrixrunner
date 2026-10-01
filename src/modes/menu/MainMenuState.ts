import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { Screen, el } from '../../ui/dom';

/** Title screen: continue / new game / controls. */
export class MainMenuState implements GameState {
  readonly id = StateId.MAIN_MENU;
  private screen: Screen | null = null;

  constructor(private ctx: GameContext) {}

  enter(): void {
    const { save } = this.ctx;
    this.screen = new Screen(this.ctx.uiRoot, 'menu');
    const root = this.screen.root;
    root.appendChild(el('h1', 'title glitch', 'RAINLINE'));
    root.appendChild(el('div', 'subtitle', 'the city is a simulation. the rain is real enough.'));

    const buttons = el('div', 'menu-buttons');
    const hasSave = save.data.totalRuns > 0 || save.data.xp > 0;
    const play = el('button', 'btn primary', hasSave ? 'Continue' : 'Jack In');
    play.addEventListener('click', () => this.ctx.states.change(StateId.HUB));
    buttons.appendChild(play);
    if (hasSave) {
      const reset = el('button', 'btn', 'New Game');
      reset.addEventListener('click', () => {
        if (confirm('Erase all progress?')) {
          save.reset();
          this.ctx.states.change(StateId.HUB);
        }
      });
      buttons.appendChild(reset);
    }
    root.appendChild(buttons);

    root.appendChild(
      el(
        'div',
        'controls-help',
        `<b>RUN</b> &nbsp; A/D or ←/→ lanes · W/Space jump (hold = higher) · S/Ctrl slide · Shift sprint · Mouse look · Esc pause<br>
         <b>PAYPHONE</b> &nbsp; hold E to complete the call before the Agents reach you`,
      ),
    );
    play.focus();
  }

  exit(): void {
    this.screen?.destroy();
    this.screen = null;
  }

  update(): void {
    if (this.ctx.input.wasPressed('confirm')) this.ctx.states.change(StateId.HUB);
  }

  render(): void {
    this.ctx.renderer.clear();
  }
}
