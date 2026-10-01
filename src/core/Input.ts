/**
 * Keyboard + mouse input with per-frame edge detection.
 *
 * Gameplay code asks about *actions* (jump, left, ...) rather than raw keys so
 * bindings live in one place and gamepad support can slot in later.
 */

export type Action =
  | 'left'
  | 'right'
  | 'jump'
  | 'slide'
  | 'sprint'
  | 'skill'
  | 'interact'
  | 'pause'
  | 'confirm'
  | 'retry'
  | 'quit';

const KEY_BINDINGS: Record<Action, readonly string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['KeyW', 'ArrowUp', 'Space'],
  slide: ['KeyS', 'ArrowDown'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  skill: [],
  interact: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space'],
  retry: ['KeyR'],
  quit: ['KeyQ'],
};

/** Mouse buttons bound to actions (0 = left). */
const MOUSE_BINDINGS: Partial<Record<Action, readonly number[]>> = {
  skill: [0],
};

/** Keys whose browser default (scrolling, etc.) should be suppressed. */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  private mouseReleased = new Set<number>();


  constructor(target: HTMLElement | Window = window) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    // Losing focus would otherwise leave keys stuck "down".
    window.addEventListener('blur', () => {
      for (const code of this.down) this.released.add(code);
      this.down.clear();
      this.mouseDown.clear();
    });
    target.addEventListener('mousedown', (e) => {
      const me = e as MouseEvent;
      this.mouseDown.add(me.button);
      this.mousePressed.add(me.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseReleased.add(e.button);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(action: Action): boolean {
    return KEY_BINDINGS[action].some((c) => this.down.has(c)) || (MOUSE_BINDINGS[action]?.some((b) => this.mouseDown.has(b)) ?? false);
  }

  /** True only on the frame the action went down. */
  wasPressed(action: Action): boolean {
    return KEY_BINDINGS[action].some((c) => this.pressed.has(c)) || (MOUSE_BINDINGS[action]?.some((b) => this.mousePressed.has(b)) ?? false);
  }

  wasReleased(action: Action): boolean {
    return KEY_BINDINGS[action].some((c) => this.released.has(c)) || (MOUSE_BINDINGS[action]?.some((b) => this.mouseReleased.has(b)) ?? false);
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
  }
}
