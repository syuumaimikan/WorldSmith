/**
 * Drives the generation worker and assembles a playable World from its output.
 */

import { Terrain, OVERLAY } from '../world/Terrain';
import {
  TerrainData,
  WorldConfig,
  WORLD_SIZE_TILES,
  TILE_SIZE,
  ClimatePreset,
  WorldSizePreset,
  Difficulty,
  WorldEra,
} from '../world/types';
import type { WorldGenMessage, WorldGenPayload } from '../world/worldgenTypes';
import { World } from '../sim/World';
import { ANCIENT_YEARS, preSimulate } from '../sim/Presimulate';
import { hashString } from '../core/rng';

export interface GenerationProgress {
  /** A translation key, so the loading screen reads in the player's language. */
  stage: string;
  fraction: number;
  /** Substituted into `stage`, for stages that count something. */
  params?: Record<string, string | number>;
}

export interface NewWorldOptions {
  name: string;
  seedText: string;
  size: WorldSizePreset;
  climate: ClimatePreset;
  resourceDensity: number;
  startingSettlers: number;
  difficulty: Difficulty;
  era: WorldEra;
}

export function makeConfig(options: NewWorldOptions): WorldConfig {
  const seedText = options.seedText.trim() || Math.floor(Math.random() * 1e9).toString(36);
  return {
    name: options.name.trim() || 'Newholt',
    seedText,
    seed: hashString(seedText),
    size: options.size,
    gridSize: WORLD_SIZE_TILES[options.size],
    tileSize: TILE_SIZE,
    climate: options.climate,
    resourceDensity: options.resourceDensity,
    startingSettlers: options.startingSettlers,
    difficulty: options.difficulty,
    era: options.era,
  };
}

export function generate(
  config: WorldConfig,
  onProgress: (p: GenerationProgress) => void,
): Promise<WorldGenPayload> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../world/worldgen.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<WorldGenMessage>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        onProgress({ stage: msg.stage, fraction: msg.fraction });
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.payload);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`World generation failed: ${e.message}`));
    };
    worker.postMessage({ config });
  });
}

export async function assembleWorld(
  config: WorldConfig,
  payload: WorldGenPayload,
  onProgress?: (p: GenerationProgress) => void,
): Promise<World> {
  const data: TerrainData = {
    gridSize: payload.gridSize,
    tileSize: payload.tileSize,
    height: payload.height,
    moisture: payload.moisture,
    temperature: payload.temperature,
    biome: payload.biome,
    flow: payload.flow,
    slope: payload.slope,
    fertility: payload.fertility,
    seaLevel: payload.seaLevel,
    minHeight: payload.minHeight,
    maxHeight: payload.maxHeight,
  };
  const terrain = new Terrain(data, payload.waterHeight);

  // Ancient paths left by whoever was here before.
  for (let i = 0; i < payload.oldRoadTiles.length; i++) {
    const idx = payload.oldRoadTiles[i];
    terrain.overlay[idx] |= OVERLAY.Path;
    terrain.traffic[idx] = 90;
  }

  const world = new World(
    config,
    terrain,
    payload.nodes,
    payload.veins,
    payload.pois,
    payload.startX,
    payload.startZ,
  );

  for (const line of payload.historyLines) world.log.addHistory(line);

  // The other peoples of the world go in first, because an ancient world has
  // to have somebody to spend its centuries on.
  const ancient = config.era === 'ancient';
  world.seedNeighbours(ancient);
  if (ancient) await liveOutTheAges(world, onProgress);

  // Settlers, wildlife and starting supplies only exist for a brand new world;
  // a loaded save brings its own.
  world.settle();
  return world;
}

/**
 * Runs the pre-simulation in slices, handing the thread back between them so
 * the loading screen can show the centuries actually going by rather than
 * freezing on one frame for the duration.
 */
async function liveOutTheAges(
  world: World,
  onProgress?: (p: GenerationProgress) => void,
): Promise<void> {
  const slices = 20;
  for (let i = 0; i < slices; i++) {
    preSimulate(world, ANCIENT_YEARS / slices);
    onProgress?.({
      stage: 'gen.prehistory',
      fraction: (i + 1) / slices,
      params: { year: world.time.snapshot().year },
    });
    await new Promise((r) => setTimeout(r, 0));
  }
}
