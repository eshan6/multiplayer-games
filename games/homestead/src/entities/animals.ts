/**
 * The animals that share the place with you, and what they get up to.
 *
 * Each has a tiny mind: a state, a timer and somewhere it is heading. Stock
 * graze and amble inside the paddock. Deer keep to the meadow by the wood and
 * bolt if you ride at them. The dog decides for itself to come and find you,
 * and keeps pace at your stirrup once it has.
 *
 * These are the seeds of the pet system: behaviour the animal starts on its
 * own, driven by where you are and what you are doing.
 */
import * as THREE from 'three';
import type { Assets } from '../assets';
import { rng } from '../noise';
import { PADDOCK, waterDepth } from '../world/land';
import type { Terrain } from '../world/terrain';
import { Creature, angleTo, type CreatureSpec } from './creature';

type Mood = 'stand' | 'graze' | 'wander' | 'flee' | 'heel' | 'greet';

interface Mind {
  creature: Creature;
  mood: Mood;
  /** Seconds until the current mood is reconsidered. */
  timer: number;
  targetX: number;
  targetZ: number;
  /** Picks a fresh spot inside this animal's range. */
  roam: () => [number, number];
  walkSpeed: number;
  runSpeed: number;
  kind: 'stock' | 'deer' | 'dog';
}

const HORSE: CreatureSpec = { height: 2.3, walkPace: 1.9, runPace: 9.2 };
const COW: CreatureSpec = { height: 1.75, walkPace: 1.25, runPace: 6 };
const DEER: CreatureSpec = { height: 1.75, walkPace: 1.5, runPace: 9 };
const DOG: CreatureSpec = { height: 0.74, walkPace: 1.35, runPace: 6.5 };

export class Animals {
  readonly group = new THREE.Group();
  private readonly minds: Mind[] = [];
  private readonly rand = rng(2024);
  dog!: Creature;

  constructor(
    assets: Assets,
    private readonly terrain: Terrain,
  ) {
    this.group.name = 'animals';
    const rand = this.rand;

    const inPaddock = (): [number, number] => [
      PADDOCK.x + (rand() * 2 - 1) * (PADDOCK.hx - 2.2),
      PADDOCK.z + (rand() * 2 - 1) * (PADDOCK.hz - 2.2),
    ];

    // Two cows and a grey mare share the paddock.
    for (const recolour of [undefined, { Main: 0x6b4a36, Main_Light: 0xe9e2d6 }]) {
      this.add(new Creature(assets.cow, { ...COW, recolour }), 'stock', inPaddock, 0.75, 3);
    }
    this.add(
      new Creature(assets.horse, {
        ...HORSE,
        height: 2.2,
        recolour: { Main: 0xcfcac2, Main_Dark: 0x8d8a86, Main_Light: 0xe9e6e0, Hair: 0x6a6763, Muzzle: 0x8b7f7a },
      }),
      'stock',
      inPaddock,
      1.1,
      4,
    );

    // A small herd of deer in the meadow below the north wood.
    const herd = { x: -58, z: -62, r: 22 };
    const inMeadow = (): [number, number] => {
      for (let tries = 0; tries < 12; tries++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * herd.r;
        const x = herd.x + Math.cos(a) * d;
        const z = herd.z + Math.sin(a) * d;
        if (waterDepth(x, z, terrain.height(x, z)) < -0.5) return [x, z];
      }
      return [herd.x, herd.z];
    };
    for (let i = 0; i < 3; i++) {
      this.add(new Creature(assets.deer, { ...DEER, height: 1.6 + i * 0.1 }), 'deer', inMeadow, 1.2, 10.5);
    }

    // The dog starts on the doorstep.
    const home = (): [number, number] => [2 + (rand() - 0.5) * 9, 6 + (rand() - 0.5) * 7];
    const dog = this.add(new Creature(assets.dog, DOG), 'dog', home, 1.5, 13.5);
    dog.creature.root.position.set(1.5, 0, 3.5);
    dog.mood = 'greet';
    this.dog = dog.creature;
  }

  private add(creature: Creature, kind: Mind['kind'], roam: () => [number, number], walkSpeed: number, runSpeed: number): Mind {
    const [x, z] = roam();
    creature.root.position.set(x, this.terrain.height(x, z), z);
    creature.heading = this.rand() * Math.PI * 2;
    const mind: Mind = { creature, mood: 'stand', timer: this.rand() * 4, targetX: x, targetZ: z, roam, walkSpeed, runSpeed, kind };
    this.minds.push(mind);
    this.group.add(creature.root);
    return mind;
  }

  /**
   * @param rider where you are
   * @param riderSpeed how fast you are going, m/s
   * @param riderHeading which way you face, radians
   */
  update(dt: number, rider: THREE.Vector3, riderSpeed: number, riderHeading: number) {
    for (const mind of this.minds) {
      const c = mind.creature;
      const p = c.root.position;
      const toRider = Math.hypot(rider.x - p.x, rider.z - p.z);
      mind.timer -= dt;

      if (mind.kind === 'deer') this.thinkDeer(mind, rider, toRider, riderSpeed);
      else if (mind.kind === 'dog') this.thinkDog(mind, rider, toRider, riderSpeed, riderHeading);
      else this.thinkGrazer(mind);

      this.move(mind, dt);
      c.update(dt, this.terrain);
    }
  }

  /** stand → graze → wander → stand, each for a while. */
  private thinkGrazer(mind: Mind) {
    if (mind.timer > 0) return;
    const r = this.rand();
    if (mind.mood === 'wander' || r < 0.5) {
      mind.mood = r < 0.3 ? 'stand' : 'graze';
      mind.timer = mind.mood === 'graze' ? 7 + this.rand() * 12 : 2.5 + this.rand() * 4;
    } else {
      mind.mood = 'wander';
      [mind.targetX, mind.targetZ] = mind.roam();
      mind.timer = 20;
    }
  }

  private thinkDeer(mind: Mind, rider: THREE.Vector3, toRider: number, riderSpeed: number) {
    const p = mind.creature.root.position;
    // A deer tolerates a quiet approach better than a gallop.
    const alarm = 13 + Math.min(riderSpeed, 11) * 1.1;
    if (toRider < alarm) {
      if (mind.mood !== 'flee' || mind.timer <= 0) {
        // Run directly away, then keep going a good distance.
        const ax = p.x - rider.x;
        const az = p.z - rider.z;
        const len = Math.hypot(ax, az) || 1;
        const jitter = (this.rand() - 0.5) * 0.9;
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);
        const dx = (ax * cos - az * sin) / len;
        const dz = (ax * sin + az * cos) / len;
        mind.targetX = p.x + dx * 34;
        mind.targetZ = p.z + dz * 34;
        mind.mood = 'flee';
        mind.timer = 2.2;
      }
      return;
    }
    if (mind.mood === 'flee') {
      // Out of danger: stop, head up, and look back for a moment.
      if (toRider > alarm + 16 || this.arrived(mind, 2)) {
        mind.mood = 'stand';
        mind.timer = 3 + this.rand() * 3;
      }
      return;
    }
    this.thinkGrazer(mind);
  }

  private thinkDog(mind: Mind, rider: THREE.Vector3, toRider: number, riderSpeed: number, riderHeading: number) {
    // Heel: a point just off the horse's near side, a little behind the shoulder.
    const side = 2.1;
    const back = 1.2 + Math.min(riderSpeed, 11) * 0.12;
    const hx = rider.x + Math.cos(riderHeading) * side - Math.sin(riderHeading) * back;
    const hz = rider.z - Math.sin(riderHeading) * side - Math.cos(riderHeading) * back;

    if (mind.mood === 'greet' || mind.mood === 'heel') {
      mind.targetX = hx;
      mind.targetZ = hz;
      // You have ridden off and left it behind: it gives up and trots home.
      if (toRider > 95) {
        mind.mood = 'wander';
        [mind.targetX, mind.targetZ] = mind.roam();
        mind.timer = 30;
      } else if (mind.mood === 'greet' && toRider < 4) {
        mind.mood = 'heel';
      }
      return;
    }
    // At home and idle: if you come near, it decides to join you.
    if (toRider < 26) {
      mind.mood = 'greet';
      return;
    }
    this.thinkGrazer(mind);
    if (mind.mood === 'graze') mind.mood = 'stand';
  }

  private arrived(mind: Mind, within: number): boolean {
    const p = mind.creature.root.position;
    return Math.hypot(mind.targetX - p.x, mind.targetZ - p.z) < within;
  }

  private move(mind: Mind, dt: number) {
    const c = mind.creature;
    const p = c.root.position;
    const dx = mind.targetX - p.x;
    const dz = mind.targetZ - p.z;
    const dist = Math.hypot(dx, dz);

    let want = 0;
    switch (mind.mood) {
      case 'wander':
        want = mind.walkSpeed;
        if (dist < 0.8) {
          mind.mood = 'stand';
          mind.timer = 1.5 + this.rand() * 3;
        }
        break;
      case 'flee':
        want = mind.runSpeed;
        break;
      case 'greet':
      case 'heel':
        // Speed scales with how far behind it is: a walk when close, flat out when not.
        want = dist < 0.7 ? 0 : THREE.MathUtils.clamp(dist * 2.4, mind.walkSpeed * 0.8, mind.runSpeed);
        break;
      default:
        want = 0;
    }

    const rate = want > c.speed ? 7 : 10;
    c.speed += THREE.MathUtils.clamp(want - c.speed, -rate * dt, rate * dt);

    if (c.speed > 0.05 && dist > 0.05) {
      const desired = Math.atan2(dx, dz);
      const turn = angleTo(c.heading, desired);
      const maxTurn = (mind.kind === 'dog' ? 7 : 3.2) * dt;
      c.heading += THREE.MathUtils.clamp(turn, -maxTurn, maxTurn);
      // Do not stride off at full speed while still facing the wrong way.
      const facing = Math.max(0.25, Math.cos(turn));
      p.x += Math.sin(c.heading) * c.speed * facing * dt;
      p.z += Math.cos(c.heading) * c.speed * facing * dt;
    }

    if (c.speed > mind.walkSpeed * 2.1) c.setGait('run', 0.2);
    else if (c.speed > 0.12) c.setGait('walk', 0.25);
    else if (mind.mood === 'graze') c.setGait('eat', 0.7);
    else if (mind.kind === 'dog' && mind.mood === 'heel') c.setGait('idleAlt', 0.5);
    else c.setGait('idle', 0.6);
  }
}
