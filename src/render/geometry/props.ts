/**
 * Small world props: ground piles of goods, crops at each growth stage, and the
 * markers used by the placement preview.
 */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { ItemId, ITEMS } from '../../data/items';
import { PALETTE, shade } from '../Palette';
import { Season } from '../TerrainColors';

export type PileShape = 'logs' | 'rocks' | 'sacks' | 'planks' | 'crate' | 'barrel' | 'loose';

export function pileShapeFor(item: ItemId): PileShape {
  switch (item) {
    case 'log':
      return 'logs';
    case 'stone':
    case 'iron_ore':
    case 'copper_ore':
    case 'coal':
    case 'clay':
    case 'sand':
      return 'rocks';
    case 'plank':
    case 'beam':
    case 'stone_block':
    case 'brick':
      return 'planks';
    case 'grain':
    case 'flour':
    case 'fiber':
    case 'reed':
    case 'thatch':
      return 'sacks';
    case 'iron_ingot':
    case 'copper_ingot':
    case 'nails':
    case 'glass':
      return 'crate';
    case 'bread':
    case 'berries':
    case 'vegetables':
    case 'fish':
    case 'meat':
    case 'preserves':
      return 'barrel';
    default:
      return 'loose';
  }
}

/**
 * @param fill 0..1 how big the stack is. Piles visibly grow and shrink as goods
 *   are added and carried away.
 */
export function buildPileGeometry(item: ItemId, shape: PileShape, fill: number): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(`pile:${item}:${shape}`);
  const tint = ITEMS[item].color;
  const levels = Math.max(1, Math.round(1 + fill * 2));

  switch (shape) {
    case 'logs': {
      for (let row = 0; row < levels; row++) {
        const count = Math.max(1, 3 - row);
        for (let i = 0; i < count; i++) {
          b.cylinder(0.16, 0.16, 1.4, 7, i % 2 === 0 ? tint : shade(tint, 0.86), {
            x: (i - (count - 1) / 2) * 0.35,
            y: 0.17 + row * 0.3,
            z: rng.range(-0.05, 0.05),
            rz: Math.PI / 2,
          });
        }
      }
      break;
    }
    case 'rocks': {
      const n = 3 + levels * 2;
      for (let i = 0; i < n; i++) {
        b.dodec(rng.range(0.14, 0.25), shade(tint, rng.range(0.85, 1.12)), {
          x: rng.range(-0.4, 0.4),
          y: rng.range(0.1, 0.16 + levels * 0.14),
          z: rng.range(-0.4, 0.4),
          sy: 0.75,
          ry: rng.range(0, Math.PI),
        });
      }
      break;
    }
    case 'planks': {
      for (let row = 0; row < levels + 1; row++) {
        b.box(1.3, 0.09, 0.5, row % 2 === 0 ? tint : shade(tint, 0.9), {
          y: 0.06 + row * 0.1,
          ry: row % 2 === 0 ? 0 : Math.PI / 2,
        });
      }
      break;
    }
    case 'sacks': {
      const n = 2 + levels;
      for (let i = 0; i < n; i++) {
        b.sphere(0.24, 6, 5, shade(PALETTE.build.canvas, rng.range(0.9, 1.05)), {
          x: rng.range(-0.3, 0.3),
          y: 0.22 + Math.floor(i / 3) * 0.4,
          z: rng.range(-0.25, 0.25),
          sy: 1.3,
          ry: rng.range(0, Math.PI),
        });
      }
      // A spill of the contents so you can tell what is in them.
      b.dodec(0.12, tint, { x: 0.32, y: 0.08, z: 0.28, sy: 0.4 });
      break;
    }
    case 'crate': {
      for (let i = 0; i < levels; i++) {
        const s = 0.42;
        b.box(s, s, s, PALETTE.build.wood, {
          x: rng.range(-0.15, 0.15),
          y: s / 2 + i * s,
          z: rng.range(-0.15, 0.15),
          ry: rng.range(-0.3, 0.3),
        });
        b.box(s * 1.02, 0.05, s * 0.3, PALETTE.build.woodDark, { y: s * 0.5 + i * s });
      }
      b.box(0.16, 0.16, 0.16, tint, { x: 0.3, y: 0.08, z: 0.3 });
      break;
    }
    case 'barrel': {
      for (let i = 0; i < levels; i++) {
        b.cylinder(0.24, 0.27, 0.56, 9, PALETTE.build.woodDark, {
          x: rng.range(-0.22, 0.22),
          y: 0.28 + i * 0.58,
          z: rng.range(-0.22, 0.22),
        });
        b.cylinder(0.28, 0.28, 0.06, 9, PALETTE.build.metal, { y: 0.28 + i * 0.58 });
        b.cylinder(0.23, 0.23, 0.04, 9, tint, { y: 0.56 + i * 0.58 });
      }
      break;
    }
    default: {
      const n = 3 + levels;
      for (let i = 0; i < n; i++) {
        b.box(0.22, 0.14, 0.22, shade(tint, rng.range(0.88, 1.1)), {
          x: rng.range(-0.3, 0.3),
          y: 0.08 + rng.range(0, levels * 0.16),
          z: rng.range(-0.3, 0.3),
          ry: rng.range(0, Math.PI),
        });
      }
    }
  }

  return b.build();
}

/**
 * Crops at a given maturity. Stage 0 is bare tilled soil; by stage 3 the plants
 * are chest high and ready to cut.
 */
export function buildCropGeometry(crop: 'grain' | 'vegetables', stage: 0 | 1 | 2 | 3, season: Season): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(`crop:${crop}:${stage}`);
  if (stage === 0) {
    // Furrows in bare soil.
    for (let i = 0; i < 3; i++) {
      b.box(1.8, 0.05, 0.16, shade(PALETTE.terrain.farmTilled, 0.9 + i * 0.05), {
        y: 0.03,
        z: -0.6 + i * 0.6,
      });
    }
    return b.build();
  }

  const heights = [0, 0.22, 0.5, 0.82];
  const h = heights[stage];
  const green = season === 'autumn' ? PALETTE.vegetation.cropRipe : PALETTE.vegetation.crop;
  const colour = crop === 'grain' && stage === 3 ? PALETTE.vegetation.cropRipe : green;

  const rows = 3;
  const perRow = 5;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < perRow; i++) {
      const x = -0.75 + (i / (perRow - 1)) * 1.5;
      const z = -0.6 + r * 0.6;
      if (crop === 'grain') {
        b.box(0.05, h, 0.05, shade(colour, rng.range(0.9, 1.08)), {
          x: x + rng.range(-0.06, 0.06),
          y: h / 2,
          z: z + rng.range(-0.06, 0.06),
          rz: rng.range(-0.1, 0.1),
        });
        if (stage === 3) {
          b.box(0.09, 0.16, 0.09, PALETTE.vegetation.cropRipe, { x, y: h + 0.06, z });
        }
      } else {
        b.blob(0.13 + stage * 0.04, 0, shade(colour, rng.range(0.9, 1.08)), {
          x: x + rng.range(-0.06, 0.06),
          y: h * 0.5,
          z: z + rng.range(-0.06, 0.06),
          sy: 0.7,
        });
        if (stage === 3) {
          b.sphere(0.09, 5, 4, PALETTE.vegetation.flowerA, { x, y: h * 0.5 + 0.1, z });
        }
      }
    }
  }
  return b.build();
}

/** The flat quad used under the placement preview. */
export function buildPlacementMarker(w: number, d: number): BufferGeometry {
  const b = new GeoBuilder();
  b.quadXZ(w, d, 0xffffff, { y: 0.06 });
  const hw = w / 2;
  const hd = d / 2;
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]) {
    b.box(0.16, 0.9, 0.16, 0xffffff, { x, y: 0.45, z });
  }
  return b.build();
}

/** Simple directional arrow for the rotation indicator. */
export function buildArrowGeometry(): BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.18, 0.05, 0.8, 0xffffff, { y: 0.1, z: 0.1 });
  b.cone(0.28, 0.5, 4, 0xffffff, { y: 0.1, z: 0.72, rx: Math.PI / 2 });
  return b.build();
}
