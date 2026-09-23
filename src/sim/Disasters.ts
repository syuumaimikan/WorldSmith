/**
 * Natural disasters.
 *
 * Nothing here deletes anything directly. An earthquake shakes the ground; how
 * much a building suffers depends on what it is made of and what condition it
 * is in. A fire needs fuel, spreads with the wind, and goes out in the rain.
 * The damage, the repairs and the recovery are all ordinary simulation.
 */

import { Body } from './Body';
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


/**
 * Something on its way down.
 *
 * A meteor that simply appears in a crater is a crater. The thing people
 * actually remember is the minute beforehand: a light in the sky that gets
 * brighter, and then the ground moves. So the rock is a real object with a
 * position and a course, it burns its way down over several seconds, and
 * anybody outside can watch it come.
 */
export interface FallingBody {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Metres per simulated second. */
  vx: number;
  vy: number;
  vz: number;
  /** 0..1, the same figure the impact is scaled by. */
  size: number;
  targetX: number;
  targetZ: number;
  /** Simulated seconds of flight left. */
  left: number;
  /** Total flight time, for anything that wants to know how close it is. */
  flight: number;
}

/**
 * A wave on its way in.
 *
 * The sea floor moves, the water above it moves with it, and some minutes
 * later that displacement arrives somewhere as a wall of water. The delay is
 * the whole character of the thing: the shaking stops, people go to look at
 * the harbour, and the sea has gone out.
 */
export interface Tsunami {
  id: number;
  /** Where the sea bed moved. */
  x: number;
  z: number;
  /** 0..1. */
  strength: number;
  /** Simulated seconds until it arrives. */
  arriveIn: number;
  /** Whether the drawback has been announced yet. */
  warned: boolean;
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

/**
 * How well a building stands up to wind. Mass and a low profile help, so a
 * stone cottage rides out what strips the canvas off a tent and lifts a tall
 * timber frame off its footings.
 */
export function windResistance(b: Building): number {
  const mats = b.def.totalMaterials;
  let mass = 0;
  let score = 0;
  const weight: Partial<Record<ItemId, number>> = {
    stone: 0.9,
    stone_block: 0.95,
    brick: 0.88,
    iron_ingot: 0.95,
    nails: 0.8,
    beam: 0.6,
    plank: 0.42,
    log: 0.5,
    thatch: 0.12,
    cloth: 0.05,
    fiber: 0.08,
    glass: 0.25,
  };
  for (const [item, amount] of Object.entries(mats) as [ItemId, number][]) {
    const w = weight[item];
    if (w === undefined) continue;
    mass += amount;
    score += w * amount;
  }
  if (mass === 0) return 0.9;
  // A tall building catches far more wind than a low one.
  const profile = clamp01(1 - (b.def.height - 1.5) / 14);
  return clamp01((score / mass) * (0.5 + profile * 0.5) * (0.55 + b.condition * 0.45));
}

export class DisasterManager {
  readonly fires: Fire[] = [];
  private floods: FloodCell[] = [];
  readonly falling: FallingBody[] = [];
  readonly waves: Tsunami[] = [];
  private nextBodyId = 1;
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

    // And if the sea floor was part of what moved, the sea moved with it.
    this.maybeTsunami(world, x, z, mag);
  }

  // =======================================================================
  // The sea
  // =======================================================================

  /**
   * Whether that earthquake moved enough sea floor to raise a wave.
   *
   * Only a big shock does it, and only one whose epicentre is at or under
   * water -- a quake inland moves rock, not ocean. The wave is then launched
   * from the water and given a few minutes to cross it.
   */
  maybeTsunami(world: World, x: number, z: number, magnitude: number): void {
    if (magnitude < 0.45) return;
    // How far out the shock can reach water. Two hundred and sixty metres was
    // a number from a much smaller map: on this world an epicentre in a
    // coastal valley is a kilometre from the sea, so almost every quake the
    // player deliberately set off on a beach quietly raised nothing. A real
    // shock of this size displaces sea floor for tens of kilometres; the
    // limit here is the size of the world, not the physics.
    const search = Math.max(900, world.terrain.worldSize * 0.45);
    const source = this.nearestOpenWater(world, x, z, search);
    if (!source) return;

    // How far the wave has to come decides how long the harbour has.
    const travel = Math.hypot(source.x - x, source.z - z);
    this.waves.push({
      id: this.nextBodyId++,
      x: source.x,
      z: source.z,
      strength: clamp01((magnitude - 0.4) * 1.8),
      arriveIn: 55 + travel * 0.5,
      warned: false,
    });
  }

  updateWaves(world: World, dt: number): void {
    if (this.waves.length === 0) return;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.arriveIn -= dt;

      // The sea goes out first. It is the only warning there is, and it is
      // worth giving the player, because it is the one real people get.
      if (!w.warned && w.arriveIn < 30) {
        w.warned = true;
        world.log.add(world.time, 'disaster', 'ev.seaDrawsBack', undefined, {
          notable: true,
          x: w.x,
          z: w.z,
        });
      }
      if (w.arriveIn > 0) continue;

      this.waves.splice(i, 1);
      this.breakWave(world, w);
    }
  }

  /** The wave arrives, and goes as far up the land as it has force to. */
  private breakWave(world: World, wave: Tsunami): void {
    const t = world.terrain;
    const ts = t.tileSize;
    // Run height: how far up the beach the water gets. A big wave on a flat
    // shore goes a very long way; the same wave against a cliff does not.
    const runUp = 2.5 + wave.strength * 9;
    const reach = 120 + wave.strength * 420;
    const r = Math.ceil(reach / ts);
    const cx = t.tileX(wave.x);
    const cz = t.tileZ(wave.z);
    let drowned = 0;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        const dist = Math.hypot(dx, dz) * ts;
        if (dist > reach) continue;
        const i = t.index(tx, tz);
        const ground = t.data.height[i];
        if (ground <= 0) continue;
        // The wave loses height as it travels and as it climbs.
        const height = runUp * (1 - dist / reach);
        if (ground >= height) continue;
        if (this.floods.some((c) => c.index === i)) continue;

        this.floods.push({
          index: i,
          level: height,
          remaining: 90 + wave.strength * 220,
          previousWater: t.waterHeight[i],
        });
        t.waterHeight[i] = height;
        t.markTileDirty(tx, tz);
        drowned++;
      }
    }

    // What the water takes with it.
    let lost = 0;
    for (const b of [...world.buildings]) {
      const i = t.index(t.tileX(b.worldX), t.tileZ(b.worldZ));
      if (!this.floods.some((c) => c.index === i)) continue;
      // Anything standing in it is hit by the whole weight of it.
      if (world.damageBuilding(b, 0.8 + wave.strength * 1.4)) lost++;
    }
    for (const npc of world.npcs) {
      const i = t.index(t.tileX(npc.x), t.tileZ(npc.z));
      if (!this.floods.some((c) => c.index === i)) continue;
      // Struck by the water and by everything the water is carrying.
      npc.body.hurtPart(Body.randomPart(this.rng), 'bruise', 0.3 + wave.strength * 0.5);
      if (this.rng.chance(0.3 + wave.strength * 0.4)) {
        npc.body.hurtPart('torso', 'bruise', 0.25 + wave.strength * 0.45);
      }
      world.startleNpc(npc, wave.x, wave.z);
    }
    for (const node of [...world.nodes]) {
      if (Math.hypot(node.x - wave.x, node.z - wave.z) > reach) continue;
      const i = t.index(t.tileX(node.x), t.tileZ(node.z));
      if (!this.floods.some((c) => c.index === i)) continue;
      if (RESOURCES[node.kind].category !== 'tree') continue;
      if (!this.rng.chance(0.35 + wave.strength * 0.4)) continue;
      world.removeNode(node);
    }

    if (drowned > 0) world.onFloodStarted(wave.x, wave.z, reach);
    world.log.add(
      world.time,
      'disaster',
      'event.tsunami',
      { flooded: drowned, destroyed: lost },
      { notable: true, x: wave.x, z: wave.z },
    );
  }

  /**
   * The nearest tile of real sea, for launching a wave off.
   *
   * Searched outward in rings rather than over the whole square, and stopped
   * at the first ring that finds water. An epicentre on a beach answers in a
   * few dozen tests; only one in the middle of a continent pays for the full
   * radius, and that one is looking for something that is not there.
   */
  private nearestOpenWater(
    world: World,
    x: number,
    z: number,
    maxDistance: number,
  ): { x: number; z: number } | null {
    const t = world.terrain;
    const ts = t.tileSize;
    const maxRing = Math.ceil(maxDistance / ts);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);

    const isSea = (tx: number, tz: number): boolean => {
      if (!t.inBounds(tx, tz)) return false;
      const i = t.index(tx, tz);
      // Real sea, not a pond: below sea level, and deep enough to have
      // something in it to displace.
      return t.data.height[i] <= -3 && t.waterHeight[i] > t.data.height[i];
    };

    if (isSea(cx, cz)) return { x: t.worldXOf(cx), z: t.worldZOf(cz) };

    // Rings, two tiles apart, which is fine enough not to step over a river
    // mouth and coarse enough to cross a continent cheaply.
    for (let r = 2; r <= maxRing; r += 2) {
      const step = Math.max(2, Math.floor(r / 6));
      for (let d = -r; d <= r; d += step) {
        const candidates: [number, number][] = [
          [cx + d, cz - r],
          [cx + d, cz + r],
          [cx - r, cz + d],
          [cx + r, cz + d],
        ];
        for (const [tx, tz] of candidates) {
          if (!isSea(tx, tz)) continue;
          const dist = Math.hypot(tx - cx, tz - cz) * ts;
          if (dist > maxDistance) continue;
          return { x: t.worldXOf(tx), z: t.worldZOf(tz) };
        }
      }
    }
    return null;
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

  /**
   * Calls something down on a place, from a long way up.
   *
   * Getting this seen was harder than making it happen. The rock used to
   * enter four hundred metres out and a kilometre up, which is an entry angle
   * of nearly sixty degrees: it came down almost vertically, out of a piece
   * of sky above the top of the screen, and was gone. What a person actually
   * sees of a fireball is a long shallow streak across the sky, so the rock
   * now enters over a kilometre away and only a few hundred metres up, and it
   * enters to one *side* of the line between the player and where it is
   * going, so that it crosses the view instead of arriving down it.
   */
  callDownMeteor(world: World, x: number, z: number, size: number): FallingBody {
    const flight = 9 + size * 5;
    // Roughly across the player's view rather than into it or away from it.
    const toPlayer = Math.atan2(world.player.position.z - z, world.player.position.x - x);
    const side = this.rng.chance(0.5) ? 1 : -1;
    const angle = toPlayer + side * this.rng.range(0.9, 2.2);
    const reach = 1100 + size * 900;
    const altitude = 260 + size * 300;
    const body: FallingBody = {
      id: this.nextBodyId++,
      x: x + Math.cos(angle) * reach,
      y: world.terrain.heightAt(x, z) + altitude,
      z: z + Math.sin(angle) * reach,
      vx: 0,
      vy: 0,
      vz: 0,
      size,
      targetX: x,
      targetZ: z,
      left: flight,
      flight,
    };
    const ground = world.terrain.heightAt(x, z);
    body.vx = (x - body.x) / flight;
    body.vy = (ground - body.y) / flight;
    body.vz = (z - body.z) / flight;
    this.falling.push(body);

    world.log.add(world.time, 'disaster', 'ev.skyfallSeen', undefined, {
      notable: true,
      x: body.x,
      z: body.z,
    });
    // Everyone who can see it stops what they are doing and looks.
    for (const npc of world.npcs) world.startleNpc(npc, body.x, body.z);
    return body;
  }

  /**
   * Moves what is in the air, and lands it.
   *
   * `dt` here is wall-clock seconds, not world seconds. A meteor crossing the
   * sky is something a person watches; if its flight were scaled by the speed
   * control then at eight times it would enter and land inside a single frame
   * and all the player would ever see is the crater it left. The world may
   * run fast; the thing falling through it falls at the speed it falls.
   */
  updateSkyfall(world: World, dt: number): void {
    if (this.falling.length === 0) return;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const b = this.falling[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.left -= dt;

      const ground = world.terrain.heightAt(b.x, b.z);
      if (b.left > 0 && b.y > ground) continue;

      this.falling.splice(i, 1);
      this.meteor(world, b.targetX, b.targetZ, b.size);
    }
  }

  meteor(world: World, x: number, z: number, size: number): void {
    const radius = 14 + size * 26;
    // The crater itself.
    // A crater shape digs its own bowl and throws up its own rim, so the
    // depth it is given is positive. Handing it a negative depth turned it
    // inside out, and every meteor in this world left a hill behind it
    // with a moat round the outside.
    world.editor.sculpt(x, z, radius, 4 + size * 10, 'crater', 'meteor');

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

    // What is left of the thing that fell.
    //
    // Meteoric iron was the only iron anybody had before smelting: the
    // Egyptians called it "iron from the sky" and made daggers of it, and it
    // is naturally alloyed with nickel, which is why those blades did not
    // rust like bog iron did. So a crater is worth walking to -- not because
    // a crater is a treasure chest, but because the rock survived the landing
    // and it is better metal than the ground here has.
    const shards = 2 + Math.round(size * 5);
    for (let i = 0; i < shards; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      // Scattered around the rim, where ejecta actually ends up, rather than
      // heaped in the middle where the rock is vapour.
      const r = radius * this.rng.range(0.35, 1.25);
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (!world.terrain.inWorld(sx, sz)) continue;
      if (world.terrain.waterDepthAt(sx, sz) > 0.3) continue;
      world.spawnNode('meteoric_iron', sx, sz);
    }

    world.log.add(world.time, 'disaster', 'event.meteor', { shards }, { notable: true, x, z });
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
