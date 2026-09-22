/**
 * Procedural terrain generation.
 *
 * This is deliberately a multi-stage pipeline rather than one noise call:
 *
 *   continent shape -> mountain uplift -> thermal + hydraulic erosion ->
 *   depression filling -> flow accumulation -> river carving -> climate ->
 *   biome classification -> derived layers (slope, fertility)
 *
 * The erosion and flow stages are what make the result read as a *landscape*
 * (ridgelines, valleys, rivers that reach the sea) rather than as noise, which
 * is the single biggest visual difference from the reference diorama.
 *
 * Runs inside a Web Worker. Must stay free of DOM and three.js imports.
 */

import { Noise2D, warp } from '../core/noise';
import { Rng } from '../core/rng';
import { clamp, clamp01, lerp, smoothstep } from '../core/math';
import { Biome, TerrainData, WorldConfig } from './types';

export const NO_WATER = -1e9;

export interface TerrainGenResult {
  terrain: TerrainData;
  /** Water surface height per tile, or NO_WATER. */
  waterHeight: Float32Array;
  lakes: { level: number; cx: number; cz: number; area: number }[];
}

export type ProgressFn = (stage: string, fraction: number) => void;

const CLIMATE_TEMP: Record<WorldConfig['climate'], { base: number; span: number; moisture: number }> = {
  temperate: { base: 4, span: 20, moisture: 1.0 },
  cold: { base: -10, span: 17, moisture: 0.92 },
  warm: { base: 13, span: 18, moisture: 1.05 },
  arid: { base: 8, span: 22, moisture: 0.62 },
};

export function generateTerrain(config: WorldConfig, progress: ProgressFn): TerrainGenResult {
  const N = config.gridSize;
  const total = N * N;
  const rng = new Rng(config.seed);

  const nContinent = new Noise2D(rng.int(0, 1e9));
  const nWarp = new Noise2D(rng.int(0, 1e9));
  const nMountain = new Noise2D(rng.int(0, 1e9));
  const nRidge = new Noise2D(rng.int(0, 1e9));
  const nHill = new Noise2D(rng.int(0, 1e9));
  const nDetail = new Noise2D(rng.int(0, 1e9));
  const nMoist = new Noise2D(rng.int(0, 1e9));
  const nTemp = new Noise2D(rng.int(0, 1e9));

  const height = new Float32Array(total);

  // ---------------------------------------------------------------- stage 1
  //
  // Elevation is built directly in metres. The key move is `shapeElevation`,
  // which compresses low ground and expands high ground: real valley floors are
  // nearly flat and real mountains are steep, and a uniform noise-to-metres
  // mapping gives you neither. Without this the whole map averages about 30
  // degrees of slope and there is nowhere to put a building.
  progress('Shaping the continent', 0);
  // Relief has to be proportional to the map. A 150 m peak is a mountain on a
  // 1.3 km continent and an unclimbable cone on a 400 m island, so every height
  // constant below is expressed relative to this one and scaled with the world.
  const worldMetres = N * config.tileSize;
  const PEAK_HEIGHT = clamp(worldMetres * 0.085, 28, 210);
  const hs = PEAK_HEIGHT / 145;
  const SEABED_DEPTH = PEAK_HEIGHT * 0.8;
  /**
   * Fraction of the map above sea level *before* erosion. Erosion and river
   * carving then drown roughly a third of the coastal fringe, which is why
   * this is set well above the land fraction we actually want.
   */
  const TARGET_LAND_FRACTION = 0.5;

  // Pass 1: the raw continent field, before it means anything in metres.
  const raw = new Float32Array(total);
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = z / N;

      // Warped coordinates keep coastlines from looking like plain noise.
      const [wx, wz] = warp(nWarp, u, v, 0.09, 2.4);

      // Radial falloff guarantees ocean at the world edge: the world reads as
      // a finite island slab, matching reference image 1.
      const dx = Math.abs(u - 0.5) * 2;
      const dz = Math.abs(v - 0.5) * 2;
      const d = Math.sqrt(dx * dx * 0.82 + dz * dz * 0.82);
      const coastNoise = nContinent.fbm(wx * 3.1, wz * 3.1, 4) * 0.11;
      const mask = 1 - smoothstep(0.8, 1.16, d + coastNoise);

      // A broad dome under the noise. Without it the island interior is one
      // uniform noise band, the sea-level cut lands inside the coastal ramp,
      // and the result is a cliff-edged plateau instead of a landscape that
      // rises from a coastal plain to an interior highland.
      const dome = 1 - smoothstep(0.02, 1.05, d + coastNoise * 0.5);
      const land = ((nContinent.fbm(wx * 1.15, wz * 1.15, 5) * 0.5 + 0.5) * 0.72 + dome * 0.28) * mask;
      raw[z * N + x] = land;
      if (land < rawMin) rawMin = land;
      if (land > rawMax) rawMax = land;
    }
    if ((z & 31) === 0) progress('Shaping the continent', (z / N) * 0.5);
  }

  // Normalise the field by its own distribution. Raw noise output varies a lot
  // between seeds, and without this one seed gives a gentle archipelago and the
  // next gives an unplayable wall of mountains. Percentile-based remapping means
  // every world has roughly the same land area and the same spread of heights,
  // while still looking completely different.
  const sea = percentileOf(raw, rawMin, rawMax, 1 - TARGET_LAND_FRACTION);
  const peak = percentileOf(raw, rawMin, rawMax, 0.997);
  const landSpan = Math.max(1e-4, peak - sea);
  const seaSpan = Math.max(1e-4, sea - rawMin);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const u = x / N;
      const v = z / N;
      const r = raw[i];

      let h: number;
      if (r <= sea) {
        h = ((r - sea) / seaSpan) * SEABED_DEPTH;
      } else {
        // The exponent compresses low ground and expands high ground: real
        // valley floors are nearly flat and real mountains are steep, and a
        // linear mapping gives you neither.
        const t = clamp01((r - sea) / landSpan);
        h = Math.pow(t, 1.9) * PEAK_HEIGHT;
      }

      // Hills and surface detail scale with altitude, so lowlands stay walkable
      // and buildable while uplands get genuinely broken ground.
      const hillAmp = (0.9 + smoothstep(8 * hs, 60 * hs, h) * 11) * hs;
      h += nHill.fbm(u * 6.5, v * 6.5, 4) * hillAmp;
      const detailAmp = (0.18 + smoothstep(18 * hs, 80 * hs, h) * 1.9) * hs;
      h += nDetail.fbm(u * 17, v * 17, 3) * detailAmp;

      height[i] = h;
    }
    if ((z & 31) === 0) progress('Shaping the continent', 0.5 + (z / N) * 0.5);
  }

  // ---------------------------------------------------------------- stage 2
  progress('Raising mountains', 0);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const u = x / N;
      const v = z / N;
      const h = height[i];
      if (h < 2) continue;

      const [mx, mz] = warp(nWarp, u, v, 0.05, 3.1);
      const range = nMountain.fbm(mx * 1.7, mz * 1.7, 3) * 0.5 + 0.5;
      // Mountains only where the land is already high, and only in distinct
      // ranges rather than everywhere — the reference imagery is flat valley
      // floors *against* steep rock, not uniformly rugged ground.
      const inland = smoothstep(14 * hs, 58 * hs, h);
      const mMask = smoothstep(0.6, 0.88, range) * inland;
      if (mMask <= 0.001) continue;

      const ridge = nRidge.ridged(mx * 3.4, mz * 3.4, 6);
      height[i] = h + mMask * ridge * 155 * hs;
    }
    if ((z & 31) === 0) progress('Raising mountains', z / N);
  }

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < total; i++) {
    const h = height[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  // ---------------------------------------------------------------- stage 3
  progress('Weathering the land', 0);
  // Talus is an angle, not a length, so it stays fixed to the tile size.
  thermalErode(height, N, 4, 1.55, progress);
  hydraulicErode(height, N, config.seed ^ 0x51ab, Math.floor(total * 0.35), progress);
  // Droplet erosion leaves high-frequency speckle behind. Smoothing it out of
  // the flats (and only the flats) is what finally makes level ground level.
  smoothLowlands(height, N, config.tileSize, 3);

  // ---------------------------------------------------------------- stage 4
  progress('Carving rivers', 0);
  const filled = fillDepressions(height, N, 0);
  const flow = accumulateFlow(filled, N);
  const waterHeight = new Float32Array(total).fill(NO_WATER);
  const { lakes, isLake } = carveRiversAndLakes(height, filled, flow, waterHeight, N, config);

  // Ocean everywhere below sea level.
  for (let i = 0; i < total; i++) {
    if (height[i] < 0 && waterHeight[i] === NO_WATER) waterHeight[i] = 0;
  }

  // Recompute extremes after erosion and carving.
  minH = Infinity;
  maxH = -Infinity;
  for (let i = 0; i < total; i++) {
    if (height[i] < minH) minH = height[i];
    if (height[i] > maxH) maxH = height[i];
  }

  // ---------------------------------------------------------------- stage 5
  progress('Measuring the climate', 0);
  const moisture = computeMoisture(height, waterHeight, N, nMoist, config, progress, hs);
  const temperature = new Float32Array(total);
  const clim = CLIMATE_TEMP[config.climate];
  const lapse = 9 / Math.max(10, PEAK_HEIGHT);
  for (let z = 0; z < N; z++) {
    const lat = z / N; // north (0) is cold, south (1) is warm
    const latTemp = clim.base + clim.span * lat;
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const alt = Math.max(0, height[i]);
      const variation = nTemp.fbm(x / N * 5.5, z / N * 5.5, 3) * 3.2;
      temperature[i] = latTemp - alt * lapse + variation;
    }
  }

  // ---------------------------------------------------------------- stage 6
  progress('Classifying biomes', 0);
  const slope = computeSlope(height, N, config.tileSize);
  const biome = new Uint8Array(total);
  const fertility = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const h = height[i];
    const w = waterHeight[i];
    const t = temperature[i];
    const m = moisture[i];
    const s = slope[i];

    if (w > h) {
      // Only a genuine filled basin is a lake. Carved river channels and
      // coastal shallows are standing water too, and labelling them "lake"
      // produced bodies of water with no consistent surface level.
      if (isLake[i]) biome[i] = Biome.Lake;
      else if (h > 0.2) biome[i] = Biome.River;
      else biome[i] = Biome.Ocean;
      fertility[i] = 0;
      continue;
    }

    biome[i] = classify(h, t, m, s, maxH, hs);
    fertility[i] = computeFertility(biome[i] as Biome, h, t, m, s, hs);
  }

  // Wetlands: flat, wet, low ground adjacent to standing water.
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (biome[i] !== Biome.Grassland && biome[i] !== Biome.TemperateForest) continue;
      if (height[i] > 8 || slope[i] > 0.08 || moisture[i] < 0.66) continue;
      let nearWater = false;
      for (let dz = -2; dz <= 2 && !nearWater; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          if (waterHeight[(z + dz) * N + (x + dx)] > NO_WATER) {
            nearWater = true;
            break;
          }
        }
      if (nearWater) {
        biome[i] = Biome.Wetland;
        fertility[i] = Math.min(1, fertility[i] + 0.15);
      }
    }
  }

  progress('Classifying biomes', 1);

  const terrain: TerrainData = {
    gridSize: N,
    tileSize: config.tileSize,
    height,
    moisture,
    temperature,
    biome,
    flow,
    slope,
    fertility,
    seaLevel: 0,
    minHeight: minH,
    maxHeight: maxH,
  };

  return { terrain, waterHeight, lakes };
}

// -------------------------------------------------------------------------
// Biome classification
// -------------------------------------------------------------------------

function classify(h: number, t: number, m: number, s: number, maxH: number, hs: number): Biome {
  const highBand = Math.max(95 * hs, maxH * 0.62);

  if (h < 1.6 && s < 0.12) return Biome.Beach;

  // Bare rock on anything genuinely steep, regardless of climate.
  if (s > 0.62) return h > highBand * 1.05 || t < -4 ? Biome.Alpine : Biome.Mountain;
  if (t < -7) return Biome.Alpine;
  if (h > highBand) return t < 1 ? Biome.Alpine : Biome.Mountain;

  if (t < 0) return Biome.Tundra;
  if (t < 7) return m > 0.34 ? Biome.Taiga : Biome.Tundra;

  if (t < 21) {
    if (m > 0.64) return Biome.DenseForest;
    if (m > 0.41) return Biome.TemperateForest;
    return Biome.Grassland;
  }

  if (m > 0.6) return Biome.DenseForest;
  if (m > 0.3) return Biome.Savanna;
  return Biome.Desert;
}

function computeFertility(b: Biome, h: number, t: number, m: number, s: number, hs: number): number {
  let f: number;
  switch (b) {
    case Biome.Grassland:
      f = 0.82;
      break;
    case Biome.TemperateForest:
      f = 0.74;
      break;
    case Biome.DenseForest:
      f = 0.62;
      break;
    case Biome.Wetland:
      f = 0.7;
      break;
    case Biome.Savanna:
      f = 0.48;
      break;
    case Biome.Taiga:
      f = 0.34;
      break;
    case Biome.Beach:
      f = 0.2;
      break;
    case Biome.Tundra:
      f = 0.12;
      break;
    case Biome.Desert:
      f = 0.06;
      break;
    default:
      f = 0.02;
  }
  f *= 1 - smoothstep(0.1, 0.42, s);
  f *= smoothstep(-2, 6, t) * (1 - smoothstep(26, 36, t) * 0.6);
  f *= 0.55 + clamp01(m) * 0.6;
  f *= 1 - smoothstep(60 * hs, 130 * hs, h) * 0.7;
  return clamp01(f);
}

// -------------------------------------------------------------------------
// Erosion
// -------------------------------------------------------------------------

/**
 * Thermal (talus) erosion. Material above the angle of repose slides downhill.
 * Produces the angular scree slopes that read well under flat shading.
 */
function thermalErode(h: Float32Array, N: number, passes: number, talus: number, progress: ProgressFn): void {
  const delta = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    delta.fill(0);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        const hi = h[i];
        let lowest = -1;
        let maxDiff = talus;
        for (let d = 0; d < 4; d++) {
          const j = d === 0 ? i - 1 : d === 1 ? i + 1 : d === 2 ? i - N : i + N;
          const diff = hi - h[j];
          if (diff > maxDiff) {
            maxDiff = diff;
            lowest = j;
          }
        }
        if (lowest >= 0) {
          const move = (maxDiff - talus) * 0.35;
          delta[i] -= move;
          delta[lowest] += move;
        }
      }
    }
    for (let i = 0; i < h.length; i++) h[i] += delta[i];
    progress('Weathering the land', (p + 1) / (passes + 2) * 0.5);
  }
}

/**
 * Droplet-based hydraulic erosion. Each droplet carries sediment downhill,
 * eroding steep ground and depositing in flats — this is what produces valleys
 * that rivers can later be routed along.
 */
function hydraulicErode(
  h: Float32Array,
  N: number,
  seed: number,
  droplets: number,
  progress: ProgressFn,
): void {
  const rng = new Rng(seed);
  const MAX_STEPS = 34;
  const INERTIA = 0.06;
  const CAPACITY = 3.4;
  const EROSION = 0.28;
  const DEPOSITION = 0.22;
  const EVAPORATION = 0.022;
  const MIN_SLOPE = 0.012;
  const RADIUS = 1;

  const report = Math.max(1, droplets >> 4);

  for (let d = 0; d < droplets; d++) {
    let px = rng.range(1.5, N - 2.5);
    let pz = rng.range(1.5, N - 2.5);
    let dirX = 0;
    let dirZ = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const nx = Math.floor(px);
      const nz = Math.floor(pz);
      if (nx < 1 || nz < 1 || nx >= N - 2 || nz >= N - 2) break;
      const i = nz * N + nx;
      if (h[i] < -2) break; // reached the sea

      const fx = px - nx;
      const fz = pz - nz;

      const h00 = h[i];
      const h10 = h[i + 1];
      const h01 = h[i + N];
      const h11 = h[i + N + 1];

      const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
      const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

      dirX = dirX * INERTIA - gx * (1 - INERTIA);
      dirZ = dirZ * INERTIA - gz * (1 - INERTIA);
      const len = Math.hypot(dirX, dirZ);
      if (len < 1e-5) break;
      dirX /= len;
      dirZ /= len;

      const oldH = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
      px += dirX;
      pz += dirZ;
      const mx = Math.floor(px);
      const mz = Math.floor(pz);
      if (mx < 1 || mz < 1 || mx >= N - 2 || mz >= N - 2) break;
      const j = mz * N + mx;
      const gfx = px - mx;
      const gfz = pz - mz;
      const newH =
        h[j] * (1 - gfx) * (1 - gfz) +
        h[j + 1] * gfx * (1 - gfz) +
        h[j + N] * (1 - gfx) * gfz +
        h[j + N + 1] * gfx * gfz;

      const dh = newH - oldH;
      const capacity = Math.max(-dh, MIN_SLOPE) * speed * water * CAPACITY;

      if (sediment > capacity || dh > 0) {
        const drop = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * DEPOSITION;
        sediment -= drop;
        deposit(h, N, nx, nz, fx, fz, drop);
      } else {
        const erode = Math.min((capacity - sediment) * EROSION, -dh);
        sediment += erodeAt(h, N, nx, nz, erode, RADIUS);
      }

      speed = Math.sqrt(Math.max(0, speed * speed - dh * 4));
      water *= 1 - EVAPORATION;
      if (water < 0.01) break;
    }

    if (d % report === 0) progress('Weathering the land', 0.5 + (d / droplets) * 0.5);
  }
}

/**
 * Value below which `fraction` of the samples fall, via a histogram. Used to
 * normalise the continent field so every seed yields a comparable world.
 */
function percentileOf(data: Float32Array, min: number, max: number, fraction: number): number {
  const BUCKETS = 2048;
  const span = Math.max(1e-6, max - min);
  const counts = new Int32Array(BUCKETS);
  for (let i = 0; i < data.length; i++) {
    const b = Math.min(BUCKETS - 1, Math.floor(((data[i] - min) / span) * BUCKETS));
    counts[b]++;
  }
  const target = data.length * fraction;
  let acc = 0;
  for (let b = 0; b < BUCKETS; b++) {
    acc += counts[b];
    if (acc >= target) return min + ((b + 0.5) / BUCKETS) * span;
  }
  return max;
}

/**
 * Selective smoothing: blurs gentle ground hard, leaves ridges and cliffs
 * alone. Flat land that is actually flat is what makes a settlement possible,
 * and it is also what the reference imagery shows — broad level valley floors
 * against sharp rock.
 */
function smoothLowlands(h: Float32Array, N: number, tileSize: number, passes: number): void {
  const out = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    out.set(h);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        const gx = (h[i + 1] - h[i - 1]) / (2 * tileSize);
        const gz = (h[i + N] - h[i - N]) / (2 * tileSize);
        const slope = Math.atan(Math.hypot(gx, gz));
        const weight = (1 - smoothstep(0.26, 0.62, slope)) * 0.85;
        if (weight <= 0.001) continue;

        const avg =
          (h[i] * 4 +
            h[i - 1] * 2 + h[i + 1] * 2 + h[i - N] * 2 + h[i + N] * 2 +
            h[i - N - 1] + h[i - N + 1] + h[i + N - 1] + h[i + N + 1]) / 16;
        out[i] = h[i] + (avg - h[i]) * weight;
      }
    }
    h.set(out);
  }
}

function deposit(h: Float32Array, N: number, x: number, z: number, fx: number, fz: number, amt: number): void {
  const i = z * N + x;
  h[i] += amt * (1 - fx) * (1 - fz);
  h[i + 1] += amt * fx * (1 - fz);
  h[i + N] += amt * (1 - fx) * fz;
  h[i + N + 1] += amt * fx * fz;
}

function erodeAt(h: Float32Array, N: number, x: number, z: number, amt: number, radius: number): number {
  let removed = 0;
  let weightSum = 0;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const w = Math.max(0, radius + 1 - Math.hypot(dx, dz));
      weightSum += w;
    }
  if (weightSum <= 0) return 0;
  for (let dz = -radius; dz <= radius; dz++) {
    const zz = z + dz;
    if (zz < 0 || zz >= N) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= N) continue;
      const w = Math.max(0, radius + 1 - Math.hypot(dx, dz)) / weightSum;
      const take = amt * w;
      h[zz * N + xx] -= take;
      removed += take;
    }
  }
  return removed;
}

// -------------------------------------------------------------------------
// Hydrology
// -------------------------------------------------------------------------

/** Minimal binary heap keyed on a float, storing an integer payload. */
class MinHeap {
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

  peekKey(): number {
    return this.keys[0];
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

/**
 * Priority-flood depression filling (Barnes et al). Guarantees every land cell
 * has a downhill path to the sea, which is what makes rivers actually reach the
 * coast instead of vanishing into pits. The fill delta also gives us lakes.
 */
function fillDepressions(h: Float32Array, N: number, seaLevel: number): Float32Array {
  const total = N * N;
  const filled = new Float32Array(total);
  const closed = new Uint8Array(total);
  const heap = new MinHeap(N * 8);
  const EPS = 0.0015;

  for (let i = 0; i < total; i++) filled[i] = Infinity;

  // Seed from map border and from anything already at or below sea level.
  const seed = (i: number) => {
    if (closed[i]) return;
    closed[i] = 1;
    filled[i] = h[i];
    heap.push(h[i], i);
  };
  for (let x = 0; x < N; x++) {
    seed(x);
    seed((N - 1) * N + x);
  }
  for (let z = 0; z < N; z++) {
    seed(z * N);
    seed(z * N + N - 1);
  }
  for (let i = 0; i < total; i++) if (h[i] <= seaLevel) seed(i);

  while (heap.size > 0) {
    const i = heap.pop();
    const hi = filled[i];
    const x = i % N;
    const z = (i / N) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const nz = z + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const j = nz * N + nx;
      if (closed[j]) continue;
      closed[j] = 1;
      filled[j] = Math.max(h[j], hi + EPS);
      heap.push(filled[j], j);
    }
  }
  return filled;
}

/**
 * D8 flow accumulation over the depression-filled surface. Processing cells in
 * descending height order means each cell's upstream contribution is final by
 * the time we route it.
 */
function accumulateFlow(filled: Float32Array, N: number): Float32Array {
  const total = N * N;
  const order = new Int32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;

  // Counting sort by quantised height: far cheaper than a comparison sort here.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < total; i++) {
    const v = filled[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const BUCKETS = 4096;
  const scale = hi > lo ? (BUCKETS - 1) / (hi - lo) : 0;
  const counts = new Int32Array(BUCKETS + 1);
  const bucket = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const b = ((filled[i] - lo) * scale) | 0;
    bucket[i] = b;
    counts[b]++;
  }
  // Descending order => fill from the top bucket down.
  const starts = new Int32Array(BUCKETS);
  let acc = 0;
  for (let b = BUCKETS - 1; b >= 0; b--) {
    starts[b] = acc;
    acc += counts[b];
  }
  const cursor = starts.slice();
  for (let i = 0; i < total; i++) order[cursor[bucket[i]]++] = i;

  const flow = new Float32Array(total).fill(1);
  const DIAG = Math.SQRT1_2;

  for (let k = 0; k < total; k++) {
    const i = order[k];
    const x = i % N;
    const z = (i / N) | 0;
    if (x === 0 || z === 0 || x === N - 1 || z === N - 1) continue;
    const hi2 = filled[i];
    let best = -1;
    let bestDrop = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const j = (z + dz) * N + (x + dx);
        const w = dx !== 0 && dz !== 0 ? DIAG : 1;
        const drop = (hi2 - filled[j]) * w;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = j;
        }
      }
    if (best >= 0) flow[best] += flow[i];
  }

  // Normalise to 0..1 with a log curve — raw accumulation is extremely skewed.
  const logMax = Math.log(1 + total * 0.06);
  for (let i = 0; i < total; i++) {
    flow[i] = clamp01(Math.log(1 + flow[i]) / logMax);
  }
  return flow;
}

function carveRiversAndLakes(
  h: Float32Array,
  filled: Float32Array,
  flow: Float32Array,
  waterHeight: Float32Array,
  N: number,
  config: WorldConfig,
): { lakes: { level: number; cx: number; cz: number; area: number }[]; isLake: Uint8Array } {
  const total = N * N;
  const RIVER_THRESHOLD = 0.44;

  // Lakes: where depression filling raised the surface meaningfully.
  const lakeId = new Int32Array(total).fill(-1);
  /** Tiles belonging to a finished lake. Their surface is fixed and level. */
  const isLake = new Uint8Array(total);
  const lakes: { level: number; cx: number; cz: number; area: number }[] = [];
  const stack: number[] = [];

  // Priority-flood raises each filled cell by a tiny epsilon so that water
  // always has somewhere to drain. That epsilon accumulates across a big basin,
  // so grouping cells by their filled *value* splits one lake into a staircase
  // of slightly different levels. Instead, group by connected submergence and
  // take the basin's spill point as the single surface level.
  const members: number[] = [];
  for (let i = 0; i < total; i++) {
    if (lakeId[i] >= 0) continue;
    const depth = filled[i] - h[i];
    if (depth < 0.45 || h[i] < 0.2) continue;

    const id = lakes.length;
    let level = filled[i];
    let area = 0;
    let sx = 0;
    let sz = 0;
    stack.length = 0;
    members.length = 0;
    stack.push(i);
    lakeId[i] = id;

    while (stack.length) {
      const c = stack.pop() as number;
      area++;
      members.push(c);
      sx += c % N;
      sz += (c / N) | 0;
      // The highest filled value in the basin is its outlet, and that is the
      // level the whole body of water sits at.
      if (filled[c] > level) level = filled[c];
      const x = c % N;
      const z = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const nz = z + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (lakeId[j] >= 0) continue;
        if (filled[j] - h[j] < 0.12) continue;
        lakeId[j] = id;
        stack.push(j);
      }
    }

    if (area < 14) {
      // Too small to be a lake — undo.
      continue;
    }
    lakes.push({ level, cx: sx / area, cz: sz / area, area });
    for (const k of members) {
      waterHeight[k] = level;
      isLake[k] = 1;
      // Guarantee the bed sits under the surface everywhere in the basin.
      if (h[k] > level - 0.15) h[k] = level - 0.15;
    }
  }

  // Rivers: carve a channel proportional to discharge.
  const carve = new Float32Array(total);
  const widthScale = config.tileSize;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (h[i] < 0.3) continue;
      const f = flow[i];
      if (f < RIVER_THRESHOLD) continue;
      const strength = smoothstep(RIVER_THRESHOLD, 0.92, f);
      const depth = 0.9 + strength * 3.6;
      const radius = Math.max(1, Math.round((0.7 + strength * 2.4) * (2 / widthScale)));
      for (let dz = -radius; dz <= radius; dz++) {
        const zz = z + dz;
        if (zz < 1 || zz >= N - 1) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 1 || xx >= N - 1) continue;
          const dd = Math.hypot(dx, dz) / (radius + 0.001);
          if (dd > 1) continue;
          const amount = depth * (1 - dd * dd);
          const j = zz * N + xx;
          if (amount > carve[j]) carve[j] = amount;
        }
      }
    }
  }

  for (let i = 0; i < total; i++) {
    if (carve[i] <= 0) continue;
    const before = h[i];
    h[i] = before - carve[i];
    // A lake has one surface level across its whole area. Where a river runs
    // into a lake the channel is still carved, but the lake's level wins —
    // otherwise the water surface steps up and down across a single body of
    // water, which looks broken and breaks downhill flow checks.
    if (isLake[i]) {
      if (waterHeight[i] < h[i]) h[i] = waterHeight[i] - 0.05;
      continue;
    }
    // Elsewhere the water surface sits just under the original bank level.
    const surface = before - carve[i] * 0.42;
    if (waterHeight[i] === NO_WATER || surface > waterHeight[i]) {
      if (surface > h[i]) waterHeight[i] = surface;
    }
  }

  return { lakes, isLake };
}

// -------------------------------------------------------------------------
// Climate
// -------------------------------------------------------------------------

function computeMoisture(
  h: Float32Array,
  waterHeight: Float32Array,
  N: number,
  noise: Noise2D,
  config: WorldConfig,
  progress: ProgressFn,
  hs: number,
): Float32Array {
  const total = N * N;
  const moisture = new Float32Array(total);

  // Chebyshev-ish distance transform from water, in tiles.
  const distToWater = new Float32Array(total).fill(1e9);
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;
  for (let i = 0; i < total; i++) {
    if (waterHeight[i] > h[i]) {
      distToWater[i] = 0;
      queue[qTail++] = i;
    }
  }
  while (qHead < qTail) {
    const i = queue[qHead++];
    const x = i % N;
    const z = (i / N) | 0;
    const d = distToWater[i] + 1;
    if (d > 90) continue;
    for (let dd = 0; dd < 4; dd++) {
      const nx = x + (dd === 0 ? -1 : dd === 1 ? 1 : 0);
      const nz = z + (dd === 2 ? -1 : dd === 3 ? 1 : 0);
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const j = nz * N + nx;
      if (distToWater[j] <= d) continue;
      distToWater[j] = d;
      queue[qTail++] = j;
    }
  }

  progress('Measuring the climate', 0.45);

  // Prevailing wind from the west: a rain-shadow budget depleted by elevation.
  const clim = CLIMATE_TEMP[config.climate];
  for (let z = 0; z < N; z++) {
    let budget = 1;
    let lastH = 0;
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const hh = Math.max(0, h[i]);
      if (waterHeight[i] > h[i]) budget = Math.min(1, budget + 0.05);
      const climb = Math.max(0, hh - lastH);
      budget = clamp01(budget - (climb / hs) * 0.012 + 0.0025);
      lastH = hh;

      const base = noise.fbm(x / N * 4.2, z / N * 4.2, 4) * 0.5 + 0.5;
      const near = Math.exp(-distToWater[i] / 26);
      let m = base * 0.46 + near * 0.34 + budget * 0.3;
      m *= clim.moisture;
      m -= smoothstep(70 * hs, 170 * hs, hh) * 0.16;
      moisture[i] = clamp01(m);
    }
    if ((z & 31) === 0) progress('Measuring the climate', 0.45 + (z / N) * 0.55);
  }

  return moisture;
}

function computeSlope(h: Float32Array, N: number, tileSize: number): Float32Array {
  const slope = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const xm = x > 0 ? h[i - 1] : h[i];
      const xp = x < N - 1 ? h[i + 1] : h[i];
      const zm = z > 0 ? h[i - N] : h[i];
      const zp = z < N - 1 ? h[i + N] : h[i];
      const gx = (xp - xm) / (2 * tileSize);
      const gz = (zp - zm) / (2 * tileSize);
      slope[i] = Math.atan(Math.hypot(gx, gz));
    }
  }
  return slope;
}

export { lerp, clamp };
