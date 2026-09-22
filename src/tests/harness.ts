/**
 * Headless world harness.
 *
 * Runs the real generator and the real simulation with no renderer attached,
 * which is what makes the acceptance tests meaningful: they exercise the same
 * code the game runs, not a stand-in.
 */

import { generateTerrain } from '../world/TerrainGen';
import { SECONDS_PER_GAME_HOUR } from '../sim/Time';
import { populateWorld } from '../world/WorldPopulate';
import { Terrain, OVERLAY } from '../world/Terrain';
import { TerrainData, WorldConfig } from '../world/types';
import { World } from '../sim/World';
import { hashString } from '../core/rng';
import { BuildingId } from '../data/buildings';
import { Building } from '../sim/Building';

export const TICK = 1 / 15;

export function makeTestConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  const seedText = overrides.seedText ?? 'harness';
  return {
    name: 'Testholt',
    seedText,
    seed: hashString(seedText),
    size: 'small',
    gridSize: 384,
    tileSize: 2,
    climate: 'temperate',
    resourceDensity: 1,
    startingSettlers: 6,
    difficulty: 'normal',
    era: 'fresh',
    ...overrides,
  };
}

export function buildTestWorld(config = makeTestConfig()): World {
  const noop = (): void => undefined;
  const { terrain: data, waterHeight } = generateTerrain(config, noop);
  const populated = populateWorld(config, data, waterHeight, noop);

  const terrainData: TerrainData = data as TerrainData;
  const terrain = new Terrain(terrainData, waterHeight);
  for (let i = 0; i < populated.oldRoadTiles.length; i++) {
    terrain.overlay[populated.oldRoadTiles[i]] |= OVERLAY.Path;
  }

  const world = new World(
    config,
    terrain,
    populated.nodes,
    populated.veins,
    populated.pois,
    populated.startX,
    populated.startZ,
  );
  world.bootstrap();
  return world;
}

/** Runs `seconds` of simulated time. */
export function run(world: World, seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) world.simulate(TICK);
}

/**
 * Runs `days` of weather and nothing else.
 *
 * The atmosphere is the same code the game runs, but skipping the people,
 * jobs and crops makes a century of climate cheap enough to assert on.
 */
export function runAir(world: World, days: number): void {
  const STEP = 0.25; // game hours, matching the world's own cadence
  const steps = Math.round((days * 24) / STEP);
  for (let i = 0; i < steps; i++) {
    world.time.advance(STEP * SECONDS_PER_GAME_HOUR);
    world.stepAtmosphere(STEP);
    world.weather.driveFrom(world.climate, world.player.position.x, world.player.position.z, STEP);
  }
}

/**
 * Runs `days` of geology and nothing else.
 *
 * Plates move on their own clock and do not care what the weather is doing,
 * so an age of drift costs almost nothing to simulate this way.
 */
export function runRock(world: World, days: number): void {
  const STEP_DAYS = 30;
  let left = days;
  while (left > 0) {
    const step = Math.min(STEP_DAYS, left);
    world.time.advance(step * 24 * SECONDS_PER_GAME_HOUR);
    world.tectonics.update(world, step * 24);
    left -= step;
  }
}

/** Finds the first legal placement for a building near a point. */
export function placeNear(
  world: World,
  id: BuildingId,
  x: number,
  z: number,
  maxRadius = 60,
): Building | null {
  const t = world.terrain;
  for (let r = 0; r <= maxRadius; r += 2) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r));
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      const tx = t.tileX(x + Math.cos(ang) * r);
      const tz = t.tileZ(z + Math.sin(ang) * r);
      if (world.canPlace(id, tx, tz, 0).ok) {
        return world.placeBuilding(id, tx, tz, 0);
      }
    }
  }
  return null;
}

/** Slope statistics over dry land, used to sanity-check terrain shaping. */
export function landSlopeStats(world: World): { median: number; p90: number; buildableFraction: number } {
  const t = world.terrain;
  const vals: number[] = [];
  let buildable = 0;
  let land = 0;
  for (let i = 0; i < t.data.slope.length; i += 3) {
    if (t.waterHeight[i] > t.data.height[i]) continue;
    if (t.data.height[i] < 1) continue;
    land++;
    vals.push(t.data.slope[i]);
    if (t.data.slope[i] < 0.2) buildable++;
  }
  vals.sort((a, b) => a - b);
  return {
    median: vals[Math.floor(vals.length * 0.5)] ?? 0,
    p90: vals[Math.floor(vals.length * 0.9)] ?? 0,
    buildableFraction: land > 0 ? buildable / land : 0,
  };
}
