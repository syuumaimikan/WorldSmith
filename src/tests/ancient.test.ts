/**
 * The Ancient World.
 *
 * The new-world screen offers a world where centuries of history have already
 * happened. The line held here is that it means what it says: the same systems
 * that run during play are what produced that past, so the borders, the
 * faiths, the rulers and the chronicle are all outcomes rather than flavour
 * text — and the settlers themselves are still brand new, arriving into it
 * with nothing.
 */

import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../world/TerrainGen';
import { populateWorld } from '../world/WorldPopulate';
import { Terrain } from '../world/Terrain';
import { TerrainData, WorldConfig } from '../world/types';
import { World } from '../sim/World';
import { ANCIENT_YEARS, preSimulate } from '../sim/Presimulate';
import { DAYS_PER_YEAR } from '../sim/Time';
import { makeTestConfig } from './harness';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SaveData, validate } from '../persistence/schema';

/**
 * Builds a world the way the loader does, with the pre-simulation in the
 * middle: neighbours first, then the centuries, then the settlers.
 */
function buildAncientWorld(config: WorldConfig, years = ANCIENT_YEARS): World {
  const noop = (): void => undefined;
  const { terrain: data, waterHeight } = generateTerrain(config, noop);
  const populated = populateWorld(config, data, waterHeight, noop);
  const terrain = new Terrain(data as TerrainData, waterHeight);
  const world = new World(
    config,
    terrain,
    populated.nodes,
    populated.veins,
    populated.pois,
    populated.startX,
    populated.startZ,
  );
  world.seedNeighbours(true);
  preSimulate(world, years);
  world.settle();
  return world;
}

const ancientConfig = (seedText = 'ancient'): WorldConfig =>
  makeTestConfig({ seedText, era: 'ancient' });

describe('a world that was already here', () => {
  it('arrives at the year it claims to have lived through', () => {
    const world = buildAncientWorld(ancientConfig());
    const year = world.time.snapshot().year;
    expect(year).toBeGreaterThan(ANCIENT_YEARS * 0.9);
    expect(world.settlement.foundedDay).toBeGreaterThan(DAYS_PER_YEAR * 200);
  });

  it('has a past made of things that happened rather than things written down', () => {
    const world = buildAncientWorld(ancientConfig());
    const h = world.history;
    expect(h.ages.length).toBeGreaterThan(1);
    expect(h.annals.length).toBeGreaterThan(20);
    expect(h.snapshots.length).toBeGreaterThan(10);
    // The founding of the player's settlement is the newest thing in it, not
    // the oldest: everything else already happened.
    const founding = h.annals.filter((a) => a.key === 'ev.founded');
    expect(founding.length).toBe(1);
    expect(founding[0].day).toBeGreaterThan(h.annals[0].day);
  });

  it('leaves borders where the centuries actually left them', () => {
    const world = buildAncientWorld(ancientConfig());
    const first = world.history.snapshots[0];
    const last = world.history.snapshots[world.history.snapshots.length - 1];
    let moved = 0;
    for (let i = 0; i < first.claims.length; i++) {
      if (first.claims[i] !== last.claims[i]) moved++;
    }
    expect(moved).toBeGreaterThan(20);
  });

  it('has rulers who came after other rulers', () => {
    const world = buildAncientWorld(ancientConfig());
    const foreign = world.nations.nations.filter((n) => !n.isPlayer);
    expect(foreign.length).toBeGreaterThan(1);
    // Nobody rules for three hundred years.
    for (const n of foreign) {
      expect(n.leader.since, n.name).toBeGreaterThan(0);
    }
    expect(foreign.some((n) => n.regimeChanges > 0 || n.leader.cameBy !== 'founding')).toBe(true);
  });

  it('has faiths that travelled, and peoples whose values moved', () => {
    const world = buildAncientWorld(ancientConfig());
    const c = world.culture;
    expect(c.religions.length).toBeGreaterThan(1);
    // Somebody keeps a faith that began somewhere else, or a sect of one.
    const travelled = c.religions.some(
      (r) => r.schismOf !== 0 || [...r.followers.values()].filter((v) => v > 0.05).length > 1,
    );
    expect(travelled).toBe(true);
    for (const n of world.nations.nations) {
      expect(c.cultureFor(n.id), n.name).not.toBeNull();
      expect(c.faithFor(n.id), n.name).not.toBeNull();
    }
  });

  it('still gives the player nothing but settlers and what they carried', () => {
    const config = ancientConfig();
    const world = buildAncientWorld(config);
    expect(world.npcs.length).toBe(config.startingSettlers);
    expect(world.buildings.length).toBe(0);
    const mine = world.nations.playerNation!;
    expect(mine).not.toBeNull();
    expect(mine.foundedDay).toBeCloseTo(world.time.totalDays, 2);
    // The settlers stand on ground somebody may already call theirs, and they
    // hold it, so the nation is a nation and not a name with no land.
    expect(mine.territory).toBeGreaterThan(0);
  });

  it('keeps every number in a sane range after three centuries unattended', () => {
    for (const seedText of ['one', 'two', 'three']) {
      const world = buildAncientWorld(ancientConfig(seedText));
      expect(world.nations.nations.length).toBeGreaterThan(1);
      for (const n of world.nations.nations) {
        expect(Number.isFinite(n.population), n.name).toBe(true);
        expect(n.population).toBeGreaterThan(0);
        expect(n.unrest).toBeGreaterThanOrEqual(0);
        expect(n.unrest).toBeLessThanOrEqual(1);
        expect(n.legitimacy).toBeGreaterThanOrEqual(0);
        expect(n.legitimacy).toBeLessThanOrEqual(1);
        expect(n.taxRate).toBeLessThanOrEqual(0.6);
        expect(n.territory).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(n.treasury)).toBe(true);
      }
      for (const r of world.culture.religions) {
        for (const hold of r.followers.values()) {
          expect(hold).toBeGreaterThanOrEqual(0);
          expect(hold).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('does not leave a claim belonging to a nation that no longer exists', () => {
    const world = buildAncientWorld(ancientConfig('orphans'));
    const live = new Set(world.nations.nations.map((n) => n.id));
    for (const id of world.nations.claims) {
      if (id === 0) continue;
      expect(live.has(id)).toBe(true);
    }
  });

  it('saves and loads like any other world', () => {
    const world = buildAncientWorld(ancientConfig());
    const cloned = structuredClone(serializeWorld(world, 'test')) as SaveData &
      Record<string, unknown>;
    const migrated = migrate(cloned);
    expect(validate(migrated)).toBeNull();
    const loaded = deserializeWorld(migrated);
    expect(loaded.time.snapshot().year).toBe(world.time.snapshot().year);
    expect(loaded.history.ages.length).toBe(world.history.ages.length);
    expect(loaded.nations.nations.length).toBe(world.nations.nations.length);
  });
});

describe('a fresh world', () => {
  it('is still fresh', () => {
    const noop = (): void => undefined;
    const config = makeTestConfig({ seedText: 'fresh' });
    const { terrain: data, waterHeight } = generateTerrain(config, noop);
    const populated = populateWorld(config, data, waterHeight, noop);
    const world = new World(
      config,
      new Terrain(data as TerrainData, waterHeight),
      populated.nodes,
      populated.veins,
      populated.pois,
      populated.startX,
      populated.startZ,
    );
    world.bootstrap();

    expect(world.time.snapshot().year).toBe(1);
    expect(world.history.ages.length).toBe(0);
    for (const n of world.nations.nations) expect(n.regimeChanges).toBe(0);
  });
});
