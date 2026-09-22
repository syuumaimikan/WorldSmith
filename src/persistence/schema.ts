/**
 * Save file schema and migrations.
 *
 * Saves carry a version. Loading an older save runs it through the migration
 * chain rather than refusing it, so worlds survive updates to the game.
 */

import type { WorldConfig, OreVein, PointOfInterest } from '../world/types';
import { RESOURCES } from '../world/resources';
import type { ResourceKind, ResourceNode } from '../world/resources';
import type { WorldEvent } from '../sim/EventLog';
import type { SerializedInventory } from '../sim/Inventory';
import type { GameSpeed } from '../sim/Time';

export const SAVE_VERSION = 7;

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
  /** The age this one's body starts giving way around. Theirs alone. */
  lifespan?: number;
  frailty?: number;
  bornDay?: number;
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
  repairNeeded?: boolean;
  repairWork?: number;
  repairBill?: Record<string, number>;
  repairMaterialsConsumed?: boolean;
  fields?: { tx: number; tz: number; crop: string; growth: number; watered: number; planted: boolean }[];
}

export interface SavedJob {
  id: number;
  kind: string;
  priority: number;
  assignedTo: number;
  data: Record<string, unknown>;
}

export interface SavedVolcano {
  id: number;
  x: number;
  z: number;
  radius: number;
  state: string;
  pressure: number;
  name: string;
  eruptionLeft?: number;
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
  climate: Record<string, unknown>;
  storms: Record<string, unknown>;
  disasters: Record<string, unknown>;
  director: Record<string, unknown>;
  tectonics: Record<string, unknown>;
  nations: Record<string, unknown>;
  diplomacy: Record<string, unknown>;
  culture: Record<string, unknown>;
  history: Record<string, unknown>;
  technology: Record<string, unknown>;
  disease: Record<string, unknown>;
  volcanoes: SavedVolcano[];
  economy: Record<string, unknown>;
  wildlife: { id: number; species: string; x: number; z: number; age: number; lifespan?: number }[];
  nextEntityId: number;
  tutorialStep: number;
  /** Settler the player was driving when the game was saved, or 0. */
  possessed: number;
  lightningStrikes: number;
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
  if (data.version < 5) {
    // v4 predates the atmosphere, the storms and the disaster systems. An old
    // world simply starts them fresh: the air settles to the ground beneath it
    // and nothing is on fire, which is a perfectly good state to resume from.
    data.climate = data.climate ?? {};
    data.storms = data.storms ?? {};
    data.disasters = data.disasters ?? {};
    data.director = data.director ?? {};
    data.tectonics = data.tectonics ?? {};
    data.nations = data.nations ?? {};
    data.diplomacy = data.diplomacy ?? {};
    data.disease = data.disease ?? {};
    data.volcanoes = data.volcanoes ?? [];
    data.possessed = 0;
    data.lightningStrikes = 0;
    data.version = 5;
  }
  if (data.version < 6) {
    // v5 worlds had nations but nothing those nations believed. They get a
    // people and a faith the first time the world takes a step, founded the
    // same way a new world's are.
    data.culture = data.culture ?? {};
    data.history = data.history ?? {};
    data.technology = data.technology ?? {};
    data.version = 6;
  }
  if (data.version < 7) {
    // v6 trees had no age, only a maturity flag. Anything already standing is
    // taken to be grown, which is what it looked like, and starts its clock
    // from there.
    for (const n of data.nodes ?? []) {
      if (typeof n.age !== 'number') {
        const life = RESOURCES[n.kind as ResourceKind]?.life;
        n.age = life ? life.matureYears * (typeof n.growth === 'number' ? n.growth : 1) : 0;
      }
    }
    data.version = 7;
  }

  return data;
}

/**
 * Brings every resource node back inside the range the simulation assumes.
 *
 * A save file is untrusted input. Most of the fields here feed arithmetic that
 * runs every frame or every day, and one NaN or one negative count in a save
 * silently poisons the whole world rather than failing loudly, so each one is
 * clamped on the way in.
 */
function sanitiseNodes(data: AnySave): void {
  const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return n < lo ? lo : n > hi ? hi : n;
  };
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  for (const n of nodes) {
    n.age = num(n.age, 0, 100000, 0);
    n.growth = num(n.growth, 0, 1, 1);
    n.scale = num(n.scale, 0.05, 20, 1);
    n.maxAmount = Math.round(num(n.maxAmount, 0, 10000, 1));
    n.amount = Math.round(num(n.amount, 0, n.maxAmount, 0));
    n.work = num(n.work, 0, 1e6, 0);
    n.regrowIn = num(n.regrowIn, -1, 100000, -1);
    n.rot = num(n.rot, -100, 100, 0);
  }
}

/** Rejects obviously corrupt or hostile save payloads before they are used. */
export function validate(data: SaveData): string | null {
  sanitiseNodes(data as unknown as AnySave);
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
