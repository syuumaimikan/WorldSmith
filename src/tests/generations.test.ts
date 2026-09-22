/**
 * Being born, growing old, and dying of it.
 *
 * The line held here is that a span belongs to an individual and not to a
 * kind: two people born the same spring do not die the same year. Births are
 * what the settlement's own food and roofs allow rather than a rate with
 * modifiers bolted on, children are not workers, and a century left to itself
 * leaves a settlement full of people nobody has met.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import { WORKING_AGE, isChild } from '../sim/Generations';
import { DAYS_PER_YEAR } from '../sim/Time';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SaveData, validate } from '../persistence/schema';

function skipYears(world: World, years: number): void {
  const days = Math.round(years * DAYS_PER_YEAR);
  for (let i = 0; i < days; i++) world.skipDay();
}

describe('a span of your own', () => {
  it('gives no two people the same one', () => {
    const world = buildTestWorld();
    const spans = new Set(world.npcs.map((n) => n.lifespan.toFixed(4)));
    expect(world.npcs.length).toBeGreaterThan(3);
    expect(spans.size).toBe(world.npcs.length);
    for (const n of world.npcs) {
      expect(n.lifespan).toBeGreaterThan(30);
      expect(n.lifespan).toBeLessThan(100);
    }
  });

  it('gives no two animals the same one either', () => {
    const world = buildTestWorld();
    expect(world.wildlife.length).toBeGreaterThan(5);
    const spans = new Set(world.wildlife.map((a) => a.lifespan.toFixed(4)));
    expect(spans.size).toBeGreaterThan(world.wildlife.length * 0.9);
    for (const a of world.wildlife) expect(a.lifespan).toBeGreaterThan(0.5);
  });

  it('is not a line everybody crosses at once', () => {
    const world = buildTestWorld();
    // Same age, same day, different spans: they do not go together.
    for (const n of world.npcs) n.age = 60;
    const deathYears: number[] = [];
    const startCount = world.npcs.length;
    const watching = new Set(world.npcs.map((n) => n.id));

    for (let year = 0; year < 60; year++) {
      const before = world.npcs.filter((n) => watching.has(n.id)).length;
      skipYears(world, 1);
      const after = world.npcs.filter((n) => watching.has(n.id)).length;
      for (let i = 0; i < before - after; i++) deathYears.push(year);
      if (after === 0) break;
    }

    expect(deathYears.length).toBe(startCount);
    // They died across a spread of years, not all in one.
    expect(new Set(deathYears).size).toBeGreaterThan(2);
  });
});

describe('growing old', () => {
  it('slows a person down before it kills them', () => {
    const world = buildTestWorld();
    const n = world.npcs[0];
    n.age = 20;
    n.lifespan = 70;
    n.frailty = 0;
    const young = n.workRate('construction');

    n.age = 78;
    for (let i = 0; i < 40; i++) world.skipDay();
    expect(n.frailty).toBeGreaterThan(0);
    // Still in the world, and slower for it.
    if (world.npcById.has(n.id)) {
      expect(n.workRate('construction')).toBeLessThan(young);
    }
  });

  it('writes down who died and how old they were', () => {
    const world = buildTestWorld();
    for (const n of world.npcs) {
      n.age = 95;
      n.lifespan = 60;
    }
    skipYears(world, 6);
    const obituaries = world.log.all().filter((e) => e.key === 'ev.diedOfAge');
    expect(obituaries.length).toBeGreaterThan(0);
    expect(obituaries[0].params?.age).toBeGreaterThan(60);
  });
});

describe('being born', () => {
  it('needs food, and does not happen without it', () => {
    const world = buildTestWorld();
    for (const n of world.npcs) {
      n.age = 25;
      n.lifespan = 80;
      n.needs.health = 90;
    }
    const before = world.npcs.length;
    for (let i = 0; i < DAYS_PER_YEAR * 10; i++) {
      // Hungry every day of it: nothing they gathered was enough.
      for (const n of world.npcs) n.needs.hunger = 12;
      world.skipDay();
    }
    // Nobody is born into a settlement with nothing to eat.
    const born = world.log.all().filter((e) => e.key === 'ev.born').length;
    expect(born).toBe(0);
    expect(world.npcs.length).toBeLessThanOrEqual(before);
  });

  it('happens when there is food and somewhere to put them', () => {
    const world = buildTestWorld();
    for (const n of world.npcs) {
      n.age = 25;
      n.lifespan = 90;
      n.needs.health = 95;
      n.needs.mood = 80;
    }
    let born = 0;
    for (let i = 0; i < DAYS_PER_YEAR * 25; i++) {
      // Well fed, well housed, and nobody ageing out of it.
      world.settlement.housingCapacity = 40;
      for (const n of world.npcs) {
        if (n.age > 40) n.age = 25;
        n.needs.hunger = 95;
        n.needs.mood = 80;
      }
      world.skipDay();
      born = Math.max(born, world.log.all().filter((e) => e.key === 'ev.born').length);
    }
    expect(born).toBeGreaterThan(0);
  });

  it('produces children, who are not put to work', () => {
    const world = buildTestWorld();
    const parent = world.npcs[0];
    const child = world.bearChild(parent);
    expect(child.age).toBe(0);
    expect(isChild(child)).toBe(true);
    expect(child.homeId).toBe(parent.homeId);
    child.age = WORKING_AGE + 1;
    expect(isChild(child)).toBe(false);
  });
});

describe('a century left alone', () => {
  it('turns the settlement over to people nobody has met', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'generations' }));
    const original = new Set(world.npcs.map((n) => n.id));
    // A place that can feed and house itself.
    for (let i = 0; i < DAYS_PER_YEAR * 100; i++) {
      world.settlement.housingCapacity = 60;
      for (const n of world.npcs) n.needs.hunger = Math.max(n.needs.hunger, 80);
      world.skipDay();
    }

    // A hundred years is longer than anyone lives.
    const survivors = world.npcs.filter((n) => original.has(n.id));
    expect(survivors.length).toBe(0);
    // And the clock really moved.
    expect(world.time.snapshot().year).toBeGreaterThan(95);
  });

  it('keeps every number in a sane range while it does', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'sane' }));
    for (let i = 0; i < DAYS_PER_YEAR * 120; i++) {
      world.settlement.housingCapacity = 50;
      for (const n of world.npcs) n.needs.hunger = Math.max(n.needs.hunger, 75);
      world.skipDay();
    }
    for (const n of world.npcs) {
      expect(Number.isFinite(n.age)).toBe(true);
      expect(n.age).toBeGreaterThanOrEqual(0);
      expect(n.age).toBeLessThan(140);
      expect(n.frailty).toBeGreaterThanOrEqual(0);
      expect(n.frailty).toBeLessThanOrEqual(1);
      for (const [key, value] of Object.entries(n.needs)) {
        expect(Number.isFinite(value), `${n.name}.${key}`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    expect(world.npcs.length).toBeLessThanOrEqual(400);
    expect(world.wildlife.length).toBeLessThanOrEqual(600);
  });
});

describe('the animals', () => {
  it('breed back towards what the land will carry, and no further', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'herds' }));
    // Nobody left to hunt them. The claim being checked is about what the
    // land will carry, and a settlement working the same ground is a separate
    // question -- answered in the next test.
    for (const npc of [...world.npcs]) world.removeNpc(npc);

    const keep = new Map<string, number>();
    for (const a of [...world.wildlife]) {
      const n = keep.get(a.species) ?? 0;
      if (n >= 4) world.removeAnimal(a);
      else keep.set(a.species, n + 1);
    }
    for (const a of world.wildlife) a.age = 3;
    const after = world.wildlife.length;

    for (let i = 0; i < DAYS_PER_YEAR * 40; i++) world.skipDay();
    const recovered = world.wildlife.length;
    expect(recovered).toBeGreaterThan(after);

    // And it does not run away with itself.
    for (let i = 0; i < DAYS_PER_YEAR * 200; i++) world.skipDay();
    expect(world.wildlife.length).toBeLessThanOrEqual(600);
  });

  it('are fewer where there are hunters, because hunting takes them', () => {
    // The same world twice: once with its settlement, once emptied of people
    // the moment it is built. Nothing else differs, so whatever gap opens up
    // over a century is the hunting -- which means the hunting is real, and
    // the animals it accounts for are animals that stopped existing.
    const hunted = buildTestWorld(makeTestConfig({ seedText: 'quarry' }));
    const left = buildTestWorld(makeTestConfig({ seedText: 'quarry' }));
    for (const npc of [...left.npcs]) left.removeNpc(npc);
    expect(hunted.wildlife.length).toBe(left.wildlife.length);

    for (let i = 0; i < DAYS_PER_YEAR * 100; i++) {
      hunted.skipDay();
      left.skipDay();
    }
    expect(hunted.wildlife.length).toBeLessThan(left.wildlife.length);
  });
});

describe('the record', () => {
  it('remembers every span across a save', () => {
    const world = buildTestWorld();
    skipYears(world, 3);
    const cloned = structuredClone(serializeWorld(world, 'test')) as SaveData &
      Record<string, unknown>;
    const migrated = migrate(cloned);
    expect(validate(migrated)).toBeNull();
    const loaded = deserializeWorld(migrated);

    for (const n of world.npcs) {
      const copy = loaded.npcById.get(n.id)!;
      expect(copy, n.name).toBeDefined();
      expect(copy.lifespan).toBeCloseTo(n.lifespan, 5);
      expect(copy.age).toBeCloseTo(n.age, 5);
      expect(copy.frailty).toBeCloseTo(n.frailty, 5);
    }
    for (const a of world.wildlife) {
      const copy = loaded.wildlifeById.get(a.id)!;
      expect(copy).toBeDefined();
      expect(copy.lifespan).toBeCloseTo(a.lifespan, 5);
    }
  });
});
