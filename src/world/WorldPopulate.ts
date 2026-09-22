/**
 * Populates a generated terrain with the things that make it a *place*:
 * forests, mineral deposits, landmarks, the remains of earlier settlements,
 * and the old roads between them.
 *
 * Runs in the generation worker immediately after TerrainGen.
 */

import { Rng } from '../core/rng';
import { Noise2D } from '../core/noise';
import { clamp01, smoothstep } from '../core/math';
import { GeologyField, ORE_IN_ROCK, readGeology, Rock } from './Geology';
import { Biome, OreVein, PointOfInterest, TerrainData, WorldConfig } from './types';
import {
  BIOME_FLORA,
  growsAt,
  RESOURCES,
  ResourceKind,
  ResourceNode,
  yieldOf,
} from './resources';
import type { ProgressFn } from './TerrainGen';

/** Global tuning so biome tables stay readable as "relative" densities. */
const FLORA_SCALE = 2.6;

export interface PopulateResult {
  nodes: ResourceNode[];
  veins: OreVein[];
  pois: PointOfInterest[];
  /** Tiles to mark as ancient path in the overlay. */
  oldRoadTiles: Int32Array;
  startX: number;
  startZ: number;
  historyLines: string[];
}

const POI_NAME_PARTS = {
  prefix: ['Old', 'Grey', 'Hollow', 'Far', 'Bright', 'Still', 'Black', 'White', 'Raven', 'Elder', 'Iron', 'Mist'],
  root: ['stone', 'wood', 'water', 'fall', 'ridge', 'hollow', 'barrow', 'march', 'crag', 'hearth', 'mere', 'gate'],
};

function makeName(rng: Rng): string {
  return `${rng.pick(POI_NAME_PARTS.prefix)}${rng.pick(POI_NAME_PARTS.root)}`;
}

export function populateWorld(
  config: WorldConfig,
  terrain: TerrainData,
  waterHeight: Float32Array,
  progress: ProgressFn,
): PopulateResult {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  const rng = new Rng(config.seed ^ 0x9e37);
  const clumpNoise = new Noise2D(rng.int(0, 1e9));
  const varietyNoise = new Noise2D(rng.int(0, 1e9));

  const occupied = new Uint8Array(N * N);
  const nodes: ResourceNode[] = [];
  let nextId = 1;

  // ------------------------------------------------------------- ore veins
  progress('Seeding mineral veins', 0);
  // What the rock is, which decides what is in it and where the caves are.
  const geology = readGeology(config, terrain, waterHeight);
  const veins = placeVeins(config, terrain, waterHeight, rng, geology);

  // ------------------------------------------------------------ vegetation
  progress('Growing forests', 0);
  const tileArea = ts * ts;

  for (let tz = 1; tz < N - 1; tz++) {
    for (let tx = 1; tx < N - 1; tx++) {
      const i = tz * N + tx;
      if (occupied[i]) continue;
      if (waterHeight[i] > terrain.height[i] - 0.05) continue;
      if (terrain.slope[i] > 0.72) continue;

      const biome = terrain.biome[i] as Biome;
      const flora = BIOME_FLORA[biome];
      if (!flora) continue;

      // Clump modulation: this is what produces groves instead of a carpet.
      const clump = clumpNoise.fbm(tx / N * 26, tz / N * 26, 3) * 0.5 + 0.5;
      const clumpFactor = 0.25 + smoothstep(0.35, 0.78, clump) * 1.9;

      const density = flora.density * FLORA_SCALE * config.resourceDensity * clumpFactor;
      const p = (density * tileArea) / 100;
      if (!rng.chance(Math.min(0.85, p))) continue;

      // Biome is too blunt on its own. A temperate forest at the edge of the
      // ice and one on the tropic line are the same biome and should not hold
      // the same trees, so a species that cannot stand the local temperature
      // simply is not what grew here. Three tries, then the tile stays empty:
      // the thinning at the edge of a species' range is the point.
      let kind: ResourceKind | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const pick = rng.weighted(flora.entries.map((e) => ({ value: e.kind, weight: e.weight })));
        if (growsAt(pick, terrain.temperature[i])) {
          kind = pick;
          break;
        }
      }
      if (!kind) continue;
      const def = RESOURCES[kind];

      // Big things need room; reject if a neighbour tile is already taken.
      if (def.radius > 0.75) {
        let blocked = false;
        for (let dz = -1; dz <= 1 && !blocked; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (occupied[(tz + dz) * N + (tx + dx)]) {
              blocked = true;
              break;
            }
          }
        if (blocked) continue;
      }

      const jx = rng.range(0.15, 0.85);
      const jz = rng.range(0.15, 0.85);
      const wx = (tx + jx) * ts;
      const wz = (tz + jz) * ts;

      // Size variation, biased by local "richness" noise so groves feel grown.
      const vigor = varietyNoise.fbm(tx / N * 40, tz / N * 40, 2) * 0.5 + 0.5;
      const scale = 0.72 + vigor * 0.5 + rng.range(-0.1, 0.16);

      occupied[i] = 1;
      nodes.push(makeNode(nextId++, kind, wx, wz, terrain.height[i], rng, scale));
    }
    if ((tz & 31) === 0) progress('Growing forests', tz / N);
  }

  // ---------------------------------------------------- ore outcrop nodes
  progress('Placing mineral deposits', 0);
  for (const vein of veins) {
    const count = Math.round(6 + vein.richness * 14);
    let placed = 0;
    // Two passes. The second one is allowed to stand an outcrop among the
    // trees, because a seam of copper under a wood is still a seam of copper
    // -- and without it a vein that happened to fall in dense forest produced
    // nothing at all, which is how a whole world ended up with no copper in
    // it and no way for the player to find out why.
    for (let pass = 0; pass < 2 && placed === 0; pass++) {
      const tries = pass === 0 ? count : count * 3;
      for (let k = 0; k < tries && placed < count; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(rng.next()) * vein.radius * (pass === 0 ? 1 : 1.6);
        const wx = vein.x + Math.cos(a) * rr;
        const wz = vein.z + Math.sin(a) * rr;
        const tx = Math.floor(wx / ts);
        const tz = Math.floor(wz / ts);
        if (tx < 1 || tz < 1 || tx >= N - 1 || tz >= N - 1) continue;
        const i = tz * N + tx;
        if (pass === 0 && occupied[i]) continue;
        if (waterHeight[i] > terrain.height[i] - 0.1) continue;
        if (terrain.slope[i] > 0.8) continue;
        occupied[i] = 1;
        placed++;
        nodes.push(
          makeNode(nextId++, VEIN_NODE[vein.kind], wx, wz, terrain.height[i], rng, rng.range(0.85, 1.25)),
        );
      }
    }
  }

  // Clay along river banks, sand along beaches: both read as visible banks.
  for (let tz = 2; tz < N - 2; tz += 3) {
    for (let tx = 2; tx < N - 2; tx += 3) {
      const i = tz * N + tx;
      if (occupied[i]) continue;
      if (waterHeight[i] > terrain.height[i]) continue;
      const b = terrain.biome[i] as Biome;
      const nearWater =
        waterHeight[i - 1] > terrain.height[i - 1] ||
        waterHeight[i + 1] > terrain.height[i + 1] ||
        waterHeight[i - N] > terrain.height[i - N] ||
        waterHeight[i + N] > terrain.height[i + N];
      if (!nearWater) continue;
      if (b === Biome.Beach && rng.chance(0.3)) {
        occupied[i] = 1;
        nodes.push(makeNode(nextId++, 'sand_pit', (tx + 0.5) * ts, (tz + 0.5) * ts, terrain.height[i], rng, 1));
      } else if (terrain.flow[i] > 0.3 && rng.chance(0.22)) {
        occupied[i] = 1;
        nodes.push(makeNode(nextId++, 'clay_pit', (tx + 0.5) * ts, (tz + 0.5) * ts, terrain.height[i], rng, 1));
      }
    }
  }

  // ------------------------------------------------------------- landmarks
  progress('Remembering the past', 0);
  const { pois, historyLines } = placePois(config, terrain, waterHeight, rng, occupied);

  // -------------------------------------------------------- starting site
  const start = chooseStartSite(terrain, waterHeight, rng);

  // ------------------------------------------------------------ old roads
  const oldRoadTiles = traceOldRoads(terrain, waterHeight, pois, start, rng);

  progress('Remembering the past', 1);

  return {
    nodes,
    veins,
    pois,
    oldRoadTiles,
    startX: start.x,
    startZ: start.z,
    historyLines,
  };
}

/** What an outcrop of each kind of vein looks like on the ground. */
const VEIN_NODE: Record<OreVein['kind'], ResourceKind> = {
  iron: 'iron_outcrop',
  copper: 'copper_outcrop',
  tin: 'tin_outcrop',
  coal: 'coal_seam',
  clay: 'clay_pit',
  gold: 'gold_vein',
  silver: 'silver_vein',
  salt: 'salt_flat',
  obsidian: 'obsidian_flow',
  limestone: 'limestone_outcrop',
  flint: 'flint_nodule',
  stone: 'boulder',
};

function makeNode(
  id: number,
  kind: ResourceKind,
  x: number,
  z: number,
  y: number,
  rng: Rng,
  scale: number,
): ResourceNode {
  const def = RESOURCES[kind];
  const node: ResourceNode = {
    id,
    kind,
    x,
    z,
    y,
    rot: rng.range(0, Math.PI * 2),
    scale,
    variant: rng.int(0, 3),
    amount: def.units,
    maxAmount: def.units,
    growth: 1,
    age: 0,
    regrowIn: -1,
    reservedBy: 0,
    work: 0,
    depleted: false,
  };
  if (!def.life) return node;

  // A wood is not all one age. Most of it is young, because most seedlings
  // never make it; a good part of it is mature; and every so often there is
  // one that was already old when the last people who saw it were born.
  // Drawing the ages this way is what makes a forest look like it grew rather
  // than like it was placed.
  const L = def.life;
  node.age = rng.chance(0.03)
    ? L.matureYears + (L.maxYears - L.matureYears) * Math.pow(rng.next(), 1.4)
    : Math.min(L.maxYears, L.matureYears * (0.1 + Math.pow(rng.next(), 1.8) * 2.4));
  node.growth = Math.min(1, node.age / L.matureYears);
  node.maxAmount = yieldOf(node);
  node.amount = node.maxAmount;
  return node;
}

// -------------------------------------------------------------------------

/**
 * Where the deposits are.
 *
 * Not scattered: each one is in the rock that would actually hold it. The
 * geology field already knows what every tile is made of and how much heat
 * has been through it, so a vein is simply drawn from what that rock has in
 * it. Copper and gold come up with the hot water over a slab, tin sits in
 * granite, coal is a drowned swamp, salt is a dried-out basin -- and a
 * settlement that wants tin has to go and find the old mountain roots rather
 * than dig anywhere and hope.
 */
function placeVeins(
  config: WorldConfig,
  terrain: TerrainData,
  waterHeight: Float32Array,
  rng: Rng,
  geology: GeologyField,
): OreVein[] {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  const veins: OreVein[] = [];
  const target = Math.round((N * N) / 5200 * config.resourceDensity);

  let attempts = 0;
  while (veins.length < target && attempts < target * 60) {
    attempts++;
    const tx = rng.int(6, N - 7);
    const tz = rng.int(6, N - 7);
    const i = tz * N + tx;
    if (waterHeight[i] > terrain.height[i]) continue;
    const h = terrain.height[i];
    if (h < 2) continue;
    const table = ORE_IN_ROCK[geology.rock[i] as Rock];
    const pick = {
      kind: rng.weighted(table.map((e) => ({ value: e.kind, weight: e.weight }))) as OreVein['kind'],
    };
    // Coal is a drowned swamp: flat, low and wet, and nowhere else.
    if (pick.kind === 'coal' && (h > 60 || terrain.moisture[i] < 0.4)) continue;
    // Salt is what an arid basin leaves behind.
    if (pick.kind === 'salt' && (terrain.moisture[i] > 0.34 || h > 40)) continue;
    // And the precious metals ride the heat.
    if ((pick.kind === 'gold' || pick.kind === 'silver') && geology.volcanism[i] < 0.25) continue;
    // Ore favours rugged ground.
    if (terrain.slope[i] < 0.1 && !rng.chance(0.25)) continue;

    const x = tx * ts;
    const z = tz * ts;
    let tooClose = false;
    for (const v of veins) {
      if (Math.hypot(v.x - x, v.z - z) < 55) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    veins.push({
      x,
      z,
      radius: rng.range(9, 20),
      kind: pick.kind,
      richness: rng.range(0.4, 1),
    });
  }

  // Three metals the whole technological line runs through. A world without
  // any copper in it is a world where bronze is unreachable and the player
  // never finds out why, so if the rock did not happen to provide any, the
  // best ground for it gets some. This is a floor, not a hand-out: it places
  // two or three small veins in the most plausible place there is.
  for (const needed of ['iron', 'copper', 'tin'] as OreVein['kind'][]) {
    const want = veins.filter((v) => v.kind === needed).length > 0 ? 2 : 3;
    if (veins.filter((v) => v.kind === needed).length >= want) continue;

    // Two lists, tried in order. First the ground whose rock would actually
    // hold this metal; then, only if that was not enough, the most broken
    // high ground there is -- which is where somebody would go looking, and
    // which keeps a world from being one where bronze is unreachable and the
    // player never finds out why.
    const preferred: { i: number; score: number }[] = [];
    const anywhere: { i: number; score: number }[] = [];
    for (let i2 = 0; i2 < N * N; i2 += 3) {
      if (waterHeight[i2] > terrain.height[i2]) continue;
      if (terrain.height[i2] < 4) continue;
      // Rugged, but not so rugged that nothing can stand on it: an outcrop on
      // a cliff face is an outcrop nobody can put a pick to.
      if (terrain.slope[i2] > 0.6) continue;
      anywhere.push({ i: i2, score: terrain.height[i2] * 0.4 + terrain.slope[i2] * 30 });
      const entry = ORE_IN_ROCK[geology.rock[i2] as Rock].find((e) => e.kind === needed);
      if (!entry) continue;
      preferred.push({
        i: i2,
        score: entry.weight + terrain.slope[i2] * 12 + geology.volcanism[i2] * 8,
      });
    }
    preferred.sort((a2, b2) => b2.score - a2.score);
    anywhere.sort((a2, b2) => b2.score - a2.score);

    for (const list of [preferred, anywhere]) {
      for (const cand of list) {
        if (veins.filter((v) => v.kind === needed).length >= want) break;
        const x = (cand.i % N) * ts;
        const z = Math.floor(cand.i / N) * ts;
        if (veins.some((v) => Math.hypot(v.x - x, v.z - z) < 55)) continue;
        veins.push({ x, z, radius: rng.range(9, 18), kind: needed, richness: rng.range(0.5, 1) });
      }
    }
  }
  return veins;
}

/**
 * How many lines of lore each kind of landmark has. The lines themselves live
 * in the dictionaries under `poi.lore.<kind>.<n>`, because what a ruin looks
 * like has to read in whatever language the player is playing in — storing the
 * prose in the world data would bake English into every save.
 */
const POI_LORE_COUNT: Record<PointOfInterest['kind'], number> = {
  ruin: 3,
  cave: 3,
  tower: 2,
  camp: 2,
  grove: 2,
  monolith: 2,
  shipwreck: 2,
};

function placePois(
  config: WorldConfig,
  terrain: TerrainData,
  waterHeight: Float32Array,
  rng: Rng,
  occupied: Uint8Array,
): { pois: PointOfInterest[]; historyLines: string[] } {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  const pois: PointOfInterest[] = [];
  const historyLines: string[] = [];
  const target = Math.round(10 + (N / 100) * 4);
  let attempts = 0;
  let id = 1;

  while (pois.length < target && attempts < target * 200) {
    attempts++;
    const tx = rng.int(8, N - 9);
    const tz = rng.int(8, N - 9);
    const i = tz * N + tx;
    const h = terrain.height[i];
    if (waterHeight[i] > h) continue;
    const slope = terrain.slope[i];
    const biome = terrain.biome[i] as Biome;

    let kind: PointOfInterest['kind'] | null = null;
    if (biome === Biome.Mountain || biome === Biome.Alpine) {
      kind = slope > 0.5 ? 'cave' : rng.chance(0.5) ? 'tower' : 'monolith';
    } else if (biome === Biome.Beach) {
      kind = rng.chance(0.55) ? 'shipwreck' : 'camp';
    } else if (biome === Biome.DenseForest || biome === Biome.TemperateForest) {
      kind = rng.chance(0.45) ? 'grove' : rng.chance(0.5) ? 'ruin' : 'camp';
    } else if (biome === Biome.Grassland || biome === Biome.Savanna) {
      if (slope < 0.14) kind = rng.chance(0.5) ? 'ruin' : 'monolith';
    } else if (biome === Biome.Taiga || biome === Biome.Tundra) {
      kind = rng.chance(0.5) ? 'camp' : 'monolith';
    } else if (biome === Biome.Desert) {
      kind = rng.chance(0.6) ? 'ruin' : 'monolith';
    }
    if (!kind) continue;
    if ((kind === 'ruin' || kind === 'tower' || kind === 'camp') && slope > 0.22) continue;

    const x = tx * ts;
    const z = tz * ts;
    let tooClose = false;
    for (const p of pois) {
      if (Math.hypot(p.x - x, p.z - z) < 70) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Clear a little room around structures.
    if (kind === 'ruin' || kind === 'tower' || kind === 'camp') {
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) occupied[(tz + dz) * N + (tx + dx)] = 1;
    }

    const name = makeName(rng);
    pois.push({
      id: id++,
      kind,
      x,
      z,
      name,
      lore: `poi.lore.${kind}.${rng.int(0, POI_LORE_COUNT[kind] - 1)}`,
      discovered: false,
    });
  }

  // A short pre-history so the world reads as older than the player.
  const yearsAgo = () => rng.int(20, 240);
  const ruins = pois.filter((p) => p.kind === 'ruin' || p.kind === 'tower');
  for (const rPoi of ruins.slice(0, 4)) {
    historyLines.push(
      `${yearsAgo()} years ago — a holding at ${rPoi.name} was raised, and later abandoned.`,
    );
  }
  const camps = pois.filter((p) => p.kind === 'camp');
  for (const c of camps.slice(0, 3)) {
    historyLines.push(`${rng.int(2, 30)} years ago — prospectors camped at ${c.name} and moved on.`);
  }
  historyLines.push(
    `The ${config.climate} lands here have been empty for a long time. Today that changes.`,
  );

  return { pois, historyLines };
}

function chooseStartSite(
  terrain: TerrainData,
  waterHeight: Float32Array,
  rng: Rng,
): { x: number; z: number } {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  let best = -1;
  let bestScore = -1;

  const margin = Math.floor(N * 0.18);
  for (let tz = margin; tz < N - margin; tz += 2) {
    for (let tx = margin; tx < N - margin; tx += 2) {
      const i = tz * N + tx;
      const h = terrain.height[i];
      if (h < 3 || h > 48) continue;
      if (waterHeight[i] > h) continue;
      if (terrain.slope[i] > 0.2) continue;

      // Require a genuinely buildable pad, not just one flat tile — the first
      // thing the player does here is place buildings, and a site that only
      // looks flat at its centre is a frustrating place to start.
      let padMin = Infinity;
      let padMax = -Infinity;
      let padSlope = 0;
      let padTiles = 0;
      let padBlocked = false;
      for (let dz = -3; dz <= 3 && !padBlocked; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const j = (tz + dz) * N + (tx + dx);
          if (j < 0 || j >= N * N) {
            padBlocked = true;
            break;
          }
          if (waterHeight[j] > terrain.height[j]) {
            padBlocked = true;
            break;
          }
          padMin = Math.min(padMin, terrain.height[j]);
          padMax = Math.max(padMax, terrain.height[j]);
          padSlope += terrain.slope[j];
          padTiles++;
        }
      }
      if (padBlocked || padTiles === 0) continue;
      if (padMax - padMin > 3.2) continue;
      if (padSlope / padTiles > 0.16) continue;

      let score = (1 - terrain.slope[i] / 0.2) * 0.22;
      score += clamp01(terrain.fertility[i]) * 0.26;

      // Sample a neighbourhood for flat buildable ground, water and timber.
      let flat = 0;
      let water = 0;
      let forest = 0;
      let samples = 0;
      for (let dz = -9; dz <= 9; dz += 3)
        for (let dx = -9; dx <= 9; dx += 3) {
          const j = (tz + dz) * N + (tx + dx);
          if (j < 0 || j >= N * N) continue;
          samples++;
          if (waterHeight[j] > terrain.height[j]) water++;
          else if (terrain.slope[j] < 0.16) flat++;
          const b = terrain.biome[j] as Biome;
          if (b === Biome.TemperateForest || b === Biome.DenseForest || b === Biome.Taiga) forest++;
        }
      if (samples === 0) continue;
      score += (flat / samples) * 0.24;
      score += clamp01(water / samples / 0.2) * 0.16;
      score += clamp01(forest / samples / 0.35) * 0.12;
      score += rng.next() * 0.02;

      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }

  if (best < 0) {
    return { x: (N / 2) * ts, z: (N / 2) * ts };
  }
  return { x: (best % N) * ts, z: Math.floor(best / N) * ts };
}

/**
 * Traces faint ancient paths between nearby landmarks. They give the player
 * something to follow on first exploration and imply the world had traffic
 * before they arrived.
 */
function traceOldRoads(
  terrain: TerrainData,
  waterHeight: Float32Array,
  pois: PointOfInterest[],
  start: { x: number; z: number },
  rng: Rng,
): Int32Array {
  const N = terrain.gridSize;
  const ts = terrain.tileSize;
  const tiles: number[] = [];

  const anchors = pois
    .filter((p) => p.kind === 'ruin' || p.kind === 'tower' || p.kind === 'camp')
    .slice(0, 8);
  if (anchors.length < 2) return Int32Array.from(tiles);

  const pairs: [{ x: number; z: number }, { x: number; z: number }][] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    let nearest = anchors[i + 1];
    let bestD = Infinity;
    for (let j = 0; j < anchors.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(anchors[j].x - a.x, anchors[j].z - a.z);
      if (d < bestD && d < 260) {
        bestD = d;
        nearest = anchors[j];
      }
    }
    if (bestD < Infinity) pairs.push([a, nearest]);
  }
  // One path also brushes past the founding site.
  if (anchors.length > 0) pairs.push([anchors[0], start]);

  for (const [a, b] of pairs) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / ts);
    if (steps > 400) continue;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // Gentle sinusoidal wander so paths are not dead straight.
      const wob = Math.sin(t * Math.PI * 3 + rng.seed % 6) * 5;
      const nx = a.x + (b.x - a.x) * t - ((b.z - a.z) / (steps * ts || 1)) * wob;
      const nz = a.z + (b.z - a.z) * t + ((b.x - a.x) / (steps * ts || 1)) * wob;
      const tx = Math.floor(nx / ts);
      const tz = Math.floor(nz / ts);
      if (tx < 1 || tz < 1 || tx >= N - 1 || tz >= N - 1) continue;
      const i = tz * N + tx;
      if (waterHeight[i] > terrain.height[i]) continue;
      if (terrain.slope[i] > 0.45) continue;
      tiles.push(i);
    }
  }

  return Int32Array.from(tiles);
}
