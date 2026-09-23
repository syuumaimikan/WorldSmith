/** Shared world-layer types. Kept dependency-free so workers can import them. */

import type { WorldEra } from './eras';
import type { GameMode } from './modes';

export enum Biome {
  Ocean = 0,
  Lake = 1,
  Beach = 2,
  Grassland = 3,
  TemperateForest = 4,
  DenseForest = 5,
  Taiga = 6,
  Tundra = 7,
  Desert = 8,
  Savanna = 9,
  Wetland = 10,
  Mountain = 11,
  Alpine = 12,
  River = 13,
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Lake]: 'Lake',
  [Biome.Beach]: 'Coast',
  [Biome.Grassland]: 'Grassland',
  [Biome.TemperateForest]: 'Temperate Forest',
  [Biome.DenseForest]: 'Dense Forest',
  [Biome.Taiga]: 'Taiga',
  [Biome.Tundra]: 'Tundra',
  [Biome.Desert]: 'Desert',
  [Biome.Savanna]: 'Savanna',
  [Biome.Wetland]: 'Wetland',
  [Biome.Mountain]: 'Mountain',
  [Biome.Alpine]: 'Alpine',
  [Biome.River]: 'River',
};

export function isWaterBiome(b: Biome): boolean {
  return b === Biome.Ocean || b === Biome.Lake || b === Biome.River;
}

export type ClimatePreset = 'temperate' | 'cold' | 'warm' | 'arid';
export type WorldSizePreset = 'small' | 'medium' | 'large';
export type Difficulty = 'relaxed' | 'normal' | 'harsh';
// The world's age, and the rules you are playing under. Both are decided at
// generation and both live in the config from then on; see `eras.ts` and
// `modes.ts` for what each one means.
export type { WorldEra, GameMode };

export interface WorldConfig {
  name: string;
  seedText: string;
  seed: number;
  size: WorldSizePreset;
  /** Tiles per side. */
  gridSize: number;
  /** Metres per tile. */
  tileSize: number;
  climate: ClimatePreset;
  /** Multiplier on ore/forest density, 0.6 – 1.6. */
  resourceDensity: number;
  startingSettlers: number;
  difficulty: Difficulty;
  era: WorldEra;
  mode: GameMode;
  /** What the person playing is called. Theirs to choose, and theirs alone. */
  playerName: string;
}

/**
 * Tiles per side. A world has to be big enough to hold more than one country
 * and an ocean between them; at the old sizes a "continent" was four minutes'
 * walk across. Terrain meshes are chunked and levelled by distance, so the
 * cost of the extra ground is paid in generation time rather than in frames.
 */
export const WORLD_SIZE_TILES: Record<WorldSizePreset, number> = {
  small: 640,
  medium: 1024,
  large: 1440,
};

/**
 * Metres per tile.
 *
 * Raised from two to three along with the grid sizes above, which together
 * take a large world from two kilometres across to four and a bit -- four and
 * a half times the ground for twice the tiles. Two metres was finer than
 * anything in the world needed: the terrain's own detail is generated at
 * metre-relative frequencies, so a three-metre sample still catches every
 * shape that is there, and the extra kilometre is worth more than the extra
 * sample.
 */
export const TILE_SIZE = 3;

/** Heightmap + climate + biome layers. All arrays are gridSize*gridSize. */
export interface TerrainData {
  gridSize: number;
  tileSize: number;
  /** Metres above sea level; may be negative for seabed. */
  height: Float32Array;
  moisture: Float32Array;
  /** Degrees celsius, annual mean at that tile. */
  temperature: Float32Array;
  biome: Uint8Array;
  /** Normalised river flow accumulation, 0..1. */
  flow: Float32Array;
  /** Steepness in radians, precomputed for placement rules. */
  slope: Float32Array;
  /** Fertility 0..1 for farm placement. */
  fertility: Float32Array;
  seaLevel: number;
  minHeight: number;
  maxHeight: number;
}

export interface OreVein {
  x: number;
  z: number;
  radius: number;
  kind:
    | 'iron'
    | 'copper'
    | 'tin'
    | 'coal'
    | 'stone'
    | 'clay'
    | 'gold'
    | 'silver'
    | 'salt'
    | 'obsidian'
    | 'limestone'
    | 'flint';
  richness: number;
}

export interface PointOfInterest {
  id: number;
  kind: 'ruin' | 'cave' | 'tower' | 'camp' | 'grove' | 'monolith' | 'shipwreck';
  x: number;
  z: number;
  name: string;
  lore: string;
  discovered: boolean;
}
