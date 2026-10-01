import { StateId, type GameState } from '../../core/StateMachine';
import type { GameContext } from '../../core/Game';
import { Screen } from '../../ui/dom';

/** Shows a short boot splash, then hands off to the main menu. */
export class BootState implements GameState {
  readonly id = StateId.BOOT;
  private screen: Screen | null = null;
  private t = 0;

  constructor(private ctx: GameContext) {}

  enter(): void {
    this.t = 0;
    this.screen = new Screen(this.ctx.uiRoot, 'boot');
    this.screen.root.innerHTML = `<div class="boot-text">&gt; establishing carrier signal<span class="blink">_</span></div>`;
  }

  exit(): void {
    this.screen?.destroy();
    this.screen = null;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t > 0.8) {
      // ?style jumps straight into the art-direction test scene.
      const toStyle = new URLSearchParams(location.search).has('style');
      this.ctx.states.change(toStyle ? StateId.STYLE_TEST : StateId.MAIN_MENU);
    }
  }

  render(): void {
    this.ctx.renderer.clear();
  }
}
