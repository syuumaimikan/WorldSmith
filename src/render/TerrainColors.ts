/**
 * Ground colour lookup.
 *
 * Every terrain triangle gets its colour from here: biome, altitude, steepness,
 * season and any player-made overlay all fold into one value. Keeping it in a
 * single pure function means the whole world re-tints consistently when the
 * season turns.
 */

import { clamp01, smoothstep } from '../core/math';
import { Biome } from '../world/types';
import { OVERLAY } from '../world/Terrain';
import { PALETTE, mixHex, shade } from './Palette';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface TerrainTint {
  season: Season;
  /** Degrees added to every tile's base temperature by the current season. */
  seasonTempOffset: number;
  /** 0..1 how much snow has accumulated where it is cold enough. */
  snowCover: number;
}

const BASE: Record<Biome, number> = {
  [Biome.Ocean]: PALETTE.terrain.sand,
  [Biome.Lake]: PALETTE.terrain.dirt,
  [Biome.River]: PALETTE.terrain.dirt,
  [Biome.Beach]: PALETTE.terrain.sand,
  [Biome.Grassland]: PALETTE.terrain.grass,
  [Biome.TemperateForest]: PALETTE.terrain.grassLush,
  [Biome.DenseForest]: PALETTE.terrain.grassLush,
  [Biome.Taiga]: PALETTE.terrain.taiga,
  [Biome.Tundra]: PALETTE.terrain.tundra,
  [Biome.Desert]: PALETTE.terrain.sand,
  [Biome.Savanna]: PALETTE.terrain.savanna,
  [Biome.Wetland]: PALETTE.terrain.wetland,
  [Biome.Mountain]: PALETTE.terrain.rock,
  [Biome.Alpine]: PALETTE.terrain.snow,
};

/** Seasonal recolouring applied to anything that grows. */
function seasonalGround(hex: number, biome: Biome, season: Season): number {
  const vegetated =
    biome === Biome.Grassland ||
    biome === Biome.TemperateForest ||
    biome === Biome.DenseForest ||
    biome === Biome.Wetland ||
    biome === Biome.Savanna ||
    biome === Biome.Taiga;
  if (!vegetated) return hex;
  switch (season) {
    case 'spring':
      return mixHex(hex, PALETTE.vegetation.leafSpring, 0.26);
    case 'summer':
      return hex;
    case 'autumn':
      return mixHex(hex, PALETTE.terrain.grassDry, 0.42);
    case 'winter':
      return mixHex(hex, PALETTE.terrain.tundra, 0.4);
  }
}

/**
 * @param faceSlope steepness of this particular triangle in radians — this is
 *   what turns the sides of hills into visible rock faces rather than stretched
 *   grass, matching the angular cliffs in the reference diorama.
 */
export function groundColor(
  biome: Biome,
  height: number,
  temperature: number,
  moisture: number,
  faceSlope: number,
  overlay: number,
  traffic: number,
  jitter: number,
  tint: TerrainTint,
): number {
  // Player-made surfaces win outright.
  if (overlay & OVERLAY.Floor) return shade(PALETTE.build.foundation, 0.96 + jitter * 0.08);
  if (overlay & OVERLAY.Road) return shade(PALETTE.terrain.path, 0.94 + jitter * 0.12);
  if (overlay & OVERLAY.Tilled) return shade(PALETTE.terrain.farmTilled, 0.94 + jitter * 0.12);
  if (overlay & OVERLAY.Field) return shade(PALETTE.terrain.farmSoil, 0.94 + jitter * 0.12);

  let c = BASE[biome] ?? PALETTE.terrain.grass;
  c = seasonalGround(c, biome, tint.season);

  // The sea bed. Shallow water is see-through, so what is under it has to
  // read as sea bed and not as a wet field: pale sand near the beach going to
  // dark silt as it drops away.
  if (biome === Biome.Ocean || biome === Biome.Lake) {
    const depth = Math.max(0, -height);
    c = mixHex(c, 0x6a7a72, smoothstep(0.3, 5, depth));
    c = mixHex(c, 0x243b44, smoothstep(5, 26, depth));
  }

  // Moisture darkens and enriches low ground.
  if (biome === Biome.Grassland || biome === Biome.TemperateForest || biome === Biome.DenseForest) {
    c = mixHex(c, PALETTE.terrain.grassLush, clamp01((moisture - 0.45) * 1.3) * 0.5);
    c = mixHex(c, PALETTE.terrain.grassDry, clamp01((0.35 - moisture) * 2.2) * 0.55);
  }

  // Patchiness. Ground is never one colour over a whole field: there are
  // damper hollows and thinner, drier stretches, and the blotching happens at
  // a scale of tens of metres rather than tile by tile. This is what does the
  // work a texture would do, and it is worth far more than value noise.
  if (
    biome === Biome.Grassland ||
    biome === Biome.TemperateForest ||
    biome === Biome.DenseForest ||
    biome === Biome.Savanna ||
    biome === Biome.Taiga ||
    biome === Biome.Wetland
  ) {
    const blotch = (jitter - 0.5) * 2;
    if (blotch > 0) c = mixHex(c, PALETTE.terrain.grassDry, blotch * 0.3);
    else c = mixHex(c, PALETTE.terrain.grassLush, -blotch * 0.34);
  } else if (biome === Biome.Mountain || biome === Biome.Alpine) {
    c = mixHex(c, PALETTE.terrain.rockDark, clamp01((jitter - 0.45) * 1.4) * 0.35);
  } else if (biome === Biome.Desert || biome === Biome.Beach) {
    c = mixHex(c, PALETTE.terrain.dirt, clamp01((jitter - 0.55) * 1.6) * 0.22);
  }

  // Steep faces expose rock. Two rock tones keep cliffs from reading as flat.
  const rockBlend = smoothstep(0.42, 0.78, faceSlope);
  if (rockBlend > 0) {
    const rockTone = jitter > 0.5 ? PALETTE.terrain.rock : PALETTE.terrain.rockDark;
    c = mixHex(c, rockTone, rockBlend);
  }

  // Snow. The effective temperature already carries the seasonal offset, so the
  // snow line visibly descends in winter and retreats in summer.
  const effTemp = temperature + tint.seasonTempOffset;
  const snowAmt = smoothstep(1.5, -3.5, effTemp) * tint.snowCover;
  if (snowAmt > 0.01) {
    // Snow does not stick to near-vertical rock.
    const stick = 1 - smoothstep(0.55, 0.95, faceSlope) * 0.85;
    c = mixHex(c, PALETTE.terrain.snow, clamp01(snowAmt * stick));
  }

  // Beaches fade into the water line.
  if (height < 1.2 && biome !== Biome.Mountain && biome !== Biome.Alpine) {
    c = mixHex(c, PALETTE.terrain.sand, smoothstep(1.2, -0.2, height) * 0.75);
  }

  // Fire scars. They fade as fertility recovers, but for now the ground is
  // visibly burnt.
  if (overlay & OVERLAY.Burnt) {
    c = mixHex(c, 0x2e2822, 0.62);
  }

  // Desire paths worn in by foot traffic.
  if (traffic > 0) {
    c = mixHex(c, PALETTE.terrain.path, clamp01(traffic / 200) * 0.7);
  }
  if (overlay & OVERLAY.Path) {
    c = mixHex(c, PALETTE.terrain.path, 0.78);
  }

  // A last, gentle shading wobble. Small: the colour variation above is
  // already doing the work, and stacking a heavy value jitter on top of it
  // is what made flat ground look tiled.
  return shade(c, 0.965 + jitter * 0.07);
}

/** Water surface colour from depth, used by the water mesh. */
export function waterColor(depth: number, flowing: boolean): number {
  const t = clamp01(depth / 6);
  let c = mixHex(PALETTE.water.shallow, PALETTE.water.deep, t);
  if (flowing) c = mixHex(c, PALETTE.water.foam, 0.12);
  return c;
}
