/**
 * Save file schema and migrations.
 *
 * Saves carry a version. Loading an older save runs it through the migration
 * chain rather than refusing it, so worlds survive updates to the game.
 */

import type { WorldConfig, OreVein, PointOfInterest } from '../world/types';
import type { ResourceNode } from '../world/resources';
import type { WorldEvent } from '../sim/EventLog';
import type { SerializedInventory } from '../sim/Inventory';
import type { GameSpeed } from '../sim/Time';

export const SAVE_VERSION = 4;

export interface SavedTerrain {
  gridSize: number;
  tileSize: number;
  height: Float32Array;
  moisture: Float32Array;
  temperature: Float32Array;
  biome: Uint8Array;
  flow: Float32Array;
  slope: Float32Array;
  fertility: Float32Array;
  waterHeight: Float32Array;
  overlay: Uint8Array;
  traffic: Float32Array;
  seaLevel: number;
  minHeight: number;
  maxHeight: number;
}

export interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  stats: Record<string, number>;
  inventory: SerializedInventory;
  quickSlots: (string | null)[];
}

export interface SavedNpc {
  id: number;
  name: string;
  age: number;
  profession: string;
  x: number;
  z: number;
  yaw: number;
  homeId: number;
  workplaceId: number;
  needs: Record<string, number>;
  skills: Record<string, number>;
  inventory: SerializedInventory;
  money: number;
  seed: number;
  taskState: unknown;
  memories: { day: number; text: string }[];
  relationships: { id: number; value: number }[];
  scheduleOffset: number;
}

export interface SavedBuilding {
  id: number;
  defId: string;
  tx: number;
  tz: number;
  rotation: number;
  stageIndex: number;
  stageWork: number;
  complete: boolean;
  condition: number;
  inventory: SerializedInventory;
  delivered: Record<string, number>;
  workerIds: number[];
  residentIds: number[];
  startedDay: number;
  completedDay: number;
  builtBy: string[];
  productionProgress: number;
  activeRecipe: string | null;
  paused: boolean;
  priority: number;
  fields?: { tx: number; tz: number; crop: string; growth: number; watered: number; planted: boolean }[];
}

export interface SavedJob {
  id: number;
  kind: string;
  priority: number;
  assignedTo: number;
  data: Record<string, unknown>;
}

export interface SaveData {
  version: number;
  id: string;
  savedAt: number;
  config: WorldConfig;
  terrain: SavedTerrain;
  nodes: ResourceNode[];
  veins: OreVein[];
  pois: PointOfInterest[];
  time: { totalHours: number; speed: GameSpeed };
  player: SavedPlayer;
  npcs: SavedNpc[];
  buildings: SavedBuilding[];
  jobs: SavedJob[];
  events: WorldEvent[];
  research: { unlocked: string[]; active: string | null; progress: number; points: number };
  settlement: Record<string, unknown>;
  weather: Record<string, unknown>;
  economy: Record<string, unknown>;
  wildlife: { id: number; species: string; x: number; z: number; age: number }[];
  nextEntityId: number;
  tutorialStep: number;
}

export interface SaveSummary {
  id: string;
  name: string;
  seedText: string;
  savedAt: number;
  day: number;
  year: number;
  population: number;
  buildings: number;
  version: number;
}

type AnySave = SaveData & Record<string, unknown>;

/** Brings a save forward to the current version. Never throws on old data. */
export function migrate(raw: AnySave): SaveData {
  let data = raw;
  if (data.version === undefined) data.version = 1;

  if (data.version < 2) {
    // v1 had no wildlife or weather state.
    data.wildlife = data.wildlife ?? [];
    data.weather = data.weather ?? {};
    data.version = 2;
  }
  if (data.version < 3) {
    // v2 stored research as a bare array of unlocked ids.
    const legacy = data.research as unknown;
    if (Array.isArray(legacy)) {
      data.research = { unlocked: legacy as string[], active: null, progress: 0, points: 0 };
    }
    data.research = data.research ?? { unlocked: [], active: null, progress: 0, points: 0 };
    data.version = 3;
  }
  if (data.version < 4) {
    // v3 buildings had no maintenance condition.
    for (const b of data.buildings ?? []) {
      if (typeof b.condition !== 'number') b.condition = 1;
      if (!Array.isArray(b.builtBy)) b.builtBy = [];
    }
    data.tutorialStep = data.tutorialStep ?? 0;
    data.version = 4;
  }

  return data;
}

/** Rejects obviously corrupt or hostile save payloads before they are used. */
export function validate(data: SaveData): string | null {
  if (!data || typeof data !== 'object') return 'Save is not an object';
  if (typeof data.version !== 'number') return 'Missing version';
  if (data.version > SAVE_VERSION) return `Save is from a newer version (${data.version})`;
  if (!data.config || typeof data.config.gridSize !== 'number') return 'Missing world configuration';
  const t = data.terrain;
  if (!t) return 'Missing terrain';
  const expected = t.gridSize * t.gridSize;
  if (!(t.height instanceof Float32Array) || t.height.length !== expected) {
    return 'Terrain height layer is corrupt';
  }
  if (!(t.biome instanceof Uint8Array) || t.biome.length !== expected) {
    return 'Terrain biome layer is corrupt';
  }
  if (!Array.isArray(data.nodes)) return 'Missing resource nodes';
  if (!Array.isArray(data.buildings)) return 'Missing buildings';
  if (!Array.isArray(data.npcs)) return 'Missing people';
  return null;
}
