/**
 * Things to gather: fallen branches, loose stones, berry bushes, mushrooms.
 *
 * Where they are is fixed by the world's seed, so both players find the same
 * branch in the same place. Whether one has been gathered is shared state: a
 * timestamp per spot, from which "has it grown back yet?" is arithmetic.
 */
import * as THREE from 'three';
import type { MoveName } from '../entities/moves';
import { modelOf, type Assets, type Model } from '../assets';
import * as act from '../game/actions';
import { NODES, type NodeKind } from '../game/catalog';
import { nodeReady, type Store } from '../game/world';
import type { Spot } from '../interact';
import { rng } from '../noise';
import { WORLD, laneDistance, waterDepth, woodland } from './land';
import type { Obstacle } from './scatter';
import type { Terrain } from './terrain';

/** How each kind of thing is gathered: branches are cut to length, berries picked into a basket. */
const GATHER_MOVE: Record<NodeKind, MoveName> = { log: 'chop', rock: 'stones', berry: 'pick', mushroom: 'forage' };

interface Node {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  ready: boolean;
}

/** One instanced mesh per part of a model, with a slot per node. */
class Layer {
  readonly meshes: THREE.InstancedMesh[];
  constructor(parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[], count: number, shadows: boolean) {
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, count);
      m.castShadow = shadows;
      m.receiveShadow = true;
      m.frustumCulled = false;
      return m;
    });
  }
  set(i: number, matrix: THREE.Matrix4) {
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Nodes {
  readonly group = new THREE.Group();
  private readonly nodes: Node[] = [];
  private readonly layers = new Map<string, { layer: Layer; index: Map<string, number> }>();
  private stale = true;
  private clock = 0;

  constructor(
    assets: Assets,
    terrain: Terrain,
    private readonly store: Store,
    blocked: Obstacle[],
    private readonly ui: { moment(): act.Moment; say(out: act.Outcome, at?: THREE.Vector3): void },
  ) {
    this.group.name = 'nodes';
    const rand = rng(WORLD.seed * 7 + 99);
    const clear = (x: number, z: number) => blocked.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 0.9);

    for (const kind of Object.keys(NODES) as NodeKind[]) {
      const def = NODES[kind];
      let placed = 0;
      let tries = 0;
      while (placed < def.count && tries++ < def.count * 60) {
        const a = rand() * Math.PI * 2;
        // The first few of everything are near camp, so the game can begin.
        const d = placed < 5 ? 14 + rand() * 30 : 18 + Math.sqrt(rand()) * (WORLD.playRadius - 30);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const w = woodland(x, z);
        const fits = def.habitat === 'wood' ? w > 0.5 || placed < 5 : def.habitat === 'edge' ? (w > 0.08 && w < 0.7) || placed < 5 : true;
        if (!fits || laneDistance(x, z) < 2.2 || !clear(x, z)) continue;
        const y = terrain.height(x, z);
        if (waterDepth(x, z, y) > -0.4) continue;
        this.nodes.push({ id: `${kind}${placed}`, kind, x, y, z, rot: rand() * Math.PI * 2, scale: 0.85 + rand() * 0.4, ready: true });
        placed++;
      }
    }

    const model = (pack: 'wild' | 'crops', name: string): Model => modelOf(assets, pack, name);
    const layer = (key: string, parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[], kind: NodeKind, shadows = true) => {
      const mine = this.nodes.filter((n) => n.kind === kind);
      const l = new Layer(parts, mine.length, shadows);
      this.layers.set(key, { layer: l, index: new Map(mine.map((n, i) => [n.id, i])) });
      this.group.add(...l.meshes);
    };
    layer('log', model('wild', 'dead_tree_trunk').parts, 'log');
    layer('rock', model('wild', 'rock_moss_set_02_4').parts, 'rock');
    layer('berry', model('crops', 'BushBerries_4').parts, 'berry');
    layer('berry-bare', model('crops', 'BushBerries_Harvested').parts, 'berry');
    layer('mushroom', model('crops', 'Mushroom_4').parts, 'mushroom', false);

    store.subscribe((name) => {
      if (name === 'nodes') this.stale = true;
    });
  }

  /** Scale per kind: a fallen limb two metres long, a knee-high pile of stones. */
  private static readonly SIZE: Record<NodeKind, number> = { log: 0.62, rock: 0.42, berry: 0.85, mushroom: 0.9 };

  update(dt: number, now: number) {
    // Regrowth is a matter of time passing, so look again every couple of seconds.
    this.clock -= dt;
    if (!this.stale && this.clock > 0) return;
    this.stale = false;
    this.clock = 2;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yUp = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const n of this.nodes) {
      n.ready = nodeReady(this.store, n.id, n.kind, now);
      q.setFromAxisAngle(yUp, n.rot);
      s.setScalar(n.scale * Nodes.SIZE[n.kind]);
      m.compose(p.set(n.x, n.y - (n.kind === 'rock' ? 0.06 : 0.04), n.z), q, s);
      const put = (key: string, shown: boolean) => {
        const l = this.layers.get(key)!;
        l.layer.set(l.index.get(n.id)!, shown ? m : HIDDEN);
      };
      if (n.kind === 'berry') {
        // A picked bush is still a bush: it just has no berries on it.
        put('berry', n.ready);
        put('berry-bare', !n.ready);
      } else {
        put(n.kind, n.ready);
      }
    }
  }

  spots(x: number, z: number): Spot[] {
    const out: Spot[] = [];
    for (const n of this.nodes) {
      if (!n.ready || Math.abs(n.x - x) > 4 || Math.abs(n.z - z) > 4) continue;
      const def = NODES[n.kind];
      out.push({
        x: n.x,
        z: n.z,
        reach: 2.1,
        title: def.name,
        height: n.kind === 'berry' ? 1 : 0.5,
        actions: [
          {
            key: 'E',
            label: def.verb,
            move: GATHER_MOVE[n.kind],
            run: () => {
              this.ui.say(act.gather(this.store, this.ui.moment(), n.id, n.kind), new THREE.Vector3(n.x, n.y + 1, n.z));
              this.stale = true;
            },
          },
        ],
      });
    }
    return out;
  }

  /** The nearest thing ready to gather within `within` metres, for the dog to point out. */
  nearestReady(x: number, z: number, within: number): { x: number; z: number } | null {
    let best: Node | null = null;
    let bestD = within;
    for (const n of this.nodes) {
      if (!n.ready) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }
}
