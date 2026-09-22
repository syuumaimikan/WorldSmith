/**
 * What peoples believe.
 *
 * The line held here is that belief is a thing that moves between people who
 * are actually in contact, that a people's belief is a whole which gets
 * divided up rather than a set of numbers that can all rise at once, and that
 * a faith is built out of this world's own sky rather than out of a list of
 * religions written in advance.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import { Nation } from '../sim/Nations';
import { Religion, TENETS, VALUE_IDS } from '../sim/Culture';
import { DAYS_PER_YEAR, SECONDS_PER_GAME_HOUR } from '../sim/Time';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SaveData, validate } from '../persistence/schema';

/** Runs `days` of politics and belief together. */
function runBelief(world: World, days: number): void {
  for (let d = 0; d < days; d++) {
    world.time.advance(24 * SECONDS_PER_GAME_HOUR);
    world.nations.update(world, 24);
    world.diplomacy.update(world, 24);
    world.culture.update(world, 24);
  }
}

/** Belief alone: no treaties form, so no roads open between anyone. */
function runSealed(world: World, days: number): void {
  for (let d = 0; d < days; d++) {
    world.time.advance(24 * SECONDS_PER_GAME_HOUR);
    world.culture.update(world, 24);
  }
}

/** Everything one people keeps, across every faith in the world. */
function totalHeld(world: World, nationId: number): number {
  let sum = 0;
  for (const r of world.culture.religions) sum += r.followers.get(nationId) ?? 0;
  return sum;
}

describe('a people and their faith', () => {
  it('gives every nation in the world both, at founding', () => {
    const world = buildTestWorld();
    expect(world.nations.nations.length).toBeGreaterThan(2);
    for (const n of world.nations.nations) {
      const culture = world.culture.cultureFor(n.id);
      const faith = world.culture.faithFor(n.id);
      expect(culture, n.name).not.toBeNull();
      expect(faith, n.name).not.toBeNull();
      expect(world.culture.fervourOf(n.id)).toBeGreaterThan(0.4);
    }
  });

  it('builds its faiths out of the figures this world actually has in its sky', () => {
    const world = buildTestWorld();
    const known = new Set(world.astronomy.constellations.map((c) => c.id));
    let deities = 0;
    for (const r of world.culture.religions) {
      expect(r.deities.length).toBeGreaterThan(0);
      for (const d of r.deities) {
        expect(known.has(d.constellation), `${r.name}: ${d.name}`).toBe(true);
        const figure = world.astronomy.constellations.find((c) => c.id === d.constellation)!;
        expect(d.domain).toBe(figure.domain);
        deities++;
      }
    }
    expect(deities).toBeGreaterThan(3);
  });

  it('gives a world with a different sky a different set of faiths', () => {
    const a = buildTestWorld(makeTestConfig({ seedText: 'one sky' }));
    const b = buildTestWorld(makeTestConfig({ seedText: 'another sky' }));
    const names = new Set(a.culture.religions.map((r) => r.name));
    const shared = b.culture.religions.filter((r) => names.has(r.name));
    expect(shared).toEqual([]);
  });

  it('shapes how many powers a faith recognises to the shape of the faith', () => {
    for (const seedText of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const world = buildTestWorld(makeTestConfig({ seedText }));
      for (const r of world.culture.religions) {
        if (r.kind === 'monotheist') expect(r.deities.length, r.name).toBe(1);
        if (r.kind === 'polytheist') expect(r.deities.length, r.name).toBeGreaterThan(2);
      }
    }
  });
});

describe('a faith travelling', () => {
  it('does not reach a people nobody has dealt with', () => {
    const world = buildTestWorld();
    // No diplomacy runs, so no treaty is ever signed and no war declared:
    // every road between these peoples stays shut.
    const before = world.nations.nations.map((n) => world.culture.faithFor(n.id)!.id);
    const holds = world.nations.nations.map((n) => totalHeld(world, n.id));

    runSealed(world, DAYS_PER_YEAR * 200);

    world.nations.nations.forEach((n, i) => {
      expect(world.culture.faithFor(n.id)!.id, n.name).toBe(before[i]);
      expect(totalHeld(world, n.id)).toBeCloseTo(holds[i], 6);
    });
  });

  it('travels the road a treaty opens', () => {
    const world = buildTestWorld();
    const [a, b] = world.nations.nations;
    const theirs = world.culture.faithFor(b.id)!;
    // An alliance is the widest road there is between two peoples.
    world.diplomacy.relation(a.id, b.id).treaty = 'alliance';
    theirs.followers.set(b.id, 0.95);

    runSealed(world, DAYS_PER_YEAR * 60);
    expect(theirs.followers.get(a.id) ?? 0).toBeGreaterThan(0.02);
  });

  it('keeps what a people believe a whole rather than a sum that can exceed them', () => {
    const world = buildTestWorld();
    runBelief(world, DAYS_PER_YEAR * 250);
    for (const n of world.nations.nations) {
      const held = totalHeld(world, n.id);
      expect(held, n.name).toBeGreaterThan(0);
      expect(held, n.name).toBeLessThanOrEqual(1.0001);
      for (const r of world.culture.religions) {
        const hold = r.followers.get(n.id) ?? 0;
        expect(Number.isFinite(hold)).toBe(true);
        expect(hold).toBeGreaterThanOrEqual(0);
        expect(hold).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not have a people change what they believe and change back', () => {
    // Conversion is a thing that happens to a people once in a long while, not
    // a number crossing a line back and forth every season.
    let conversions = 0;
    for (const seedText of ['back', 'forth']) {
      const world = buildTestWorld(makeTestConfig({ seedText }));
      const log = world.log;
      const original = log.add.bind(log);
      log.add = ((...args: Parameters<typeof original>) => {
        if (args[2] === 'ev.conversion') conversions++;
        return original(...args);
      }) as typeof log.add;
      runBelief(world, DAYS_PER_YEAR * 300);
    }
    // Two worlds, three centuries each: a handful of conversions is history,
    // hundreds would be a number oscillating.
    expect(conversions).toBeLessThan(30);
  });

  it('lets a faith die out when the last people who kept it are gone', () => {
    const world = buildTestWorld();
    const doomed = world.culture.religions[0];
    const sect = world.culture.religions[1];
    // Nothing is left of it, and something had split from it once.
    sect.schismOf = doomed.id;
    doomed.followers.clear();
    world.culture.faithOf.set(world.nations.nations[0].id, doomed.id);

    runBelief(world, DAYS_PER_YEAR * 20);

    expect(world.culture.religions.find((r) => r.id === doomed.id)).toBeUndefined();
    // Whatever split from it is the eldest of its line now, not an orphan
    // pointing at a faith that no longer exists.
    expect(sect.schismOf).toBe(0);
  });
});

describe('a faith breaking in two', () => {
  it('produces a sect that keeps what it came from and argues about one thing', () => {
    const world = buildTestWorld();
    const [a, b] = world.nations.nations.filter((n) => !n.isPlayer);
    const shared = world.culture.faithFor(a.id)!;

    // The same faith kept at opposite ends of the world by two peoples who
    // agree about nothing and have been at war for as long as anyone can
    // remember. It does not stay one faith.
    for (const r of world.culture.religions) r.followers.delete(b.id);
    shared.followers.set(b.id, 0.9);
    world.culture.faithOf.set(b.id, shared.id);
    const ca = world.culture.cultureFor(a.id)!;
    const cb = world.culture.cultureFor(b.id)!;
    for (const id of VALUE_IDS) {
      ca.values[id] = 0.9;
      cb.values[id] = 0.1;
    }

    let sect: Religion | undefined;
    for (let year = 0; year < 400 && !sect; year++) {
      for (let d = 0; d < DAYS_PER_YEAR; d++) {
        world.time.advance(24 * SECONDS_PER_GAME_HOUR);
        if (!world.diplomacy.atWar(a.id, b.id)) {
          world.diplomacy.declareWar(world, a, b, 'conquest');
        }
        world.culture.update(world, 24);
      }
      sect = world.culture.religions.find((r) => r.schismOf === shared.id);
    }

    expect(sect, 'no sect in four hundred years of a faith at war with itself').toBeDefined();
    // The same figures in the sky, read the same way.
    expect(sect!.kind).toBe(shared.kind);
    expect(sect!.deities.map((d) => d.name)).toEqual(shared.deities.map((d) => d.name));
    // And exactly one thing asked of the faithful that differs.
    expect(difference(sect!, shared)).toBe(1);
    expect(sect!.tenets.size).toBeGreaterThan(0);
    // It still sounds like what it broke from, and is not it.
    expect(sect!.name).not.toBe(shared.name);
    expect(sect!.stem).not.toBe(shared.stem);
    // And one of the two peoples keeps it now.
    expect([a.id, b.id]).toContain(
      [...world.culture.faithOf].find(([, f]) => f === sect!.id)?.[0],
    );
  });
});

describe('what a people hold worth doing', () => {
  it('moves with what has been happening to them', () => {
    // The same world and the same people, three centuries apart in one
    // respect only: whether they spent them fighting.
    const martialAfterThreeCenturies = (fighting: boolean): number => {
      const world = buildTestWorld();
      const [them, neighbour] = world.nations.nations.filter((n) => !n.isPlayer);
      for (let d = 0; d < DAYS_PER_YEAR * 300; d++) {
        world.time.advance(24 * SECONDS_PER_GAME_HOUR);
        if (fighting && world.diplomacy.warsOf(them.id).length === 0) {
          world.diplomacy.declareWar(world, them, neighbour, 'conquest');
        }
        world.culture.update(world, 24);
      }
      return world.culture.cultureFor(them.id)!.values.martial;
    };

    const atWar = martialAfterThreeCenturies(true);
    const atPeace = martialAfterThreeCenturies(false);
    expect(atWar).toBeGreaterThan(atPeace);
    expect(atWar - atPeace).toBeGreaterThan(0.1);
  });

  it('does not make every people in the world identical given time', () => {
    const world = buildTestWorld();
    runBelief(world, DAYS_PER_YEAR * 300);
    const all = world.nations.nations;
    let widest = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        widest = Math.max(widest, world.culture.culturalDistance(all[i].id, all[j].id));
      }
    }
    expect(widest).toBeGreaterThan(0.05);
  });

  it('keeps every value inside its range however long the world runs', () => {
    const world = buildTestWorld();
    runBelief(world, DAYS_PER_YEAR * 400);
    for (const c of world.culture.cultures) {
      for (const id of VALUE_IDS) {
        expect(Number.isFinite(c.values[id]), `${c.name}.${id}`).toBe(true);
        expect(c.values[id]).toBeGreaterThanOrEqual(0);
        expect(c.values[id]).toBeLessThanOrEqual(1);
      }
    }
    for (const n of world.nations.nations) {
      expect(n.unrest).toBeGreaterThanOrEqual(0);
      expect(n.unrest).toBeLessThanOrEqual(1);
      expect(Number.isFinite(n.army)).toBe(true);
      expect(n.army).toBeLessThanOrEqual(n.population + 1);
    }
  });
});

describe('belief and everyone else', () => {
  it('warms two peoples to each other when they keep the same faith', () => {
    const world = buildTestWorld();
    const [a, b] = world.nations.nations;
    const shared = world.culture.faithFor(a.id)!;
    shared.followers.set(b.id, 0.9);
    world.culture.faithOf.set(b.id, shared.id);
    // The same people, so nothing about culture pulls the other way.
    world.culture.cultureOf.set(b.id, world.culture.cultureOf.get(a.id)!);

    const r = world.diplomacy.relation(a.id, b.id);
    r.opinion = 0;
    runSealed(world, DAYS_PER_YEAR * 20);
    expect(r.opinion).toBeGreaterThan(2);
  });

  it('cools them when one of them holds that unbelief is to be ended', () => {
    const world = buildTestWorld();
    const [a, b] = world.nations.nations;
    const theirs = world.culture.faithFor(a.id)!;
    theirs.tenets.clear();
    theirs.tenets.add('crusade');
    expect(world.culture.toleranceOf(a.id)).toBe(TENETS.crusade.tolerance);

    const r = world.diplomacy.relation(a.id, b.id);
    r.opinion = 0;
    runSealed(world, DAYS_PER_YEAR * 20);
    expect(r.opinion).toBeLessThan(0);
  });

  it('counts a sect and what it split from as neither the same nor strangers', () => {
    const world = buildTestWorld();
    const [a, b] = world.nations.nations;
    const parent = world.culture.faithFor(a.id)!;
    const sect = world.culture.faithFor(b.id)!;
    expect(world.culture.faithAffinity(a.id, b.id)).toBe(0);
    sect.schismOf = parent.id;
    const near = world.culture.faithAffinity(a.id, b.id);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
  });
});

describe('a faction that breaks away', () => {
  it('takes the people and the faith of the country it rose against', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    const theirCulture = world.culture.cultureOf.get(n.id)!;
    const theirFaith = world.culture.faithOf.get(n.id)!;

    const contested = (x: Nation): void => {
      x.taxRate = 0.55;
      x.leader.cruelty = 0.95;
      x.leader.competence = 1;
      x.unrest = 0.95;
      x.legitimacy = 0.7;
      x.stability = 0.05;
      x.population = 800;
      x.army = 800 * 0.06;
      x.lastRegimeChangeDay = -99999;
    };

    contested(n);
    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runBelief(world, 5);
      if (!n.inCivilWar) contested(n);
    }
    expect(n.inCivilWar).toBe(true);

    const rebels = world.nations.nations.find((x) => x.rebelAgainst === n.id)!;
    expect(rebels).toBeDefined();
    // A civil war is not fought between strangers.
    expect(world.culture.cultureOf.get(rebels.id)).toBe(theirCulture);
    expect(world.culture.faithOf.get(rebels.id)).toBe(theirFaith);
  });
});

describe('the record', () => {
  it('survives a save with its peoples, faiths and followers intact', () => {
    const world = buildTestWorld();
    runBelief(world, DAYS_PER_YEAR * 120);

    const cloned = structuredClone(serializeWorld(world, 'test')) as SaveData &
      Record<string, unknown>;
    const migrated = migrate(cloned);
    expect(validate(migrated)).toBeNull();
    const loaded = deserializeWorld(migrated);

    expect(loaded.culture.cultures.length).toBe(world.culture.cultures.length);
    expect(loaded.culture.religions.length).toBe(world.culture.religions.length);

    for (const n of world.nations.nations) {
      expect(loaded.culture.faithFor(n.id)?.name).toBe(world.culture.faithFor(n.id)?.name);
      expect(loaded.culture.fervourOf(n.id)).toBeCloseTo(world.culture.fervourOf(n.id), 6);
      const before = world.culture.cultureFor(n.id)!;
      const after = loaded.culture.cultureFor(n.id)!;
      for (const id of VALUE_IDS) {
        expect(after.values[id]).toBeCloseTo(before.values[id], 6);
        expect(after.origin[id]).toBeCloseTo(before.origin[id], 6);
      }
    }

    for (const r of world.culture.religions) {
      const copy = loaded.culture.religions.find((x) => x.id === r.id)!;
      expect(copy, r.name).toBeDefined();
      expect([...copy.tenets].sort()).toEqual([...r.tenets].sort());
      expect(copy.deities.length).toBe(r.deities.length);
      expect(copy.schismOf).toBe(r.schismOf);
      expect(copy.stem).toBe(r.stem);
    }
  });

  it('clamps a save that claims impossible belief', () => {
    const world = buildTestWorld();
    const save = serializeWorld(world, 'test') as SaveData & Record<string, unknown>;
    const culture = save.culture as Record<string, unknown>;
    (culture.cultures as Record<string, unknown>[])[0].values = {
      honour: 40,
      industry: -12,
      piety: Number.NaN,
    };
    (culture.religions as Record<string, unknown>[])[0].followers = [
      [1, 9000],
      ['not a nation', 0.5],
      [2, Number.NaN],
    ];
    (culture.religions as Record<string, unknown>[])[0].tenets = ['charity', 'not-a-tenet'];

    const loaded = deserializeWorld(migrate(structuredClone(save)));
    const first = loaded.culture.cultures[0];
    for (const id of VALUE_IDS) {
      expect(Number.isFinite(first.values[id]), id).toBe(true);
      expect(first.values[id]).toBeGreaterThanOrEqual(0);
      expect(first.values[id]).toBeLessThanOrEqual(1);
    }
    const faith = loaded.culture.religions[0];
    expect([...faith.tenets]).toEqual(['charity']);
    for (const hold of faith.followers.values()) {
      expect(hold).toBeGreaterThanOrEqual(0);
      expect(hold).toBeLessThanOrEqual(1);
    }
  });
});

/** How many things one faith asks of the faithful that the other does not. */
function difference(a: Religion, b: Religion): number {
  let n = 0;
  for (const id of a.tenets) if (!b.tenets.has(id)) n++;
  for (const id of b.tenets) if (!a.tenets.has(id)) n++;
  return n;
}
