/**
 * Natural disasters.
 *
 * Nothing here deletes anything directly. An earthquake shakes the ground; how
 * much a building suffers depends on what it is made of and what condition it
 * is in. A fire needs fuel, spreads with the wind, and goes out in the rain.
 * The damage, the repairs and the recovery are all ordinary simulation.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01, smoothstep } from '../core/math';
import { Biome } from '../world/types';
import { ItemId } from '../data/items';
import { RESOURCES } from '../world/resources';
import type { World } from './World';
import type { Building } from './Building';

export type DisasterKind =
  | 'earthquake'
  | 'wildfire'
  | 'flood'
  | 'eruption'
  | 'meteor'
  | 'storm'
  | 'plague'
  | 'landslide';

export type Severity = 'minor' | 'moderate' | 'major' | 'catastrophic';

export function severityOf(scale: number): Severity {
  if (scale < 0.3) return 'minor';
  if (scale < 0.55) return 'moderate';
  if (scale < 0.8) return 'major';
  return 'catastrophic';
}

/** A patch of ground that is currently alight. */
export interface Fire {
  id: number;
  x: number;
  z: number;
  /** Remaining fuel; when it hits zero the fire goes out. */
  fuel: number;
  /** 0..1 how fiercely it is burning. */
  intensity: number;
  age: number;
  /** Ticks until it may try to spread again. */
  spreadCooldown: number;
}

/** Water standing where it should not be, receding over time. */
export interface FloodCell {
  index: number;
  level: number;
  /** Simulated seconds remaining. */
  remaining: number;
  previousWater: number;
}

const MAX_FIRES = 220;
const FIRE_SPREAD_RADIUS = 5.5;

/**
 * How well a building resists shaking, from what it is built of. Stone and
 * brick hold up; a timber frame with a thatch roof does not.
 */
export function earthquakeResistance(b: Building): number {
  const mats = b.def.totalMaterials;
  let mass = 0;
  let score = 0;
  const weight: Partial<Record<ItemId, number>> = {
    stone: 0.75,
    stone_block: 0.95,
    brick: 0.85,
    iron_ingot: 1,
    nails: 0.9,
    beam: 0.7,
    plank: 0.45,
    log: 0.4,
    thatch: 0.2,
    cloth: 0.15,
    fiber: 0.1,
  };
  for (const [item, amount] of Object.entries(mats) as [ItemId, number][]) {
    const w = weight[item];
    if (w === undefined) continue;
    mass += amount;
    score += w * amount;
  }
  // A building with no materials at all (a stockpile) has nothing to shake down.
  if (mass === 0) return 1;
  const base = score / mass;
  // Condition matters: a neglected building fails first.
  return clamp01(base * (0.55 + b.condition * 0.45));
}

export class DisasterManager {
  readonly fires: Fire[] = [];
  private floods: FloodCell[] = [];
  private rng: Rng;
  private nextFireId = 1;
  /** Set for one tick when a fire starts, so audio and toasts can react. */
  fireStartedThisTick = false;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xd15a);
  }

  get activeFireCount(): number {
    return this.fires.length;
  }

  get floodedTileCount(): number {
    return this.floods.length;
  }

  // =======================================================================
  // Earthquake
  // =======================================================================

  /**
   * @param magnitude 0..1. Damage falls off with distance from the epicentre.
   */
  earthquake(world: World, x: number, z: number, magnitude: number, radius: number): void {
    const mag = clamp01(magnitude);
    let damaged = 0;
    let destroyed = 0;

    for (const b of [...world.buildings]) {
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      if (d > radius) continue;
      const local = mag * (1 - smoothstep(0, radius, d));
      if (local <= 0.02) continue;

      const resistance = earthquakeResistance(b);
      // A well-built stone hall shrugs off what flattens a tent.
      const harm = Math.max(0, local * 1.6 - resistance * 1.1);
      if (harm <= 0.01) continue;

      damaged++;
      if (world.damageBuilding(b, harm)) destroyed++;
    }

    // Steep slopes let go.
    const ts = world.terrain.tileSize;
    const tiles = Math.ceil(radius / ts);
    const cx = world.terrain.tileX(x);
    const cz = world.terrain.tileZ(z);
    let slides = 0;
    for (let dz = -tiles; dz <= tiles; dz += 2) {
      for (let dx = -tiles; dx <= tiles; dx += 2) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!world.terrain.inBounds(tx, tz)) continue;
        const dist = Math.hypot(dx, dz) * ts;
        if (dist > radius) continue;
        const i = world.terrain.index(tx, tz);
        if (world.terrain.data.slope[i] < 0.7) continue;
        if (!this.rng.chance(mag * 0.25)) continue;
        world.landslide(tx * ts, tz * ts, this.rng.range(4, 10));
        slides++;
        if (slides > 14) break;
      }
    }

    // People run for open ground.
    for (const npc of world.npcs) {
      if (Math.hypot(npc.x - x, npc.z - z) > radius) continue;
      world.startleNpc(npc, x, z);
    }

    world.log.add(
      world.time,
      'disaster',
      'event.earthquake',
      { damaged, destroyed },
      { notable: true, x, z },
    );
  }

  // =======================================================================
  // Fire
  // =======================================================================

  ignite(world: World, x: number, z: number, intensity = 0.6): Fire | null {
    if (this.fires.length >= MAX_FIRES) return null;
    if (world.terrain.waterDepthAt(x, z) > 0.1) return null;

    // Fuel comes from what is actually there to burn.
    const fuel = this.fuelAt(world, x, z);
    if (fuel <= 0.05) return null;

    const fire: Fire = {
      id: this.nextFireId++,
      x,
      z,
      fuel,
      intensity: clamp01(intensity),
      age: 0,
      spreadCooldown: this.rng.int(10, 40),
    };
    this.fires.push(fire);
    this.fireStartedThisTick = true;
    return fire;
  }

  private fuelAt(world: World, x: number, z: number): number {
    let fuel = 0;
    world.nodeGrid.forEachNear(x, z, 3, (n) => {
      if (n.depleted) return;
      const def = RESOURCES[n.kind];
      if (def.category === 'tree') fuel += 3 * n.growth;
      else if (def.category === 'plant') fuel += 0.7 * n.growth;
    });
    const biome = world.terrain.biomeAt(x, z);
    if (biome === Biome.Grassland || biome === Biome.Savanna) fuel += 1;
    if (biome === Biome.DenseForest || biome === Biome.TemperateForest) fuel += 1.5;

    // Buildings burn too, and timber ones burn well.
    const tx = world.terrain.tileX(x);
    const tz = world.terrain.tileZ(z);
    const b = world.buildingAt(tx, tz);
    if (b && b.complete) fuel += 4;

    // Damp ground resists ignition.
    const moisture = world.terrain.moistureAt(x, z);
    return fuel * (1.25 - moisture * 0.7) * (1 - world.weather.severity * 0.5);
  }

  updateFires(world: World, dt: number): void {
    this.fireStartedThisTick = false;
    if (this.fires.length === 0) return;

    const raining = world.weather.isPrecipitating;
    const windX = Math.cos(world.weather.windDirection);
    const windZ = Math.sin(world.weather.windDirection);
    const windStrength = world.weather.windStrength;

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;

      // Rain smothers a fire; dry weather feeds it.
      const burnRate = raining ? 2.6 : 0.85 + windStrength * 0.6;
      f.fuel -= burnRate * dt * 0.35;
      f.intensity = clamp01(f.fuel / 3) * (raining ? 0.4 : 1);

      // Consume what it is standing in.
      this.burnAt(world, f, dt);

      if (f.fuel <= 0) {
        this.fires[i] = this.fires[this.fires.length - 1];
        this.fires.pop();
        world.scorchGround(f.x, f.z, 3);
        continue;
      }

      if (--f.spreadCooldown > 0) continue;
      f.spreadCooldown = this.rng.int(20, 60);
      if (raining) continue;
      if (this.fires.length >= MAX_FIRES) continue;

      // Spread downwind.
      const a = this.rng.range(0, Math.PI * 2);
      const drift = 0.35 + windStrength * 0.65;
      const dx = Math.cos(a) * (1 - drift) + windX * drift;
      const dz = Math.sin(a) * (1 - drift) + windZ * drift;
      const len = Math.hypot(dx, dz) || 1;
      const nx = f.x + (dx / len) * FIRE_SPREAD_RADIUS;
      const nz = f.z + (dz / len) * FIRE_SPREAD_RADIUS;
      if (this.fires.some((o) => Math.hypot(o.x - nx, o.z - nz) < 3.5)) continue;
      this.ignite(world, nx, nz, f.intensity * 0.9);
    }
  }

  private burnAt(world: World, f: Fire, dt: number): void {
    // Vegetation is destroyed outright.
    const doomed: number[] = [];
    world.nodeGrid.forEachNear(f.x, f.z, 3, (n) => {
      if (n.depleted) return;
      if (this.rng.chance(dt * 0.25 * f.intensity)) doomed.push(n.id);
    });
    for (const id of doomed) {
      const node = world.nodeById.get(id);
      if (node) world.burnNode(node);
    }

    // Buildings take damage while the fire sits on them.
    const tx = world.terrain.tileX(f.x);
    const tz = world.terrain.tileZ(f.z);
    const b = world.buildingAt(tx, tz);
    if (b) world.damageBuilding(b, dt * 0.06 * f.intensity);

    // People do not stand in fire.
    world.npcGrid.forEachNear(f.x, f.z, 6, (npc) => {
      world.startleNpc(npc, f.x, f.z);
    });
  }

  extinguishAll(world: World): void {
    for (const f of this.fires) world.scorchGround(f.x, f.z, 3);
    this.fires.length = 0;
  }

  // =======================================================================
  // Flood
  // =======================================================================

  /** Raises water over low ground for a while, then lets it drain away. */
  flood(world: World, x: number, z: number, radius: number, depth: number, durationSeconds: number): void {
    const t = world.terrain;
    const ts = t.tileSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);
    const level = t.heightAt(x, z) + depth;
    let cells = 0;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        if (Math.hypot(dx, dz) * ts > radius) continue;
        const i = t.index(tx, tz);
        if (t.data.height[i] >= level) continue;
        if (this.floods.some((c) => c.index === i)) continue;

        this.floods.push({
          index: i,
          level,
          remaining: durationSeconds,
          previousWater: t.waterHeight[i],
        });
        t.waterHeight[i] = level;
        t.markTileDirty(tx, tz);
        cells++;
      }
    }

    if (cells > 0) {
      world.onFloodStarted(x, z, radius);
    }
  }

  updateFloods(world: World, dt: number): void {
    if (this.floods.length === 0) return;
    const t = world.terrain;
    let receded = 0;

    for (let i = this.floods.length - 1; i >= 0; i--) {
      const c = this.floods[i];
      c.remaining -= dt;
      if (c.remaining > 0) {
        // Damage while the water is up.
        continue;
      }
      t.waterHeight[c.index] = c.previousWater;
      const tx = c.index % t.gridSize;
      const tz = (c.index / t.gridSize) | 0;
      t.markTileDirty(tx, tz);
      // Silt left behind enriches the soil — the one good thing about a flood.
      t.data.fertility[c.index] = clamp01(t.data.fertility[c.index] + 0.12);
      this.floods[i] = this.floods[this.floods.length - 1];
      this.floods.pop();
      receded++;
    }

    if (receded > 0 && this.floods.length === 0) world.onFloodEnded();
  }

  /** True when a tile is currently under flood water. */
  isFlooded(index: number): boolean {
    return this.floods.some((c) => c.index === index);
  }

  // =======================================================================
  // Meteor
  // =======================================================================

  meteor(world: World, x: number, z: number, size: number): void {
    const radius = 14 + size * 26;
    // The crater itself.
    world.editor.sculpt(x, z, radius, -(4 + size * 10), 'crater', 'meteor');

    // Everything inside is flattened.
    const doomed: number[] = [];
    world.nodeGrid.forEachNear(x, z, radius * 1.3, (n) => doomed.push(n.id));
    for (const id of doomed) {
      const n = world.nodeById.get(id);
      if (n) world.removeNode(n);
    }

    for (const b of [...world.buildings]) {
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      if (d > radius * 1.8) continue;
      const harm = 1.8 * (1 - smoothstep(0, radius * 1.8, d));
      world.damageBuilding(b, harm);
    }

    for (const npc of world.npcs) {
      if (Math.hypot(npc.x - x, npc.z - z) > radius * 2.5) continue;
      world.startleNpc(npc, x, z);
    }

    // Fires around the rim.
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = radius * this.rng.range(0.9, 1.5);
      this.ignite(world, x + Math.cos(a) * r, z + Math.sin(a) * r, 0.9);
    }

    world.log.add(world.time, 'disaster', 'event.meteor', undefined, { notable: true, x, z });
  }

  serialize(): Record<string, unknown> {
    return {
      fires: this.fires.map((f) => ({ x: f.x, z: f.z, fuel: f.fuel, intensity: f.intensity })),
      floods: this.floods.map((c) => ({
        index: c.index,
        level: c.level,
        remaining: c.remaining,
        previousWater: c.previousWater,
      })),
    };
  }

  restore(data: Record<string, unknown> | undefined, world: World): void {
    if (!data) return;
    this.fires.length = 0;
    for (const f of (data.fires as { x: number; z: number; fuel: number; intensity: number }[]) ?? []) {
      this.fires.push({
        id: this.nextFireId++,
        x: f.x,
        z: f.z,
        fuel: f.fuel,
        intensity: f.intensity,
        age: 0,
        spreadCooldown: 30,
      });
    }
    this.floods = ((data.floods as FloodCell[]) ?? []).slice();
    for (const c of this.floods) {
      if (c.index >= 0 && c.index < world.terrain.waterHeight.length) {
        world.terrain.waterHeight[c.index] = c.level;
      }
    }
  }
}

export { clamp };
