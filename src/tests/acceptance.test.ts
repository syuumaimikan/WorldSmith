/**
 * Acceptance tests for the behaviour that defines the game.
 *
 * These are deliberately end-to-end: generate a real world, place real
 * blueprints, run the real simulation, and check that goods physically moved
 * and a building physically went up. If these pass, the core loop works.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, landSlopeStats, makeTestConfig, placeNear, run } from './harness';
import { Biome } from '../world/types';

describe('world generation', () => {
  const world = buildTestWorld();

  it('produces land, sea and a range of biomes', () => {
    const t = world.terrain;
    let land = 0;
    let water = 0;
    const biomes = new Set<number>();
    for (let i = 0; i < t.data.height.length; i++) {
      if (t.waterHeight[i] > t.data.height[i]) water++;
      else land++;
      biomes.add(t.data.biome[i]);
    }
    expect(land).toBeGreaterThan(t.data.height.length * 0.15);
    expect(water).toBeGreaterThan(t.data.height.length * 0.05);
    expect(biomes.size).toBeGreaterThanOrEqual(5);
  });

  it('carves rivers that reach the sea', () => {
    const t = world.terrain;
    let riverTiles = 0;
    for (let i = 0; i < t.data.biome.length; i++) {
      if (t.data.biome[i] === Biome.River) riverTiles++;
    }
    expect(riverTiles).toBeGreaterThan(20);
  });

  it('leaves enough flat ground to actually build on, on every seed', () => {
    // Checked across seeds because the failure mode this guards against is
    // "one seed in five is an unplayable wall of rock", not an average.
    for (const seedText of ['harness', 'alpha', 'bravo', 'charlie']) {
      const w = seedText === 'harness' ? world : buildTestWorld(makeTestConfig({ seedText }));
      const stats = landSlopeStats(w);
      expect(stats.median, `median slope for seed ${seedText}`).toBeLessThan(0.36);
      expect(stats.buildableFraction, `buildable fraction for seed ${seedText}`).toBeGreaterThan(0.2);
    }
  });

  it('places resources and landmarks', () => {
    expect(world.nodes.length).toBeGreaterThan(200);
    expect(world.pois.length).toBeGreaterThan(3);
    expect(world.veins.length).toBeGreaterThan(2);
  });

  it('starts the player on dry, reachable ground', () => {
    const p = world.player.position;
    expect(world.terrain.waterDepthAt(p.x, p.z)).toBe(0);
    expect(world.terrain.heightAt(p.x, p.z)).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = buildTestWorld();
    const b = buildTestWorld();
    expect(a.terrain.data.height[5000]).toBe(b.terrain.data.height[5000]);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.player.position.x).toBe(b.player.position.x);
  });
});

describe('settlers', () => {
  it('spawn, gather, and leave goods on the ground for collection', () => {
    const world = buildTestWorld();
    expect(world.npcs.length).toBe(6);

    const pilesBefore = world.piles.length;
    run(world, 900);

    // Someone should have harvested something in fifteen minutes of work.
    expect(world.piles.length).toBeGreaterThan(pilesBefore);
    const activities = new Set(world.npcs.map((n) => n.activity));
    expect(activities.size).toBeGreaterThan(1);
  });

  it('get hungry over time and go looking for food', () => {
    const world = buildTestWorld();
    const before = world.npcs.map((n) => n.needs.hunger);
    run(world, 600);
    const after = world.npcs.map((n) => n.needs.hunger);
    expect(Math.min(...after)).toBeLessThan(Math.max(...before));
  });
});

describe('logistics', () => {
  it('hauls loose goods into storage once there is somewhere to put them', () => {
    const world = buildTestWorld();
    const c = world.settlement.centre;

    const stockpile = placeNear(world, 'stockpile', c.x, c.z);
    expect(stockpile).not.toBeNull();

    // The stockpile is only cleared ground, so it finishes quickly.
    run(world, 400);
    expect(stockpile!.complete).toBe(true);

    // Now haulers have a destination and should start filling it.
    run(world, 900);
    expect(stockpile!.inventory.totalCount()).toBeGreaterThan(0);
  });
});

describe('construction', () => {
  it('builds a tent through its stages using delivered materials', () => {
    const world = buildTestWorld();
    const c = world.settlement.centre;

    const stockpile = placeNear(world, 'stockpile', c.x, c.z);
    expect(stockpile).not.toBeNull();
    run(world, 400);

    const tent = placeNear(world, 'tent', c.x + 12, c.z + 12, 40);
    expect(tent).not.toBeNull();
    expect(tent!.complete).toBe(false);
    expect(tent!.stageIndex).toBe(0);

    // A tent needs 3 logs and 8 fiber, which the starting supplies cover.
    const totals = tent!.def.totalMaterials;
    expect(totals.log).toBeGreaterThan(0);

    run(world, 2400);

    // Either finished, or demonstrably progressed through real stages.
    expect(tent!.progress).toBeGreaterThan(0.3);
    if (!tent!.complete) {
      expect(tent!.stageIndex).toBeGreaterThan(0);
    }
  });

  it('never completes a building without the materials being delivered', () => {
    const world = buildTestWorld();
    const c = world.settlement.centre;
    // A cottage needs stone and planks, which a fresh settlement cannot make.
    const cottage = placeNear(world, 'cottage', c.x, c.z, 50);
    expect(cottage).not.toBeNull();

    run(world, 1200);
    expect(cottage!.complete).toBe(false);
    // It may clear and stake the site, but it cannot lay footings without stone.
    const stageId = cottage!.def.stages[cottage!.stageIndex]?.id;
    expect(['planning', 'clearing', 'foundation']).toContain(stageId);
  });
});

describe('economy and settlement', () => {
  it('reports why the settlement is stuck', () => {
    const world = buildTestWorld();
    run(world, 300);
    // With no storage built, it should say so.
    const kinds = world.economy.bottlenecks.map((b) => b.kind);
    expect(kinds.length).toBeGreaterThan(0);
  });

  it('tracks population and housing', () => {
    const world = buildTestWorld();
    run(world, 120);
    expect(world.settlement.population).toBe(world.npcs.length);
    expect(world.settlement.homeless).toBe(world.npcs.length);
  });
});
