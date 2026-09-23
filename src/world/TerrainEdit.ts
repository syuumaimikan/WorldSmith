/**
 * Terrain modification.
 *
 * The heightfield is immutable during normal play, but god powers, volcanoes,
 * landslides and meteor strikes all reshape it. Every edit must keep the
 * derived layers consistent — slope, water surfaces, biome and fertility are
 * all computed from height, and a raised hill that still reports itself as
 * flat marshland is worse than no edit at all.
 *
 * Edits are recorded so they can be undone, and they report which chunks the
 * renderer has to rebuild.
 */

import { Terrain } from './Terrain';
import { Biome } from './types';
import { NO_WATER } from './TerrainGen';
import { clamp01, smoothstep } from '../core/math';

export interface TerrainEdit {
  /** Tile indices touched, with the height they had before. */
  indices: Int32Array;
  previous: Float32Array;
  previousWater: Float32Array;
  label: string;
}

export type EditShape = 'dome' | 'cone' | 'crater' | 'flatten';

export class TerrainEditor {
  private terrain: Terrain;
  private history: TerrainEdit[] = [];
  private maxHistory = 12;
  /**
   * Whether an edit keeps what it overwrote so it can be undone.
   *
   * On during play, because the god tools need it. Off while a world is
   * being lived out before the player arrives: centuries of tectonics is
   * thousands of edits over hundreds of thousands of tiles, and keeping the
   * previous height of every one of them so that somebody could undo an
   * earthquake from the fourth century is pure cost.
   */
  recordHistory = true;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Raises or lowers the ground. `amount` is metres at the centre; the effect
   * falls off smoothly to nothing at the radius so edits blend into the land.
   */
  sculpt(
    worldX: number,
    worldZ: number,
    radius: number,
    amount: number,
    shape: EditShape = 'dome',
    label = 'sculpt',
  ): TerrainEdit {
    const t = this.terrain;
    const ts = t.tileSize;
    const N = t.gridSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(worldX);
    const cz = t.tileZ(worldZ);

    const indices: number[] = [];
    const previous: number[] = [];
    const previousWater: number[] = [];

    // A flatten pass needs the target level before anything moves.
    let targetLevel = 0;
    if (shape === 'flatten') {
      let sum = 0;
      let n = 0;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r) continue;
          const tx = cx + dx;
          const tz = cz + dz;
          if (!t.inBounds(tx, tz)) continue;
          sum += t.data.height[tz * N + tx];
          n++;
        }
      }
      targetLevel = n > 0 ? sum / n : 0;
    }

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        const dist = Math.hypot(dx, dz) * ts;
        if (dist > radius) continue;
        const i = tz * N + tx;

        const falloff = 1 - smoothstep(0, radius, dist);
        let delta: number;
        switch (shape) {
          case 'cone':
            delta = amount * Math.pow(falloff, 0.65);
            break;
          case 'crater': {
            // Bowl in the middle, rim thrown up around it.
            const nd = dist / radius;
            const bowl = -Math.cos(clamp01(nd) * Math.PI) * 0.5 + 0.5;
            delta = amount * (bowl * 1.35 - 0.85) * (1 - smoothstep(0.85, 1, nd));
            break;
          }
          case 'flatten':
            delta = (targetLevel - t.data.height[i]) * falloff * clamp01(Math.abs(amount));
            break;
          default:
            delta = amount * falloff * falloff * (3 - 2 * falloff);
        }

        indices.push(i);
        previous.push(t.data.height[i]);
        previousWater.push(t.waterHeight[i]);
        t.data.height[i] += delta;
      }
    }

    const edit: TerrainEdit = {
      indices: Int32Array.from(indices),
      previous: Float32Array.from(previous),
      previousWater: Float32Array.from(previousWater),
      label,
    };
    this.finish(edit);
    return edit;
  }

  /** Opens a water source: floods the local depression up to `depth`. */
  flood(worldX: number, worldZ: number, radius: number, depth: number): TerrainEdit {
    const t = this.terrain;
    const ts = t.tileSize;
    const N = t.gridSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(worldX);
    const cz = t.tileZ(worldZ);
    const centreHeight = t.heightAt(worldX, worldZ);
    const level = centreHeight + depth;

    const indices: number[] = [];
    const previous: number[] = [];
    const previousWater: number[] = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        if (Math.hypot(dx, dz) * ts > radius) continue;
        const i = tz * N + tx;
        // Water only covers ground below the new level; it does not climb hills.
        if (t.data.height[i] >= level) continue;
        indices.push(i);
        previous.push(t.data.height[i]);
        previousWater.push(t.waterHeight[i]);
        t.waterHeight[i] = Math.max(t.waterHeight[i] === NO_WATER ? -Infinity : t.waterHeight[i], level);
      }
    }

    const edit: TerrainEdit = {
      indices: Int32Array.from(indices),
      previous: Float32Array.from(previous),
      previousWater: Float32Array.from(previousWater),
      label: 'flood',
    };
    this.finish(edit);
    return edit;
  }

  /** Removes surface water from an area. */
  drain(worldX: number, worldZ: number, radius: number): TerrainEdit {
    const t = this.terrain;
    const ts = t.tileSize;
    const N = t.gridSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(worldX);
    const cz = t.tileZ(worldZ);

    const indices: number[] = [];
    const previous: number[] = [];
    const previousWater: number[] = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        if (Math.hypot(dx, dz) * ts > radius) continue;
        const i = tz * N + tx;
        if (t.waterHeight[i] === NO_WATER) continue;
        // The sea cannot be drained; only standing water above it.
        if (t.data.height[i] < 0) continue;
        indices.push(i);
        previous.push(t.data.height[i]);
        previousWater.push(t.waterHeight[i]);
        t.waterHeight[i] = NO_WATER;
      }
    }

    const edit: TerrainEdit = {
      indices: Int32Array.from(indices),
      previous: Float32Array.from(previous),
      previousWater: Float32Array.from(previousWater),
      label: 'drain',
    };
    this.finish(edit);
    return edit;
  }

  undo(): boolean {
    const edit = this.history.pop();
    if (!edit) return false;
    const t = this.terrain;
    for (let k = 0; k < edit.indices.length; k++) {
      const i = edit.indices[k];
      t.data.height[i] = edit.previous[k];
      t.waterHeight[i] = edit.previousWater[k];
    }
    this.refreshDerived(edit.indices);
    return true;
  }

  private finish(edit: TerrainEdit): void {
    if (this.recordHistory) {
      this.history.push(edit);
      if (this.history.length > this.maxHistory) this.history.shift();
    }
    this.refreshDerived(edit.indices);
  }

  /**
   * Recomputes slope, water consistency and biome for the edited tiles and a
   * one-tile margin, then marks the affected chunks for rebuild.
   */
  private refreshDerived(indices: Int32Array): void {
    const t = this.terrain;
    const N = t.gridSize;
    const touched = new Set<number>();
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const x = i % N;
      const z = (i / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          touched.add(nz * N + nx);
        }
      }
    }

    for (const i of touched) {
      const x = i % N;
      const z = (i / N) | 0;
      const h = t.data.height[i];

      // Slope from central differences, same as generation.
      const xm = x > 0 ? t.data.height[i - 1] : h;
      const xp = x < N - 1 ? t.data.height[i + 1] : h;
      const zm = z > 0 ? t.data.height[i - N] : h;
      const zp = z < N - 1 ? t.data.height[i + N] : h;
      const gx = (xp - xm) / (2 * t.tileSize);
      const gz = (zp - zm) / (2 * t.tileSize);
      t.data.slope[i] = Math.atan(Math.hypot(gx, gz));

      // Ground pushed above its own water surface is no longer submerged.
      if (t.waterHeight[i] !== NO_WATER && t.waterHeight[i] < h) {
        t.waterHeight[i] = h < 0 ? 0 : NO_WATER;
      }
      // Ground pushed below sea level floods.
      if (h < 0 && t.waterHeight[i] === NO_WATER) t.waterHeight[i] = 0;

      t.data.biome[i] = reclassify(t, i, h);
      t.markTileDirty(x, z);
    }
  }
}

/**
 * Lightweight biome reclassification after an edit. Climate does not change,
 * so only the height- and slope-driven distinctions need revisiting.
 */
function reclassify(t: Terrain, i: number, h: number): Biome {
  const water = t.waterHeight[i];
  if (water !== NO_WATER && water > h) {
    return h > 0.2 ? Biome.Lake : Biome.Ocean;
  }
  const slope = t.data.slope[i];
  const temp = t.data.temperature[i];
  const previous = t.data.biome[i] as Biome;

  if (h < 1.6 && slope < 0.12) return Biome.Beach;
  if (slope > 0.62) return temp < -4 ? Biome.Alpine : Biome.Mountain;
  if (temp < -7) return Biome.Alpine;

  // Anything that was water and is now dry becomes plain ground rather than
  // keeping a lake biome.
  if (previous === Biome.Ocean || previous === Biome.Lake || previous === Biome.River) {
    return temp < 0 ? Biome.Tundra : Biome.Grassland;
  }
  return previous;
}
