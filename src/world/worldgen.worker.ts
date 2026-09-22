/// <reference lib="webworker" />
/**
 * World generation worker.
 *
 * Generation takes seconds and touches multi-megabyte typed arrays, so it runs
 * off the main thread and streams progress back to the loading screen. The
 * finished layers are transferred (not copied) back to the main thread.
 */

import { generateTerrain } from './TerrainGen';
import { populateWorld } from './WorldPopulate';
import type { WorldConfig } from './types';
import type { WorldGenPayload, WorldGenRequest, WorldGenMessage } from './worldgenTypes';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorldGenRequest>) => {
  const config: WorldConfig = ev.data.config;
  try {
    let lastPost = 0;
    const post = (stage: string, fraction: number, force = false) => {
      const now = performance.now();
      if (!force && now - lastPost < 60) return;
      lastPost = now;
      const msg: WorldGenMessage = { type: 'progress', stage, fraction };
      ctx.postMessage(msg);
    };

    // Stage weights so the progress bar advances at a believable rate.
    const STAGES: { name: string; weight: number }[] = [
      { name: 'Shaping the continent', weight: 0.08 },
      { name: 'Raising mountains', weight: 0.06 },
      { name: 'Weathering the land', weight: 0.3 },
      { name: 'Carving rivers', weight: 0.1 },
      { name: 'Measuring the climate', weight: 0.08 },
      { name: 'Classifying biomes', weight: 0.04 },
      { name: 'Seeding mineral veins', weight: 0.03 },
      { name: 'Growing forests', weight: 0.21 },
      { name: 'Placing mineral deposits', weight: 0.04 },
      { name: 'Remembering the past', weight: 0.06 },
    ];
    const offsets = new Map<string, { start: number; weight: number }>();
    let acc = 0;
    for (const s of STAGES) {
      offsets.set(s.name, { start: acc, weight: s.weight });
      acc += s.weight;
    }

    const progress = (stage: string, fraction: number) => {
      const o = offsets.get(stage);
      const overall = o ? o.start + o.weight * Math.min(1, Math.max(0, fraction)) : fraction;
      post(stage, overall);
    };

    const { terrain, waterHeight, lakes } = generateTerrain(config, progress);
    const populated = populateWorld(config, terrain, waterHeight, progress);

    post('Waking the world', 1, true);

    const payload: WorldGenPayload = {
      gridSize: terrain.gridSize,
      tileSize: terrain.tileSize,
      height: terrain.height,
      moisture: terrain.moisture,
      temperature: terrain.temperature,
      biome: terrain.biome,
      flow: terrain.flow,
      slope: terrain.slope,
      fertility: terrain.fertility,
      seaLevel: terrain.seaLevel,
      minHeight: terrain.minHeight,
      maxHeight: terrain.maxHeight,
      waterHeight,
      lakes,
      nodes: populated.nodes,
      veins: populated.veins,
      pois: populated.pois,
      oldRoadTiles: populated.oldRoadTiles,
      startX: populated.startX,
      startZ: populated.startZ,
      historyLines: populated.historyLines,
    };

    const done: WorldGenMessage = { type: 'done', payload };
    ctx.postMessage(done, [
      terrain.height.buffer,
      terrain.moisture.buffer,
      terrain.temperature.buffer,
      terrain.biome.buffer,
      terrain.flow.buffer,
      terrain.slope.buffer,
      terrain.fertility.buffer,
      waterHeight.buffer,
      populated.oldRoadTiles.buffer,
    ]);
  } catch (err) {
    const msg: WorldGenMessage = {
      type: 'error',
      message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    };
    ctx.postMessage(msg);
  }
};
