/**
 * Runtime accessor around the generated terrain layers.
 *
 * Owns sampling (bilinear height, normals), coordinate conversion, and the
 * mutable *overlay* layer that gameplay writes into (roads, tilled fields,
 * cleared ground). Terrain height itself is immutable after generation.
 */

import { clamp, clamp01 } from '../core/math';
import { Biome, TerrainData } from './types';
import { NO_WATER } from './TerrainGen';

/** Bit flags for the mutable per-tile overlay. */
export const OVERLAY = {
  None: 0,
  Path: 1 << 0,
  Road: 1 << 1,
  Field: 1 << 2,
  Tilled: 1 << 3,
  Floor: 1 << 4,
  Reserved: 1 << 5,
  Trampled: 1 << 6,
  Burnt: 1 << 7,
} as const;

export class Terrain {
  readonly data: TerrainData;
  readonly waterHeight: Float32Array;
  readonly overlay: Uint8Array;
  /** Foot traffic per tile; enough of it wears a natural path. */
  readonly traffic: Float32Array;
  readonly gridSize: number;
  readonly tileSize: number;
  readonly worldSize: number;
  /** Chunks whose mesh must be rebuilt because overlay changed. */
  readonly dirtyChunks = new Set<number>();
  chunkTiles = 32;

  constructor(data: TerrainData, waterHeight: Float32Array, overlay?: Uint8Array, traffic?: Float32Array) {
    this.data = data;
    this.waterHeight = waterHeight;
    this.gridSize = data.gridSize;
    this.tileSize = data.tileSize;
    this.worldSize = data.gridSize * data.tileSize;
    this.overlay = overlay ?? new Uint8Array(data.gridSize * data.gridSize);
    this.traffic = traffic ?? new Float32Array(data.gridSize * data.gridSize);
  }

  // ------------------------------------------------------------ coordinates

  /** World metres -> tile index (floored). */
  tileX(worldX: number): number {
    return clamp(Math.floor(worldX / this.tileSize), 0, this.gridSize - 1);
  }

  tileZ(worldZ: number): number {
    return clamp(Math.floor(worldZ / this.tileSize), 0, this.gridSize - 1);
  }

  index(tx: number, tz: number): number {
    return tz * this.gridSize + tx;
  }

  inBounds(tx: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && tx < this.gridSize && tz < this.gridSize;
  }

  worldXOf(tx: number): number {
    return tx * this.tileSize;
  }

  worldZOf(tz: number): number {
    return tz * this.tileSize;
  }

  /** Whether a point in metres is inside the world at all. */
  inWorld(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x <= this.worldSize && z <= this.worldSize;
  }

  /** Centre of the world in metres, handy for camera defaults. */
  get centre(): [number, number] {
    return [this.worldSize / 2, this.worldSize / 2];
  }

  // ---------------------------------------------------------------- sampling

  heightAtTile(tx: number, tz: number): number {
    if (!this.inBounds(tx, tz)) return 0;
    return this.data.height[tz * this.gridSize + tx];
  }

  /** Bilinear-interpolated ground height at world position. */
  heightAt(worldX: number, worldZ: number): number {
    const fx = worldX / this.tileSize;
    const fz = worldZ / this.tileSize;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = this.heightAtTile(x0, z0);
    const h10 = this.heightAtTile(x0 + 1, z0);
    const h01 = this.heightAtTile(x0, z0 + 1);
    const h11 = this.heightAtTile(x0 + 1, z0 + 1);
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  /** Surface height including any floor/road overlay lift. */
  walkHeightAt(worldX: number, worldZ: number): number {
    return this.heightAt(worldX, worldZ);
  }

  /** Ground normal at world position, via central differences. */
  normalAt(worldX: number, worldZ: number, out: [number, number, number]): [number, number, number] {
    const e = this.tileSize;
    const hl = this.heightAt(worldX - e, worldZ);
    const hr = this.heightAt(worldX + e, worldZ);
    const hd = this.heightAt(worldX, worldZ - e);
    const hu = this.heightAt(worldX, worldZ + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
  }

  slopeAt(worldX: number, worldZ: number): number {
    const i = this.index(this.tileX(worldX), this.tileZ(worldZ));
    return this.data.slope[i];
  }

  biomeAt(worldX: number, worldZ: number): Biome {
    const i = this.index(this.tileX(worldX), this.tileZ(worldZ));
    return this.data.biome[i] as Biome;
  }

  biomeAtTile(tx: number, tz: number): Biome {
    if (!this.inBounds(tx, tz)) return Biome.Ocean;
    return this.data.biome[tz * this.gridSize + tx] as Biome;
  }

  temperatureAt(worldX: number, worldZ: number): number {
    return this.data.temperature[this.index(this.tileX(worldX), this.tileZ(worldZ))];
  }

  moistureAt(worldX: number, worldZ: number): number {
    return this.data.moisture[this.index(this.tileX(worldX), this.tileZ(worldZ))];
  }

  fertilityAt(worldX: number, worldZ: number): number {
    return this.data.fertility[this.index(this.tileX(worldX), this.tileZ(worldZ))];
  }

  waterAtTile(tx: number, tz: number): number {
    if (!this.inBounds(tx, tz)) return 0;
    return this.waterHeight[tz * this.gridSize + tx];
  }

  /** Depth of water at a world position; 0 if dry land. */
  waterDepthAt(worldX: number, worldZ: number): number {
    const tx = this.tileX(worldX);
    const tz = this.tileZ(worldZ);
    const w = this.waterHeight[this.index(tx, tz)];
    if (w === NO_WATER) return 0;
    return Math.max(0, w - this.heightAt(worldX, worldZ));
  }

  isWaterTile(tx: number, tz: number): boolean {
    if (!this.inBounds(tx, tz)) return true;
    const i = tz * this.gridSize + tx;
    return this.waterHeight[i] > this.data.height[i] + 0.05;
  }

  // ----------------------------------------------------------------- overlay

  overlayAt(tx: number, tz: number): number {
    if (!this.inBounds(tx, tz)) return 0;
    return this.overlay[tz * this.gridSize + tx];
  }

  hasOverlay(tx: number, tz: number, flag: number): boolean {
    return (this.overlayAt(tx, tz) & flag) !== 0;
  }

  setOverlay(tx: number, tz: number, flag: number): void {
    if (!this.inBounds(tx, tz)) return;
    const i = tz * this.gridSize + tx;
    if ((this.overlay[i] & flag) === flag) return;
    this.overlay[i] |= flag;
    this.markTileDirty(tx, tz);
  }

  clearOverlay(tx: number, tz: number, flag: number): void {
    if (!this.inBounds(tx, tz)) return;
    const i = tz * this.gridSize + tx;
    if ((this.overlay[i] & flag) === 0) return;
    this.overlay[i] &= ~flag;
    this.markTileDirty(tx, tz);
  }

  /**
   * Accumulate foot traffic. Enough repeated use converts open ground into a
   * visible desire path, which is how the world records where people walk.
   */
  addTraffic(worldX: number, worldZ: number, amount: number): void {
    const tx = this.tileX(worldX);
    const tz = this.tileZ(worldZ);
    const i = this.index(tx, tz);
    if (this.overlay[i] & (OVERLAY.Road | OVERLAY.Path | OVERLAY.Field | OVERLAY.Floor)) return;
    const before = this.traffic[i];
    const after = Math.min(220, before + amount);
    this.traffic[i] = after;
    if (before < 60 && after >= 60) this.setOverlay(tx, tz, OVERLAY.Trampled);
  }

  markTileDirty(tx: number, tz: number): void {
    const cs = this.chunkTiles;
    const cx = Math.floor(tx / cs);
    const cz = Math.floor(tz / cs);
    const perRow = Math.ceil(this.gridSize / cs);
    this.dirtyChunks.add(cz * perRow + cx);
    // Tiles on a chunk edge affect the neighbour's seam colours.
    if (tx % cs === 0 && cx > 0) this.dirtyChunks.add(cz * perRow + cx - 1);
    if (tz % cs === 0 && cz > 0) this.dirtyChunks.add((cz - 1) * perRow + cx);
  }

  /**
   * Marches a ray against the heightfield. Far cheaper and more reliable than
   * raycasting the chunk meshes, which are rebuilt constantly and use skirts
   * that would produce false hits.
   *
   * @returns the world-space hit point, or null if the ray leaves the map.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDistance = 900,
  ): { x: number; y: number; z: number } | null {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;

    let t = 0;
    let step = this.tileSize * 0.6;
    let prevT = 0;
    let prevAbove = oy - this.heightAt(ox, oz) > 0;

    while (t < maxDistance) {
      t += step;
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      if (x < 0 || z < 0 || x > this.worldSize || z > this.worldSize) {
        if (y < this.data.minHeight - 20) return null;
        if (t > maxDistance) return null;
        continue;
      }
      const above = y - this.heightAt(x, z) > 0;
      if (prevAbove && !above) {
        // Bisect between the last two samples for a clean hit point.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = ox + dx * mid;
          const my = oy + dy * mid;
          const mz = oz + dz * mid;
          if (my - this.heightAt(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const hx = ox + dx * hi;
        const hz = oz + dz * hi;
        return { x: hx, y: this.heightAt(hx, hz), z: hz };
      }
      prevAbove = above;
      prevT = t;
      // Take bigger strides once we are far from the camera.
      step = Math.min(this.tileSize * 4, this.tileSize * 0.6 + t * 0.02);
    }
    return null;
  }

  /** Movement cost multiplier used by navigation. 1 = normal ground. */
  moveCostAt(tx: number, tz: number): number {
    if (!this.inBounds(tx, tz)) return Infinity;
    const i = tz * this.gridSize + tx;
    if (this.waterHeight[i] > this.data.height[i] + 0.7) return Infinity;
    const o = this.overlay[i];
    if (o & OVERLAY.Road) return 0.55;
    if (o & OVERLAY.Path) return 0.72;
    if (o & OVERLAY.Trampled) return 0.88;
    const s = this.data.slope[i];
    if (s > 0.85) return Infinity;
    let cost = 1 + s * 2.6;
    const b = this.data.biome[i] as Biome;
    if (b === Biome.Wetland) cost *= 1.5;
    if (b === Biome.DenseForest) cost *= 1.15;
    if (b === Biome.Alpine) cost *= 1.25;
    return cost;
  }

  isWalkableTile(tx: number, tz: number): boolean {
    return this.moveCostAt(tx, tz) < Infinity;
  }

  /** Flatness score over a footprint, used by building placement rules. */
  flatnessOver(tx: number, tz: number, w: number, d: number): { ok: boolean; minH: number; maxH: number } {
    let minH = Infinity;
    let maxH = -Infinity;
    for (let z = tz; z < tz + d; z++) {
      for (let x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, z)) return { ok: false, minH: 0, maxH: 0 };
        const i = z * this.gridSize + x;
        if (this.waterHeight[i] > this.data.height[i] + 0.15) return { ok: false, minH: 0, maxH: 0 };
        const h = this.data.height[i];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    return { ok: true, minH, maxH };
  }

  /** 0..1 how suitable a tile is as a settlement centre. */
  settlementScore(tx: number, tz: number): number {
    if (!this.inBounds(tx, tz)) return 0;
    const i = tz * this.gridSize + tx;
    const h = this.data.height[i];
    if (h < 2 || h > 70) return 0;
    if (this.waterHeight[i] > h) return 0;
    const slope = this.data.slope[i];
    if (slope > 0.2) return 0;
    let score = (1 - slope / 0.2) * 0.4;
    score += clamp01(this.data.fertility[i]) * 0.3;
    // Proximity to fresh water is the classic settlement driver.
    let waterNear = 0;
    for (let dz = -7; dz <= 7; dz += 2)
      for (let dx = -7; dx <= 7; dx += 2) {
        const j = (tz + dz) * this.gridSize + (tx + dx);
        if (j < 0 || j >= this.waterHeight.length) continue;
        if (this.waterHeight[j] > this.data.height[j]) waterNear++;
      }
    score += clamp01(waterNear / 10) * 0.3;
    return clamp01(score);
  }
}
