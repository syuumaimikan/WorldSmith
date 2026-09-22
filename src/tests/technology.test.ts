/**
 * What a people know how to do.
 *
 * The line held here is that know-how is earned rather than granted, that it
 * travels the same roads as everything else, that it can be lost, and that an
 * era is worth something concrete rather than being a label on a panel.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import { ERAS } from '../sim/Technology';
import { DAYS_PER_YEAR } from '../sim/Time';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SaveData, validate } from '../persistence/schema';

function runAges(world: World, years: number): void {
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    world.time.advance(24 * 12);
    world.nations.update(world, 24);
    world.diplomacy.update(world, 24);
    world.culture.update(world, 24);
    world.technology.update(world, 24);
  }
}

/** Technology alone, so nothing else moves the numbers under it. */
function runQuiet(world: World, years: number): void {
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    world.time.advance(24 * 12);
    world.technology.update(world, 24);
  }
}

describe('knowing more', () => {
  it('starts every people in the age of stone', () => {
    const world = buildTestWorld();
    for (const n of world.nations.nations) {
      expect(world.technology.eraOf(world, n).id, n.name).toBe('stone');
    }
  });

  it('is earned by having people with time to think', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    n.population = 2000;
    n.stability = 0.8;
    n.treasury = 500;
    const before = world.technology.knowledgeOf(world, n);
    runQuiet(world, 60);
    expect(world.technology.knowledgeOf(world, n)).toBeGreaterThan(before);
  });

  it('comes faster to a larger, steadier people than a small shaky one', () => {
    const world = buildTestWorld();
    const [big, small] = world.nations.nations.filter((x) => !x.isPlayer);
    big.population = 3000;
    big.stability = 0.85;
    big.treasury = 900;
    small.population = 60;
    small.stability = 0.3;
    small.treasury = -10;
    runQuiet(world, 120);
    expect(world.technology.knowledgeOf(world, big)).toBeGreaterThan(
      world.technology.knowledgeOf(world, small) * 3,
    );
  });

  it('is lost by a country that is coming apart', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    world.technology.knowledge.set(n.id, 800);
    n.inCivilWar = true;
    runQuiet(world, 80);
    expect(world.technology.knowledgeOf(world, n)).toBeLessThan(800);
    expect(world.technology.knowledgeOf(world, n)).toBeGreaterThan(0);
  });

  it('travels to a neighbour along a road that is open', () => {
    const world = buildTestWorld();
    const [ahead, behind] = world.nations.nations.filter((x) => !x.isPlayer);
    world.technology.knowledge.set(ahead.id, 1500);
    world.technology.knowledge.set(behind.id, 0);
    // Nobody is learning anything on their own here.
    behind.population = 1;
    behind.stability = 0;
    ahead.population = 1;
    ahead.stability = 0;
    world.diplomacy.relation(ahead.id, behind.id).treaty = 'trade';

    runQuiet(world, 40);
    const taught = world.technology.knowledgeOf(world, behind);
    expect(taught).toBeGreaterThan(20);
    // Being taught is not the same as working it out: they do not overtake.
    expect(taught).toBeLessThan(world.technology.knowledgeOf(world, ahead));
  });

  it('does not reach a people nobody deals with as readily as one they do', () => {
    const measure = (open: boolean): number => {
      const world = buildTestWorld(makeTestConfig({ seedText: 'diffuse' }));
      const [ahead, behind] = world.nations.nations.filter((x) => !x.isPlayer);
      world.technology.knowledge.set(ahead.id, 1500);
      world.technology.knowledge.set(behind.id, 0);
      behind.population = 1;
      behind.stability = 0;
      ahead.population = 1;
      ahead.stability = 0;
      if (open) world.diplomacy.relation(ahead.id, behind.id).treaty = 'alliance';
      runQuiet(world, 40);
      return world.technology.knowledgeOf(world, behind);
    };
    expect(measure(true)).toBeGreaterThan(measure(false) * 2);
  });
});

describe('what an era is worth', () => {
  it('feeds more people off the same land', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    n.population = 10;
    n.stability = 0.9;
    n.treasury = 100;

    const grow = (knowledge: number): number => {
      world.technology.knowledge.set(n.id, knowledge);
      n.population = 10;
      for (let d = 0; d < DAYS_PER_YEAR * 200; d++) {
        world.time.advance(24 * 12);
        world.nations.update(world, 24);
      }
      return n.population;
    };

    const stoneAge = grow(0);
    const ironAge = grow(ERAS[2].threshold + 10);
    expect(ironAge).toBeGreaterThan(stoneAge);
  });

  it('is a real ordering, with each age worth more than the last', () => {
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERAS[i].threshold).toBeGreaterThan(ERAS[i - 1].threshold);
      expect(ERAS[i].carrying).toBeGreaterThan(ERAS[i - 1].carrying);
      expect(ERAS[i].production).toBeGreaterThan(ERAS[i - 1].production);
      expect(ERAS[i].martial).toBeGreaterThan(ERAS[i - 1].martial);
    }
  });
});

describe("the player's own people", () => {
  it('advance by working things out rather than by existing', () => {
    const world = buildTestWorld();
    const mine = world.nations.playerNation!;
    const before = world.technology.knowledgeOf(world, mine);
    runQuiet(world, 200);
    // Two centuries of doing no research at all is two centuries of knowing
    // exactly what they knew before.
    expect(world.technology.knowledgeOf(world, mine)).toBe(before);

    world.research.unlocked.add('woodworking');
    world.research.unlocked.add('masonry');
    expect(world.technology.knowledgeOf(world, mine)).toBeGreaterThan(before);
  });
});

describe('the record', () => {
  it('writes down a people coming into a new age', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    n.population = 4000;
    n.stability = 0.9;
    n.treasury = 2000;
    runQuiet(world, 1);
    const before = world.log.all().filter((e) => e.key === 'ev.eraReached').length;
    world.technology.knowledge.set(n.id, ERAS[1].threshold + 1);
    runQuiet(world, 1);
    const after = world.log.all().filter((e) => e.key === 'ev.eraReached').length;
    expect(after).toBe(before + 1);
  });

  it('survives a save', () => {
    const world = buildTestWorld();
    runAges(world, 40);
    const cloned = structuredClone(serializeWorld(world, 'test')) as SaveData &
      Record<string, unknown>;
    const migrated = migrate(cloned);
    expect(validate(migrated)).toBeNull();
    const loaded = deserializeWorld(migrated);
    for (const n of world.nations.nations) {
      const copy = loaded.nations.byId(n.id)!;
      expect(copy).not.toBeNull();
      expect(loaded.technology.knowledgeOf(loaded, copy)).toBeCloseTo(
        world.technology.knowledgeOf(world, n),
        4,
      );
    }
  });

  it('clamps a save that claims impossible know-how', () => {
    const world = buildTestWorld();
    const save = serializeWorld(world, 'test') as SaveData & Record<string, unknown>;
    (save.technology as Record<string, unknown>).knowledge = [
      [1, Number.POSITIVE_INFINITY],
      [2, -500],
      ['x', 10],
      [3, 1e12],
    ];
    (save.technology as Record<string, unknown>).reported = [[1, 'the-age-of-nonsense']];
    const loaded = deserializeWorld(migrate(structuredClone(save)));
    for (const k of loaded.technology.knowledge.values()) {
      expect(Number.isFinite(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1e6);
    }
  });
});
