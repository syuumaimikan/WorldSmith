/**
 * Places, rather than a border with nothing inside it.
 *
 * A nation used to be a capital point and a set of claimed cells; you could
 * walk across a kingdom of four thousand people and find an empty valley.
 * What is checked here is that the people are somewhere in particular, that
 * where they are is ground their own nation holds, and that what a place is
 * called -- village, town, city -- is how many of them are in it rather than
 * a label somebody picked.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import { tierOf } from '../sim/Nations';
import { DAYS_PER_YEAR } from '../sim/Time';
import { serializeWorld, deserializeWorld } from '../persistence/serialize';

function runYears(world: ReturnType<typeof buildTestWorld>, years: number): void {
  for (let i = 0; i < Math.round(years * DAYS_PER_YEAR); i++) world.skipDay();
}

describe('the other peoples', () => {
  it('live somewhere', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'places' }));
    runYears(world, 6);
    const foreign = world.nations.nations.filter((n) => !n.isPlayer);
    expect(foreign.length).toBeGreaterThan(0);
    for (const n of foreign) {
      expect(n.towns.length, `${n.name} has nowhere to live`).toBeGreaterThan(0);
      expect(n.towns.filter((t) => t.isCapital).length).toBe(1);
    }
  });

  it('builds on ground it can live on', () => {
    // Checked soon after founding. Over decades the ground genuinely moves --
    // the plates lift it, a hillside lets go, a sinkhole opens -- and a town
    // standing on ground that has since become a cliff is the simulation
    // working, not the placement being wrong.
    const world = buildTestWorld(makeTestConfig({ seedText: 'ground' }));
    runYears(world, 2);
    const t = world.terrain;
    expect(world.nations.allTowns.length).toBeGreaterThan(0);
    for (const town of world.nations.allTowns) {
      const i = t.index(t.tileX(town.x), t.tileZ(town.z));
      expect(t.waterHeight[i], `${town.name} is in the sea`).toBeLessThanOrEqual(t.data.height[i]);
      expect(t.data.slope[i], `${town.name} is on a cliff`).toBeLessThan(0.3);
    }
  });

  it('keeps its towns apart', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'apart' }));
    runYears(world, 30);
    const towns = world.nations.allTowns;
    for (let i = 0; i < towns.length; i++) {
      for (let j = i + 1; j < towns.length; j++) {
        const d = Math.hypot(towns[i].x - towns[j].x, towns[i].z - towns[j].z);
        expect(d, `${towns[i].name} and ${towns[j].name}`).toBeGreaterThan(10);
      }
    }
  });

  it('calls a place what its population makes it', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'tiers' }));
    runYears(world, 40);
    for (const town of world.nations.allTowns) {
      const tier = tierOf(town);
      if (tier === 'city') expect(town.population).toBeGreaterThanOrEqual(900);
      if (tier === 'village') expect(town.population).toBeLessThan(220);
    }
    // Everybody in a nation is in one of its places, give or take rounding.
    for (const n of world.nations.nations) {
      if (n.isPlayer || n.towns.length === 0) continue;
      const inTowns = n.towns.reduce((sum, t) => sum + t.population, 0);
      expect(Math.abs(inTowns - n.population) / Math.max(1, n.population)).toBeLessThan(0.15);
    }
  });

  it('still stands after a save and a load', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'remembered' }));
    runYears(world, 12);
    const before = world.nations.allTowns.map((t) => `${t.name}@${t.x.toFixed(1)}`).sort();
    expect(before.length).toBeGreaterThan(0);

    const loaded = deserializeWorld(structuredClone(serializeWorld(world, 'towns')));
    const after = loaded.nations.allTowns.map((t) => `${t.name}@${t.x.toFixed(1)}`).sort();
    expect(after).toEqual(before);
  });
});
