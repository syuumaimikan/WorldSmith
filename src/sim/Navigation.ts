/**
 * Tile-grid navigation.
 *
 * A* over the terrain with real movement costs, so people prefer roads, avoid
 * steep ground and route around water and buildings instead of walking through
 * them. Path requests are budgeted per tick: with hundreds of settlers all
 * deciding where to go, unbounded pathfinding is the first thing to melt a
 * frame, so requests queue rather than all resolving at once.
 */

import { Terrain, OVERLAY } from '../world/Terrain';

export interface PathPoint {
  x: number;
  z: number;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export class Navigation {
  private terrain: Terrain;
  private N: number;
  /** Non-zero where a building or other permanent obstruction stands. */
  readonly blocked: Uint8Array;
  /** Cached per-tile movement cost; rebuilt when the overlay changes. */
  private costCache: Float32Array;
  private costDirty = true;

  private gScore: Float32Array;
  private fScore: Float32Array;
  private cameFrom: Int32Array;
  private stamp: Int32Array;
  private currentStamp = 0;
  private open: PathHeap;
  private closed: Uint8Array;

  /** Path requests remaining this tick. */
  private budget = 0;
  /** Tuning: how many A* nodes may be expanded for one path. */
  maxExpansions = 5200;

  stats = { pathsFound: 0, pathsFailed: 0, expansions: 0, queued: 0 };

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.N = terrain.gridSize;
    const total = this.N * this.N;
    this.blocked = new Uint8Array(total);
    this.costCache = new Float32Array(total);
    this.gScore = new Float32Array(total);
    this.fScore = new Float32Array(total);
    this.cameFrom = new Int32Array(total);
    this.stamp = new Int32Array(total);
    this.closed = new Uint8Array(total);
    this.open = new PathHeap(4096);
  }

  markCostDirty(): void {
    this.costDirty = true;
  }

  private rebuildCosts(): void {
    const t = this.terrain;
    for (let i = 0; i < this.costCache.length; i++) {
      const tx = i % this.N;
      const tz = (i / this.N) | 0;
      this.costCache[i] = t.moveCostAt(tx, tz);
    }
    this.costDirty = false;
  }

  setBlocked(tx: number, tz: number, value: boolean): void {
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return;
    this.blocked[tz * this.N + tx] = value ? 1 : 0;
  }

  blockRect(tx: number, tz: number, w: number, d: number, value: boolean): void {
    for (let z = tz; z < tz + d; z++) for (let x = tx; x < tx + w; x++) this.setBlocked(x, z, value);
  }

  isWalkable(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return false;
    const i = tz * this.N + tx;
    if (this.blocked[i]) return false;
    if (this.costDirty) this.rebuildCosts();
    return this.costCache[i] < Infinity;
  }

  cost(tx: number, tz: number): number {
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return Infinity;
    const i = tz * this.N + tx;
    if (this.blocked[i]) return Infinity;
    if (this.costDirty) this.rebuildCosts();
    return this.costCache[i];
  }

  /** Called once per simulation tick. */
  resetBudget(perTick: number): void {
    this.budget = perTick;
    this.stats.queued = 0;
  }

  get hasBudget(): boolean {
    return this.budget > 0;
  }

  /** Nearest walkable tile to a target, used when a destination is blocked. */
  nearestWalkable(tx: number, tz: number, maxRadius = 6): { tx: number; tz: number } | null {
    if (this.isWalkable(tx, tz)) return { tx, tz };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.isWalkable(tx + dx, tz + dz)) return { tx: tx + dx, tz: tz + dz };
        }
      }
    }
    return null;
  }

  /**
   * Finds a path in world coordinates. Returns null when no route exists or the
   * per-tick budget is exhausted — callers should retry next tick rather than
   * treating null as "unreachable forever".
   */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): PathPoint[] | null {
    if (this.budget <= 0) {
      this.stats.queued++;
      return null;
    }
    this.budget--;

    const t = this.terrain;
    const ts = t.tileSize;
    const N = this.N;
    if (this.costDirty) this.rebuildCosts();

    const sx = t.tileX(fromX);
    const sz = t.tileZ(fromZ);
    let gx = t.tileX(toX);
    let gz = t.tileZ(toZ);

    const goalFix = this.nearestWalkable(gx, gz, 8);
    if (!goalFix) {
      this.stats.pathsFailed++;
      return null;
    }
    gx = goalFix.tx;
    gz = goalFix.tz;

    const startIdx = sz * N + sx;
    const goalIdx = gz * N + gx;
    if (startIdx === goalIdx) return [{ x: toX, z: toZ }];

    this.currentStamp++;
    const stampNow = this.currentStamp;
    this.open.clear();

    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = heuristic(sx, sz, gx, gz);
    this.cameFrom[startIdx] = -1;
    this.stamp[startIdx] = stampNow;
    this.closed[startIdx] = 0;
    this.open.push(this.fScore[startIdx], startIdx);

    let expansions = 0;
    let found = false;
    let bestIdx = startIdx;
    let bestH = this.fScore[startIdx];

    while (this.open.size > 0 && expansions < this.maxExpansions) {
      const current = this.open.pop();
      if (this.closed[current] === 1 && this.stamp[current] === stampNow) continue;
      this.closed[current] = 1;
      this.stamp[current] = stampNow;
      expansions++;

      if (current === goalIdx) {
        found = true;
        break;
      }

      const cx = current % N;
      const cz = (current / N) | 0;
      const h = heuristic(cx, cz, gx, gz);
      if (h < bestH) {
        bestH = h;
        bestIdx = current;
      }

      for (let d = 0; d < DIRS.length; d++) {
        const nx = cx + DIRS[d][0];
        const nz = cz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (this.blocked[ni]) continue;
        const tileCost = this.costCache[ni];
        if (tileCost === Infinity) continue;

        // Do not cut corners diagonally through a blocked tile.
        if (DIRS[d][0] !== 0 && DIRS[d][1] !== 0) {
          if (this.blocked[cz * N + nx] || this.blocked[nz * N + cx]) continue;
          if (this.costCache[cz * N + nx] === Infinity || this.costCache[nz * N + cx] === Infinity) continue;
        }

        const stepCost = DIRS[d][2] * tileCost * ts;
        const tentative = this.gScore[current] + stepCost;
        const seen = this.stamp[ni] === stampNow;
        if (seen && this.closed[ni] === 1) continue;
        if (!seen || tentative < this.gScore[ni]) {
          this.gScore[ni] = tentative;
          this.fScore[ni] = tentative + heuristic(nx, nz, gx, gz) * ts * 1.15;
          this.cameFrom[ni] = current;
          this.stamp[ni] = stampNow;
          this.closed[ni] = 0;
          this.open.push(this.fScore[ni], ni);
        }
      }
    }

    this.stats.expansions = expansions;

    // If we ran out of budget, walk toward the closest point we reached — a
    // partial path still makes progress and avoids people freezing in place.
    const endIdx = found ? goalIdx : bestIdx;
    if (!found && endIdx === startIdx) {
      this.stats.pathsFailed++;
      return null;
    }
    if (found) this.stats.pathsFound++;

    const tiles: number[] = [];
    let cur = endIdx;
    let guard = 0;
    while (cur !== -1 && guard++ < 20000) {
      tiles.push(cur);
      if (cur === startIdx) break;
      cur = this.cameFrom[cur];
    }
    tiles.reverse();

    const points = this.smooth(tiles, ts);
    if (found) {
      points[points.length - 1] = { x: toX, z: toZ };
    }
    return points;
  }

  /**
   * Removes intermediate waypoints that a straight line already covers. Keeps
   * walking looking purposeful instead of stair-stepping across open ground.
   */
  private smooth(tiles: number[], ts: number): PathPoint[] {
    const N = this.N;
    const toPoint = (i: number): PathPoint => ({
      x: ((i % N) + 0.5) * ts,
      z: (((i / N) | 0) + 0.5) * ts,
    });
    if (tiles.length <= 2) return tiles.map(toPoint);

    const out: PathPoint[] = [toPoint(tiles[0])];
    let anchor = 0;
    for (let i = 2; i < tiles.length; i++) {
      if (!this.lineClear(tiles[anchor], tiles[i])) {
        out.push(toPoint(tiles[i - 1]));
        anchor = i - 1;
      }
    }
    out.push(toPoint(tiles[tiles.length - 1]));
    return out;
  }

  private lineClear(a: number, b: number): boolean {
    const N = this.N;
    let x0 = a % N;
    let z0 = (a / N) | 0;
    const x1 = b % N;
    const z1 = (b / N) | 0;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let guard = 0;
    for (;;) {
      if (guard++ > 512) return false;
      const i = z0 * N + x0;
      if (this.blocked[i] || this.costCache[i] === Infinity) return false;
      // Reject shortcuts that cross much steeper ground than the tiles imply.
      if (this.costCache[i] > 2.6) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }
  }

  /** Marks a tile as a walked route so paths and traffic reinforce each other. */
  isRoad(tx: number, tz: number): boolean {
    return this.terrain.hasOverlay(tx, tz, OVERLAY.Road | OVERLAY.Path);
  }
}

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  // Octile distance.
  return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

/** Binary heap specialised for (float key, int payload). */
class PathHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(key: number, val: number): void {
    if (this.n >= this.keys.length) this.grow();
    let i = this.n++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): number {
    const top = this.vals[0];
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n];
      this.vals[0] = this.vals[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.keys[l] < this.keys[m]) m = l;
        if (r < this.n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }

  private grow(): void {
    const nk = new Float64Array(this.keys.length * 2);
    nk.set(this.keys);
    this.keys = nk;
    const nv = new Int32Array(this.vals.length * 2);
    nv.set(this.vals);
    this.vals = nv;
  }
}
