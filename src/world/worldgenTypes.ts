/** Message contract between the main thread and the generation worker. */

import type { OreVein, PointOfInterest, WorldConfig } from './types';
import type { ResourceNode } from './resources';

export interface WorldGenRequest {
  config: WorldConfig;
}

export interface WorldGenPayload {
  gridSize: number;
  tileSize: number;
  height: Float32Array;
  moisture: Float32Array;
  temperature: Float32Array;
  biome: Uint8Array;
  flow: Float32Array;
  slope: Float32Array;
  fertility: Float32Array;
  seaLevel: number;
  minHeight: number;
  maxHeight: number;
  waterHeight: Float32Array;
  lakes: { level: number; cx: number; cz: number; area: number }[];
  nodes: ResourceNode[];
  veins: OreVein[];
  pois: PointOfInterest[];
  oldRoadTiles: Int32Array;
  startX: number;
  startZ: number;
  historyLines: string[];
}

export type WorldGenMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; payload: WorldGenPayload }
  | { type: 'error'; message: string };
