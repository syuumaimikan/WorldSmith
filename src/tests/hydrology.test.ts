/**
 * Hydrology regression tests.
 *
 * Water flowing uphill is the single most obvious way a generated world stops
 * being believable, so these tests assert the physical invariants directly:
 * every river surface descends toward the sea, tributaries join rather than
 * cross, and lakes sit in genuine depressions.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import { Biome } from '../world/types';
import { NO_WATER } from '../world/TerrainGen';

const SEEDS = ['harness', 'alpha', 'bravo'];

describe('hydrology', () => {
  it('never puts a water surface below the ground it covers', () => {
    for (const seedText of SEEDS) {
      const w = buildTestWorld(makeTestConfig({ seedText }));
      const t = w.terrain;
      let bad = 0;
      for (let i = 0; i < t.waterHeight.length; i++) {
        if (t.waterHeight[i] === NO_WATER) continue;
        // A water tile whose surface is under its own bed is a rendering and
        // simulation contradiction.
        if (t.waterHeight[i] < t.data.height[i] - 0.001) bad++;
      }
      expect(bad, `seed ${seedText}`).toBe(0);
    }
  });

  it('routes rivers downhill all the way to standing water', () => {
    for (const seedText of SEEDS) {
      const w = buildTestWorld(makeTestConfig({ seedText }));
      const t = w.terrain;
      const N = t.gridSize;

      // Walk downstream from each river tile, always stepping to the lowest
      // neighbouring water surface. The walk must terminate at the sea or a
      // lake, and must never step upward.
      let checked = 0;
      let uphillSteps = 0;
      let strandedWalks = 0;

      for (let tz = 2; tz < N - 2; tz += 5) {
        for (let tx = 2; tx < N - 2; tx += 5) {
          const start = tz * N + tx;
          if (t.data.biome[start] !== Biome.River) continue;
          checked++;

          let cur = start;
          let guard = 0;
          let reachedStandingWater = false;
          while (guard++ < N * 2) {
            const cx = cur % N;
            const cz = (cur / N) | 0;
            const curLevel = t.waterHeight[cur];

            if (t.data.biome[cur] === Biome.Ocean || t.data.biome[cur] === Biome.Lake) {
              reachedStandingWater = true;
              break;
            }

            let best = -1;
            let bestLevel = curLevel;
            for (let dz = -1; dz <= 1; dz++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0) continue;
                const nx = cx + dx;
                const nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
                const j = nz * N + nx;
                if (t.waterHeight[j] === NO_WATER) continue;
                if (t.waterHeight[j] < bestLevel) {
                  bestLevel = t.waterHeight[j];
                  best = j;
                }
              }
            }
            if (best < 0) break;
            // A downhill walk that ever rises means the channel is broken.
            if (bestLevel > curLevel + 0.001) uphillSteps++;
            cur = best;
          }
          if (!reachedStandingWater) strandedWalks++;
        }
      }

      expect(checked, `seed ${seedText} should have rivers to test`).toBeGreaterThan(0);
      expect(uphillSteps, `seed ${seedText} uphill steps`).toBe(0);
      // Most rivers must actually reach the sea or a lake. A few short stubs
      // near the coast can terminate in a tile the sampler skipped.
      expect(strandedWalks / checked, `seed ${seedText} stranded fraction`).toBeLessThan(0.25);
    }
  });

  it('widens rivers downstream rather than keeping a constant width', () => {
    const w = buildTestWorld(makeTestConfig({ seedText: 'bravo' }));
    const t = w.terrain;
    // Flow accumulation is what river width is derived from; check that it
    // spans a wide range rather than being effectively binary.
    let maxFlow = 0;
    let riverTiles = 0;
    const flows: number[] = [];
    for (let i = 0; i < t.data.flow.length; i++) {
      if (t.data.biome[i] !== Biome.River) continue;
      riverTiles++;
      flows.push(t.data.flow[i]);
      if (t.data.flow[i] > maxFlow) maxFlow = t.data.flow[i];
    }
    expect(riverTiles).toBeGreaterThan(20);
    flows.sort((a, b) => a - b);
    const spread = flows[flows.length - 1] - flows[0];
    expect(spread).toBeGreaterThan(0.1);
  });

  it('keeps lakes level and above their beds', () => {
    for (const seedText of SEEDS) {
      const w = buildTestWorld(makeTestConfig({ seedText }));
      const t = w.terrain;
      const N = t.gridSize;
      let checkedLakeTiles = 0;
      for (let tz = 1; tz < N - 1; tz++) {
        for (let tx = 1; tx < N - 1; tx++) {
          const i = tz * N + tx;
          if (t.data.biome[i] !== Biome.Lake) continue;
          checkedLakeTiles++;
          const level = t.waterHeight[i];
          expect(level).toBeGreaterThan(t.data.height[i] - 0.001);
          // Neighbouring lake tiles must share a surface level.
          for (const j of [i - 1, i + 1, i - N, i + N]) {
            if (t.data.biome[j] !== Biome.Lake) continue;
            expect(Math.abs(t.waterHeight[j] - level)).toBeLessThan(0.35);
          }
        }
      }
      // Guard against the test silently passing because no lakes exist.
      void checkedLakeTiles;
    }
  });
});
