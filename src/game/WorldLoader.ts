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
  GameMode,
} from '../world/types';
import { eraProfile } from '../world/eras';
import type { WorldGenMessage, WorldGenPayload } from '../world/worldgenTypes';
import { World } from '../sim/World';
import { preSimulate, strideFor } from '../sim/Presimulate';
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
  mode: GameMode;
  playerName: string;
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
    mode: options.mode,
    playerName: options.playerName.trim().slice(0, 32) || 'Wayfarer',
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

  // The other peoples of the world go in first, because a world with a past
  // has to have somebody to spend that past on.
  const era = eraProfile(config.era);
  world.seedNeighbours(era.peoples);
  // They begin knowing what their age knows, rather than scraping flints and
  // racing through four eras during the loading screen.
  world.technology.seedKnowledge(world, era.startingKnowledge);
  if (era.presimYears > 0) {
    await liveOutTheAges(world, era.presimYears, onProgress);
    // Those centuries carried everybody a long way past where they started.
    // An age is a statement about where the world is *now*, so what the
    // history produced is rescaled to land on it -- keeping who got ahead.
    world.technology.settleIntoEra(world, era.startingKnowledge);
  }

  // And so do you. Being born into a kingdom means not having to invent rope.
  world.research.seedCommonKnowledge(era.commonKnowledge);

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
  years: number,
  onProgress?: (p: GenerationProgress) => void,
): Promise<void> {
  const slices = 20;
  // The stride comes from the whole run, not from one twentieth of it.
  const stride = strideFor(years);
  for (let i = 0; i < slices; i++) {
    preSimulate(world, years / slices, undefined, stride);
    onProgress?.({
      stage: 'gen.prehistory',
      fraction: (i + 1) / slices,
      params: { year: world.time.snapshot().year },
    });
    await new Promise((r) => setTimeout(r, 0));
  }
}
