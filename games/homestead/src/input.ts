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
  /** Fires once per press, for toggles. */
  onPress: (code: string) => void = () => {};

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.down.has(e.code)) this.onPress(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    // A key held while the window loses focus never sends its keyup.
    window.addEventListener('blur', () => this.down.clear());

    surface.tabIndex = 0;
    surface.addEventListener('pointerdown', (e) => {
      // Take keyboard focus: in an embedded frame, keys go nowhere until this.
      surface.focus({ preventScroll: true });
      this.dragging = true;
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointerup', (e) => {
      this.dragging = false;
      surface.releasePointerCapture(e.pointerId);
    });
    surface.addEventListener('pointercancel', () => (this.dragging = false));
    surface.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
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
  }
}
