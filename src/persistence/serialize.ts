/**
 * World <-> save payload conversion.
 *
 * Terrain layers are stored verbatim rather than regenerated from the seed:
 * regeneration would be smaller on disk but would silently change old worlds
 * whenever the generator is tuned, and a settlement you built over hours should
 * not move because a noise constant changed.
 */

import { Terrain } from '../world/Terrain';
import { TerrainData } from '../world/types';
import { World } from '../sim/World';
import { GameTime } from '../sim/Time';
import { EventLog } from '../sim/EventLog';
import { Inventory } from '../sim/Inventory';
import { ItemId } from '../data/items';
import { SAVE_VERSION, SaveData, SavedTerrain, SaveSummary } from './schema';

export function serializeWorld(world: World, id: string): SaveData {
  const t = world.terrain;
  const terrain: SavedTerrain = {
    gridSize: t.gridSize,
    tileSize: t.tileSize,
    height: t.data.height,
    moisture: t.data.moisture,
    temperature: t.data.temperature,
    biome: t.data.biome,
    flow: t.data.flow,
    slope: t.data.slope,
    fertility: t.data.fertility,
    waterHeight: t.waterHeight,
    overlay: t.overlay,
    traffic: t.traffic,
    seaLevel: t.data.seaLevel,
    minHeight: t.data.minHeight,
    maxHeight: t.data.maxHeight,
  };

  return {
    version: SAVE_VERSION,
    id,
    savedAt: Date.now(),
    config: world.config,
    terrain,
    nodes: world.nodes,
    veins: world.veins,
    pois: world.pois,
    time: world.time.serialize(),
    player: {
      x: world.player.position.x,
      y: world.player.position.y,
      z: world.player.position.z,
      yaw: world.player.yaw,
      stats: { ...world.player.stats },
      inventory: world.player.inventory.serialize(),
      quickSlots: world.player.quickSlots,
    },
    npcs: world.serializeNpcs(),
    buildings: world.serializeBuildings(),
    jobs: world.serializeJobs(),
    events: world.log.serialize(),
    research: world.research.serialize(),
    settlement: world.settlement.serialize(),
    weather: world.weather.serialize(),
    climate: world.climate.serialize(),
    storms: world.storms.serialize(),
    disasters: world.disasters.serialize(),
    director: world.director.serialize(),
    tectonics: world.tectonics.serialize(),
    nations: world.nations.serialize(),
    diplomacy: world.diplomacy.serialize(),
    culture: world.culture.serialize(),
    disease: world.disease.serialize(),
    volcanoes: world.volcanoes.map((v) => ({ ...v })),
    economy: world.economy.serialize(),
    wildlife: world.serializeWildlife(),
    nextEntityId: world.peekNextId(),
    tutorialStep: world.tutorialStep,
    possessed: world.possessed,
    lightningStrikes: world.lightningStrikes,
  };
}

export function summarise(world: World, id: string): SaveSummary {
  const snap = world.time.snapshot();
  return {
    id,
    name: world.config.name,
    seedText: world.config.seedText,
    savedAt: Date.now(),
    day: snap.totalDays,
    year: snap.year,
    population: world.npcs.length,
    buildings: world.buildings.filter((b) => b.complete).length,
    version: SAVE_VERSION,
  };
}

export function deserializeWorld(data: SaveData): World {
  const st = data.terrain;
  const terrainData: TerrainData = {
    gridSize: st.gridSize,
    tileSize: st.tileSize,
    height: toF32(st.height),
    moisture: toF32(st.moisture),
    temperature: toF32(st.temperature),
    biome: toU8(st.biome),
    flow: toF32(st.flow),
    slope: toF32(st.slope),
    fertility: toF32(st.fertility),
    seaLevel: st.seaLevel,
    minHeight: st.minHeight,
    maxHeight: st.maxHeight,
  };
  const terrain = new Terrain(
    terrainData,
    toF32(st.waterHeight),
    toU8(st.overlay),
    toF32(st.traffic),
  );

  const time = GameTime.deserialize(data.time);
  const world = new World(
    data.config,
    terrain,
    data.nodes,
    data.veins,
    data.pois,
    data.player.x,
    data.player.z,
    time,
  );

  world.player.position.set(data.player.x, data.player.y, data.player.z);
  world.player.yaw = data.player.yaw;
  Object.assign(world.player.stats, data.player.stats);
  const inv = Inventory.deserialize(data.player.inventory, world.player.inventory.weightLimit);
  world.player.inventory.slots.length = 0;
  for (const s of inv.slots) world.player.inventory.slots.push(s);
  for (let i = 0; i < world.player.quickSlots.length; i++) {
    world.player.quickSlots[i] = (data.player.quickSlots?.[i] as ItemId | null) ?? null;
  }

  world.replaceLog(EventLog.deserialize(data.events));
  world.restoreNextId(data.nextEntityId ?? 1);
  world.deserializeBuildings(data.buildings ?? []);
  world.deserializeNpcs(data.npcs ?? []);
  world.deserializeJobs(data.jobs ?? []);
  world.research.restore(data.research);
  world.settlement.restore(data.settlement);
  world.weather.restore(data.weather);
  world.climate.restore(data.climate);
  world.storms.restore(data.storms);
  world.disasters.restore(data.disasters, world);
  world.director.restore(data.director);
  world.tectonics.restore(data.tectonics);
  if (data.nations && Object.keys(data.nations).length > 0) {
    world.nations.restore(data.nations);
    world.diplomacy.restore(data.diplomacy);
  }
  if (data.culture && Object.keys(data.culture).length > 0) {
    world.culture.restore(data.culture);
  }
  world.disease.restore(data.disease);
  world.restoreVolcanoes(data.volcanoes ?? []);
  world.economy.restore(data.economy);
  world.deserializeWildlife(data.wildlife ?? []);
  world.tutorialStep = data.tutorialStep ?? 0;
  world.possessed = typeof data.possessed === 'number' ? data.possessed : 0;
  world.lightningStrikes =
    typeof data.lightningStrikes === 'number' && data.lightningStrikes >= 0
      ? data.lightningStrikes
      : 0;
  world.rebuildRegrowQueue();
  world.afterLoad();

  return world;
}

/** Structured clone can return plain objects for typed arrays in odd cases. */
function toF32(v: Float32Array | ArrayLike<number>): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v as ArrayLike<number>);
}

function toU8(v: Uint8Array | ArrayLike<number>): Uint8Array {
  return v instanceof Uint8Array ? v : Uint8Array.from(v as ArrayLike<number>);
}
