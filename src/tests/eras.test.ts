/**
 * The world's own timeline.
 *
 * Choosing an age is choosing where on it you arrive, and what changes has to
 * change for a reason that is in the world: there is no grass in the
 * primordial world because grass had not evolved, and there are kingdoms in
 * the medieval one because three centuries of the same simulation the game
 * runs put them there.
 */

import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../world/TerrainGen';
import { populateWorld } from '../world/WorldPopulate';
import { Terrain } from '../world/Terrain';
import { World } from '../sim/World';
import { preSimulate } from '../sim/Presimulate';
import { eraProfile, readEra, WORLD_ERAS } from '../world/eras';
import { readMode, modeRules } from '../world/modes';
import { RESEARCH } from '../data/research';
import { ANIMALS, speciesForBiome } from '../sim/Wildlife';
import { Biome, TerrainData, WorldConfig } from '../world/types';
import { makeTestConfig } from './harness';

const noop = (): void => undefined;

function worldOfAge(config: WorldConfig): World {
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
  const era = eraProfile(config.era);
  world.seedNeighbours(era.peoples);
  world.technology.seedKnowledge(world, era.startingKnowledge);
  // The pre-simulation is the expensive part and is covered by its own
  // tests; a token slice is enough to show the machinery is connected.
  if (era.presimYears > 0) preSimulate(world, 8);
  world.research.seedCommonKnowledge(era.commonKnowledge);
  world.settle();
  return world;
}

describe('the world before flowers', () => {
  it('has no grasses, no blossom and no broadleaf trees anywhere in it', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'primeval', era: 'primordial' }));
    const banned = new Set(['oak', 'beech', 'maple', 'wildflowers', 'wild_wheat', 'berry_bush']);
    const found = new Set(world.nodes.map((n) => n.kind));
    for (const kind of banned) expect(found.has(kind as never)).toBe(false);
  });

  it('grows the plants that were actually there instead', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'primeval-2', era: 'primordial' }));
    const found = new Set(world.nodes.map((n) => n.kind));
    const old = ['clubmoss_tree', 'tree_fern', 'horsetail', 'moss_mat', 'seed_fern'];
    expect(old.some((k) => found.has(k as never))).toBe(true);
  });

  it('has nobody in it, because nobody has arrived', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'primeval-3', era: 'primordial' }));
    expect(world.nations.nations.filter((n) => !n.isPlayer).length).toBe(0);
  });

  it('puts no mammal in it that would not evolve for another age', () => {
    const primeval = speciesForBiome(Biome.Wetland, 'primeval');
    for (const s of primeval) expect(ANIMALS[s].life).toContain('primeval');
    expect(primeval).not.toContain('deer');
  });
});

describe('the great beasts', () => {
  it('are in the ages they were alive for, and gone from the ones after', () => {
    expect(speciesForBiome(Biome.Tundra, 'settled')).toContain('mammoth');
    expect(speciesForBiome(Biome.Tundra, 'late')).not.toContain('mammoth');
    expect(speciesForBiome(Biome.Grassland, 'settled')).toContain('aurochs');
    expect(speciesForBiome(Biome.Grassland, 'late')).not.toContain('aurochs');
  });
});

describe('arriving late', () => {
  it('finds kingdoms already standing rather than empty land', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'medieval', era: 'medieval' }));
    const others = world.nations.nations.filter((n) => !n.isPlayer);
    expect(others.length).toBeGreaterThan(2);
    expect(world.nations.allTowns.length).toBeGreaterThan(2);
  });

  it('makes the player a subject of one of them, not the founder of a new one', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'medieval-2', era: 'medieval' }));
    expect(world.nations.nations.some((n) => n.isPlayerHome)).toBe(true);
    // And the settlement they live in is on that nation's books.
    const home = world.nations.nations.find((n) => n.isPlayerHome)!;
    expect(home.towns.length).toBeGreaterThan(0);
  });

  it('lets them start knowing what their age knows', () => {
    const early = worldOfAge(makeTestConfig({ seedText: 'k1', era: 'prehistory' }));
    const late = worldOfAge(makeTestConfig({ seedText: 'k1', era: 'medieval' }));
    expect(late.research.unlocked.size).toBeGreaterThan(early.research.unlocked.size);
  });

  it('never unlocks a topic whose prerequisites are missing', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'k2', era: 'modern' }));
    for (const id of world.research.unlocked) {
      for (const req of RESEARCH[id].requires) {
        expect(world.research.unlocked.has(req)).toBe(true);
      }
    }
  });

  it('has neighbours who already know more than a stone-age band', () => {
    const world = worldOfAge(makeTestConfig({ seedText: 'k3', era: 'industrial' }));
    const other = world.nations.nations.find((n) => !n.isPlayer)!;
    expect(world.technology.eraOf(world, other).id).not.toBe('stone');
  });
});

describe('what a save is allowed to claim', () => {
  it('translates the two ages a world used to be able to have', () => {
    expect(readEra('fresh')).toBe('prehistory');
    expect(readEra('ancient')).toBe('ancient');
  });

  it('refuses anything it does not recognise rather than believing it', () => {
    expect(WORLD_ERAS).toContain(readEra('__proto__'));
    expect(WORLD_ERAS).toContain(readEra(undefined));
    expect(readMode('hardcore')).toBe('hardcore');
    expect(readMode('invincible')).toBe('survival');
  });

  it('keeps hardcore hardcore', () => {
    expect(modeRules('hardcore').permadeath).toBe(true);
    expect(modeRules('survival').permadeath).toBe(false);
    expect(modeRules('creative').mortal).toBe(false);
  });
});
