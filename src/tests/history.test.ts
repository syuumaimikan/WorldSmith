/**
 * The world's long memory.
 *
 * The line held here is that a chronicle is not the event feed with a longer
 * scrollback. It keeps what mattered, it forgets on purpose and in a stated
 * order, it works out for itself what kind of time the world has been through,
 * and it keeps enough of the map to show where the borders used to be.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld } from './harness';
import type { World } from '../sim/World';
import { Snapshot } from '../sim/History';
import { DAYS_PER_YEAR } from '../sim/Time';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SaveData, validate } from '../persistence/schema';

type AnySave = SaveData & Record<string, unknown>;

/** Runs `days` of world history and nothing else. */
function runYears(world: World, years: number): void {
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    world.time.advance(24 * 12);
    world.history.update(world, 24);
  }
}

function roundTrip(world: World): World {
  const cloned = structuredClone(serializeWorld(world, 'test')) as AnySave;
  const migrated = migrate(cloned);
  expect(validate(migrated)).toBeNull();
  return deserializeWorld(migrated);
}

describe('what a world remembers', () => {
  it('keeps its founding and throws away its finished walls', () => {
    const world = buildTestWorld();
    const keys = world.history.annals.map((a) => a.key);
    expect(keys).toContain('ev.founded');

    const before = world.history.annals.length;
    for (let i = 0; i < 40; i++) {
      world.log.add(world.time, 'construction', 'ev.completed', { name: 'tent' });
      world.log.add(world.time, 'weather', 'ev.weatherTurns', { weather: 'clear' });
      world.log.add(world.time, 'production', 'ev.felled', { what: 'tree' });
    }
    expect(world.history.annals.length).toBe(before);

    world.log.add(world.time, 'politics', 'ev.warDeclared', {
      attacker: 'A',
      defender: 'B',
      goal: 'wargoal.conquest',
    });
    expect(world.history.annals.at(-1)?.key).toBe('ev.warDeclared');
  });

  it('forgets the least important thing first, and the older of two equals', () => {
    const world = buildTestWorld();
    // Far more than it can hold, half of it barely worth keeping.
    for (let i = 0; i < 4000; i++) {
      world.time.advance(24 * 12 * 5);
      world.log.add(world.time, 'settlement', 'ev.treatyTrade', { a: 'x', b: 'y' });
    }
    expect(world.history.annals.length).toBeLessThanOrEqual(3000);

    // The founding is the single most important thing that has ever happened
    // to this world and is also the oldest. It stays.
    expect(world.history.annals.some((a) => a.key === 'ev.founded')).toBe(true);
    // And what survives of the light stuff is the recent end of it.
    const light = world.history.annals.filter((a) => a.key === 'ev.treatyTrade');
    expect(light.length).toBeGreaterThan(0);
    const newest = Math.max(...light.map((a) => a.day));
    const oldest = Math.min(...light.map((a) => a.day));
    expect(newest - oldest).toBeLessThan(world.time.totalDays);
  });
});

describe('the ages of the world', () => {
  it('begins in the age of its own founding', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const age = world.history.currentAge()!;
    expect(age).not.toBeNull();
    expect(age.kind).toBe('founding');
    expect(age.subject).toBe(world.config.name);
    expect(age.endDay).toBe(-1);
  });

  it('turns when the character of the time turns', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const [a, b] = world.nations.nations;
    world.diplomacy.declareWar(world, a, b, 'conquest');

    runYears(world, 20);

    const ages = world.history.ages;
    expect(ages.length).toBeGreaterThan(1);
    expect(ages[0].kind).toBe('founding');
    // The founding age was closed, not left open behind the new one.
    expect(ages[0].endDay).toBeGreaterThan(0);
    expect(world.history.currentAge()!.kind).toBe('war');
    expect(world.history.currentAge()!.subject.length).toBeGreaterThan(0);
  });

  it('does not invent an age a decade when nothing is happening', () => {
    const world = buildTestWorld();
    runYears(world, 60);
    // Sixty quiet years is one or two kinds of time, not twelve.
    expect(world.history.ages.length).toBeLessThan(5);
  });

  it('files what it remembers under the age it happened in', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const [a, b] = world.nations.nations;
    world.diplomacy.declareWar(world, a, b, 'conquest');
    runYears(world, 20);

    const wartime = world.history.ages.find((x) => x.kind === 'war')!;
    world.log.add(world.time, 'politics', 'ev.battle', { name: a.name });
    const inside = world.history.annalsOf(wartime);
    expect(inside.some((x) => x.key === 'ev.battle')).toBe(true);

    const founding = world.history.ages[0];
    expect(world.history.annalsOf(founding).every((x) => x.day < founding.endDay)).toBe(true);
  });
});

describe('the map as it was', () => {
  it('takes a snapshot of the borders every ten years', () => {
    const world = buildTestWorld();
    runYears(world, 35);
    const shots = world.history.snapshots;
    expect(shots.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].day - shots[i - 1].day).toBeGreaterThanOrEqual(DAYS_PER_YEAR * 10 - 1);
    }
  });

  it('records the claims the nations were actually holding', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const shot = world.history.snapshots[0];
    expect(shot.cells).toBe(world.nations.cells);
    expect(shot.claims.length).toBe(world.nations.claims.length);
    for (let i = 0; i < shot.claims.length; i++) {
      expect(shot.claims[i]).toBe(world.nations.claims[i]);
    }
    // And a copy, so a later border change does not rewrite the past.
    world.nations.claims[0] = 250;
    expect(shot.claims[0]).not.toBe(250);
  });

  it('keeps the deep past at half resolution rather than dropping it', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const shots = world.history.snapshots;
    const first = shots[0];
    while (shots.length < 140) {
      shots.push({ ...first, day: shots.length * 10, year: shots.length } as Snapshot);
    }
    const oldestDay = shots[0].day;

    runYears(world, 11);

    expect(shots.length).toBeLessThan(140);
    // The far end of the record is still there; it is only coarser.
    expect(shots[0].day).toBe(oldestDay);
    expect(shots[shots.length - 1].day).toBe(world.history.snapshots.at(-1)!.day);
  });

  it('finds the snapshot nearest a year the player asks about', () => {
    const world = buildTestWorld();
    runYears(world, 35);
    const wanted = DAYS_PER_YEAR * 21;
    const near = world.history.snapshotNear(wanted)!;
    expect(near).not.toBeNull();
    for (const s of world.history.snapshots) {
      expect(Math.abs(s.day - wanted)).toBeGreaterThanOrEqual(Math.abs(near.day - wanted));
    }
  });
});

describe('the record itself', () => {
  it('survives a save with its ages, annals and maps intact', () => {
    const world = buildTestWorld();
    runYears(world, 1);
    const [a, b] = world.nations.nations;
    world.diplomacy.declareWar(world, a, b, 'conquest');
    runYears(world, 12);

    const loaded = roundTrip(world);
    expect(loaded.history.ages.length).toBe(world.history.ages.length);
    expect(loaded.history.annals.length).toBe(world.history.annals.length);
    expect(loaded.history.snapshots.length).toBe(world.history.snapshots.length);

    const before = world.history.currentAge()!;
    const after = loaded.history.currentAge()!;
    expect(after.kind).toBe(before.kind);
    expect(after.subject).toBe(before.subject);
    expect(after.startDay).toBeCloseTo(before.startDay, 4);

    const shotBefore = world.history.snapshots[0];
    const shotAfter = loaded.history.snapshots[0];
    expect(shotAfter.claims.length).toBe(shotBefore.claims.length);
    for (let i = 0; i < shotBefore.claims.length; i++) {
      expect(shotAfter.claims[i]).toBe(shotBefore.claims[i]);
    }
    expect(shotAfter.powers.map((p) => p.name)).toEqual(shotBefore.powers.map((p) => p.name));
  });

  it('goes on remembering after it has been loaded', () => {
    const world = buildTestWorld();
    runYears(world, 2);
    const loaded = roundTrip(world);
    const before = loaded.history.annals.length;
    loaded.log.add(loaded.time, 'politics', 'ev.revolution', {
      nation: 'X',
      from: 'gov.monarchy',
      to: 'gov.republic',
    });
    expect(loaded.history.annals.length).toBe(before + 1);
  });

  it('refuses to trust a save that claims impossible history', () => {
    const world = buildTestWorld();
    runYears(world, 12);
    const save = serializeWorld(world, 'test') as AnySave;
    const history = save.history as Record<string, unknown>;

    (history.ages as Record<string, unknown>[])[0].kind = 'the-age-of-nonsense';
    (history.ages as Record<string, unknown>[])[0].subject = 'x'.repeat(5000);
    (history.annals as Record<string, unknown>[])[0].weight = 9000;
    (history.annals as Record<string, unknown>[])[0].params = {
      good: 'fine',
      bad: { nested: true },
    };
    (history.snapshots as Record<string, unknown>[])[0].claims = [1, 2, 3];
    (history.snapshots as Record<string, unknown>[])[1].population = Number.NaN;

    const loaded = deserializeWorld(migrate(structuredClone(save)));
    const h = loaded.history;

    expect(h.ages[0].kind).toBe('peace');
    expect(h.ages[0].subject.length).toBeLessThanOrEqual(80);
    expect(h.annals[0].weight).toBeLessThanOrEqual(1);
    expect(h.annals[0].params).toEqual({ good: 'fine' });
    // A snapshot whose map is the wrong size is not a snapshot.
    expect(h.snapshots.length).toBe(world.history.snapshots.length - 1);
    for (const s of h.snapshots) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(s.claims.length).toBe(s.cells * s.cells);
    }
  });
});
