/**
 * Keyboard and mouse input with rebindable actions.
 *
 * The camera is driven by right-mouse drag rather than pointer lock: this game
 * has a lot of UI and a placement cursor, and a captured pointer fights both.
 */

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'jump'
  | 'interact'
  | 'useTool'
  | 'inventory'
  | 'build'
  | 'map'
  | 'rotate'
  | 'menu'
  | 'settlement'
  | 'jobs'
  | 'research'
  | 'production'
  | 'overlayCycle'
  | 'pause'
  | 'speedDown'
  | 'speedUp'
  | 'debug'
  | 'cameraMode'
  | 'godMode'
  | 'ascend'
  | 'descend'
  | 'placeItem'
  | 'throwItem'
  | 'drink'
  | 'console'
  | 'cancel';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE'],
  useTool: ['KeyF'],
  inventory: ['Tab'],
  build: ['KeyB'],
  map: ['KeyM'],
  rotate: ['KeyR'],
  menu: ['Escape'],
  settlement: ['KeyC'],
  jobs: ['KeyJ'],
  research: ['KeyT'],
  production: ['KeyP'],
  overlayCycle: ['KeyO'],
  pause: ['Backquote'],
  speedDown: ['BracketLeft'],
  speedUp: ['BracketRight'],
  debug: ['F1'],
  cameraMode: ['KeyV'],
  godMode: ['KeyG'],
  ascend: ['KeyQ'],
  descend: ['KeyZ'],
  // The hands. G used to put something down and also toggle god mode, which
  // meant dropping your axe every time you took off.
  placeItem: ['KeyX'],
  throwItem: ['KeyY'],
  drink: ['KeyH'],
  console: ['Slash'],
  cancel: ['Escape'],
};

export const ACTION_LABELS: Record<Action, string> = {
  moveForward: 'Move forward',
  moveBack: 'Move back',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  run: 'Run',
  jump: 'Jump',
  interact: 'Interact',
  useTool: 'Use tool',
  inventory: 'Inventory',
  build: 'Build mode',
  map: 'World map',
  rotate: 'Rotate blueprint',
  menu: 'Menu',
  settlement: 'Settlement',
  jobs: 'Jobs',
  research: 'Research',
  production: 'Production',
  overlayCycle: 'Cycle overlay',
  pause: 'Pause simulation',
  speedDown: 'Slower',
  speedUp: 'Faster',
  debug: 'Debug panel',
  cameraMode: 'Camera mode',
  godMode: 'God mode',
  ascend: 'Ascend',
  descend: 'Descend',
  placeItem: 'Put down held item',
  throwItem: 'Throw held item',
  drink: 'Drink',
  console: 'Console',
  cancel: 'Cancel',
};

export class Input {
  private bindings: Record<Action, string[]>;
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();

  mouseX = 0;
  mouseY = 0;
  /** Normalised device coordinates for picking. */
  ndcX = 0;
  ndcY = 0;
  deltaX = 0;
  deltaY = 0;
  wheel = 0;
  buttons = new Set<number>();
  private buttonsPressed = new Set<number>();
  private buttonsReleased = new Set<number>();
  /** True while the cursor is over the 3D view rather than a UI panel. */
  overViewport = false;
  /** Set by the UI layer when a text field has focus. */
  textFocus = false;

  private listeners: (() => void)[] = [];

  constructor(bindings?: Partial<Record<Action, string[]>>) {
    this.bindings = { ...DEFAULT_BINDINGS };
    if (bindings) {
      for (const k of Object.keys(bindings) as Action[]) {
        const v = bindings[k];
        if (v && v.length) this.bindings[k] = v;
      }
    }
  }

  setBinding(action: Action, codes: string[]): void {
    this.bindings[action] = codes;
  }

  getBinding(action: Action): string[] {
    return this.bindings[action];
  }

  get allBindings(): Record<Action, string[]> {
    return this.bindings;
  }

  attach(element: HTMLElement): void {

    const onKeyDown = (e: KeyboardEvent) => {
      if (this.textFocus) return;
      // Tab and F1 would otherwise leave the page or open browser help.
      if (e.code === 'Tab' || e.code === 'F1' || (e.code === 'Space' && e.target === document.body)) {
        e.preventDefault();
      }
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    };
    const onBlur = () => {
      this.down.clear();
      this.buttons.clear();
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      this.deltaX += e.movementX ?? 0;
      this.deltaY += e.movementY ?? 0;
      this.mouseX = px;
      this.mouseY = py;
      this.ndcX = (px / rect.width) * 2 - 1;
      this.ndcY = -(py / rect.height) * 2 + 1;
      this.overViewport = px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== element) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
      if (e.button === 2) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      this.buttons.delete(e.button);
      this.buttonsReleased.add(e.button);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.target !== element) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };
    const onContext = (e: MouseEvent) => {
      if (e.target === element) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', onContext);

    this.listeners.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      element.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContext);
    });
  }

  detach(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }

  isDown(action: Action): boolean {
    if (this.textFocus) return false;
    for (const code of this.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  wasPressed(action: Action): boolean {
    if (this.textFocus) return false;
    for (const code of this.bindings[action]) if (this.pressedThisFrame.has(code)) return true;
    return false;
  }

  /** Raw key check, for quick-slot digits and similar. */
  keyPressed(code: string): boolean {
    return !this.textFocus && this.pressedThisFrame.has(code);
  }

  mouseDown(button: number): boolean {
    return this.buttons.has(button);
  }

  mousePressed(button: number): boolean {
    return this.buttonsPressed.has(button);
  }

  mouseReleased(button: number): boolean {
    return this.buttonsReleased.has(button);
  }

  /** Called once at the end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.deltaX = 0;
    this.deltaY = 0;
    this.wheel = 0;
  }

  /** Human-readable key name for the settings screen. */
  static keyLabel(code: string): string {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
    switch (code) {
      case 'ShiftLeft':
        return 'L Shift';
      case 'ShiftRight':
        return 'R Shift';
      case 'Space':
        return 'Space';
      case 'Backquote':
        return '`';
      case 'BracketLeft':
        return '[';
      case 'BracketRight':
        return ']';
      case 'Escape':
        return 'Esc';
      default:
        return code;
    }
  }
}
