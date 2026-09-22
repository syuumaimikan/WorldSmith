/**
 * Volcanoes.
 *
 * A volcano is not a particle emitter on a mountain. Pressure builds under it
 * over years; as it rises the ground shakes and the summit steams; when it
 * gives way, lava actually runs downhill and reshapes the land, ash drifts
 * with the wind and settles on the fields, and the crops fail for a season.
 * Years later that same ash makes the soil around it the best in the world.
 */

import { clamp, clamp01 } from '../core/math';
import { Biome } from '../world/types';
import type { World } from './World';

export type VolcanoState = 'dormant' | 'unrest' | 'erupting' | 'spent';

export interface Volcano {
  id: number;
  x: number;
  z: number;
  radius: number;
  state: VolcanoState;
  /** 0..1. Above 1 it erupts. */
  pressure: number;
  name: string;
  /** Simulated seconds left in the current eruption. */
  eruptionLeft?: number;
  /** Simulated seconds until the next tremor while in unrest. */
  tremorIn?: number;
}

const UNREST_THRESHOLD = 0.72;
const ERUPT_THRESHOLD = 1;

export function updateVolcanoes(world: World, dt: number): void {
  if (world.volcanoes.length === 0) return;
  const hours = world.time.hoursFor(dt);

  for (const v of world.volcanoes) {
    switch (v.state) {
      case 'spent':
        // A spent cone slowly recharges over decades.
        v.pressure += hours * 0.000012;
        if (v.pressure > 0.2) v.state = 'dormant';
        break;

      case 'dormant':
        v.pressure += hours * 0.00006;
        if (v.pressure >= UNREST_THRESHOLD) {
          v.state = 'unrest';
          v.tremorIn = 20;
          world.log.add(world.time, 'disaster', 'event.volcanoUnrest', { name: v.name }, {
            notable: true,
            x: v.x,
            z: v.z,
          });
        }
        break;

      case 'unrest': {
        v.pressure += hours * 0.00022;
        v.tremorIn = (v.tremorIn ?? 20) - dt;
        if (v.tremorIn <= 0) {
          v.tremorIn = 25 + Math.random() * 60;
          // Small warning quakes, strong enough to be felt and to worry people.
          world.disasters.earthquake(world, v.x, v.z, 0.12, v.radius * 1.6);
        }
        if (v.pressure >= ERUPT_THRESHOLD) beginEruption(world, v);
        break;
      }

      case 'erupting': {
        v.eruptionLeft = (v.eruptionLeft ?? 0) - dt;
        eruptTick(world, v, dt);
        if ((v.eruptionLeft ?? 0) <= 0) {
          v.state = 'spent';
          v.pressure = 0;
          world.log.add(world.time, 'disaster', 'event.eruptionEnds', { name: v.name }, {
            notable: true,
            x: v.x,
            z: v.z,
          });
        }
        break;
      }
    }
  }
}

export function beginEruption(world: World, v: Volcano): void {
  v.state = 'erupting';
  v.eruptionLeft = 90 + Math.random() * 120;
  // What goes up into the high air stays there, and the whole world is a
  // little colder for the next few years because of it.
  world.climate.addAerosol(0.6 + (v.pressure - 1) * 1.2 + v.radius / 260);
  world.log.add(world.time, 'disaster', 'event.eruption', { name: v.name }, {
    notable: true,
    x: v.x,
    z: v.z,
  });

  // The blast itself.
  world.disasters.earthquake(world, v.x, v.z, 0.45, v.radius * 2.2);

  // Everyone nearby runs.
  for (const npc of world.npcs) {
    if (Math.hypot(npc.x - v.x, npc.z - v.z) > v.radius * 3) continue;
    world.startleNpc(npc, v.x, v.z);
  }
}

/** One tick of an ongoing eruption: lava advances, ash falls, fires start. */
function eruptTick(world: World, v: Volcano, dt: number): void {
  // Lava runs downhill from the crater, raising the ground as it cools.
  if (Math.random() < dt * 0.9) {
    let x = v.x;
    let z = v.z;
    const t = world.terrain;
    // Follow the steepest descent for a few steps, which is what makes lava
    // pour down one flank rather than spreading evenly in a disc.
    for (let step = 0; step < 26; step++) {
      let bestX = x;
      let bestZ = z;
      let bestH = t.heightAt(x, z);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const nx = x + Math.cos(ang) * t.tileSize * 1.5;
        const nz = z + Math.sin(ang) * t.tileSize * 1.5;
        const h = t.heightAt(nx, nz);
        if (h < bestH) {
          bestH = h;
          bestX = nx;
          bestZ = nz;
        }
      }
      if (bestX === x && bestZ === z) break;
      x = bestX;
      z = bestZ;

      // Lava entering water chills into new rock instead of flowing on.
      if (t.waterDepthAt(x, z) > 0.3) {
        world.editor.sculpt(x, z, 5, 1.2, 'dome', 'lava');
        break;
      }
    }

    world.editor.sculpt(x, z, 6, 0.55, 'dome', 'lava');
    world.scorchGround(x, z, 7);
    world.ignite(x, z, 1);

    // Anything in the flow path is gone.
    const doomed: number[] = [];
    world.nodeGrid.forEachNear(x, z, 7, (n) => doomed.push(n.id));
    for (const id of doomed) {
      const n = world.nodeById.get(id);
      if (n) world.removeNode(n);
    }
    const b = world.buildingAt(t.tileX(x), t.tileZ(z));
    if (b) world.damageBuilding(b, 1.5);
  }

  // Ashfall, carried downwind.
  if (Math.random() < dt * 0.35) {
    const windX = Math.cos(world.weather.windDirection);
    const windZ = Math.sin(world.weather.windDirection);
    const reach = v.radius * (2 + Math.random() * 4);
    const ax = v.x + windX * reach + (Math.random() - 0.5) * v.radius;
    const az = v.z + windZ * reach + (Math.random() - 0.5) * v.radius;
    applyAshfall(world, ax, az, v.radius * 1.2);
  }
}

/**
 * Ash smothers crops now and enriches the soil later. Both are recorded on the
 * tiles themselves, so the effect persists and is visible on the fertility map.
 */
export function applyAshfall(world: World, x: number, z: number, radius: number): void {
  const t = world.terrain;
  const ts = t.tileSize;
  const r = Math.ceil(radius / ts);
  const cx = t.tileX(x);
  const cz = t.tileZ(z);
  let hit = 0;

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx;
      const tz = cz + dz;
      if (!t.inBounds(tx, tz)) continue;
      const d = Math.hypot(dx, dz) * ts;
      if (d > radius) continue;
      const i = t.index(tx, tz);
      if (t.waterHeight[i] > t.data.height[i]) continue;
      // Volcanic soil is famously good, once the ash has weathered in.
      t.data.fertility[i] = clamp01(t.data.fertility[i] + 0.18);
      hit++;
    }
  }

  // Standing crops are ruined.
  for (const b of world.buildings) {
    if (b.fields.length === 0) continue;
    if (Math.hypot(b.worldX - x, b.worldZ - z) > radius + 12) continue;
    for (const plot of b.fields) {
      if (!plot.planted) continue;
      plot.growth = clamp(plot.growth - 0.5, 0, 1);
    }
  }

  if (hit > 0) world.onAshfall(x, z);
}

/** Marks the most likely volcanic ground during world generation. */
export function volcanicPotential(world: World, x: number, z: number): number {
  const biome = world.terrain.biomeAt(x, z);
  const h = world.terrain.heightAt(x, z);
  if (biome !== Biome.Mountain && biome !== Biome.Alpine) return 0;
  return clamp01((h - 30) / 80);
}
