/**
 * Procedural building geometry, including every construction stage.
 *
 * This is the file that makes WorldSmith what it is. A building is never drawn
 * as "40% of a finished house": it is drawn as the thing that is physically
 * standing right now — stakes in the ground, then a levelled plot with material
 * piles, then footings, then a bare frame with scaffolding, then walls going
 * up, then rafters, then a roof. You can tell how far along a site is from
 * across the valley without reading a progress bar.
 */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { PALETTE, mixHex, shade } from '../Palette';
import { BuildingDef, BuildingStyle, StageId } from '../../data/buildings';
import { Season } from '../TerrainColors';
import { clamp01 } from '../../core/math';

export interface BuildProgress {
  /** Stage ids that are fully finished. */
  completed: StageId[];
  current: StageId | null;
  currentProgress: number;
  complete: boolean;
}

export interface BuildingVisualOptions {
  def: BuildingDef;
  progress: BuildProgress;
  /** Rotation-aware footprint in tiles. */
  tilesW: number;
  tilesD: number;
  tileSize: number;
  seed: number;
  season: Season;
  /** Windows glow at night and when the building is staffed. */
  lit: boolean;
  /** 0..1; below 0.6 the building starts to look neglected. */
  condition: number;
}

/** Cache key so identical buildings at identical progress share geometry. */
export function visualKey(o: BuildingVisualOptions): string {
  const p = o.progress;
  const bucket = Math.round(p.currentProgress * 5) / 5;
  return [
    o.def.id,
    o.tilesW,
    o.tilesD,
    p.complete ? 'C' : `${p.completed.length}:${p.current ?? '-'}:${bucket}`,
    o.seed % 64,
    o.season,
    o.lit ? 'L' : 'D',
    o.condition > 0.6 ? 'ok' : 'worn',
  ].join('|');
}

export function buildBuildingGeometry(o: BuildingVisualOptions): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(o.seed);
  const W = o.tilesW * o.tileSize;
  const D = o.tilesD * o.tileSize;
  const p = o.progress;

  const has = (s: StageId): boolean => p.complete || p.completed.includes(s);
  const amount = (s: StageId): number => {
    if (p.complete) return 1;
    if (p.completed.includes(s)) return 1;
    if (p.current === s) return clamp01(p.currentProgress);
    return 0;
  };
  // Some buildings skip stages entirely; treat a missing stage as done once
  // anything later has started.
  const stageOrder = o.def.stages.map((s) => s.id);
  const reached = (s: StageId): number => {
    if (!stageOrder.includes(s)) {
      const idx = STAGE_SEQUENCE.indexOf(s);
      for (let i = idx + 1; i < STAGE_SEQUENCE.length; i++) {
        if (stageOrder.includes(STAGE_SEQUENCE[i]) && has(STAGE_SEQUENCE[i])) return 1;
      }
      return p.complete ? 1 : 0;
    }
    return amount(s);
  };

  const palette = buildingPalette(o.def.style, rng, o.condition);

  switch (o.def.style) {
    case 'road':
      buildRoad(b, W, D, palette, rng, reached('fitout'));
      return b.build();
    case 'bridge':
      buildBridge(b, W, D, palette, reached('fitout'));
      return b.build();
    case 'fence':
      buildFence(b, W, palette, rng, reached('fitout'));
      return b.build();
    case 'lamp':
      buildLamp(b, palette, o.lit, reached('fitout'));
      return b.build();
    case 'sign':
      buildSign(b, palette, rng, reached('fitout'));
      return b.build();
    case 'bench':
      buildBench(b, palette, reached('fitout'));
      return b.build();
    case 'stockpile':
      buildStockpile(b, W, D, palette, reached('clearing'));
      return b.build();
    case 'field':
      buildFieldFrame(b, W, D, palette, reached('fitout'));
      return b.build();
    default:
      break;
  }

  // ------------------------------------------------------------ site works
  const planning = reached('planning');
  const clearing = reached('clearing');
  const foundation = reached('foundation');
  const frame = reached('frame');
  const floor = reached('floor');
  const walls = reached('walls');
  const roof = reached('roof');
  const openings = reached('openings');
  const interior = Math.max(reached('interior'), reached('fitout'));

  // Surveyor's stakes and string. Present until the walls go up.
  if (!p.complete && walls < 0.9) {
    buildStakes(b, W, D, planning, walls);
  }

  // Levelled plot, visible once clearing starts.
  if (clearing > 0.05 && !p.complete) {
    b.quadXZ(W * 0.98, D * 0.98, mixHex(PALETTE.terrain.dirt, PALETTE.build.foundation, clearing * 0.6), {
      y: 0.03,
    });
  }

  // Material piles beside the site while it is being built.
  if (!p.complete && clearing > 0.3) {
    buildMaterialPiles(b, W, D, rng, palette);
  }

  // Footings.
  if (foundation > 0) {
    buildFoundation(b, W, D, palette, foundation, p.complete);
  }

  // Frame, floor, walls, roof.
  const wallHeight = o.def.height * (o.def.style === 'longhouse' ? 0.52 : 0.58);
  const storeys = o.def.style === 'house' || o.def.style === 'hall' ? 2 : 1;

  if (frame > 0) buildFrame(b, W, D, wallHeight, palette, frame, rng, storeys);
  if (floor > 0 && stageOrder.includes('floor')) buildFloor(b, W, D, palette, floor);
  if (walls > 0) buildWalls(b, W, D, wallHeight, palette, walls, rng, storeys, o.def.style);
  if (roof > 0) buildRoof(b, W, D, wallHeight * storeys, o.def, palette, roof, rng);
  if (openings > 0 || (p.complete && walls > 0)) {
    buildOpenings(b, W, D, wallHeight, palette, p.complete ? 1 : openings, o.lit, rng, storeys);
  }
  if (interior > 0 || p.complete) buildDetails(b, W, D, wallHeight * storeys, o.def, palette, rng, o.season);

  // Scaffolding while work is in progress above foundation level.
  if (!p.complete && frame > 0.05 && interior < 0.95) {
    buildScaffolding(b, W, D, wallHeight * storeys, rng);
  }

  return b.build();
}

const STAGE_SEQUENCE: StageId[] = [
  'planning',
  'clearing',
  'foundation',
  'frame',
  'floor',
  'walls',
  'roof',
  'openings',
  'interior',
  'fitout',
];

// -------------------------------------------------------------------------
// Palettes
// -------------------------------------------------------------------------

interface BuildPalette {
  wall: number;
  wallAlt: number;
  timber: number;
  timberDark: number;
  roof: number;
  roofAlt: number;
  stone: number;
  trim: number;
}

function buildingPalette(style: BuildingStyle, rng: Rng, condition: number): BuildPalette {
  const B = PALETTE.build;
  const wear = clamp01(1 - condition) * 0.28;

  const roofChoices =
    style === 'house' || style === 'hall'
      ? [B.roofTile, B.roofTileAlt, B.roofSlate]
      : [B.roofThatch, B.roofThatch, B.roofTileAlt];
  const roof = rng.pick(roofChoices);

  const wallChoices =
    style === 'hall' || style === 'house'
      ? [B.plaster, B.plasterWarm]
      : [B.wood, B.woodLight, B.plasterWarm];
  const wall = rng.pick(wallChoices);

  return {
    wall: shade(wall, 1 - wear),
    wallAlt: shade(mixHex(wall, B.woodDark, 0.25), 1 - wear),
    timber: B.wood,
    timberDark: B.woodDark,
    roof: shade(roof, 1 - wear * 1.4),
    roofAlt: shade(mixHex(roof, 0x000000, 0.12), 1 - wear * 1.4),
    stone: B.stone,
    trim: B.woodDark,
  };
}

// -------------------------------------------------------------------------
// Construction stage parts
// -------------------------------------------------------------------------

function buildStakes(b: GeoBuilder, W: number, D: number, planning: number, walls: number): void {
  if (planning <= 0.02) return;
  const fade = 1 - walls;
  if (fade <= 0.05) return;
  const hw = W / 2;
  const hd = D / 2;
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  for (const [x, z] of corners) {
    b.box(0.09, 0.85, 0.09, PALETTE.build.marker, { x, y: 0.42, z });
    b.box(0.2, 0.14, 0.05, PALETTE.build.marker, { x, y: 0.82, z, ry: 0.4 });
  }
  // String line between the stakes.
  const lines: [number, number, number, number][] = [
    [-hw, -hd, hw, -hd],
    [hw, -hd, hw, hd],
    [hw, hd, -hw, hd],
    [-hw, hd, -hw, -hd],
  ];
  for (const [x1, z1, x2, z2] of lines) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    b.box(len, 0.025, 0.025, PALETTE.build.canvas, {
      x: (x1 + x2) / 2,
      y: 0.66,
      z: (z1 + z2) / 2,
      ry: Math.atan2(z2 - z1, x2 - x1),
    });
  }
}

function buildMaterialPiles(b: GeoBuilder, W: number, D: number, rng: Rng, pal: BuildPalette): void {
  const hw = W / 2;
  const hd = D / 2;
  // Stacked timber just outside the footprint.
  const sx = hw * 0.75;
  const sz = -hd * 0.95;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      b.cylinder(0.14, 0.14, 1.5, 6, i % 2 === 0 ? pal.timber : pal.timberDark, {
        x: sx + (i - (2 - row) / 2) * 0.32,
        y: 0.16 + row * 0.27,
        z: sz,
        rz: Math.PI / 2,
      });
    }
  }
  // A heap of stone.
  for (let i = 0; i < 5; i++) {
    b.dodec(rng.range(0.16, 0.3), i % 2 ? PALETTE.build.stone : PALETTE.build.stoneDark, {
      x: -hw * 0.8 + rng.range(-0.3, 0.3),
      y: rng.range(0.1, 0.32),
      z: -hd * 0.85 + rng.range(-0.35, 0.35),
      sy: 0.7,
      ry: rng.range(0, Math.PI),
    });
  }
  // A workman's barrow.
  b.box(0.52, 0.26, 0.34, pal.timber, { x: -hw * 0.9, y: 0.3, z: hd * 0.7, ry: rng.range(0, 1) });
  b.cylinder(0.14, 0.14, 0.06, 7, PALETTE.build.metal, { x: -hw * 0.9, y: 0.14, z: hd * 0.7 + 0.2, rx: Math.PI / 2 });
}

function buildFoundation(
  b: GeoBuilder,
  W: number,
  D: number,
  pal: BuildPalette,
  t: number,
  complete: boolean,
): void {
  const h = 0.36;
  const inset = 0.05;
  const hw = W / 2 - inset;
  const hd = D / 2 - inset;
  const thickness = 0.42;

  // Build the perimeter progressively, one side at a time, so a half-finished
  // footing reads as genuinely half-finished.
  const sides: { x: number; z: number; w: number; d: number }[] = [
    { x: 0, z: -hd + thickness / 2, w: W - inset * 2, d: thickness },
    { x: hw - thickness / 2, z: 0, w: thickness, d: D - inset * 2 },
    { x: 0, z: hd - thickness / 2, w: W - inset * 2, d: thickness },
    { x: -hw + thickness / 2, z: 0, w: thickness, d: D - inset * 2 },
  ];
  const done = complete ? 4 : t * 4;
  for (let i = 0; i < sides.length; i++) {
    const portion = clamp01(done - i);
    if (portion <= 0.02) continue;
    const s = sides[i];
    const scaleAxis = s.w > s.d ? 'w' : 'd';
    const w = scaleAxis === 'w' ? s.w * portion : s.w;
    const d = scaleAxis === 'd' ? s.d * portion : s.d;
    const offX = scaleAxis === 'w' ? -(s.w - w) / 2 : 0;
    const offZ = scaleAxis === 'd' ? -(s.d - d) / 2 : 0;
    b.boxOnGround(w, h, d, i % 2 === 0 ? pal.stone : PALETTE.build.stoneDark, {
      x: s.x + offX,
      z: s.z + offZ,
    });
  }
}

function buildFrame(
  b: GeoBuilder,
  W: number,
  D: number,
  wallHeight: number,
  pal: BuildPalette,
  t: number,
  rng: Rng,
  storeys: number,
): void {
  const totalHeight = wallHeight * storeys;
  const hw = W / 2 - 0.22;
  const hd = D / 2 - 0.22;
  const postR = 0.13;

  const postsX = Math.max(2, Math.round(W / 2.6));
  const postsZ = Math.max(2, Math.round(D / 2.6));
  const positions: [number, number][] = [];
  for (let i = 0; i < postsX; i++) {
    const x = -hw + (i / (postsX - 1)) * hw * 2;
    positions.push([x, -hd], [x, hd]);
  }
  for (let i = 1; i < postsZ - 1; i++) {
    const z = -hd + (i / (postsZ - 1)) * hd * 2;
    positions.push([-hw, z], [hw, z]);
  }

  // Posts go up in order, so a frame under construction is visibly partial.
  const count = Math.ceil(positions.length * t);
  for (let i = 0; i < count; i++) {
    const [x, z] = positions[i];
    const grow = i === count - 1 ? clamp01((t * positions.length) % 1 || 1) : 1;
    b.box(postR * 2, totalHeight * grow, postR * 2, i % 3 === 0 ? pal.timberDark : pal.timber, {
      x,
      y: (totalHeight * grow) / 2 + 0.3,
      z,
    });
  }

  if (t > 0.75) {
    // Top plate ties the posts together.
    const ring = clamp01((t - 0.75) / 0.25);
    b.box(W - 0.3, 0.16, 0.18, pal.timberDark, { x: 0, y: totalHeight + 0.3, z: -hd });
    b.box(W - 0.3, 0.16, 0.18, pal.timberDark, { x: 0, y: totalHeight + 0.3, z: hd });
    if (ring > 0.5) {
      b.box(0.18, 0.16, D - 0.3, pal.timberDark, { x: -hw, y: totalHeight + 0.3, z: 0 });
      b.box(0.18, 0.16, D - 0.3, pal.timberDark, { x: hw, y: totalHeight + 0.3, z: 0 });
    }
    // Diagonal braces, the giveaway that this is a timber frame.
    for (let i = 0; i < 3; i++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const len = Math.hypot(hw, totalHeight) * 0.5;
      b.box(0.12, len, 0.12, pal.timber, {
        x: side * hw * 0.55,
        y: totalHeight * 0.5 + 0.3,
        z: rng.chance(0.5) ? -hd : hd,
        rz: side * 0.72,
      });
    }
    if (storeys > 1) {
      b.box(W - 0.3, 0.16, D - 0.3, shade(pal.timber, 0.85), { y: wallHeight + 0.3 });
    }
  }
}

function buildFloor(b: GeoBuilder, W: number, D: number, pal: BuildPalette, t: number): void {
  const planks = Math.max(3, Math.round(D / 0.5));
  const count = Math.ceil(planks * t);
  const pw = D / planks;
  for (let i = 0; i < count; i++) {
    const z = -D / 2 + pw * (i + 0.5);
    b.box(W - 0.3, 0.08, pw * 0.92, i % 2 === 0 ? pal.timber : shade(pal.timber, 0.92), {
      y: 0.38,
      z,
    });
  }
}

function buildWalls(
  b: GeoBuilder,
  W: number,
  D: number,
  wallHeight: number,
  pal: BuildPalette,
  t: number,
  rng: Rng,
  storeys: number,
  style: BuildingStyle,
): void {
  const hw = W / 2;
  const hd = D / 2;
  const thickness = 0.2;
  const base = 0.36;

  for (let s = 0; s < storeys; s++) {
    // Upper storeys only start once the one below is done.
    const storeyT = clamp01(t * storeys - s);
    if (storeyT <= 0.01) break;
    const y0 = base + s * wallHeight;
    const h = wallHeight * storeyT;
    const wallColor = s === 0 ? pal.wall : pal.wallAlt;

    b.boxOnGround(W, h, thickness, wallColor, { y: y0, z: -hd + thickness / 2 });
    b.boxOnGround(W, h, thickness, shade(wallColor, 0.94), { y: y0, z: hd - thickness / 2 });
    b.boxOnGround(thickness, h, D - thickness * 2, shade(wallColor, 0.9), { y: y0, x: -hw + thickness / 2 });
    b.boxOnGround(thickness, h, D - thickness * 2, shade(wallColor, 0.97), { y: y0, x: hw - thickness / 2 });

    // Exposed timber framing on plastered walls — the classic look.
    if (storeyT > 0.9 && (pal.wall === PALETTE.build.plaster || pal.wall === PALETTE.build.plasterWarm)) {
      const studs = Math.max(2, Math.round(W / 1.5));
      for (let i = 0; i <= studs; i++) {
        const x = -hw + (i / studs) * W;
        b.box(0.13, wallHeight, thickness * 1.3, pal.timberDark, { x, y: y0 + wallHeight / 2, z: -hd + thickness / 2 });
        b.box(0.13, wallHeight, thickness * 1.3, pal.timberDark, { x, y: y0 + wallHeight / 2, z: hd - thickness / 2 });
      }
      b.box(W, 0.14, thickness * 1.3, pal.timberDark, { y: y0 + wallHeight - 0.07, z: -hd + thickness / 2 });
      b.box(W, 0.14, thickness * 1.3, pal.timberDark, { y: y0 + wallHeight - 0.07, z: hd - thickness / 2 });
    }
  }

  if (style === 'warehouse' && t > 0.9) {
    // Big sliding door panel.
    b.box(W * 0.42, wallHeight * 0.78, 0.1, pal.timberDark, {
      y: base + wallHeight * 0.39,
      z: -hd - 0.04,
    });
  }
  void rng;
}

function buildRoof(
  b: GeoBuilder,
  W: number,
  D: number,
  wallTop: number,
  def: BuildingDef,
  pal: BuildPalette,
  t: number,
  rng: Rng,
): void {
  const y = wallTop + 0.36;
  const rise = Math.max(0.9, def.height * 0.3);
  const overhang = 0.26;
  const hip = def.style === 'hall' || def.style === 'granary' || def.style === 'workshop';

  // Rafters first, then the covering — you can watch a roof being closed in.
  const rafterPhase = Math.min(1, t / 0.45);
  const coverPhase = clamp01((t - 0.45) / 0.55);

  if (rafterPhase > 0) {
    const count = Math.max(3, Math.round(W / 0.9));
    const shown = Math.ceil(count * rafterPhase);
    for (let i = 0; i < shown; i++) {
      const x = -W / 2 + (i / (count - 1)) * W;
      const len = Math.hypot(D / 2 + overhang, rise);
      const ang = Math.atan2(rise, D / 2 + overhang);
      b.box(0.1, 0.12, len, pal.timberDark, {
        x,
        y: y + rise / 2,
        z: -(D / 4 + overhang / 2),
        rx: -ang,
      });
      b.box(0.1, 0.12, len, pal.timberDark, {
        x,
        y: y + rise / 2,
        z: D / 4 + overhang / 2,
        rx: ang,
      });
    }
    // Ridge beam.
    b.box(W + 0.2, 0.14, 0.14, pal.timberDark, { y: y + rise, z: 0 });
  }

  if (coverPhase > 0.02) {
    if (hip) {
      b.hipRoof(W * coverPhase, D * coverPhase, rise, overhang * coverPhase, pal.roof, { y });
    } else {
      // Cover from the eaves upward so a partly-tiled roof looks right.
      const covered = rise * coverPhase;
      b.gableRoof(W, D, rise, overhang, pal.roof, pal.wallAlt, { y });
      if (coverPhase < 0.99) {
        // Mask the upper band with the rafter colour to imply missing covering.
        const gap = rise - covered;
        b.box(W + overhang * 2, 0.03, gap * 1.6, shade(pal.timberDark, 1.1), {
          y: y + rise - gap * 0.4,
          z: 0,
        });
      }
      // Ridge capping.
      if (coverPhase > 0.9) {
        b.box(W + overhang * 2, 0.12, 0.26, pal.roofAlt, { y: y + rise + 0.02 });
      }
    }
  }
  void rng;
}

function buildOpenings(
  b: GeoBuilder,
  W: number,
  D: number,
  wallHeight: number,
  pal: BuildPalette,
  t: number,
  lit: boolean,
  rng: Rng,
  storeys: number,
): void {
  const hd = D / 2;
  const base = 0.36;

  // Door in the front wall.
  if (t > 0.15) {
    const doorW = Math.min(1.1, W * 0.26);
    const doorH = Math.min(1.9, wallHeight * 0.82);
    b.box(doorW, doorH, 0.12, pal.timberDark, { y: base + doorH / 2, z: -hd - 0.05 });
    b.box(doorW + 0.16, 0.12, 0.1, pal.timber, { y: base + doorH + 0.06, z: -hd - 0.05 });
    b.sphere(0.055, 5, 4, PALETTE.build.metal, { x: doorW * 0.3, y: base + doorH * 0.52, z: -hd - 0.12 });
  }

  if (t > 0.4) {
    const windowColor = lit ? PALETTE.build.windowLit : PALETTE.build.windowDark;
    const count = Math.max(1, Math.round(W / 2.2));
    for (let s = 0; s < storeys; s++) {
      for (let i = 0; i < count; i++) {
        const x = -W / 2 + ((i + 0.5) / count) * W;
        if (Math.abs(x) < 0.8 && s === 0) continue; // leave room for the door
        const y = base + s * wallHeight + wallHeight * 0.58;
        for (const z of [-hd - 0.04, hd + 0.04]) {
          b.box(0.62, 0.62, 0.06, windowColor, { x, y, z });
          b.box(0.72, 0.1, 0.08, pal.timberDark, { x, y: y + 0.34, z });
          b.box(0.72, 0.1, 0.08, pal.timberDark, { x, y: y - 0.34, z });
          b.box(0.08, 0.66, 0.08, pal.timberDark, { x, y, z });
        }
      }
    }
  }
  void rng;
}

function buildDetails(
  b: GeoBuilder,
  W: number,
  D: number,
  wallTop: number,
  def: BuildingDef,
  pal: BuildPalette,
  rng: Rng,
  season: Season,
): void {
  const hw = W / 2;
  const hd = D / 2;

  // Chimney on anything with a hearth.
  if (def.housing || def.style === 'workshop' || def.style === 'kiln' || def.style === 'hall') {
    const cx = hw * rng.range(0.3, 0.62) * (rng.chance(0.5) ? 1 : -1);
    const h = def.height * 0.34;
    b.box(0.46, h, 0.46, PALETTE.build.stone, { x: cx, y: wallTop + h / 2 + 0.4, z: hd * 0.25 });
    b.box(0.58, 0.14, 0.58, PALETTE.build.stoneDark, { x: cx, y: wallTop + h + 0.4, z: hd * 0.25 });
  }

  // A doorstep and a couple of crates: the small stuff that sells a place as used.
  b.box(1.3, 0.12, 0.5, PALETTE.build.stone, { y: 0.06, z: -hd - 0.3 });
  const crates = rng.int(1, 3);
  for (let i = 0; i < crates; i++) {
    const s = rng.range(0.34, 0.5);
    b.box(s, s, s, i % 2 ? PALETTE.build.woodDark : PALETTE.build.wood, {
      x: hw * rng.range(-0.8, 0.8),
      y: s / 2,
      z: hd + rng.range(0.25, 0.7),
      ry: rng.range(0, Math.PI),
    });
  }

  if (season === 'winter') {
    // Snow settles on the roof ridge and the doorstep.
    b.box(W * 0.94, 0.09, D * 0.5, PALETTE.terrain.snow, { y: wallTop + def.height * 0.22 });
  }

  switch (def.style) {
    case 'mill': {
      // Cap and sails.
      const topY = wallTop + 0.5;
      b.cylinder(0.3, 0.44, 0.5, 8, pal.timberDark, { y: topY });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        b.box(0.16, 3.2, 0.06, pal.timber, {
          x: Math.cos(a) * 1.6,
          y: topY + Math.sin(a) * 1.6,
          z: -hd - 0.5,
          rz: a + Math.PI / 2,
        });
        b.box(0.5, 2.4, 0.03, PALETTE.build.canvas, {
          x: Math.cos(a) * 1.5,
          y: topY + Math.sin(a) * 1.5,
          z: -hd - 0.56,
          rz: a + Math.PI / 2,
        });
      }
      break;
    }
    case 'kiln': {
      // Dome and flue instead of a roof.
      b.sphere(Math.min(W, D) * 0.38, 9, 6, PALETTE.build.stone, { y: 0.5, sy: 0.85 });
      b.cylinder(0.2, 0.26, 1.2, 7, PALETTE.build.stoneDark, { y: 1.6, z: -0.2 });
      b.box(0.6, 0.6, 0.3, 0x2a1a12, { y: 0.55, z: -hd + 0.2 });
      break;
    }
    case 'market': {
      // Stalls with striped awnings.
      const stalls = 4;
      for (let i = 0; i < stalls; i++) {
        const a = (i / stalls) * Math.PI * 2;
        const x = Math.cos(a) * hw * 0.55;
        const z = Math.sin(a) * hd * 0.55;
        b.box(1.7, 0.12, 0.9, pal.timber, { x, y: 0.92, z, ry: -a });
        for (const s of [-0.75, 0.75]) {
          b.box(0.1, 0.92, 0.1, pal.timberDark, {
            x: x + Math.cos(-a) * s,
            y: 0.46,
            z: z + Math.sin(-a) * s,
          });
        }
        b.box(1.9, 0.08, 1.1, i % 2 ? PALETTE.cloak.trader : PALETTE.cloak.hauler, {
          x,
          y: 1.75,
          z,
          ry: -a,
          rx: 0.12,
        });
        // Goods on the counter.
        for (let k = 0; k < 3; k++) {
          b.box(0.2, 0.2, 0.2, rng.pick([PALETTE.vegetation.cropRipe, PALETTE.build.wood, PALETTE.vegetation.flowerB]), {
            x: x + rng.range(-0.55, 0.55),
            y: 1.08,
            z: z + rng.range(-0.25, 0.25),
          });
        }
      }
      break;
    }
    case 'well': {
      b.cylinder(0.72, 0.8, 0.7, 10, PALETTE.build.stone, { y: 0.35 });
      b.cylinder(0.56, 0.56, 0.08, 10, 0x2a3a48, { y: 0.66 });
      for (const s of [-0.62, 0.62]) b.box(0.12, 1.5, 0.12, pal.timber, { x: s, y: 1.05 });
      b.box(1.6, 0.12, 0.9, pal.roof, { y: 1.85, rx: 0 });
      b.cylinder(0.08, 0.08, 1.2, 6, pal.timberDark, { y: 1.62, rz: Math.PI / 2 });
      b.box(0.24, 0.26, 0.24, pal.timberDark, { y: 1.28 });
      break;
    }
    case 'quarry': {
      // A cut face with steps and loose spoil.
      for (let i = 0; i < 4; i++) {
        b.boxOnGround(W - i * 0.9, 0.42, D * 0.35, i % 2 ? PALETTE.terrain.rock : PALETTE.terrain.rockDark, {
          y: i * 0.42,
          z: hd * 0.5 - i * 0.3,
        });
      }
      for (let i = 0; i < 7; i++) {
        b.dodec(rng.range(0.2, 0.42), PALETTE.terrain.rock, {
          x: rng.range(-hw, hw),
          y: 0.2,
          z: rng.range(-hd, 0),
          sy: 0.7,
          ry: rng.range(0, Math.PI),
        });
      }
      b.box(0.1, 1.1, 0.1, pal.timber, { x: hw * 0.7, y: 0.55, z: -hd * 0.6, rz: 0.3 });
      break;
    }
    case 'mine': {
      // Timbered adit and a head frame.
      b.boxOnGround(2.4, 2.2, 0.5, PALETTE.terrain.rockDark, { z: hd - 0.4 });
      b.box(0.24, 2.1, 0.24, pal.timberDark, { x: -0.9, y: 1.05, z: hd - 0.75 });
      b.box(0.24, 2.1, 0.24, pal.timberDark, { x: 0.9, y: 1.05, z: hd - 0.75 });
      b.box(2.2, 0.26, 0.26, pal.timberDark, { y: 2.1, z: hd - 0.75 });
      b.box(1.6, 1.7, 0.2, 0x11131a, { y: 0.85, z: hd - 0.85 });
      for (const s of [-1, 1]) {
        b.box(0.18, 3.2, 0.18, pal.timber, { x: s * 1.2, y: 1.6, z: hd - 2.2, rz: s * -0.16 });
      }
      b.box(2.8, 0.2, 0.2, pal.timberDark, { y: 3.2, z: hd - 2.2 });
      b.cylinder(0.26, 0.26, 0.3, 8, PALETTE.build.metal, { y: 3.0, z: hd - 2.2, rz: Math.PI / 2 });
      break;
    }
    case 'tent': {
      break;
    }
    default:
      break;
  }
}

function buildScaffolding(b: GeoBuilder, W: number, D: number, height: number, rng: Rng): void {
  const hw = W / 2 + 0.45;
  const hd = D / 2 + 0.45;
  const c = PALETTE.build.scaffold;
  const sides: [number, number, number][] = [
    [0, -hd, 0],
    [hw, 0, Math.PI / 2],
  ];
  for (const [x, z, ry] of sides) {
    const span = ry === 0 ? W : D;
    const posts = Math.max(2, Math.round(span / 2));
    for (let i = 0; i <= posts; i++) {
      const o = -span / 2 + (i / posts) * span;
      const px = x + (ry === 0 ? o : 0);
      const pz = z + (ry === 0 ? 0 : o);
      b.box(0.1, height + 0.6, 0.1, c, { x: px, y: (height + 0.6) / 2, z: pz });
    }
    // Two lifts of planking.
    for (const lift of [height * 0.42, height * 0.84]) {
      b.box(ry === 0 ? span : 0.36, 0.08, ry === 0 ? 0.36 : span, c, { x, y: lift, z });
      b.box(ry === 0 ? span : 0.07, 0.07, ry === 0 ? 0.07 : span, c, { x, y: lift + 0.5, z });
    }
    // A leaning ladder.
    if (rng.chance(0.7)) {
      const lx = x + (ry === 0 ? span * 0.3 : 0.2);
      const lz = z + (ry === 0 ? 0.2 : span * 0.3);
      for (let r = 0; r < 5; r++) {
        b.box(0.34, 0.05, 0.05, PALETTE.build.woodDark, { x: lx, y: 0.3 + r * 0.42, z: lz });
      }
      b.box(0.05, height * 0.92, 0.05, PALETTE.build.woodDark, { x: lx - 0.16, y: height * 0.46, z: lz, rx: 0.1 });
      b.box(0.05, height * 0.92, 0.05, PALETTE.build.woodDark, { x: lx + 0.16, y: height * 0.46, z: lz, rx: 0.1 });
    }
  }
}

// -------------------------------------------------------------------------
// Special styles
// -------------------------------------------------------------------------

function buildRoad(b: GeoBuilder, W: number, D: number, pal: BuildPalette, rng: Rng, t: number): void {
  void pal;
  if (t <= 0.02) {
    b.quadXZ(W * 0.9, D * 0.9, PALETTE.terrain.dirt, { y: 0.02 });
    return;
  }
  b.boxOnGround(W, 0.09 * t, D, PALETTE.terrain.path, { y: 0 });
  // Scattered gravel so roads have some texture under flat shading.
  const n = Math.round(4 * t);
  for (let i = 0; i < n; i++) {
    b.dodec(rng.range(0.05, 0.11), shade(PALETTE.terrain.path, rng.range(0.82, 1.1)), {
      x: rng.range(-W * 0.4, W * 0.4),
      y: 0.08,
      z: rng.range(-D * 0.4, D * 0.4),
      sy: 0.5,
    });
  }
}

function buildBridge(b: GeoBuilder, W: number, D: number, pal: BuildPalette, t: number): void {
  b.box(0.22, 1.5, 0.22, pal.timberDark, { x: -W * 0.35, y: -0.4, z: -D * 0.35 });
  b.box(0.22, 1.5, 0.22, pal.timberDark, { x: W * 0.35, y: -0.4, z: -D * 0.35 });
  b.box(0.22, 1.5, 0.22, pal.timberDark, { x: -W * 0.35, y: -0.4, z: D * 0.35 });
  b.box(0.22, 1.5, 0.22, pal.timberDark, { x: W * 0.35, y: -0.4, z: D * 0.35 });
  if (t <= 0.1) return;
  const planks = 4;
  const shown = Math.ceil(planks * t);
  for (let i = 0; i < shown; i++) {
    b.box(W, 0.1, D / planks * 0.88, i % 2 ? pal.timber : shade(pal.timber, 0.92), {
      y: 0.32,
      z: -D / 2 + (D / planks) * (i + 0.5),
    });
  }
  if (t > 0.8) {
    for (const s of [-1, 1]) {
      b.box(0.08, 0.5, D, pal.timberDark, { x: s * W * 0.46, y: 0.62 });
    }
  }
}

function buildFence(b: GeoBuilder, W: number, pal: BuildPalette, rng: Rng, t: number): void {
  if (t <= 0.05) return;
  b.box(0.12, 1.05 * t, 0.12, pal.timberDark, { x: -W * 0.4, y: (1.05 * t) / 2 });
  b.box(0.12, 1.05 * t, 0.12, pal.timberDark, { x: W * 0.4, y: (1.05 * t) / 2 });
  if (t > 0.5) {
    for (const h of [0.42, 0.78]) {
      b.box(W * 0.9, 0.08, 0.06, pal.timber, { y: h, rz: rng.range(-0.02, 0.02) });
    }
  }
}

function buildLamp(b: GeoBuilder, pal: BuildPalette, lit: boolean, t: number): void {
  if (t <= 0.05) return;
  const h = 2.6 * t;
  b.cylinder(0.07, 0.11, h, 6, pal.timberDark, { y: h / 2 });
  if (t > 0.7) {
    b.box(0.3, 0.34, 0.3, lit ? PALETTE.build.windowLit : PALETTE.build.windowDark, { y: h + 0.16 });
    b.cone(0.25, 0.22, 5, PALETTE.build.metal, { y: h + 0.42 });
    b.box(0.5, 0.06, 0.06, pal.timberDark, { y: h - 0.05 });
  }
}

function buildSign(b: GeoBuilder, pal: BuildPalette, rng: Rng, t: number): void {
  if (t <= 0.05) return;
  b.cylinder(0.07, 0.09, 1.8 * t, 6, pal.timberDark, { y: (1.8 * t) / 2 });
  if (t > 0.6) {
    b.box(0.9, 0.36, 0.06, pal.timber, { y: 1.55, ry: rng.range(-0.2, 0.2) });
  }
}

function buildBench(b: GeoBuilder, pal: BuildPalette, t: number): void {
  if (t <= 0.05) return;
  b.box(1.5, 0.09, 0.42, pal.timber, { y: 0.44 });
  b.box(1.5, 0.36, 0.07, pal.timber, { y: 0.66, z: -0.18, rx: -0.14 });
  for (const s of [-0.6, 0.6]) {
    b.box(0.1, 0.44, 0.36, pal.timberDark, { x: s, y: 0.22 });
  }
}

function buildStockpile(b: GeoBuilder, W: number, D: number, pal: BuildPalette, t: number): void {
  // A stockpile is just marked-out, cleared ground plus corner posts.
  b.quadXZ(W * 0.98, D * 0.98, mixHex(PALETTE.terrain.dirt, PALETTE.terrain.path, 0.5), { y: 0.03 });
  if (t <= 0.2) return;
  const hw = W / 2 - 0.15;
  const hd = D / 2 - 0.15;
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    b.box(0.12, 0.62, 0.12, pal.timberDark, { x, y: 0.31, z });
    b.box(0.2, 0.1, 0.2, PALETTE.build.marker, { x, y: 0.64, z });
  }
}

function buildFieldFrame(b: GeoBuilder, W: number, D: number, pal: BuildPalette, t: number): void {
  if (t <= 0.1) return;
  // Low boundary stones and a gate: the crops themselves are drawn separately
  // so they can grow independently of the field structure.
  const hw = W / 2;
  const hd = D / 2;
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    b.box(0.14, 0.7, 0.14, pal.timberDark, { x, y: 0.35, z });
  }
  b.box(W, 0.07, 0.06, pal.timber, { y: 0.5, z: -hd });
  b.box(W, 0.07, 0.06, pal.timber, { y: 0.5, z: hd });
  b.box(0.06, 0.07, D, pal.timber, { y: 0.5, x: -hw });
  b.box(0.06, 0.07, D, pal.timber, { y: 0.5, x: hw });
}

/** Tent is built from poles and canvas rather than walls and a roof. */
export function buildTentGeometry(W: number, D: number, t: number, seed: number): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(seed);
  const h = 2.1;
  const frame = clamp01(t * 2);
  const canvas = clamp01((t - 0.5) * 2);

  if (frame > 0) {
    for (const s of [-1, 1]) {
      b.box(0.1, h * frame, 0.1, PALETTE.build.woodDark, { x: s * W * 0.32, y: (h * frame) / 2, z: -D * 0.32, rz: s * 0.22 });
      b.box(0.1, h * frame, 0.1, PALETTE.build.woodDark, { x: s * W * 0.32, y: (h * frame) / 2, z: D * 0.32, rz: s * 0.22 });
    }
    if (frame > 0.7) b.box(W * 0.1, 0.1, D * 0.8, PALETTE.build.woodDark, { y: h });
  }
  if (canvas > 0.02) {
    const c = shade(PALETTE.build.canvas, rng.range(0.94, 1.04));
    b.gableRoof(W * 0.86, D * 0.86 * canvas, h * 0.95, 0.12, c, shade(c, 0.9), { y: 0.05 });
    b.box(0.55, 1.1, 0.05, shade(c, 0.82), { y: 0.55, z: -D * 0.44 });
  }
  return b.build();
}
