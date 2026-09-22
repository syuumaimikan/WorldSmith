/**
 * The things that were here before the player was.
 *
 * Ruins, standing stones, a tower nobody has climbed in a century, a cave
 * mouth in a hillside, a wreck half in the sand. These existed in the world
 * data from the beginning -- they have names, they have lore, the old roads
 * run between them -- and none of them were drawn, so the player walked over
 * a world of landmarks and saw an empty field.
 *
 * Each is built once per kind and variant and drawn instanced, the same way
 * the trees are.
 */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { PALETTE, mixHex, shade } from '../Palette';
import type { PointOfInterest } from '../../world/types';

export type LandmarkKind = PointOfInterest['kind'];

/** Variants per kind, so a row of standing stones is not a row of clones. */
export const LANDMARK_VARIANTS: Record<LandmarkKind, number> = {
  ruin: 3,
  cave: 2,
  tower: 2,
  camp: 2,
  grove: 2,
  monolith: 3,
  shipwreck: 2,
};

const OLD_STONE = 0x8d8b80;
const OLD_STONE_DARK = 0x6e6c63;
const MOSS = 0x5d7a4a;

export function buildLandmarkGeometry(kind: LandmarkKind, variant: number): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(`landmark:${kind}:${variant}`);

  switch (kind) {
    case 'ruin':
      buildRuin(b, rng);
      break;
    case 'tower':
      buildTower(b, rng);
      break;
    case 'monolith':
      buildMonolith(b, rng);
      break;
    case 'cave':
      buildCaveMouth(b, rng);
      break;
    case 'camp':
      buildOldCamp(b, rng);
      break;
    case 'grove':
      buildGrove(b, rng);
      break;
    case 'shipwreck':
      buildWreck(b, rng);
      break;
  }

  if (b.isEmpty()) b.box(1, 1, 1, OLD_STONE, { y: 0.5 });
  return b.build();
}

/**
 * Walls that stop halfway up, and the corners that outlasted them.
 *
 * What makes a ruin read as a ruin rather than as an unfinished building is
 * that the height is uneven and the corners survive best -- masonry fails in
 * the middle of a run first.
 */
function buildRuin(b: GeoBuilder, rng: Rng): void {
  const w = rng.range(5, 9);
  const d = rng.range(4, 8);
  const hw = w / 2;
  const hd = d / 2;

  // The footing course, which almost always survives.
  b.box(w, 0.45, d, shade(OLD_STONE_DARK, 0.9), { y: 0.22 });

  const wall = (
    length: number,
    height: number,
    t: { x?: number; z?: number; ry?: number },
  ): void => {
    // Broken into blocks of falling height rather than one slab.
    const blocks = Math.max(2, Math.round(length / 1.1));
    for (let i = 0; i < blocks; i++) {
      const f = i / (blocks - 1);
      // Tallest at the ends, lowest in the middle: the corners hold.
      const keep = 0.35 + Math.abs(f - 0.5) * 1.5;
      const hh = Math.max(0.35, height * keep * rng.range(0.7, 1.1));
      const along = (f - 0.5) * length;
      const c = i % 2 === 0 ? OLD_STONE : OLD_STONE_DARK;
      b.box(length / blocks + 0.05, hh, 0.55, shade(c, rng.range(0.9, 1.1)), {
        x: (t.x ?? 0) + Math.cos(t.ry ?? 0) * along,
        y: 0.4 + hh / 2,
        z: (t.z ?? 0) - Math.sin(t.ry ?? 0) * along,
        ry: t.ry ?? 0,
      });
    }
  };

  const height = rng.range(1.6, 3.2);
  wall(w, height, { z: -hd });
  wall(w, height * rng.range(0.5, 0.9), { z: hd });
  wall(d, height * rng.range(0.6, 1), { x: -hw, ry: Math.PI / 2 });
  wall(d, height * rng.range(0.4, 0.8), { x: hw, ry: Math.PI / 2 });

  // Fallen stone lying where it came down, and moss on the north side of it.
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.5, Math.max(hw, hd) + 1.5);
    b.dodec(rng.range(0.22, 0.5), rng.chance(0.3) ? mixHex(OLD_STONE, MOSS, 0.4) : OLD_STONE, {
      x: Math.cos(a) * r,
      y: rng.range(0.15, 0.4),
      z: Math.sin(a) * r,
      sy: rng.range(0.4, 0.7),
      ry: rng.range(0, Math.PI),
    });
  }
}

/** Round, hollow, and missing its top few courses. */
function buildTower(b: GeoBuilder, rng: Rng): void {
  const r = rng.range(1.8, 2.6);
  const h = rng.range(5, 9);
  const courses = Math.round(h / 0.9);
  for (let i = 0; i < courses; i++) {
    const f = i / courses;
    // The top is broken, so the last courses are partial rings.
    const gap = f > 0.72 ? rng.range(0.15, 0.55) : 0;
    const segs = 9;
    for (let s = 0; s < segs; s++) {
      if (gap > 0 && s / segs < gap) continue;
      const a = (s / segs) * Math.PI * 2;
      b.box(r * 0.75, 0.9, 0.5, shade(s % 2 === 0 ? OLD_STONE : OLD_STONE_DARK, rng.range(0.92, 1.08)), {
        x: Math.cos(a) * r,
        y: 0.45 + i * 0.9,
        z: Math.sin(a) * r,
        ry: -a,
      });
    }
  }
  b.cylinder(r * 1.25, r * 1.35, 0.4, 10, OLD_STONE_DARK, { y: 0.2 });
}

/** A stone somebody stood on end, and meant something by. */
function buildMonolith(b: GeoBuilder, rng: Rng): void {
  const count = rng.int(1, 4);
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? 0 : (i / count) * Math.PI * 2;
    const r = count === 1 ? 0 : rng.range(1.6, 2.6);
    const h = rng.range(2.4, 4.6);
    b.box(rng.range(0.6, 1), h, rng.range(0.35, 0.6), shade(OLD_STONE, rng.range(0.88, 1.06)), {
      x: Math.cos(a) * r,
      y: h / 2,
      z: Math.sin(a) * r,
      ry: rng.range(0, Math.PI),
      rz: rng.range(-0.1, 0.1),
    });
  }
  // Lichen at the base, which is how you can tell it has been there.
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    b.dodec(rng.range(0.2, 0.36), mixHex(OLD_STONE, MOSS, 0.5), {
      x: Math.cos(a) * rng.range(0.8, 2.4),
      y: 0.12,
      z: Math.sin(a) * rng.range(0.8, 2.4),
      sy: 0.35,
    });
  }
}

/**
 * A hole in a hillside, with the rock that came out of it around the lip.
 *
 * The dark is a flat, very dark face set back a little, which at any distance
 * reads as depth without needing the ground opened up underneath it.
 */
function buildCaveMouth(b: GeoBuilder, rng: Rng): void {
  const w = rng.range(2.6, 4.2);
  const h = rng.range(2.2, 3.4);

  // The opening: a dark recess.
  b.box(w * 0.7, h * 0.8, 0.4, 0x0a0a0c, { y: h * 0.4, z: -0.5 });

  // The rock framing it, heaviest above.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.1 + (i / 8) * 0.8);
    b.dodec(rng.range(0.5, 1), i % 2 === 0 ? PALETTE.terrain.rock : PALETTE.terrain.rockDark, {
      x: Math.cos(a) * w * 0.55,
      y: h * 0.15 + Math.sin(a) * h * 0.78,
      z: rng.range(-0.3, 0.25),
      ry: rng.range(0, Math.PI),
      sy: rng.range(0.7, 1.1),
    });
  }
  // Spoil at the foot of it.
  for (let i = 0; i < 5; i++) {
    b.dodec(rng.range(0.25, 0.5), PALETTE.terrain.rockDark, {
      x: rng.range(-w * 0.7, w * 0.7),
      y: 0.18,
      z: rng.range(0.4, 1.4),
      sy: 0.5,
    });
  }
}

/** Somebody camped here, a long time ago. */
function buildOldCamp(b: GeoBuilder, rng: Rng): void {
  // The ring of stones, and the char inside it.
  const stones = 8;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    b.dodec(rng.range(0.16, 0.3), PALETTE.terrain.rock, {
      x: Math.cos(a) * 0.95,
      y: 0.12,
      z: Math.sin(a) * 0.95,
      sy: 0.6,
      ry: rng.range(0, Math.PI),
    });
  }
  b.cylinder(0.75, 0.8, 0.12, 8, 0x2a2622, { y: 0.06 });

  // A lean-to frame that lost its covering.
  const poles = 3;
  for (let i = 0; i < poles; i++) {
    const a = rng.range(-0.6, 0.6) + Math.PI * 0.25;
    b.cylinder(0.05, 0.07, rng.range(1.6, 2.3), 4, PALETTE.vegetation.trunkDead, {
      x: 2 + i * 0.5,
      y: 0.9,
      z: rng.range(-0.6, 0.6),
      rz: Math.cos(a) * 0.5,
      rx: Math.sin(a) * 0.4,
    });
  }
}

/** Trees in a ring, and nothing growing in the middle of it. */
function buildGrove(b: GeoBuilder, rng: Rng): void {
  const stones = rng.int(3, 5);
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const h = rng.range(0.9, 1.5);
    b.box(rng.range(0.4, 0.6), h, 0.35, mixHex(OLD_STONE, MOSS, 0.35), {
      x: Math.cos(a) * 2.8,
      y: h / 2,
      z: Math.sin(a) * 2.8,
      ry: -a,
      rz: rng.range(-0.12, 0.12),
    });
  }
  // A flat offering stone at the centre, worn smooth.
  b.cylinder(0.85, 0.95, 0.3, 9, shade(OLD_STONE, 1.05), { y: 0.15 });
}

/** Ribs in the sand, and what is left of a hull. */
function buildWreck(b: GeoBuilder, rng: Rng): void {
  const len = rng.range(7, 11);
  const ribs = Math.round(len / 1.1);
  const timber = PALETTE.vegetation.trunkDead;
  for (let i = 0; i < ribs; i++) {
    const f = i / (ribs - 1);
    // A hull is widest amidships, and these have fallen outwards.
    const spread = Math.sin(f * Math.PI) * 1.5 + 0.35;
    const h = Math.sin(f * Math.PI) * rng.range(1.2, 2.2) + 0.3;
    for (const side of [-1, 1]) {
      b.box(0.18, h, 0.3, shade(timber, rng.range(0.85, 1.1)), {
        x: (f - 0.5) * len,
        y: h / 2,
        z: side * spread,
        rx: side * rng.range(0.25, 0.5),
      });
    }
  }
  // The keel, and a broken mast lying across it.
  b.box(len, 0.3, 0.5, shade(timber, 0.8), { y: 0.15 });
  b.cylinder(0.14, 0.18, rng.range(3, 5), 5, timber, {
    x: rng.range(-1, 1),
    y: 0.5,
    z: rng.range(1.4, 2.2),
    rz: Math.PI / 2,
    ry: rng.range(0.2, 0.7),
  });
}
