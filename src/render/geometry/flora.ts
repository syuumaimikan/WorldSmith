/**
 * Procedural low-poly flora and minerals.
 *
 * Geometry is rebuilt when the season turns so canopies actually change colour
 * — the seasonal families in reference image 8 are the target. Each kind has
 * several variants and three detail levels; instancing then draws thousands of
 * them in a handful of draw calls.
 */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { PALETTE, mixHex, shade } from '../Palette';
import { Season } from '../TerrainColors';
import { ResourceKind } from '../../world/resources';

export type Lod = 0 | 1 | 2;

export interface FloraGeoKey {
  kind: ResourceKind;
  variant: number;
  lod: Lod;
}

/** Number of geometry variants a kind offers at full detail. */
export const VARIANT_COUNT: Record<ResourceKind, number> = {
  oak: 3,
  beech: 3,
  maple: 3,
  ash: 2,
  chestnut: 2,
  birch: 3,
  willow: 2,
  acacia: 2,
  baobab: 2,
  mangrove: 2,
  teak: 2,
  pine: 3,
  spruce: 3,
  fir: 2,
  cedar: 3,
  larch: 2,
  redwood: 2,
  palm: 2,
  banana: 2,
  joshua_tree: 2,
  dead_tree: 2,
  bamboo: 2,
  cactus: 2,
  bush: 2,
  berry_bush: 2,
  hazel: 2,
  olive: 2,
  tea_shrub: 1,
  fern: 2,
  wildflowers: 2,
  mushroom_ring: 2,
  herb_patch: 1,
  reeds: 2,
  papyrus: 2,
  wild_wheat: 1,
  wild_flax: 1,
  fiber_plant: 1,
  rock: 3,
  boulder: 2,
  iron_outcrop: 1,
  copper_outcrop: 1,
  tin_outcrop: 1,
  coal_seam: 1,
  gold_vein: 1,
  silver_vein: 1,
  salt_flat: 1,
  obsidian_flow: 2,
  limestone_outcrop: 2,
  flint_nodule: 2,
  clay_pit: 1,
  sand_pit: 1,
};

interface SeasonColors {
  broadleaf: number;
  broadleafAlt: number;
  conifer: number;
  bush: number;
  grass: number;
  snowCap: number;
  /** 0..1 how much snow sits on top of things. */
  snow: number;
  bare: boolean;
}

export function seasonColors(season: Season, cold: boolean): SeasonColors {
  const V = PALETTE.vegetation;
  switch (season) {
    case 'spring':
      return {
        broadleaf: V.leafSpring,
        broadleafAlt: mixHex(V.leafSpring, V.leafSummer, 0.5),
        conifer: V.coniferLight,
        bush: mixHex(V.bush, V.leafSpring, 0.4),
        grass: V.grassTuft,
        snowCap: PALETTE.terrain.snow,
        snow: cold ? 0.18 : 0,
        bare: false,
      };
    case 'summer':
      return {
        broadleaf: V.leafSummer,
        broadleafAlt: mixHex(V.leafSummer, V.leafSpring, 0.35),
        conifer: V.conifer,
        bush: V.bush,
        grass: V.grassTuft,
        snowCap: PALETTE.terrain.snow,
        snow: 0,
        bare: false,
      };
    case 'autumn':
      return {
        broadleaf: V.leafAutumn,
        broadleafAlt: V.leafAutumnAlt,
        conifer: mixHex(V.conifer, V.leafAutumn, 0.12),
        bush: mixHex(V.bush, V.leafAutumn, 0.45),
        grass: mixHex(V.grassTuft, PALETTE.terrain.grassDry, 0.6),
        snowCap: PALETTE.terrain.snow,
        snow: cold ? 0.25 : 0,
        bare: false,
      };
    case 'winter':
      return {
        broadleaf: V.leafDead,
        broadleafAlt: V.leafDead,
        conifer: V.leafWinter,
        bush: mixHex(V.bush, V.leafDead, 0.6),
        grass: mixHex(V.grassTuft, PALETTE.terrain.tundra, 0.7),
        snowCap: PALETTE.terrain.snow,
        snow: 0.75,
        bare: true,
      };
  }
}

/** Deterministic per-variant RNG so a variant always looks the same. */
function variantRng(kind: string, variant: number): Rng {
  return new Rng(`${kind}:${variant}`);
}

export function buildFloraGeometry(
  kind: ResourceKind,
  variant: number,
  lod: Lod,
  season: Season,
  cold: boolean,
): BufferGeometry {
  const b = new GeoBuilder();
  const rng = variantRng(kind, variant);
  const sc = seasonColors(season, cold);

  switch (kind) {
    case 'oak':
      buildBroadleaf(b, rng, lod, sc, 1);
      break;
    case 'beech':
      buildBroadleaf(b, rng, lod, sc, 1.08, 0x7d6448);
      break;
    case 'maple':
      buildBroadleaf(b, rng, lod, sc, 0.9, 0x6a4a34, PALETTE.vegetation.leafAutumnAlt, 0.22);
      break;
    case 'ash':
      buildBroadleaf(b, rng, lod, sc, 0.94, 0x7a6a56);
      break;
    case 'chestnut':
      buildBroadleaf(b, rng, lod, sc, 1.12, 0x5f4630);
      break;
    case 'teak':
      buildBroadleaf(b, rng, lod, sc, 1.18, 0x8a5f38);
      break;
    case 'birch':
      buildBroadleaf(b, rng, lod, sc, 0.72, PALETTE.vegetation.trunkBirch);
      break;
    case 'willow':
      buildWillow(b, rng, lod, sc);
      break;
    case 'acacia':
      buildAcacia(b, rng, lod, sc);
      break;
    case 'baobab':
      buildBaobab(b, rng, lod, sc);
      break;
    case 'mangrove':
      buildMangrove(b, rng, lod, sc);
      break;
    case 'pine':
      buildConifer(b, rng, lod, sc, CONIFERS.pine);
      break;
    case 'spruce':
      buildConifer(b, rng, lod, sc, CONIFERS.spruce);
      break;
    case 'fir':
      buildConifer(b, rng, lod, sc, CONIFERS.fir);
      break;
    case 'cedar':
      buildConifer(b, rng, lod, sc, CONIFERS.cedar);
      break;
    case 'larch':
      buildConifer(b, rng, lod, sc, CONIFERS.larch);
      break;
    case 'redwood':
      buildConifer(b, rng, lod, sc, CONIFERS.redwood);
      break;
    case 'banana':
      buildPalm(b, rng, lod, 0.62, 0x4f9a3a);
      break;
    case 'joshua_tree':
      buildJoshua(b, rng, lod);
      break;
    case 'bamboo':
      buildBamboo(b, rng, lod, sc);
      break;
    case 'hazel':
      buildBush(b, rng, lod, sc, false, 1.15, 0x4f8a3a);
      break;
    case 'olive':
      buildBush(b, rng, lod, sc, false, 1.05, 0x76916a);
      break;
    case 'tea_shrub':
      buildBush(b, rng, lod, sc, false, 0.78, 0x3f7a3c);
      break;
    case 'fern':
      buildFern(b, rng, lod, sc);
      break;
    case 'wildflowers':
      buildFlowers(b, rng, lod, sc);
      break;
    case 'mushroom_ring':
      buildMushrooms(b, rng, lod);
      break;
    case 'papyrus':
      buildReeds(b, rng, lod, sc, 1.35, PALETTE.vegetation.leafSpring);
      break;
    case 'wild_wheat':
      buildTallGrass(b, rng, lod, sc, 1.25, PALETTE.vegetation.cropRipe);
      break;
    case 'wild_flax':
      buildTallGrass(b, rng, lod, sc, 0.95, 0x8fa6c4);
      break;
    case 'tin_outcrop':
      buildOre(b, rng, lod, sc, 0xa8aab0);
      break;
    case 'gold_vein':
      buildOre(b, rng, lod, sc, 0xe0b03c);
      break;
    case 'silver_vein':
      buildOre(b, rng, lod, sc, 0xc8ccd4);
      break;
    case 'salt_flat':
      buildPit(b, rng, 0xeef0f2);
      break;
    case 'obsidian_flow':
      buildGlassyRock(b, rng, lod, sc);
      break;
    case 'limestone_outcrop':
      buildPaleRock(b, rng, lod, sc);
      break;
    case 'flint_nodule':
      buildFlint(b, rng, lod, sc);
      break;
    case 'palm':
      buildPalm(b, rng, lod);
      break;
    case 'dead_tree':
      buildDeadTree(b, rng, lod, sc);
      break;
    case 'cactus':
      buildCactus(b, rng, lod);
      break;
    case 'bush':
      buildBush(b, rng, lod, sc, false);
      break;
    case 'berry_bush':
      buildBush(b, rng, lod, sc, true);
      break;
    case 'herb_patch':
      buildHerbs(b, rng, lod, sc);
      break;
    case 'reeds':
      buildReeds(b, rng, lod, sc);
      break;
    case 'fiber_plant':
      buildTallGrass(b, rng, lod, sc);
      break;
    case 'rock':
      buildRock(b, rng, lod, sc, 0.55);
      break;
    case 'boulder':
      buildRock(b, rng, lod, sc, 1.35);
      break;
    case 'iron_outcrop':
      buildOre(b, rng, lod, sc, 0x9a6b52);
      break;
    case 'copper_outcrop':
      buildOre(b, rng, lod, sc, 0x5fa88a);
      break;
    case 'coal_seam':
      buildOre(b, rng, lod, sc, 0x2e2e34);
      break;
    case 'clay_pit':
      buildPit(b, rng, 0xa87a5c);
      break;
    case 'sand_pit':
      buildPit(b, rng, PALETTE.terrain.sand);
      break;
  }

  if (b.isEmpty()) b.box(0.2, 0.2, 0.2, PALETTE.vegetation.bush, { y: 0.1 });
  return b.build();
}

// -------------------------------------------------------------------------
// Trees
// -------------------------------------------------------------------------

function buildBroadleaf(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sc: SeasonColors,
  sizeScale: number,
  trunkColor: number = PALETTE.vegetation.trunk,
  leafTint = 0,
  leafTintAmount = 0,
): void {
  if (leafTintAmount > 0) {
    sc = {
      ...sc,
      broadleaf: mixHex(sc.broadleaf, leafTint, leafTintAmount),
      broadleafAlt: mixHex(sc.broadleafAlt, leafTint, leafTintAmount),
    };
  }
  const h = rng.range(4.4, 7.2) * sizeScale;
  const trunkR = rng.range(0.19, 0.3) * sizeScale;
  const trunkH = h * rng.range(0.38, 0.5);

  if (lod === 2) {
    // Far LOD: a trunk stub and one blob. ~24 triangles.
    b.cylinder(trunkR * 0.9, trunkR * 1.2, trunkH, 4, trunkColor, { y: trunkH / 2 });
    b.blob(h * 0.31, 0, sc.bare ? sc.broadleaf : sc.broadleaf, {
      y: trunkH + h * 0.22,
      sy: 0.86,
    });
    return;
  }

  const segs = lod === 0 ? 6 : 4;
  b.cylinder(trunkR * 0.75, trunkR * 1.35, trunkH, segs, trunkColor, { y: trunkH / 2 });

  // A couple of branches at full detail read clearly in silhouette.
  if (lod === 0) {
    const branches = rng.int(2, 3);
    for (let i = 0; i < branches; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = h * rng.range(0.16, 0.26);
      const y = trunkH * rng.range(0.6, 0.95);
      b.cylinder(trunkR * 0.25, trunkR * 0.5, len, 4, trunkColor, {
        x: Math.cos(a) * len * 0.28,
        y: y + len * 0.3,
        z: Math.sin(a) * len * 0.28,
        rz: Math.cos(a) * 0.65,
        rx: -Math.sin(a) * 0.65,
      });
    }
  }

  if (sc.bare) {
    // Winter: bare branching instead of a canopy.
    const twigs = lod === 0 ? 7 : 4;
    for (let i = 0; i < twigs; i++) {
      const a = (i / twigs) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const len = h * rng.range(0.22, 0.36);
      const y = trunkH + h * rng.range(0.02, 0.2);
      b.cylinder(trunkR * 0.12, trunkR * 0.34, len, 3, PALETTE.vegetation.trunkDead, {
        x: Math.cos(a) * len * 0.34,
        y: y + len * 0.36,
        z: Math.sin(a) * len * 0.34,
        rz: Math.cos(a) * 0.72,
        rx: -Math.sin(a) * 0.72,
      });
    }
    if (sc.snow > 0) {
      b.blob(h * 0.12, 0, sc.snowCap, { y: trunkH + h * 0.3, sy: 0.3 });
    }
    return;
  }

  const blobs = lod === 0 ? rng.int(3, 5) : 2;
  const canopyBase = trunkH + h * 0.06;
  for (let i = 0; i < blobs; i++) {
    const t = i / Math.max(1, blobs - 1);
    const r = h * rng.range(0.19, 0.29) * (1 - t * 0.28);
    const a = rng.range(0, Math.PI * 2);
    const off = h * rng.range(0.04, 0.14);
    const c = i % 2 === 0 ? sc.broadleaf : sc.broadleafAlt;
    b.blob(r, lod === 0 ? 0 : 0, shade(c, 0.92 + rng.next() * 0.16), {
      x: Math.cos(a) * off,
      y: canopyBase + h * (0.1 + t * 0.34),
      z: Math.sin(a) * off,
      sy: rng.range(0.74, 0.95),
      ry: rng.range(0, Math.PI),
    });
  }
  if (sc.snow > 0.3) {
    b.blob(h * 0.2, 0, sc.snowCap, { y: canopyBase + h * 0.42, sy: 0.34 });
  }
}

/**
 * What tells one conifer from another at a hundred metres.
 *
 * Height, how thick the bole is, how far the branches reach out and what
 * colour the needles are. A spruce is a narrow spire, a cedar is a broad
 * heavy thing with a trunk you could not get your arms round, and a larch
 * goes bare in winter like no other conifer does.
 */
interface ConiferShape {
  hMin: number;
  hMax: number;
  trunk: number;
  spread: number;
  tint: number;
  tintAmount: number;
  deciduous?: boolean;
}

const CONIFERS: Record<string, ConiferShape> = {
  pine: { hMin: 5.5, hMax: 9.5, trunk: 1, spread: 1, tint: 0, tintAmount: 0 },
  spruce: { hMin: 7, hMax: 12, trunk: 0.9, spread: 0.72, tint: 0x2a4f52, tintAmount: 0.3 },
  fir: { hMin: 6, hMax: 10, trunk: 0.95, spread: 0.85, tint: 0x35624a, tintAmount: 0.25 },
  cedar: { hMin: 9, hMax: 14, trunk: 1.9, spread: 1.25, tint: 0x3f6b38, tintAmount: 0.3 },
  larch: { hMin: 6, hMax: 10.5, trunk: 0.85, spread: 0.8, tint: 0x6f8f3c, tintAmount: 0.4, deciduous: true },
  redwood: { hMin: 14, hMax: 22, trunk: 2.4, spread: 0.95, tint: 0x2f5a3c, tintAmount: 0.2 },
};

function buildConifer(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sc: SeasonColors,
  shape: ConiferShape = CONIFERS.pine,
): void {
  const h = rng.range(shape.hMin, shape.hMax);
  const trunkR = rng.range(0.16, 0.26) * shape.trunk;
  if (shape.tintAmount > 0) {
    sc = { ...sc, conifer: mixHex(sc.conifer, shape.tint, shape.tintAmount) };
  }
  // A larch is the one conifer that drops its needles. In winter it is a
  // grey spire among green ones, which is exactly how you pick one out.
  if (shape.deciduous && sc.bare) {
    sc = { ...sc, conifer: mixHex(sc.conifer, PALETTE.vegetation.trunkDead, 0.72) };
  }

  if (lod === 2) {
    b.cylinder(trunkR, trunkR * 1.3, h * 0.2, 4, PALETTE.vegetation.trunk, { y: h * 0.1 });
    b.cone(h * 0.24 * shape.spread, h * 0.86, 5, sc.conifer, { y: h * 0.2 + h * 0.43 });
    return;
  }

  const segs = lod === 0 ? 6 : 4;
  b.cylinder(trunkR * 0.7, trunkR * 1.4, h * 0.32, segs, PALETTE.vegetation.trunk, { y: h * 0.16 });

  const tiers = lod === 0 ? rng.int(4, 6) : 3;
  const baseY = h * 0.18;
  const span = h * 0.82;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = h * 0.3 * shape.spread * (1 - t * 0.72);
    const tierH = span / tiers + h * 0.1;
    const c = shade(sc.conifer, 0.88 + (i / tiers) * 0.24);
    b.cone(r, tierH, lod === 0 ? 7 : 5, c, {
      y: baseY + span * t + tierH * 0.42,
      ry: rng.range(0, Math.PI),
    });
    if (sc.snow > 0.2 && i > 0) {
      b.cone(r * 0.82, tierH * 0.26, lod === 0 ? 7 : 5, sc.snowCap, {
        y: baseY + span * t + tierH * 0.62,
        ry: rng.range(0, Math.PI),
      });
    }
  }
}

function buildPalm(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sizeScale = 1,
  frondColor: number = PALETTE.vegetation.palm,
): void {
  const h = rng.range(5, 7.5) * sizeScale;
  const lean = rng.range(-0.2, 0.2);
  const segments = lod === 0 ? 5 : 3;
  let y = 0;
  for (let i = 0; i < segments; i++) {
    const segH = h * 0.62 / segments;
    b.cylinder(0.16, 0.22, segH, 5, PALETTE.vegetation.trunk, {
      x: lean * (i * i) * 0.5,
      y: y + segH / 2,
      rz: lean * 0.5,
    });
    y += segH;
  }
  const topX = lean * (segments * segments) * 0.5;
  const fronds = lod === 0 ? 7 : 4;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    b.box(2.4 * sizeScale, 0.08, 0.5 * sizeScale, frondColor, {
      x: topX + Math.cos(a) * 1.1,
      y: y + 0.25 - 0.2,
      z: Math.sin(a) * 1.1,
      ry: -a,
      rz: -0.34,
    });
  }
  b.blob(0.32, 0, PALETTE.vegetation.trunk, { x: topX, y: y + 0.2 });
}

function buildDeadTree(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(3.4, 5.6);
  b.cylinder(0.12, 0.28, h, lod === 0 ? 6 : 4, PALETTE.vegetation.trunkDead, { y: h / 2 });
  const branches = lod === 0 ? 4 : 2;
  for (let i = 0; i < branches; i++) {
    const a = rng.range(0, Math.PI * 2);
    const len = h * rng.range(0.3, 0.5);
    const y = h * rng.range(0.45, 0.88);
    b.cylinder(0.05, 0.12, len, 3, PALETTE.vegetation.trunkDead, {
      x: Math.cos(a) * len * 0.36,
      y: y + len * 0.22,
      z: Math.sin(a) * len * 0.36,
      rz: Math.cos(a) * 0.85,
      rx: -Math.sin(a) * 0.85,
    });
  }
  if (sc.snow > 0.4) b.box(0.5, 0.08, 0.5, sc.snowCap, { y: h * 0.98 });
}

function buildCactus(b: GeoBuilder, rng: Rng, lod: Lod): void {
  const h = rng.range(1.8, 3.4);
  const c = PALETTE.vegetation.cactus;
  b.cylinder(0.24, 0.3, h, lod === 0 ? 7 : 5, c, { y: h / 2 });
  const arms = rng.int(1, 2);
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? 1 : -1;
    const y = h * rng.range(0.4, 0.62);
    const armH = h * rng.range(0.32, 0.5);
    b.cylinder(0.16, 0.18, 0.5, 5, c, { x: side * 0.34, y, rz: side * -1.3 });
    b.cylinder(0.15, 0.17, armH, 5, c, { x: side * 0.58, y: y + armH / 2 });
    b.sphere(0.16, 5, 4, c, { x: side * 0.58, y: y + armH });
  }
  b.sphere(0.24, 6, 4, c, { y: h });
}

// -------------------------------------------------------------------------
// Small plants
// -------------------------------------------------------------------------

function buildBush(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sc: SeasonColors,
  berries: boolean,
  sizeScale = 1,
  tint = 0,
): void {
  if (tint) sc = { ...sc, bush: mixHex(sc.bush, tint, 0.5) };
  const r = rng.range(0.42, 0.7) * sizeScale;
  const lobes = lod === 0 ? 3 : 1;
  for (let i = 0; i < lobes; i++) {
    const a = rng.range(0, Math.PI * 2);
    const off = i === 0 ? 0 : r * 0.42;
    b.blob(r * rng.range(0.7, 1), 0, shade(sc.bush, 0.9 + rng.next() * 0.2), {
      x: Math.cos(a) * off,
      y: r * 0.62 + rng.range(-0.05, 0.1),
      z: Math.sin(a) * off,
      sy: 0.78,
    });
  }
  if (berries && lod === 0 && !sc.bare) {
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = r * rng.range(0.5, 0.92);
      b.sphere(0.075, 4, 3, PALETTE.vegetation.flowerB, {
        x: Math.cos(a) * rr,
        y: r * rng.range(0.55, 1.0),
        z: Math.sin(a) * rr,
      });
    }
  }
  if (sc.snow > 0.4) b.blob(r * 0.8, 0, sc.snowCap, { y: r * 0.95, sy: 0.3 });
}

function buildHerbs(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 7 : 3;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.32);
    const hh = rng.range(0.22, 0.42);
    b.box(0.06, hh, 0.06, shade(PALETTE.vegetation.bush, 1.05), {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
      ry: a,
      rz: rng.range(-0.2, 0.2),
    });
    if (i % 3 === 0 && !sc.bare) {
      b.sphere(0.07, 4, 3, PALETTE.vegetation.flowerC, {
        x: Math.cos(a) * rr,
        y: hh,
        z: Math.sin(a) * rr,
      });
    }
  }
}

function buildReeds(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sc: SeasonColors,
  sizeScale = 1,
  tint = 0,
): void {
  if (tint) sc = { ...sc, grass: mixHex(sc.grass, tint, 0.55) };
  const n = lod === 0 ? 11 : 5;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.44);
    const hh = rng.range(0.9, 1.7) * sizeScale;
    const lean = rng.range(-0.18, 0.18);
    b.box(0.05, hh, 0.05, shade(sc.grass, 0.85 + rng.next() * 0.3), {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
      rz: lean,
      ry: a,
    });
    if (i % 4 === 0) {
      b.box(0.09, 0.26, 0.09, PALETTE.vegetation.trunkDead, {
        x: Math.cos(a) * rr + lean * hh * 0.5,
        y: hh,
        z: Math.sin(a) * rr,
      });
    }
  }
}

function buildTallGrass(
  b: GeoBuilder,
  rng: Rng,
  lod: Lod,
  sc: SeasonColors,
  sizeScale = 1,
  tint = 0,
): void {
  if (tint) sc = { ...sc, grass: mixHex(sc.grass, tint, 0.6) };
  const n = lod === 0 ? 8 : 3;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.28);
    const hh = rng.range(0.38, 0.72) * sizeScale;
    b.box(0.07, hh, 0.02, shade(sc.grass, 0.85 + rng.next() * 0.3), {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
      ry: a,
      rz: rng.range(-0.28, 0.28),
    });
  }
}

// -------------------------------------------------------------------------
// Minerals
// -------------------------------------------------------------------------

function buildRock(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors, size: number): void {
  const lumps = lod === 0 ? rng.int(2, 3) : 1;
  for (let i = 0; i < lumps; i++) {
    const r = size * rng.range(0.6, 1);
    const a = rng.range(0, Math.PI * 2);
    const off = i === 0 ? 0 : size * 0.4;
    b.dodec(r, i % 2 === 0 ? PALETTE.terrain.rock : PALETTE.terrain.rockDark, {
      x: Math.cos(a) * off,
      y: r * 0.55,
      z: Math.sin(a) * off,
      sy: rng.range(0.6, 0.85),
      ry: rng.range(0, Math.PI),
      rx: rng.range(-0.25, 0.25),
    });
  }
  // Moss or snow cap on the top faces, as in reference image 8.
  const capColor = sc.snow > 0.3 ? sc.snowCap : mixHex(PALETTE.vegetation.bush, PALETTE.terrain.rock, 0.35);
  if (sc.snow > 0.3 || rng.chance(0.5)) {
    b.dodec(size * 0.62, capColor, { y: size * 0.78, sy: 0.24, ry: rng.range(0, Math.PI) });
  }
}

function buildOre(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors, oreColor: number): void {
  buildRock(b, rng, lod, sc, 1.1);
  const veins = lod === 0 ? 5 : 2;
  for (let i = 0; i < veins; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.3, 0.9);
    b.tetra(rng.range(0.14, 0.26), oreColor, {
      x: Math.cos(a) * rr,
      y: rng.range(0.3, 1.1),
      z: Math.sin(a) * rr,
      ry: rng.range(0, Math.PI),
      rx: rng.range(0, Math.PI),
    });
  }
}

function buildPit(b: GeoBuilder, rng: Rng, color: number): void {
  b.cylinder(0.95, 1.15, 0.28, 7, color, { y: 0.14 });
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    b.dodec(rng.range(0.16, 0.28), shade(color, 0.88), {
      x: Math.cos(a) * 0.6,
      y: 0.3,
      z: Math.sin(a) * 0.6,
      sy: 0.6,
    });
  }
}

/** A willow leans over the water and hangs down into it. */
function buildWillow(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(4.2, 6.4);
  const trunkR = rng.range(0.22, 0.34);
  const lean = rng.range(-0.22, 0.22);
  b.cylinder(trunkR * 0.7, trunkR * 1.4, h * 0.44, lod === 0 ? 6 : 4, 0x6a5a40, {
    y: h * 0.22,
    rz: lean,
  });
  const crownY = h * 0.5;
  const strands = lod === 0 ? 9 : 4;
  const leaf = mixHex(sc.broadleaf, 0x9bbf5a, 0.45);
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const rr = rng.range(0.9, 1.9);
    const drop = rng.range(h * 0.3, h * 0.55);
    b.box(0.5, drop, 0.16, shade(leaf, 0.86 + rng.next() * 0.26), {
      x: Math.cos(a) * rr + lean * h * 0.4,
      y: crownY - drop * 0.34,
      z: Math.sin(a) * rr,
      ry: a,
      rz: Math.cos(a) * 0.12,
    });
  }
  b.blob(h * 0.3, 0, leaf, { x: lean * h * 0.4, y: crownY + h * 0.1, sy: 0.6 });
}

/** Flat-topped, wider than it is tall, and alone on the plain. */
function buildAcacia(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(3.6, 5.4);
  const trunkR = rng.range(0.2, 0.3);
  b.cylinder(trunkR * 0.7, trunkR * 1.5, h * 0.58, lod === 0 ? 6 : 4, 0x7a6144, { y: h * 0.29 });
  const leaf = mixHex(sc.broadleaf, 0x8fa64a, 0.4);
  const plates = lod === 0 ? 3 : 1;
  for (let i = 0; i < plates; i++) {
    const rr = h * rng.range(0.42, 0.62);
    b.blob(rr, 0, shade(leaf, 0.9 + rng.next() * 0.2), {
      x: rng.range(-0.5, 0.5),
      y: h * (0.62 + i * 0.08),
      z: rng.range(-0.5, 0.5),
      sy: 0.24,
      ry: rng.range(0, Math.PI),
    });
  }
}

/** All trunk. The crown is an afterthought on top of a water tank. */
function buildBaobab(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(6, 9);
  const r = rng.range(1.1, 1.7);
  b.cylinder(r * 0.52, r, h * 0.62, lod === 0 ? 8 : 5, 0x9a8468, { y: h * 0.31 });
  const arms = lod === 0 ? 5 : 3;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = h * rng.range(0.2, 0.32);
    b.cylinder(0.1, 0.24, len, 4, 0x9a8468, {
      x: Math.cos(a) * len * 0.42,
      y: h * 0.64 + len * 0.4,
      z: Math.sin(a) * len * 0.42,
      rz: Math.cos(a) * 0.8,
      rx: -Math.sin(a) * 0.8,
    });
    if (!sc.bare) {
      b.blob(h * 0.12, 0, sc.broadleaf, {
        x: Math.cos(a) * len * 0.95,
        y: h * 0.68 + len * 0.6,
        z: Math.sin(a) * len * 0.95,
        sy: 0.7,
      });
    }
  }
}

/** Stands in the water on a tangle of its own roots. */
function buildMangrove(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(3.4, 5);
  const roots = lod === 0 ? 6 : 3;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(0.9, 1.5);
    b.cylinder(0.07, 0.13, len, 4, 0x5a4530, {
      x: Math.cos(a) * len * 0.4,
      y: len * 0.34,
      z: Math.sin(a) * len * 0.4,
      rz: -Math.cos(a) * 0.7,
      rx: Math.sin(a) * 0.7,
    });
  }
  b.cylinder(0.16, 0.24, h * 0.5, lod === 0 ? 6 : 4, 0x5a4530, { y: h * 0.25 + 0.5 });
  const leaf = mixHex(sc.broadleaf, 0x2f6b3a, 0.4);
  const blobs = lod === 0 ? 3 : 1;
  for (let i = 0; i < blobs; i++) {
    b.blob(h * rng.range(0.24, 0.34), 0, shade(leaf, 0.9 + rng.next() * 0.2), {
      x: rng.range(-0.5, 0.5),
      y: h * rng.range(0.78, 0.98),
      z: rng.range(-0.5, 0.5),
      sy: 0.8,
    });
  }
}

/** A stand of culms, not a tree. */
function buildBamboo(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const culms = lod === 0 ? 7 : 3;
  const green = mixHex(sc.grass, 0x9cb556, 0.6);
  for (let i = 0; i < culms; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.55);
    const hh = rng.range(3.4, 6.2);
    const lean = rng.range(-0.06, 0.06);
    b.cylinder(0.055, 0.075, hh, lod === 0 ? 5 : 4, shade(green, 0.86 + rng.next() * 0.28), {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
      rz: lean,
    });
    if (lod === 0) {
      for (let k = 0; k < 3; k++) {
        const ly = hh * (0.55 + k * 0.14);
        const la = a + rng.range(-1, 1);
        b.box(0.7, 0.03, 0.14, shade(green, 1.1), {
          x: Math.cos(a) * rr + Math.cos(la) * 0.35,
          y: ly,
          z: Math.sin(a) * rr + Math.sin(la) * 0.35,
          ry: -la,
          rz: -0.3,
        });
      }
    }
  }
}

/** Spiky, forked and slow. */
function buildJoshua(b: GeoBuilder, rng: Rng, lod: Lod): void {
  const h = rng.range(3, 4.8);
  const bark = 0x6f5a44;
  b.cylinder(0.2, 0.32, h * 0.5, lod === 0 ? 6 : 4, bark, { y: h * 0.25 });
  const arms = lod === 0 ? 4 : 2;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = h * rng.range(0.24, 0.4);
    const tipX = Math.cos(a) * len * 0.7;
    const tipZ = Math.sin(a) * len * 0.7;
    b.cylinder(0.1, 0.16, len, 4, bark, {
      x: tipX * 0.5,
      y: h * 0.5 + len * 0.35,
      z: tipZ * 0.5,
      rz: Math.cos(a) * 0.9,
      rx: -Math.sin(a) * 0.9,
    });
    for (let k = 0; k < 5; k++) {
      const sa = rng.range(0, Math.PI * 2);
      b.cone(0.1, 0.5, 3, 0x4a7042, {
        x: tipX + Math.cos(sa) * 0.16,
        y: h * 0.5 + len * 0.72,
        z: tipZ + Math.sin(sa) * 0.16,
        rz: Math.cos(sa) * 0.5,
        rx: -Math.sin(sa) * 0.5,
      });
    }
  }
}

/** Low, splayed fronds on the forest floor. */
function buildFern(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 7 : 3;
  const green = mixHex(sc.bush, 0x3f7a42, 0.5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = rng.range(0.5, 0.95);
    b.box(len, 0.05, 0.18, shade(green, 0.86 + rng.next() * 0.28), {
      x: Math.cos(a) * len * 0.45,
      y: rng.range(0.16, 0.34),
      z: Math.sin(a) * len * 0.45,
      ry: -a,
      rz: -rng.range(0.25, 0.55),
    });
  }
}

/** A scatter of colour in the grass. */
function buildFlowers(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 10 : 4;
  const heads = [
    PALETTE.vegetation.flowerA,
    PALETTE.vegetation.flowerB,
    PALETTE.vegetation.flowerC,
  ];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.42);
    const hh = rng.range(0.2, 0.42);
    b.box(0.04, hh, 0.04, sc.grass, {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
    });
    if (!sc.bare) {
      b.sphere(0.075, 4, 3, heads[i % heads.length], {
        x: Math.cos(a) * rr,
        y: hh,
        z: Math.sin(a) * rr,
      });
    }
  }
}

function buildMushrooms(b: GeoBuilder, rng: Rng, lod: Lod): void {
  const n = lod === 0 ? 7 : 3;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.1, 0.5);
    const hh = rng.range(0.12, 0.26);
    const cap = rng.chance(0.3) ? 0xc4483c : 0xb08a6a;
    b.cylinder(0.035, 0.05, hh, 4, 0xe4dcc8, {
      x: Math.cos(a) * rr,
      y: hh / 2,
      z: Math.sin(a) * rr,
    });
    b.blob(rng.range(0.09, 0.15), 0, cap, {
      x: Math.cos(a) * rr,
      y: hh,
      sy: 0.45,
      z: Math.sin(a) * rr,
    });
  }
}

function buildGlassyRock(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const shards = lod === 0 ? 5 : 2;
  for (let i = 0; i < shards; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = i === 0 ? 0 : rng.range(0.3, 0.8);
    b.tetra(rng.range(0.3, 0.7), i % 2 === 0 ? 0x241f2c : 0x3a3346, {
      x: Math.cos(a) * rr,
      y: rng.range(0.2, 0.6),
      z: Math.sin(a) * rr,
      ry: rng.range(0, Math.PI),
      rx: rng.range(0, Math.PI),
    });
  }
  if (sc.snow > 0.4) b.dodec(0.5, sc.snowCap, { y: 0.8, sy: 0.2 });
}

function buildPaleRock(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const beds = lod === 0 ? 3 : 2;
  for (let i = 0; i < beds; i++) {
    const w = 1.5 - i * 0.28;
    b.box(w, 0.36, w * rng.range(0.7, 1), shade(0xd2cdbc, 0.9 + i * 0.06), {
      y: 0.18 + i * 0.36,
      ry: rng.range(0, Math.PI),
    });
  }
  if (sc.snow > 0.3) b.box(1.1, 0.12, 1.1, sc.snowCap, { y: beds * 0.36 + 0.06 });
}

function buildFlint(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.3);
    b.dodec(rng.range(0.1, 0.2), i % 2 === 0 ? 0x4a4a52 : 0xa89c88, {
      x: Math.cos(a) * rr,
      y: 0.1,
      z: Math.sin(a) * rr,
      sy: 0.6,
      ry: rng.range(0, Math.PI),
    });
  }
  if (sc.snow > 0.5) b.dodec(0.26, sc.snowCap, { y: 0.16, sy: 0.2 });
}
