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
  pine: 3,
  birch: 3,
  palm: 2,
  dead_tree: 2,
  cactus: 2,
  bush: 2,
  berry_bush: 2,
  herb_patch: 1,
  reeds: 2,
  fiber_plant: 1,
  rock: 3,
  boulder: 2,
  iron_outcrop: 1,
  copper_outcrop: 1,
  coal_seam: 1,
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
    case 'birch':
      buildBroadleaf(b, rng, lod, sc, 0.72, PALETTE.vegetation.trunkBirch);
      break;
    case 'pine':
      buildConifer(b, rng, lod, sc);
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
): void {
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

function buildConifer(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const h = rng.range(5.5, 9.5);
  const trunkR = rng.range(0.16, 0.26);

  if (lod === 2) {
    b.cylinder(trunkR, trunkR * 1.3, h * 0.2, 4, PALETTE.vegetation.trunk, { y: h * 0.1 });
    b.cone(h * 0.24, h * 0.86, 5, sc.conifer, { y: h * 0.2 + h * 0.43 });
    return;
  }

  const segs = lod === 0 ? 6 : 4;
  b.cylinder(trunkR * 0.7, trunkR * 1.4, h * 0.32, segs, PALETTE.vegetation.trunk, { y: h * 0.16 });

  const tiers = lod === 0 ? rng.int(4, 6) : 3;
  const baseY = h * 0.18;
  const span = h * 0.82;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = h * 0.3 * (1 - t * 0.72);
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

function buildPalm(b: GeoBuilder, rng: Rng, lod: Lod): void {
  const h = rng.range(5, 7.5);
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
    b.box(2.4, 0.08, 0.5, PALETTE.vegetation.palm, {
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

function buildBush(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors, berries: boolean): void {
  const r = rng.range(0.42, 0.7);
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

function buildReeds(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 11 : 5;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.44);
    const hh = rng.range(0.9, 1.7);
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

function buildTallGrass(b: GeoBuilder, rng: Rng, lod: Lod, sc: SeasonColors): void {
  const n = lod === 0 ? 8 : 3;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, 0.28);
    const hh = rng.range(0.38, 0.72);
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
