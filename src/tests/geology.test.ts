/**
 * What the ground is made of.
 *
 * The claim defended here is that a deposit is where it is because of
 * something that happened to the rock, not because a die came up. Copper and
 * gold ride the heat over a descending slab, tin sits in granite, coal is a
 * drowned swamp and salt is a dried-out basin -- and a world where the rock
 * happens to hold none of the three metals the whole technological line runs
 * through still gets some, because otherwise bronze is unreachable and the
 * player never finds out why.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import { readGeology, Rock } from '../world/Geology';
import { generateTerrain } from '../world/TerrainGen';

const SEEDS = ['harness', 'alpha', 'bravo', 'charlie'];

describe('the rock under the world', () => {
  it('is not all one thing', () => {
    for (const seedText of SEEDS) {
      const config = makeTestConfig({ seedText });
      const { terrain, waterHeight } = generateTerrain(config, () => undefined);
      const geology = readGeology(config, terrain, waterHeight);
      const kinds = new Set<number>();
      for (let i = 0; i < geology.rock.length; i += 11) kinds.add(geology.rock[i]);
      expect(kinds.size, `seed ${seedText}`).toBeGreaterThan(2);
    }
  });

  it('only finds caves where there is rock that dissolves', () => {
    const config = makeTestConfig({ seedText: 'karst' });
    const { terrain, waterHeight } = generateTerrain(config, () => undefined);
    const geology = readGeology(config, terrain, waterHeight);
    for (let i = 0; i < geology.karst.length; i++) {
      if (geology.karst[i] <= 0) continue;
      expect(geology.rock[i]).toBe(Rock.Limestone);
      // And above the water, because a cave under the sea is not a cave.
      expect(waterHeight[i]).toBeLessThanOrEqual(terrain.height[i]);
    }
  });
});

describe('what is in it', () => {
  it('puts coal in drowned swamps and salt in dry basins, or nowhere', () => {
    for (const seedText of SEEDS) {
      const world = buildTestWorld(makeTestConfig({ seedText }));
      const t = world.terrain;
      for (const v of world.veins) {
        const i = t.index(t.tileX(v.x), t.tileZ(v.z));
        if (v.kind === 'coal') {
          expect(t.data.height[i], `coal at ${v.x},${v.z}`).toBeLessThanOrEqual(60);
          expect(t.data.moisture[i]).toBeGreaterThanOrEqual(0.4);
        }
        if (v.kind === 'salt') {
          expect(t.data.moisture[i], `salt at ${v.x},${v.z}`).toBeLessThanOrEqual(0.34);
        }
      }
    }
  });

  it('gives every world the three metals the tech line runs through', () => {
    for (const seedText of SEEDS) {
      const world = buildTestWorld(makeTestConfig({ seedText }));
      for (const needed of ['iron', 'copper', 'tin'] as const) {
        const veins = world.veins.filter((v) => v.kind === needed).length;
        expect(veins, `${seedText} has no ${needed}`).toBeGreaterThan(0);
        const nodes = world.nodes.filter(
          (n) =>
            n.kind === `${needed === 'iron' ? 'iron' : needed}_outcrop` ||
            (needed === 'tin' && n.kind === 'tin_outcrop'),
        ).length;
        expect(nodes, `${seedText} has no ${needed} to dig`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves something of every kind of rock to find', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'alpha' }));
    const kinds = new Set(world.nodes.map((n) => n.kind));
    // More than the four things the old table could produce.
    const minerals = [...kinds].filter((k) =>
      ['iron_outcrop', 'copper_outcrop', 'tin_outcrop', 'coal_seam', 'clay_pit', 'gold_vein',
       'silver_vein', 'salt_flat', 'obsidian_flow', 'limestone_outcrop', 'flint_nodule'].includes(k),
    );
    expect(minerals.length).toBeGreaterThan(5);
  });
});
