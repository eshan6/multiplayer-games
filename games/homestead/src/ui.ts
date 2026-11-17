/**
 * The interface: the basket of points, the day and weather, the prompt for
 * whatever you are standing next to, and one side sheet that is by turns the
 * build catalogue, the cookbook, the seed tin, the pantry and the help page.
 *
 * Plain DOM over the canvas. It reads the world through the same functions
 * the game does and asks for changes through callbacks; it never writes to
 * the store itself.
 */
import * as act from './game/actions';
import {
  ANIMALS,
  AVATARS,
  CROPS,
  FLOORS,
  FURNITURE,
  GOALS,
  ITEMS,
  RECIPES,
  STRUCTURES,
  WALLS,
  WEATHER,
  animalDef,
  furnitureDef,
  structureDef,
  type AnimalKind,
  type AvatarId,
  type CropId,
  type FurnitureId,
  type RecipeId,
  type StructureId,
  type Weather,
} from './game/catalog';
import { clock, currentGoal, describe, goalProgress, level, meta, pantry, points, roomFor, type Store } from './game/world';
import { KEY_CODES, type Spot } from './interact';
import type { Tool } from './build';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Build an element: tag, class, text. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const THUMBS = import.meta.glob('./assets/thumb_*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

type Sheet = { kind: 'build'; tab: string } | { kind: 'cook'; at: 'fire' | 'stove' } | { kind: 'plant'; bed: string; slot: number } | { kind: 'pantry' } | { kind: 'help' };

export interface HudActions {
  pick(tool: Tool | null): void;
  cook(recipe: RecipeId, at: 'fire' | 'stove'): void;
  plant(bed: string, slot: number, crop: CropId): void;
  buyAnimal(kind: AnimalKind): void;
  paint(what: 'wall' | 'floor', index: number): void;
  weather(w: Weather): void;
  detail(): void;
  startOver(): void;
}

const OUTDOOR_TABS = ['Home', 'Farm', 'Animals', 'Garden', 'Yard'] as const;
const INDOOR_TABS = ['Rest', 'Kitchen', 'Living', 'Decor', 'Walls'] as const;

export class Hud {
  private sheet: Sheet | null = null;
  private indoors = false;
  private lastPrompt = '';
  private lastBasket = '';
  private lastWorld = '';

  constructor(
    private readonly store: Store,
    private readonly actions: HudActions,
  ) {
    el('sheet-close').addEventListener('click', () => this.close());
    el('quality').addEventListener('click', () => this.actions.detail());
    for (const button of document.querySelectorAll<HTMLButtonElement>('#dock [data-open]')) {
      button.addEventListener('click', () => {
        this.toggle(button.dataset.open as 'build' | 'pantry' | 'help');
        button.blur();
      });
    }
    const weather = el('world-weather');
    for (const w of WEATHER) {
      const b = h('button', '', w[0]!.toUpperCase() + w.slice(1));
      b.type = 'button';
      b.dataset.weather = w;
      b.addEventListener('click', () => {
        this.actions.weather(w);
        b.blur();
      });
      weather.append(b);
    }
    store.subscribe(() => (this.dirty = true));
  }

  private dirty = true;

  // ---------------------------------------------------------------- start ----

  loading(text: string, fraction: number) {
    el('loading-text').textContent = text;
    el('loading-bar').style.width = `${Math.round(fraction * 100)}%`;
  }

  /** Ask who is playing. Resolves when they press the button. */
  welcome(suggested: string, avatar: AvatarId, shared: boolean): Promise<{ name: string; avatar: AvatarId }> {
    const root = el('welcome');
    const name = el<HTMLInputElement>('welcome-name');
    name.value = suggested;
    let chosen = avatar;
    const grid = el('welcome-avatars');
    grid.textContent = '';
    for (const [id, label] of Object.entries(AVATARS) as [AvatarId, string][]) {
      const b = h('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const src = THUMBS[`./assets/thumb_${id}.webp`];
      if (src) {
        const img = h('img');
        img.src = src;
        img.alt = '';
        b.append(img);
      }
      b.append(h('span', '', label));
      const mark = () => {
        for (const other of grid.children) other.setAttribute('aria-checked', String(other === b));
      };
      b.addEventListener('click', () => {
        chosen = id;
        mark();
      });
      grid.append(b);
      if (id === chosen) mark();
    }
    el('welcome-mode').textContent = shared
      ? 'This world is shared. Anyone you invite to this page with permission to interact will be here with you, and it stays as you leave it.'
      : 'Playing on your own: this world is saved in this browser. Open the shared link to play together.';
    root.hidden = false;
    name.focus();
    name.select();
    return new Promise((resolve) => {
      el<HTMLFormElement>('welcome-form').addEventListener(
        'submit',
        (e) => {
          e.preventDefault();
          root.hidden = true;
          el('hud').hidden = false;
          resolve({ name: name.value.trim() || 'Someone', avatar: chosen });
        },
        { once: true },
      );
    });
  }

  hideBar() {
    document.body.classList.toggle('bare');
  }

  setDetail(detail: 'high' | 'low') {
    el('quality').textContent = `Detail: ${detail === 'high' ? 'High' : 'Low'}`;
  }

  // ---------------------------------------------------------------- toasts ----

  toast(text: string, opts: { points?: number; together?: boolean; bad?: boolean; big?: boolean } = {}) {
    const t = h('div', `toast${opts.bad ? ' bad' : ''}${opts.big ? ' big' : ''}`, text);
    if (opts.points) t.append(h('b', '', `+${opts.points}${opts.together ? ' together' : ''}`));
    const box = el('toasts');
    box.append(t);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(() => t.remove(), 3500);
  }

  /** Show what an action did. */
  say(out: act.Outcome) {
    this.toast(out.say, { points: out.points, together: out.together, bad: !out.ok });
  }

  // ---------------------------------------------------------------- frame ----

  /** Refresh the always-visible readouts. Cheap enough to call every frame. */
  tick(now: number, people: string[], indoors: boolean) {
    this.indoors = indoors;
    const lv = level(this.store);
    const basket = `${points(this.store)}|${lv.index}|${lv.earned}|${currentGoal(this.store)}|${this.dirty}`;
    if (basket !== this.lastBasket) {
      this.lastBasket = basket;
      el('basket-points').textContent = String(points(this.store));
      el('basket-level').textContent = lv.title;
      const span = lv.next === null ? 1 : lv.earned / lv.next;
      el('basket-meter').style.width = `${Math.round(Math.min(1, span) * 100)}%`;
      const goal = el('goal');
      goal.textContent = '';
      const g = currentGoal(this.store);
      if (g >= 0) {
        goal.append(h('b', '', 'Next'), document.createTextNode(`${GOALS[g]!.text} `), h('span', '', `${Math.min(goalProgress(this.store, g), GOALS[g]!.count)}/${GOALS[g]!.count}`));
      } else {
        goal.append(h('b', '', 'Done'), document.createTextNode('Everything on the list. The rest is up to you two.'));
      }
    }

    const world = meta(this.store);
    const c = clock(world, now);
    const hh = Math.floor(c.hour);
    const mm = Math.floor((c.hour - hh) * 60);
    const stamp = `Day ${c.day} · ${c.season} · ${String(hh).padStart(2, '0')}:${String(mm - (mm % 5)).padStart(2, '0')}`;
    const who = people.length ? `With ${people.join(' and ')}` : this.store.shared ? 'Nobody else is here right now' : 'Playing alone';
    const key = `${stamp}|${who}|${world.weather}`;
    if (key !== this.lastWorld) {
      this.lastWorld = key;
      el('world-clock').textContent = stamp;
      el('world-people').textContent = who;
      for (const b of el('world-weather').children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.weather === world.weather));
    }

    if (this.dirty && this.sheet) this.render();
    this.dirty = false;
  }

  /** Show (or clear) the prompt for the thing the player is next to. */
  prompt(spot: Spot | null) {
    const box = el('prompt');
    const key = spot ? `${spot.title}|${spot.detail ?? ''}|${spot.actions.map((a) => a.key + a.label + (a.blocked ?? '')).join(',')}` : '';
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    box.hidden = !spot;
    if (!spot) return;
    el('prompt-title').textContent = spot.title;
    el('prompt-detail').textContent = spot.detail ?? '';
    const actions = el('prompt-actions');
    actions.textContent = '';
    for (const a of spot.actions) {
      const s = h('span', a.blocked ? 'blocked' : '');
      s.append(h('kbd', '', a.key), document.createTextNode(` ${a.blocked ?? a.label}`));
      actions.append(s);
    }
  }

  /** What you are busy doing, and how far to its moment (0..1); null when idle. Replaces the prompt. */
  work(verb: string | null, progress = 0) {
    const box = el('work');
    box.hidden = !verb;
    if (!verb) return;
    el('prompt').hidden = true;
    this.lastPrompt = '';
    if (el('work-verb').textContent !== verb) el('work-verb').textContent = verb;
    (el('work-bar').firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    box.classList.toggle('done', progress >= 1);
  }

  /** The line shown while a placement tool is in hand. */
  toolHint(text: string | null, bad = false) {
    const box = el('tool-hint');
    box.hidden = !text;
    box.className = `panel${bad ? ' bad' : ''}`;
    if (text && box.textContent !== text) box.textContent = text;
    document.body.classList.toggle('placing', !!text);
  }

  // ---------------------------------------------------------------- sheets ----

  get open(): boolean {
    return this.sheet !== null;
  }

  close() {
    this.sheet = null;
    el('sheet').hidden = true;
  }

  toggle(kind: 'build' | 'pantry' | 'help') {
    if (this.sheet?.kind === kind) return this.close();
    this.show(kind === 'build' ? { kind, tab: this.indoors ? INDOOR_TABS[0] : OUTDOOR_TABS[0] } : { kind });
  }

  cook(at: 'fire' | 'stove') {
    this.show({ kind: 'cook', at });
  }

  plant(bed: string, slot: number) {
    this.show({ kind: 'plant', bed, slot });
  }

  private show(sheet: Sheet) {
    this.sheet = sheet;
    el('sheet').hidden = false;
    this.render();
  }

  private render() {
    const s = this.sheet;
    if (!s) return;
    const title = el('sheet-title');
    const tabs = el('sheet-tabs');
    const body = el('sheet-body');
    const scroll = body.scrollTop;
    tabs.textContent = '';
    body.textContent = '';
    tabs.hidden = true;
    if (s.kind === 'build') {
      title.textContent = this.indoors ? 'Furnish' : 'Build';
      tabs.hidden = false;
      const names = this.indoors ? INDOOR_TABS : OUTDOOR_TABS;
      if (!(names as readonly string[]).includes(s.tab)) s.tab = names[0];
      for (const name of names) {
        const b = h('button', '', name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(name === s.tab));
        b.addEventListener('click', () => {
          s.tab = name;
          this.render();
        });
        tabs.append(b);
      }
      if (this.indoors) this.renderFurnish(body, s.tab);
      else this.renderBuild(body, s.tab);
    } else if (s.kind === 'cook') {
      title.textContent = s.at === 'stove' ? 'At the stove' : 'Over the fire';
      this.renderCook(body, s.at);
    } else if (s.kind === 'plant') {
      title.textContent = 'Plant a row';
      this.renderPlant(body, s.bed, s.slot);
    } else if (s.kind === 'pantry') {
      title.textContent = 'Pantry';
      this.renderPantry(body);
    } else {
      title.textContent = 'How to play';
      this.renderHelp(body);
    }
    body.scrollTop = scroll;
  }

  private card(name: string, blurb: string, cost: number, unit: string, why: string | null, run: () => void): HTMLButtonElement {
    const b = h('button', `card${why ? ' locked' : ''}`);
    b.type = 'button';
    const price = h('span', 'cost', cost ? String(cost) : 'Free');
    if (cost) price.append(h('small', '', unit));
    b.append(h('span', 'name', name), price, h('span', 'blurb', blurb));
    if (why) b.append(h('span', 'why', why));
    b.addEventListener('click', () => {
      run();
      b.blur();
    });
    return b;
  }

  private renderBuild(body: HTMLElement, tab: string) {
    const lv = level(this.store).index;
    for (const [id, def] of Object.entries(STRUCTURES) as [StructureId, (typeof STRUCTURES)[StructureId]][]) {
      if (def.group !== tab) continue;
      const full = structureDef(id);
      const locked = lv < def.level;
      const why = locked ? 'Unlocks as your life here grows.' : act.whyNotBuild(this.store, id);
      const extra = full.materials ? ` Needs ${describe(full.materials)}.` : '';
      body.append(
        this.card(def.name, def.blurb + extra, def.cost, 'points', why, () => {
          if (locked) return;
          this.actions.pick({ type: 'structure', kind: id });
          this.close();
        }),
      );
    }
    if (tab === 'Animals') {
      body.append(h('h3', '', 'More animals'));
      for (const [kind, def] of Object.entries(ANIMALS) as [AnimalKind, (typeof ANIMALS)[AnimalKind]][]) {
        if (!def.home) continue;
        const room = roomFor(this.store, kind);
        const why = room === null ? `Needs room in a ${structureDef(def.home as StructureId).name.toLowerCase()}.` : act.canAfford(this.store, def.cost);
        const produce = animalDef(kind).produce;
        body.append(this.card(`Another ${def.name}`, produce ? `Gives ${ITEMS[produce.item].many}.` : animalDef(kind).rideable ? 'One to ride.' : 'Good company.', def.cost, 'points', why, () => this.actions.buyAnimal(kind)));
      }
    }
    if (tab === 'Yard') {
      body.append(h('h3', '', 'Change your mind'));
      body.append(
        this.card('Take something down', 'Click a building to remove it. Half its points come back.', 0, '', null, () => {
          this.actions.pick({ type: 'remove' });
          this.close();
        }),
      );
    }
  }

  private renderFurnish(body: HTMLElement, tab: string) {
    if (tab === 'Walls') {
      const world = meta(this.store);
      const picker = (label: string, what: 'wall' | 'floor', options: readonly { name: string; tint: number; cost: number }[], current: number) => {
        body.append(h('h3', '', label));
        const row = h('div', 'swatches');
        options.forEach((o, i) => {
          const b = h('button');
          b.type = 'button';
          const sw = h('i');
          sw.style.background = `#${o.tint.toString(16).padStart(6, '0')}`;
          b.append(sw, document.createTextNode(i === current ? `${o.name} (yours)` : o.cost ? `${o.name} · ${o.cost}` : o.name));
          b.disabled = i === current;
          b.addEventListener('click', () => this.actions.paint(what, i));
          row.append(b);
        });
        body.append(row);
      };
      picker('Walls', 'wall', WALLS, world.wall);
      picker('Floor', 'floor', FLOORS, world.floor);
      return;
    }
    const lv = level(this.store).index;
    for (const [id, def] of Object.entries(FURNITURE) as [FurnitureId, (typeof FURNITURE)[FurnitureId]][]) {
      if (def.group !== tab) continue;
      const use = furnitureDef(id).use;
      const blurb = use === 'cook' ? 'You can cook here.' : use === 'sleep' ? 'Sleep until morning.' : use === 'bathe' ? 'A hot bath.' : use === 'eat' ? 'Somewhere to share a meal.' : use === 'sit' ? 'Somewhere to sit together.' : '';
      const why = lv < def.level ? 'Unlocks as your life here grows.' : act.canAfford(this.store, def.cost);
      body.append(
        this.card(def.name, blurb, def.cost, 'points', why, () => {
          this.actions.pick({ type: 'furniture', kind: id });
          this.close();
        }),
      );
    }
    if (tab === 'Decor') {
      body.append(h('h3', '', 'Rearrange'));
      body.append(
        this.card('Move furniture', 'Click a piece to pick it up, click again to put it down.', 0, '', null, () => {
          this.actions.pick({ type: 'pick' });
          this.close();
        }),
        this.card('Sell furniture', 'Click a piece to sell it for half its price.', 0, '', null, () => {
          this.actions.pick({ type: 'remove' });
          this.close();
        }),
      );
    }
  }

  private renderCook(body: HTMLElement, at: 'fire' | 'stove') {
    body.append(h('p', 'note', at === 'fire' ? 'A campfire will do for simple things. A stove indoors opens up the rest.' : 'Everything you know how to make.'));
    for (const [id, r] of Object.entries(RECIPES) as [RecipeId, (typeof RECIPES)[RecipeId]][]) {
      const wrongPlace = at === 'fire' && r.at === 'stove';
      const why = wrongPlace ? 'Needs a stove.' : act.canCook(this.store, id, at) ? null : `You need ${describe(r.needs)}.`;
      body.append(this.card(r.name, describe(r.needs), r.points, 'points', why, () => this.actions.cook(id, at)));
    }
  }

  private renderPlant(body: HTMLElement, bed: string, slot: number) {
    const lv = level(this.store).index;
    body.append(h('p', 'note', 'Seed is free. Watered crops grow twice as fast, and keep growing while you are away.'));
    for (const [id, c] of Object.entries(CROPS) as [CropId, (typeof CROPS)[CropId]][]) {
      const why = lv < c.level ? 'You have not found these seeds yet.' : null;
      body.append(
        this.card(c.name, `${c.minutes} min watered · gives ${c.yield}`, c.points, 'at harvest', why, () => {
          if (why) return;
          this.actions.plant(bed, slot, id);
          this.close();
        }),
      );
    }
  }

  private renderPantry(body: HTMLElement) {
    const items = pantry(this.store);
    if (!items.length) body.append(h('p', 'note', 'Empty. Fallen branches, loose stones, berries and mushrooms are out there for the gathering.'));
    for (const [id, n] of items) {
      const row = h('div', 'row');
      const sw = h('span', 'swatch');
      sw.style.background = ITEMS[id].tint;
      row.append(sw, h('span', '', ITEMS[id].many[0]!.toUpperCase() + ITEMS[id].many.slice(1)), h('span', 'count', String(n)));
      body.append(row);
    }
    body.append(h('h3', '', 'Who has brought what'));
    for (const l of this.store.all('ledgers').values()) {
      const row = h('div', 'row');
      row.append(h('span', '', l.name), h('span', 'count', `${Math.round(l.earned)}`));
      body.append(row);
    }
  }

  private renderHelp(body: HTMLElement) {
    body.append(h('p', 'note', 'Everything you do earns points for the basket you share. Spend them on the life you want here. Things done side by side earn half as much again.'));
    const keys = h('dl', 'keys');
    const row = (k: string, what: string) => {
      const dt = h('dt');
      for (const part of k.split(' ')) dt.append(h('kbd', '', part), document.createTextNode(' '));
      keys.append(dt, h('dd', '', what));
    };
    row('W A S D', 'Walk, or ride');
    row('Shift', 'Run, or gallop');
    row('C', 'Slow to a stroll');
    row('E R T', 'Do what the prompt offers');
    row('F', 'Mount a horse, or get down');
    row('B', 'Build (indoors: furnish)');
    row('I', 'Pantry');
    row('Esc', 'Put the tool away, close this');
    row('Drag', 'Look around');
    row('Scroll', 'Zoom');
    row('U', 'Hide the interface');
    body.append(keys);
    body.append(h('h3', '', 'Placing things'));
    body.append(h('p', 'note', 'Pick something from Build, point at the ground, click to set it down. R turns it. Fences and paths join end to end. Esc when you are done.'));
    body.append(h('h3', '', 'Start again'));
    const reset = h('button', '', 'Erase this world');
    reset.type = 'button';
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Really erase everything? Click again';
        return;
      }
      this.actions.startOver();
    });
    body.append(reset);
  }
}

export { KEY_CODES };
