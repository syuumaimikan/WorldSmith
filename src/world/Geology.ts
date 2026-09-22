/**
 * What the ground is made of, and therefore what is in it.
 *
 * Ore is not scattered where a die says. Every deposit on Earth is where it is
 * because of something that happened to the rock: copper and gold come up with
 * the hot water above a subducting slab, tin sits in the granite at the root
 * of an old range, coal is a drowned swamp that never rotted, limestone is the
 * floor of a shallow sea, and salt is what is left when an arid basin dries
 * out. This world already knows where its plates are and what they are doing,
 * so it can know all of that too.
 *
 * The same field decides where the caves are. Rain dissolves limestone and
 * nothing else, which is why karst country is full of holes and granite
 * country is not -- and why, later, it is karst country that falls in.
 *
 * Runs inside the generation worker: no DOM, no three.js.
 */

import { Noise2D } from '../core/noise';
import { clamp01, smoothstep } from '../core/math';
import { boundaryMotion, makeHotspots, makePlates, PlateMap, subducting } from './Plates';
import { TerrainData, WorldConfig } from './types';

export enum Rock {
  /** Granite and its relatives: the cooled roots of mountains. */
  Igneous = 0,
  /** Lava and ash, around the arcs and the plumes. */
  Volcanic = 1,
  /** Mud, sand and gravel, laid down flat and left. */
  Sedimentary = 2,
  /** The floor of a shallow sea, and the reason there are caves. */
  Limestone = 3,
  /** Rock that has been cooked and squeezed under a collision. */
  Metamorphic = 4,
}

export interface GeologyField {
  /** One of `Rock` per tile. */
  rock: Uint8Array;
  /**
   * How cavernous the ground is, 0..1. High where soluble rock has had a lot
   * of water through it -- which is where sinkholes happen, and where caves
   * are worth looking for.
   */
  karst: Float32Array;
  /** Metres to the nearest volcanic centre, per tile. Cheap and useful. */
  volcanism: Float32Array;
}

/**
 * Reads the geology of a finished heightmap.
 *
 * Everything here is derived from the plates and from the shape of the land
 * they produced, so it agrees with the mountains by construction rather than
 * by being tuned to match them.
 */
export function readGeology(
  config: WorldConfig,
  terrain: TerrainData,
  waterHeight: Float32Array,
): GeologyField {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  const total = N * N;
  const worldSize = N * ts;

  const plates = makePlates(config.seed, worldSize);
  const map = new PlateMap(plates, config.seed, worldSize);
  const hotspots = makeHotspots(config.seed, worldSize);
  const grain = new Noise2D(config.seed ^ 0x6e01);

  const rock = new Uint8Array(total);
  const karst = new Float32Array(total);
  const volcanism = new Float32Array(total);

  const W = worldSize * 0.05;

  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const i = tz * N + tx;
      const wx = tx * ts;
      const wz = tz * ts;
      const h = terrain.height[i];
      const q = map.at(wx, wz);
      const motion = boundaryMotion(q.a, q.b);

      // How close this is to somewhere that melts rock: a volcanic arc above
      // a descending slab, or a plume.
      let heat = 0;
      if (motion.kind === 'convergent' && q.a.oceanic !== q.b.oceanic) {
        const riding = subducting(q.a, q.b) === q.a ? q.b : q.a;
        if (q.a === riding) {
          const band = (q.edge - W * 0.3) / (W * 0.6);
          heat = Math.exp(-band * band);
        }
      }
      for (const hot of hotspots) {
        const d = Math.hypot(wx - hot.x, wz - hot.z);
        heat = Math.max(heat, Math.exp(-((d / (W * 0.9)) ** 2)) * hot.strength);
      }
      volcanism[i] = heat;

      // The grain of the country: which of two plausible rocks you actually
      // find here, at the scale of a few kilometres.
      const g = grain.fbm((tx / N) * 7, (tz / N) * 7, 3) * 0.5 + 0.5;

      let kind: Rock;
      if (heat > 0.45) {
        kind = Rock.Volcanic;
      } else if (motion.kind === 'convergent' && q.edge < W * 1.4 && h > 40) {
        // The inside of a range: cooked and squeezed, with granite where the
        // melt cooled without ever reaching the surface.
        kind = g > 0.55 ? Rock.Metamorphic : Rock.Igneous;
      } else if (h > 70 && g > 0.6) {
        kind = Rock.Igneous;
      } else if (h < 26 && h > -30 && g > 0.52) {
        // Low ground that was under a shallow sea not long ago, geologically
        // speaking. That is where the carbonate is.
        kind = Rock.Limestone;
      } else {
        kind = Rock.Sedimentary;
      }
      rock[i] = kind;

      // Caves need soluble rock, water moving through it, and somewhere for
      // that water to go -- which is to say ground that stands above the
      // water table rather than under it.
      if (kind === Rock.Limestone && waterHeight[i] <= h) {
        const wet = clamp01(terrain.moisture[i]);
        const drained = smoothstep(2, 30, h);
        karst[i] = clamp01(wet * 1.1) * drained;
      }
    }
  }

  return { rock, karst, volcanism };
}

/** Which ores this rock plausibly holds, and how readily. */
export const ORE_IN_ROCK: Record<Rock, { kind: OreKind; weight: number }[]> = {
  [Rock.Igneous]: [
    { kind: 'tin', weight: 26 },
    { kind: 'iron', weight: 14 },
    { kind: 'stone', weight: 30 },
    { kind: 'silver', weight: 8 },
  ],
  [Rock.Volcanic]: [
    { kind: 'copper', weight: 34 },
    { kind: 'gold', weight: 10 },
    { kind: 'silver', weight: 14 },
    { kind: 'obsidian', weight: 22 },
    { kind: 'stone', weight: 14 },
  ],
  [Rock.Sedimentary]: [
    { kind: 'coal', weight: 34 },
    { kind: 'clay', weight: 30 },
    { kind: 'iron', weight: 14 },
    { kind: 'salt', weight: 10 },
    { kind: 'stone', weight: 10 },
  ],
  [Rock.Limestone]: [
    { kind: 'limestone', weight: 48 },
    { kind: 'clay', weight: 18 },
    { kind: 'flint', weight: 22 },
    { kind: 'stone', weight: 12 },
  ],
  [Rock.Metamorphic]: [
    { kind: 'iron', weight: 38 },
    { kind: 'stone', weight: 26 },
    { kind: 'copper', weight: 12 },
    { kind: 'gold', weight: 6 },
  ],
};

export type OreKind =
  | 'iron'
  | 'copper'
  | 'tin'
  | 'coal'
  | 'stone'
  | 'clay'
  | 'gold'
  | 'silver'
  | 'salt'
  | 'obsidian'
  | 'limestone'
  | 'flint';
