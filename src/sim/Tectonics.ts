/**
 * The ground that everything else stands on.
 *
 * The map is divided into plates that are very slowly moving past each other.
 * Where two plates push together the ground between them is being shortened
 * and lifted; where they pull apart it is being stretched and dropped; where
 * they grind sideways neither happens but the rock still binds.
 *
 * Stress builds along every boundary at a rate set by how fast those two
 * plates are converging or sliding. It does not release on a schedule: it
 * releases when the rock can no longer hold it, which is why a quiet fault is
 * a fault that is loading, and why the longest quiet is followed by the worst
 * shaking. An earthquake drops the stress along the segment that went, so the
 * same fault cannot go twice in a row.
 *
 * Mountain building runs on the same numbers but at geological pace: it is
 * invisible over a lifetime and unmistakable over a pre-simulated age, which
 * is exactly how the world is meant to feel.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import { Terrain } from '../world/Terrain';
import { boundaryMotion, makePlates, PlateMap } from '../world/Plates';
import type { BoundaryKind } from '../world/Plates';
import type { World } from './World';

export type { BoundaryKind };

export interface Plate {
  id: number;
  name: string;
  /** Voronoi seed, in world metres. */
  x: number;
  z: number;
  /** Drift, in metres per thousand years. Small, and constant. */
  driftX: number;
  driftZ: number;
  /** Oceanic plates subduct under continental ones. */
  oceanic: boolean;
}

/** One stretch of the line between two plates. */
export interface FaultSegment {
  id: number;
  plateA: number;
  plateB: number;
  x: number;
  z: number;
  kind: BoundaryKind;
  /**
   * How fast the two sides are moving against each other here, in metres per
   * thousand years. Drives both loading rate and how big a rupture can be.
   */
  closingRate: number;
  /** Accumulated elastic strain, 0..1+. Above 1 the rock gives way. */
  stress: number;
  /** How much stress this rock can hold before it goes. */
  strength: number;
  /** Game days since this segment last ruptured, or -1 if it never has. */
  lastRupture: number;
}

/** Metres between fault sample points. */
const SEGMENT_SPACING = 18;

export class Tectonics {
  readonly plates: Plate[] = [];
  readonly faults: FaultSegment[] = [];
  /** Which plate owns each terrain tile, one byte per tile. */
  readonly plateOf: Uint8Array;

  private rng: Rng;
  private terrain: Terrain;
  private seed: number;
  private map!: PlateMap;
  private nextSegmentId = 1;
  /** Game hours of loading not yet applied, so slow drift is not lost. */
  private pending = 0;

  constructor(terrain: Terrain, seed: number, namePlate: (key: number) => string) {
    this.terrain = terrain;
    this.seed = seed;
    this.rng = new Rng(seed ^ 0x7ec7);
    this.plateOf = new Uint8Array(terrain.gridSize * terrain.gridSize);

    this.seedPlates(namePlate);
    this.assignTiles();
    this.traceFaults();
  }

  // =======================================================================
  // Building the map of plates
  // =======================================================================

  private seedPlates(namePlate: (key: number) => string): void {
    // The same plates the generator raised the land from, rebuilt from the
    // same seed. This is what makes the fault that shakes a town the fault
    // that built the mountains behind it, rather than a second, unrelated set
    // of lines drawn over a finished map.
    for (const seed of makePlates(this.seed, this.terrain.worldSize)) {
      this.plates.push({ ...seed, name: namePlate(seed.id) });
    }
    this.map = new PlateMap(this.plates, this.seed, this.terrain.worldSize);
  }

  private assignTiles(): void {
    const t = this.terrain;
    for (let tz = 0; tz < t.gridSize; tz++) {
      for (let tx = 0; tx < t.gridSize; tx++) {
        this.plateOf[tz * t.gridSize + tx] = this.map.plateIdAt(tx * t.tileSize, tz * t.tileSize);
      }
    }
  }

  /** Walks the map and records every point where two plates meet. */
  private traceFaults(): void {
    const t = this.terrain;
    const step = Math.max(1, Math.round(SEGMENT_SPACING / t.tileSize));
    for (let tz = 0; tz < t.gridSize - step; tz += step) {
      for (let tx = 0; tx < t.gridSize - step; tx += step) {
        const a = this.plateOf[tz * t.gridSize + tx];
        const right = this.plateOf[tz * t.gridSize + tx + step];
        const down = this.plateOf[(tz + step) * t.gridSize + tx];
        const other = a !== right ? right : a !== down ? down : -1;
        if (other < 0) continue;
        this.addSegment(a, other, tx * t.tileSize, tz * t.tileSize);
      }
    }
  }

  private addSegment(aId: number, bId: number, x: number, z: number): void {
    const { kind, rate: closingRate } = boundaryMotion(this.plates[aId], this.plates[bId]);

    this.faults.push({
      id: this.nextSegmentId++,
      plateA: aId,
      plateB: bId,
      x,
      z,
      kind,
      closingRate,
      stress: this.rng.range(0, 0.4),
      // Transform faults lock harder and let go more violently; the rock
      // along a spreading ridge is warm and gives way early.
      strength:
        kind === 'transform'
          ? this.rng.range(0.85, 1.25)
          : kind === 'convergent'
            ? this.rng.range(0.7, 1.1)
            : this.rng.range(0.4, 0.75),
      lastRupture: -1,
    });
  }

  // =======================================================================
  // Loading and release
  // =======================================================================

  /**
   * Advances the faults. Stress grows in proportion to how fast the rock is
   * being pushed, and a segment ruptures when it exceeds what it can hold.
   */
  update(world: World, hours: number): void {
    if (this.faults.length === 0) return;
    this.pending += hours;
    // Strain accrues over years, so there is nothing to do every quarter hour.
    if (this.pending < 24) return;
    const days = this.pending / 24;
    this.pending = 0;

    for (const f of this.faults) {
      // Loading rate: metres per thousand years, scaled to something a
      // decades-long game can feel without being a rupture a week.
      //
      // Slower than it was. At the old rate a single fault let go about every
      // fifteen years, which over the seven centuries a late world lives
      // through before the player arrives is fifty ruptures per segment and
      // several thousand earthquakes -- more shaking than any real margin has
      // ever produced, and most of the time a world spent being made.
      f.stress += (f.closingRate / 1000) * days * 0.006;
      if (f.stress < f.strength) continue;
      this.rupture(world, f);
    }

    this.buildMountains(days);
  }

  /** The rock gives way. What it does is set by how much it was holding. */
  private rupture(world: World, f: FaultSegment): void {
    // Everything the segment had stored goes at once.
    const released = f.stress;
    const magnitude = clamp01(0.25 + released * 0.45 + f.closingRate / 90);
    // How far the shaking reaches, in metres rather than as a fraction of the
    // map. A quake is a physical event with a physical size: making its reach
    // proportional to the world meant that enlarging the world enlarged every
    // earthquake in it, and a great shock covering a third of a continent is
    // both wrong and ruinously expensive to apply.
    const radius = Math.min(
      world.terrain.worldSize * 0.45,
      260 + magnitude * magnitude * 1400,
    );

    f.stress = 0;
    f.strength = this.rng.range(0.55, 1.3);
    f.lastRupture = world.time.totalDays;

    // Neighbouring rock is unloaded a little too: a rupture does not leave
    // the fault either side of it untouched.
    for (const other of this.faults) {
      if (other === f) continue;
      const d = Math.hypot(other.x - f.x, other.z - f.z);
      if (d > radius * 0.6) continue;
      other.stress = Math.max(0, other.stress - released * 0.35 * (1 - d / (radius * 0.6)));
    }

    world.disasters.earthquake(world, f.x, f.z, magnitude, radius);

    // A convergent boundary lifts the ground it just shortened, and a
    // divergent one drops it. This is the only part of mountain building
    // fast enough to see happen.
    if (f.kind === 'convergent' && magnitude > 0.5) {
      world.editor.sculpt(f.x, f.z, radius * 0.3, magnitude * 1.4, 'dome', 'uplift');
      world.markTerrainChanged();
    } else if (f.kind === 'divergent' && magnitude > 0.5) {
      world.editor.sculpt(f.x, f.z, radius * 0.25, -magnitude * 1.2, 'dome', 'rift');
      world.markTerrainChanged();
    }
  }

  /**
   * The slow part. Over a human lifetime this is nothing; over a pre-simulated
   * age it is the reason there are mountains where the plates collide and a
   * trench where they part.
   */
  private buildMountains(days: number): void {
    const t = this.terrain;
    const metresPerDay = 1 / 400000; // roughly a millimetre a year
    for (const f of this.faults) {
      if (f.kind === 'transform') continue;
      const sign = f.kind === 'convergent' ? 1 : -1;
      const rise = sign * f.closingRate * metresPerDay * days;
      if (Math.abs(rise) < 1e-9) continue;
      const tx = t.tileX(f.x);
      const tz = t.tileZ(f.z);
      const reach = 3;
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (!t.inBounds(tx + dx, tz + dz)) continue;
          const falloff = 1 - Math.hypot(dx, dz) / (reach + 1);
          if (falloff <= 0) continue;
          const i = t.index(tx + dx, tz + dz);
          t.data.height[i] = Math.max(-40, t.data.height[i] + rise * falloff);
        }
      }
    }
  }

  // =======================================================================
  // Readouts
  // =======================================================================

  plateAt(worldX: number, worldZ: number): Plate | null {
    const t = this.terrain;
    const i = t.index(t.tileX(worldX), t.tileZ(worldZ));
    return this.plates[this.plateOf[i]] ?? null;
  }

  /** The most loaded fault, which is where the next earthquake will be. */
  mostStressed(): FaultSegment | null {
    let best: FaultSegment | null = null;
    for (const f of this.faults) {
      if (!best || f.stress / f.strength > best.stress / best.strength) best = f;
    }
    return best;
  }

  /** 0..1 how close this world is to its next rupture anywhere. */
  seismicRisk(): number {
    const f = this.mostStressed();
    return f ? clamp01(f.stress / Math.max(0.01, f.strength)) : 0;
  }

  /** How loaded the rock is under a point, for the risk maps. */
  stressAt(worldX: number, worldZ: number): number {
    let best = 0;
    const reach = this.terrain.worldSize * 0.12;
    for (const f of this.faults) {
      const d = Math.hypot(f.x - worldX, f.z - worldZ);
      if (d > reach) continue;
      const w = 1 - d / reach;
      best = Math.max(best, (f.stress / Math.max(0.01, f.strength)) * w);
    }
    return clamp01(best);
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    // The plate layout is derived from the seed, so only the live state of
    // each fault has to travel.
    return {
      faults: this.faults.map((f) => ({
        stress: f.stress,
        strength: f.strength,
        lastRupture: f.lastRupture,
      })),
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data || !Array.isArray(data.faults)) return;
    const rows = data.faults as Record<string, unknown>[];
    for (let i = 0; i < this.faults.length && i < rows.length; i++) {
      const raw = rows[i];
      if (!raw || typeof raw !== 'object') continue;
      const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      this.faults[i].stress = clamp(num(raw.stress, 0), 0, 6);
      this.faults[i].strength = clamp(num(raw.strength, 1), 0.1, 3);
      this.faults[i].lastRupture = num(raw.lastRupture, -1);
    }
  }
}
