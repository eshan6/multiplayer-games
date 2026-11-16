/**
 * The few bits of interface the sample has: a loading card, the clock bar and
 * the detail toggle. Plain DOM over the canvas.
 */
import type { Sky } from './world/sky';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  onDetail: () => void = () => {};
  private readonly slider = el<HTMLInputElement>('clock-slider');
  private readonly time = el<HTMLOutputElement>('clock-time');
  private readonly toggleButton = el<HTMLButtonElement>('clock-toggle');
  private readonly qualityButton = el<HTMLButtonElement>('quality');
  private scrubbing = false;

  constructor() {
    this.qualityButton.addEventListener('click', () => this.onDetail());
  }

  loading(text: string, fraction: number) {
    el('loading-text').textContent = text;
    el('loading-bar').style.width = `${Math.round(fraction * 100)}%`;
  }

  ready() {
    el('loading').classList.add('done');
    // Inside an embedded frame the page has no keyboard focus until it is
    // clicked, and nothing would say why W does nothing. Say so, once.
    const hint = el('start-hint');
    hint.hidden = false;
    const dismiss = () => {
      hint.hidden = true;
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
  }

  toggle() {
    document.body.classList.toggle('bare');
  }

  setDetail(detail: 'high' | 'low') {
    this.qualityButton.textContent = `Detail: ${detail === 'high' ? 'High' : 'Low'}`;
  }

  bindClock(sky: Sky) {
    this.slider.addEventListener('pointerdown', () => (this.scrubbing = true));
    window.addEventListener('pointerup', () => (this.scrubbing = false));
    this.slider.addEventListener('input', () => sky.setHour(Number(this.slider.value)));
    this.toggleButton.addEventListener('click', () => this.toggleClock(sky));
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-hour]')) {
      button.addEventListener('click', () => {
        sky.setHour(Number(button.dataset.hour));
        // Presets are for looking at one light; hold it still.
        sky.running = false;
        this.showRunning(sky);
        button.blur();
      });
    }
    this.showRunning(sky);
  }

  toggleClock(sky: Sky) {
    sky.running = !sky.running;
    this.showRunning(sky);
    this.toggleButton.blur();
  }

  private showRunning(sky: Sky) {
    this.toggleButton.textContent = sky.running ? 'Pause' : 'Play';
    this.toggleButton.setAttribute('aria-label', sky.running ? 'Pause the clock' : 'Run the clock');
  }

  tick(sky: Sky) {
    const h = Math.floor(sky.hour);
    const m = Math.floor((sky.hour - h) * 60);
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (this.time.textContent !== text) this.time.textContent = text;
    if (!this.scrubbing) this.slider.value = sky.hour.toFixed(2);
  }
}
