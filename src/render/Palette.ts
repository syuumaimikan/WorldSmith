/**
 * The single source of truth for colour in WorldSmith.
 *
 * Values are taken from the reference-image analysis in docs/ART_DIRECTION.md.
 * No other module may declare a colour literal — import from here so the whole
 * world can be re-tinted from one place.
 */

import { Color } from 'three';

export const PALETTE = {
  terrain: {
    grass: 0x74a83e,
    grassLush: 0x5e9a34,
    grassDry: 0xa8b056,
    dirt: 0x9c7a4e,
    path: 0xc0a070,
    sand: 0xe0ce94,
    rock: 0x8a8d93,
    rockDark: 0x6e7178,
    snow: 0xf0f3f6,
    tundra: 0x9aa88c,
    savanna: 0xc2b05a,
    wetland: 0x5f8a5a,
    taiga: 0x53763f,
    farmSoil: 0x7a5a3c,
    farmTilled: 0x8c6846,
  },
  water: {
    shallow: 0x58c0e8,
    deep: 0x2c7fb8,
    foam: 0xe8f6ff,
  },
  vegetation: {
    leafSummer: 0x4e8c32,
    leafSpring: 0x6fb347,
    leafAutumn: 0xd2822e,
    leafAutumnAlt: 0xc25a2a,
    leafDead: 0x7a6a4a,
    leafWinter: 0x3f6b3a,
    conifer: 0x2f5f3a,
    coniferLight: 0x3d7347,
    trunk: 0x6b4a2f,
    trunkBirch: 0xd8d2c4,
    trunkDead: 0x8a7458,
    bush: 0x548f3c,
    grassTuft: 0x83b84a,
    flowerA: 0xe8d44a,
    flowerB: 0xe06a8a,
    flowerC: 0xf0f0f0,
    cactus: 0x4a8050,
    palm: 0x59a04a,
    crop: 0x8fbf4a,
    cropRipe: 0xd9c04a,
  },
  build: {
    wood: 0xb07b45,
    woodDark: 0x7a5230,
    woodLight: 0xc99a68,
    plaster: 0xe2d5bb,
    plasterWarm: 0xd8c4a0,
    roofTile: 0xb5462f,
    roofTileAlt: 0x9c4434,
    roofThatch: 0xc4a05a,
    roofSlate: 0x5a5f68,
    stone: 0x9aa0a6,
    stoneDark: 0x757b82,
    scaffold: 0xc79a5b,
    windowLit: 0xffe9a8,
    windowDark: 0x6e8ca0,
    metal: 0x8f9298,
    canvas: 0xdcd2b8,
    foundation: 0x8c8880,
    marker: 0xe0c04a,
  },
  character: {
    body: 0x1a1a20,
    bodyLight: 0x2a2a33,
    eye: 0xd8f24a,
    hand: 0x24242c,
  },
  cloak: {
    player: 0xe23b4a,
    playerTrim: 0xe8c45a,
    builder: 0xe23b4a,
    logger: 0x3f8f4f,
    farmer: 0xd8a83c,
    miner: 0x7a7f8a,
    hauler: 0xc97a2e,
    crafter: 0x8f5ba8,
    trader: 0x2f7fa8,
    researcher: 0x4a9ec4,
    forager: 0x6fa83c,
    idler: 0x9a9a9a,
  },
  wildlife: {
    deer: 0xa8733f,
    deerBelly: 0xd8bb92,
    boar: 0x5a4636,
    rabbit: 0xc9b89a,
    wolf: 0x6a6a72,
    bird: 0x3a5a8a,
    fox: 0xd4762e,
    sheep: 0xe8e4da,
  },
  ui: {
    good: 0x6fbf5a,
    warn: 0xe0b03a,
    bad: 0xd45a4a,
    neutral: 0x8fa8c0,
    valid: 0x5ad07a,
    invalid: 0xe05555,
  },
  sky: {
    dayZenith: 0x2e8fd6,
    dayHorizon: 0xbbd7f0,
    dawnZenith: 0x4e76b8,
    dawnHorizon: 0xf2c29a,
    duskZenith: 0x3a5a96,
    duskHorizon: 0xe89a6a,
    nightZenith: 0x0c1430,
    nightHorizon: 0x22304f,
    overcastZenith: 0x8fa2b4,
    overcastHorizon: 0xc2cbd4,
    cloud: 0xffffff,
    cloudShadow: 0xc8d4e0,
  },
  light: {
    sun: 0xfff4dc,
    sunDawn: 0xffc890,
    sunDusk: 0xff9e68,
    moon: 0x9fb6e0,
    hemiSky: 0xbbd7f0,
    hemiGround: 0x5a6b3a,
    lamp: 0xffcc70,
    fire: 0xff8a3a,
  },
} as const;

/** Cache of Color objects so we never allocate in render loops. */
const colorCache = new Map<number, Color>();

export function col(hex: number): Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

/** Non-cached copy, safe to mutate. */
export function colOf(hex: number): Color {
  return new Color(hex);
}

/** Multiply a hex colour by a scalar brightness, staying in gamma space. */
export function shade(hex: number, factor: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((hex & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Linear blend between two hex colours. */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

/**
 * Applies a small deterministic value jitter. Used to break up the flatness of
 * instanced vegetation and building parts without needing textures.
 */
export function jitterHex(hex: number, amount: number, r: number): number {
  return shade(hex, 1 + (r - 0.5) * 2 * amount);
}
