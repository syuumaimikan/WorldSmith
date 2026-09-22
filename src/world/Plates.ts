/**
 * The plates the world is built on.
 *
 * Every continent on Earth is the top of a slab of crust, and every mountain
 * range, trench, island arc and rift valley on it is a consequence of what
 * that slab is doing against its neighbours. A world generated from noise has
 * mountains where the noise happened to be high; a world generated from plates
 * has them where two plates are pushing, which is why its coastlines have
 * shapes you recognise — a cordillera down one seaboard, a shelf and a broad
 * plain down the other, a string of volcanic islands standing offshore of a
 * trench.
 *
 * This module is the single source of truth for that layout. The generator
 * uses it to raise the land, and the running simulation's tectonics uses the
 * same plates to load the same faults, so the earthquake that flattens a town
 * happens on the boundary that built the mountains behind it. Both derive
 * everything from the world seed, so neither has to ship the other a map.
 *
 * Kept free of DOM and three.js: this runs inside the generation worker.
 */

import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { TAU } from '../core/math';

/** Plates per world. Few enough to read on a map, many enough to be varied. */
export const PLATE_COUNT = 9;

export interface PlateSeed {
  id: number;
  /** Voronoi seed, in world metres. */
  x: number;
  z: number;
  /** Drift, in metres per thousand years. Small, and constant. */
  driftX: number;
  driftZ: number;
  /**
   * Oceanic crust is thin, dense and young; continental crust is thick, light
   * and old. Which one a plate is made of decides whether it floats high
   * enough to be dry land, and which of two colliding plates goes under.
   */
  oceanic: boolean;
}

export type BoundaryKind = 'convergent' | 'divergent' | 'transform';

/** What is happening where two particular plates meet. */
export interface BoundaryMotion {
  kind: BoundaryKind;
  /** Metres per thousand years, always positive. */
  rate: number;
  /**
   * Signed motion along the line joining the two plate centres. Negative
   * means they are closing on each other.
   */
  normal: number;
}

/** A plume in the mantle, which does not care where the plates are. */
export interface Hotspot {
  x: number;
  z: number;
  /** Direction the plate above it is carrying its old volcanoes. */
  driftX: number;
  driftZ: number;
  strength: number;
  /** How far back along the drift the chain still breaks the surface. */
  length: number;
  /** Metres between one island and the next. */
  spacing: number;
}

export interface PlateQuery {
  /** The plate this point sits on. */
  a: PlateSeed;
  /** The nearest other plate. */
  b: PlateSeed;
  /** Metres from this point to the boundary between them. */
  edge: number;
}

/**
 * The plates of a world, derived from its seed alone.
 *
 * Keep the derivation stable: the running game rebuilds these from the same
 * seed and expects to get the map the land was shaped from.
 */
export function makePlates(seed: number, worldSize: number): PlateSeed[] {
  const rng = new Rng(seed ^ 0x7ec7);
  const plates: PlateSeed[] = [];

  // Seeds are jittered on a loose grid rather than thrown down at random.
  // Pure random points clump, and a clump of plate seeds is a shoal of tiny
  // plates beside one that covers half the world.
  const cols = 3;
  const rows = Math.ceil(PLATE_COUNT / cols);
  const cell = worldSize / cols;
  for (let i = 0; i < PLATE_COUNT; i++) {
    const cx = ((i % cols) + 0.5) * cell;
    const cz = ((Math.floor(i / cols) % rows) + 0.5) * (worldSize / rows);
    const angle = rng.range(0, TAU);
    const speed = rng.range(8, 46);
    plates.push({
      id: i,
      x: cx + rng.range(-cell * 0.42, cell * 0.42),
      z: cz + rng.range(-cell * 0.42, cell * 0.42),
      driftX: Math.cos(angle) * speed,
      driftZ: Math.sin(angle) * speed,
      oceanic: false,
    });
  }

  // Most of the Earth's surface is ocean floor, and it is not distributed by
  // coin flip: a couple of big continental slabs and a lot of water. Choosing
  // the continental ones by draw, with a floor under how many there are,
  // keeps every world habitable without making them all look alike.
  const wanted = rng.int(3, 4);
  const order = plates.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const p of plates) p.oceanic = true;
  for (let i = 0; i < wanted; i++) plates[order[i]].oceanic = false;

  return plates;
}

/** Mantle plumes, which sit still while the plates ride over them. */
export function makeHotspots(seed: number, worldSize: number): Hotspot[] {
  const rng = new Rng(seed ^ 0x40e5);
  const out: Hotspot[] = [];
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, TAU);
    out.push({
      x: rng.range(worldSize * 0.12, worldSize * 0.88),
      z: rng.range(worldSize * 0.12, worldSize * 0.88),
      driftX: Math.cos(angle),
      driftZ: Math.sin(angle),
      strength: rng.range(0.7, 1),
      length: worldSize * rng.range(0.1, 0.24),
      spacing: worldSize * rng.range(0.028, 0.05),
    });
  }
  return out;
}

/**
 * Where the plates are on the ground.
 *
 * A plain Voronoi diagram would give the world straight-edged boundaries and
 * plates like slices of pie. The query point is pushed around by two octaves
 * of low-frequency noise first, which bends every boundary into the ragged,
 * lobed line a real one has without changing the fact that each point belongs
 * to exactly one plate.
 */
export class PlateMap {
  readonly plates: PlateSeed[];
  private readonly warpX: Noise2D;
  private readonly warpZ: Noise2D;
  private readonly worldSize: number;
  private readonly amp: number;

  constructor(plates: PlateSeed[], seed: number, worldSize: number) {
    this.plates = plates;
    this.worldSize = worldSize;
    this.warpX = new Noise2D(seed ^ 0x9e3d);
    this.warpZ = new Noise2D(seed ^ 0x51c7);
    this.amp = worldSize * 0.17;
  }

  /** The distorted position a point is judged at. */
  private warped(x: number, z: number): [number, number] {
    const u = x / this.worldSize;
    const v = z / this.worldSize;
    // Two scales of distortion. The broad one bends the whole boundary into a
    // curve; the tight one frays it, so a range built along it has spurs and
    // kinks instead of running dead straight for half the map.
    const dx =
      this.warpX.fbm(u * 1.8, v * 1.8, 3) * this.amp +
      this.warpX.fbm(u * 5.6 + 3.1, v * 5.6, 2) * this.amp * 0.33;
    const dz =
      this.warpZ.fbm(u * 1.8 + 7.3, v * 1.8 - 3.1, 3) * this.amp +
      this.warpZ.fbm(u * 5.6, v * 5.6 + 9.4, 2) * this.amp * 0.33;
    return [x + dx, z + dz];
  }

  /** Which plate owns this point, and how far it is from the nearest edge. */
  at(x: number, z: number): PlateQuery {
    const [wx, wz] = this.warped(x, z);
    let a = this.plates[0];
    let b = this.plates[0];
    let d1 = Infinity;
    let d2 = Infinity;
    for (const p of this.plates) {
      const dx = p.x - wx;
      const dz = p.z - wz;
      const d = dx * dx + dz * dz;
      if (d < d1) {
        d2 = d1;
        b = a;
        d1 = d;
        a = p;
      } else if (d < d2) {
        d2 = d;
        b = p;
      }
    }
    // Halfway between the two seeds is the boundary, so half the difference of
    // the distances is how far this point stands from it.
    return { a, b, edge: Math.max(0, (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5) };
  }

  /** Just the owning plate, for the per-tile map. */
  plateIdAt(x: number, z: number): number {
    return this.at(x, z).a.id;
  }
}

/**
 * What two plates are doing to each other.
 *
 * Relative motion is projected onto the line joining their centres: the part
 * along that line opens or closes the boundary, and the part across it grinds.
 */
export function boundaryMotion(a: PlateSeed, b: PlateSeed): BoundaryMotion {
  const nx = b.x - a.x;
  const nz = b.z - a.z;
  const len = Math.hypot(nx, nz) || 1;
  const ux = nx / len;
  const uz = nz / len;
  const relX = b.driftX - a.driftX;
  const relZ = b.driftZ - a.driftZ;
  const normal = relX * ux + relZ * uz;
  const shear = Math.abs(relX * -uz + relZ * ux);

  let kind: BoundaryKind;
  if (normal < -6) kind = 'convergent';
  else if (normal > 6) kind = 'divergent';
  else kind = 'transform';

  return { kind, rate: kind === 'transform' ? shear : Math.abs(normal), normal };
}

/**
 * Which of two plates goes under the other.
 *
 * Oceanic crust is denser, so it subducts beneath continental crust every
 * time. Where both are the same, the slower one wins, which is a stand-in for
 * the older and colder slab going down.
 */
export function subducting(a: PlateSeed, b: PlateSeed): PlateSeed {
  if (a.oceanic !== b.oceanic) return a.oceanic ? a : b;
  const sa = Math.hypot(a.driftX, a.driftZ);
  const sb = Math.hypot(b.driftX, b.driftZ);
  return sa >= sb ? a : b;
}
