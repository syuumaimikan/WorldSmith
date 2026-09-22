/**
 * Being born, growing up, growing old, and dying of it.
 *
 * Nothing here is on a timer and nothing is an average. Every living thing in
 * the world is given its own span at the moment it comes into being, drawn
 * from what its kind can expect but its own: two deer born the same spring
 * will not die the same year, and neither will two people. That individual
 * variation is the whole point — a settlement where everybody dies at
 * seventy is a settlement with one death every generation and then six at
 * once, which is not how a village empties and fills.
 *
 * Death of old age is not a line either. Past a certain point a body starts
 * failing, health slides, and the chance of not waking up rises; some people
 * outlive their span by years and some fall short of it. What the span
 * actually sets is where that slide begins.
 *
 * Births need what births need: adults of an age to have children, food in
 * the stores, and somewhere to put them. A starving settlement does not grow,
 * and a settlement with no roofs grows slowly and resentfully.
 */

import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import { ANIMALS, createAnimal } from './Wildlife';
import { DAYS_PER_YEAR } from './Time';
import type { Npc } from './Npc';
import type { World } from './World';

/** Below this, a person is a child: fed and housed, and not put to work. */
export const WORKING_AGE = 14;

/** The span of years a person can expect, before their own luck is drawn. */
const HUMAN_SPAN = { mean: 68, spread: 13, min: 34, max: 97 };

/** Years either side of a childbearing life. */
const FERTILE = { from: 17, to: 44 };

/**
 * Births per fertile pair per year, before anything is taken into account.
 * Set so a well-fed, well-housed settlement roughly doubles in a generation
 * and a struggling one does not grow at all.
 */
const BIRTHS_PER_PAIR_YEAR = 0.42;

export class Generations {
  private rng: Rng;
  /** Whole days owed, so this runs day by day however it is driven. */
  private pending = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x9e11);
  }

  /** The span this individual will have. Drawn once, at birth. */
  static humanLifespan(rng: Rng): number {
    return rng.stat(HUMAN_SPAN.mean, HUMAN_SPAN.spread, HUMAN_SPAN.min, HUMAN_SPAN.max);
  }

  update(world: World, hours: number): void {
    this.pending += hours / 24;
    if (this.pending < 1) return;
    const days = Math.floor(this.pending);
    this.pending -= days;

    this.agePeople(world, days);
    this.bearChildren(world, days);
    this.ageAnimals(world, days);
    this.breedAnimals(world, days);
  }

  // =========================================================================
  // People
  // =========================================================================

  private agePeople(world: World, days: number): void {
    const years = days / DAYS_PER_YEAR;
    for (const npc of [...world.npcs]) {
      npc.age += years;

      // The body starts giving way some years before the span runs out. This
      // is what makes an old settler slower and sicklier than a young one
      // rather than identical right up to the day they drop.
      const decline = npc.age - (npc.lifespan - 10);
      if (decline > 0) {
        npc.frailty = clamp01(decline / 14);
        npc.needs.health = Math.max(4, npc.needs.health - npc.frailty * 0.9 * days);
      }

      // Not a line: a rising chance, which some outlive and some do not.
      const odds = Math.pow(clamp01((npc.age - (npc.lifespan - 10)) / 18), 2.4) * 0.05;
      if (odds > 0 && this.rng.chance(clamp01(odds * days))) {
        world.killNpc(npc, 'ev.diedOfAge', {
          name: npc.name,
          age: Math.round(npc.age),
        });
      }
    }
  }

  /**
   * New people, from the people who are already here.
   *
   * The settlement's own numbers decide it: how many adults are of an age,
   * how many days of food there are, and whether there is a roof spare. None
   * of that is a modifier bolted onto a birth rate — it is the birth rate.
   */
  private bearChildren(world: World, days: number): void {
    const fertile = world.npcs.filter(
      (n) => n.age >= FERTILE.from && n.age <= FERTILE.to && n.needs.health > 35,
    );
    if (fertile.length < 2) return;
    const pairs = Math.floor(fertile.length / 2);

    // Hunger first, measured where it actually shows: in the people. A store
    // of grain is not what makes a settlement grow -- being fed is, and a
    // place that eats what it gathers the same day it gathers it is fed.
    const hunger =
      world.npcs.reduce((sum, n) => sum + n.needs.hunger, 0) / Math.max(1, world.npcs.length);
    // Hungry people do not have many children. Being not quite starving is
    // not the same as being fed.
    const fed = clamp01((hunger - 52) / 38);
    if (fed <= 0.02) return;
    // Then room. A camp with no roof at all still has children -- people have
    // always had children in worse -- but fewer of them, and crowding slows
    // rather than stops.
    const beds = world.settlement.housingCapacity;
    const room = 0.55 + clamp01(beds / Math.max(1, world.npcs.length)) * 0.45;
    // And how the place is doing generally.
    const mood =
      world.npcs.reduce((s, n) => s + n.needs.mood, 0) / Math.max(1, world.npcs.length) / 100;

    const rate = BIRTHS_PER_PAIR_YEAR * pairs * fed * room * (0.5 + mood * 0.7);
    const expected = (rate * days) / DAYS_PER_YEAR;

    let born = Math.floor(expected);
    if (this.rng.chance(expected - born)) born++;
    for (let i = 0; i < born && world.npcs.length < 400; i++) {
      const parent = this.rng.pick(fertile);
      world.bearChild(parent);
    }
  }

  // =========================================================================
  // Everything else alive
  // =========================================================================

  private ageAnimals(world: World, days: number): void {
    const years = days / DAYS_PER_YEAR;
    for (const animal of [...world.wildlife]) {
      animal.age += years;
      if (animal.age < animal.lifespan) continue;
      // Past its span, an animal dies quietly and soon.
      const over = animal.age - animal.lifespan;
      if (this.rng.chance(clamp01(over * 0.5 * days))) world.removeAnimal(animal);
    }
  }

  /**
   * Animals breed when there is room for more of them.
   *
   * The density target in the species table is what the land will carry, so a
   * population that has been hunted down recovers and one at capacity does
   * not keep climbing.
   */
  private breedAnimals(world: World, days: number): void {
    const counts = new Map<string, { adults: number; total: number }>();
    for (const a of world.wildlife) {
      const entry = counts.get(a.species) ?? { adults: 0, total: 0 };
      entry.total++;
      if (a.age > animalMaturity(a.species)) entry.adults++;
      counts.set(a.species, entry);
    }

    const km2 = (world.terrain.worldSize / 1000) ** 2;
    for (const [species, entry] of counts) {
      if (entry.adults < 2) continue;
      const def = ANIMALS[species as keyof typeof ANIMALS];
      if (!def) continue;
      const room = def.density * km2;
      if (entry.total >= room) continue;

      // Faster when there is more room, and never faster than the kind allows.
      const litters = (entry.adults / 2) * 0.55 * (1 - entry.total / room);
      const expected = (litters * days) / DAYS_PER_YEAR;
      let young = Math.floor(expected);
      if (this.rng.chance(expected - young)) young++;
      for (let i = 0; i < young; i++) {
        const parent = world.wildlife.find(
          (a) => a.species === species && a.age > animalMaturity(species),
        );
        if (!parent) break;
        world.bearAnimal(parent);
      }
    }
  }
}

/** Years before an animal of this kind can have young of its own. */
export function animalMaturity(species: string): number {
  const def = ANIMALS[species as keyof typeof ANIMALS];
  return def ? Math.max(0.4, def.lifespan[0] * 0.18) : 1;
}

/** The span this individual animal will have. Drawn once, at birth. */
export function animalLifespan(species: string, rng: Rng): number {
  const def = ANIMALS[species as keyof typeof ANIMALS];
  if (!def) return 6;
  const [lo, hi] = def.lifespan;
  // Most live near the middle of the range; a few are very old animals.
  return rng.stat((lo + hi) / 2, (hi - lo) / 4, lo * 0.5, hi * 1.25);
}

export { createAnimal };

/** A newborn's profession, until they are old enough to take a trade. */
export const CHILD_PROFESSION = 'settler';

/** True while this person is too young to be given work. */
export function isChild(npc: Npc): boolean {
  return npc.age < WORKING_AGE;
}
