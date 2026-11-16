/**
 * Keyboard and pointer state, read by whoever needs it each frame.
 * Nothing here knows what a horse is.
 */
export class Input {
  private readonly down = new Set<string>();
  /** Pointer drag since the last frame, in pixels. Consumed by the camera. */
  dragX = 0;
  dragY = 0;
  /** Wheel movement since the last frame. */
  wheel = 0;
  dragging = false;
  /** Where the pointer is, in normalised device coordinates (-1..1, y up). */
  readonly pointer = { x: 0, y: 0 };
  /** True for the one frame after a press-and-release that did not drag. */
  clicked = false;
  /** Fires once per key press, for toggles. */
  onPress: (code: string) => void = () => {};
  private travelled = 0;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // Typing a name must not ride a horse.
      if (e.target instanceof HTMLInputElement) return;
      if (!this.down.has(e.code)) this.onPress(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    // A key held while the window loses focus never sends its keyup.
    window.addEventListener('blur', () => this.down.clear());

    const aim = (e: PointerEvent) => {
      const r = surface.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    surface.tabIndex = 0;
    surface.addEventListener('pointerdown', (e) => {
      // Take keyboard focus: in an embedded frame, keys go nowhere until this.
      surface.focus({ preventScroll: true });
      this.dragging = true;
      this.travelled = 0;
      aim(e);
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointerup', (e) => {
      if (this.dragging && this.travelled < 6 && e.button === 0) this.clicked = true;
      this.dragging = false;
      surface.releasePointerCapture(e.pointerId);
    });
    surface.addEventListener('pointercancel', () => (this.dragging = false));
    surface.addEventListener('pointermove', (e) => {
      aim(e);
      if (!this.dragging) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
      this.travelled += Math.abs(e.movementX) + Math.abs(e.movementY);
    });
    surface.addEventListener(
      'wheel',
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** -1, 0 or 1 from a pair of opposing keys. */
  axis(negative: string[], positive: string[]): number {
    return (this.held(...positive) ? 1 : 0) - (this.held(...negative) ? 1 : 0);
  }

  endFrame() {
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
    this.clicked = false;
  }
}
