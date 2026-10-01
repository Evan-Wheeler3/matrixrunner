/**
 * Top-level game state machine.
 *
 *   BOOT -> MAIN_MENU -> HUB <-> TRAINING_MINIGAME
 *   HUB -> COMIC_CUTSCENE -> RUN -> RESULT (success | caught) -> HUB
 *   HUB -> DEFENSE_ALERT -> HUB
 *
 * Each state is a self-contained mode that builds its own scene/UI in enter()
 * and tears it down in exit().
 */

export enum StateId {
  BOOT = 'BOOT',
  MAIN_MENU = 'MAIN_MENU',
  HUB = 'HUB',
  TRAINING_MINIGAME = 'TRAINING_MINIGAME',
  COMIC_CUTSCENE = 'COMIC_CUTSCENE',
  RUN = 'RUN',
  RESULT = 'RESULT',
  DEFENSE_ALERT = 'DEFENSE_ALERT',
}

export interface GameState {
  readonly id: StateId;
  enter(params?: unknown): void;
  exit(): void;
  update(dt: number): void;
  render(): void;
  resize?(width: number, height: number): void;
}

/** Legal transitions. Anything not listed is rejected (and logged) to catch flow bugs early. */
const TRANSITIONS: Record<StateId, readonly StateId[]> = {
  [StateId.BOOT]: [StateId.MAIN_MENU],
  [StateId.MAIN_MENU]: [StateId.HUB],
  // HUB -> RUN directly is a temporary shortcut until the cutscene system (milestone 7).
  [StateId.HUB]: [StateId.TRAINING_MINIGAME, StateId.COMIC_CUTSCENE, StateId.RUN, StateId.DEFENSE_ALERT, StateId.MAIN_MENU],
  [StateId.TRAINING_MINIGAME]: [StateId.HUB],
  [StateId.COMIC_CUTSCENE]: [StateId.RUN, StateId.HUB],
  [StateId.RUN]: [StateId.RESULT, StateId.HUB, StateId.RUN],
  [StateId.RESULT]: [StateId.HUB, StateId.RUN],
  [StateId.DEFENSE_ALERT]: [StateId.HUB],
};

export class StateMachine {
  private states = new Map<StateId, GameState>();
  private currentState: GameState | null = null;
  private pending: { id: StateId; params?: unknown } | null = null;

  register(state: GameState): void {
    this.states.set(state.id, state);
  }

  get current(): GameState | null {
    return this.currentState;
  }

  /**
   * Request a transition. It's applied at the start of the next frame so a
   * state never gets torn down in the middle of its own update().
   */
  change(id: StateId, params?: unknown): void {
    const from = this.currentState?.id;
    if (from && !TRANSITIONS[from].includes(id)) {
      console.warn(`[StateMachine] illegal transition ${from} -> ${id}`);
      return;
    }
    this.pending = { id, params };
  }

  /** Apply any pending transition. Called by the game loop each frame. */
  flush(): void {
    if (!this.pending) return;
    const { id, params } = this.pending;
    this.pending = null;
    const next = this.states.get(id);
    if (!next) throw new Error(`[StateMachine] state ${id} not registered`);
    this.currentState?.exit();
    this.currentState = next;
    next.enter(params);
  }
}
