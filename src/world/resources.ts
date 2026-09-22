/**
 * Harvestable world objects: trees, rocks, ore outcrops, bushes.
 *
 * These are real entities, not per-tile numbers. A logger walks to a specific
 * tree, chops that tree, and the tree disappears from the world. Forests thin
 * out where people work and regrow where they do not.
 */

import { ItemId } from '../data/items';
import { Biome } from './types';

export type ResourceKind =
  | 'oak'
  | 'pine'
  | 'birch'
  | 'palm'
  | 'dead_tree'
  | 'cactus'
  | 'bush'
  | 'berry_bush'
  | 'herb_patch'
  | 'reeds'
  | 'fiber_plant'
  | 'rock'
  | 'boulder'
  | 'iron_outcrop'
  | 'copper_outcrop'
  | 'coal_seam'
  | 'clay_pit'
  | 'sand_pit';

export type ResourceCategory = 'tree' | 'plant' | 'mineral';
export type HarvestSkill = 'chop' | 'mine' | 'forage';

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  category: ResourceCategory;
  skill: HarvestSkill;
  /** Items produced when fully harvested. */
  yields: { item: ItemId; amount: number }[];
  /** Work units required to harvest one unit of amount. */
  workPerUnit: number;
  /** Total harvestable units on a mature node. */
  units: number;
  /** In-game days to regrow/replenish after depletion; -1 means permanent loss. */
  regrowDays: number;
  /** Physical radius in metres, for collision and placement spacing. */
  radius: number;
  /** Whether it blocks movement. */
  blocks: boolean;
  /** Nodes of this kind can seed new nodes nearby (forest regrowth). */
  spreads: boolean;
}

function r(d: ResourceDef): ResourceDef {
  return d;
}

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  oak: r({
    kind: 'oak',
    name: 'Oak',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 26,
    units: 4,
    regrowDays: -1,
    radius: 1.1,
    blocks: true,
    spreads: true,
  }),
  pine: r({
    kind: 'pine',
    name: 'Pine',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 22,
    units: 3,
    regrowDays: -1,
    radius: 0.95,
    blocks: true,
    spreads: true,
  }),
  birch: r({
    kind: 'birch',
    name: 'Birch',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 19,
    units: 2,
    regrowDays: -1,
    radius: 0.8,
    blocks: true,
    spreads: true,
  }),
  palm: r({
    kind: 'palm',
    name: 'Palm',
    category: 'tree',
    skill: 'chop',
    yields: [
      { item: 'log', amount: 1 },
      { item: 'fiber', amount: 2 },
    ],
    workPerUnit: 18,
    units: 2,
    regrowDays: -1,
    radius: 0.8,
    blocks: true,
    spreads: true,
  }),
  dead_tree: r({
    kind: 'dead_tree',
    name: 'Dead Tree',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 12,
    units: 2,
    regrowDays: -1,
    radius: 0.7,
    blocks: true,
    spreads: false,
  }),
  cactus: r({
    kind: 'cactus',
    name: 'Cactus',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'fiber', amount: 2 }],
    workPerUnit: 10,
    units: 2,
    regrowDays: 20,
    radius: 0.6,
    blocks: true,
    spreads: true,
  }),
  bush: r({
    kind: 'bush',
    name: 'Bush',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'fiber', amount: 3 }],
    workPerUnit: 7,
    units: 2,
    regrowDays: 8,
    radius: 0.55,
    blocks: false,
    spreads: true,
  }),
  berry_bush: r({
    kind: 'berry_bush',
    name: 'Berry Bush',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'berries', amount: 4 }],
    workPerUnit: 6,
    units: 3,
    regrowDays: 6,
    radius: 0.6,
    blocks: false,
    spreads: true,
  }),
  herb_patch: r({
    kind: 'herb_patch',
    name: 'Herb Patch',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'herbs', amount: 3 }],
    workPerUnit: 6,
    units: 2,
    regrowDays: 10,
    radius: 0.4,
    blocks: false,
    spreads: true,
  }),
  reeds: r({
    kind: 'reeds',
    name: 'Reed Bed',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'reed', amount: 4 }],
    workPerUnit: 5,
    units: 3,
    regrowDays: 5,
    radius: 0.5,
    blocks: false,
    spreads: true,
  }),
  fiber_plant: r({
    kind: 'fiber_plant',
    name: 'Tall Grass',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'fiber', amount: 3 }],
    workPerUnit: 4,
    units: 2,
    regrowDays: 4,
    radius: 0.35,
    blocks: false,
    spreads: true,
  }),
  rock: r({
    kind: 'rock',
    name: 'Loose Rock',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'stone', amount: 2 }],
    workPerUnit: 14,
    units: 2,
    regrowDays: -1,
    radius: 0.7,
    blocks: false,
    spreads: false,
  }),
  boulder: r({
    kind: 'boulder',
    name: 'Boulder',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'stone', amount: 3 }],
    workPerUnit: 20,
    units: 5,
    regrowDays: -1,
    radius: 1.5,
    blocks: true,
    spreads: false,
  }),
  iron_outcrop: r({
    kind: 'iron_outcrop',
    name: 'Iron Outcrop',
    category: 'mineral',
    skill: 'mine',
    yields: [
      { item: 'iron_ore', amount: 2 },
      { item: 'stone', amount: 1 },
    ],
    workPerUnit: 30,
    units: 8,
    regrowDays: -1,
    radius: 1.2,
    blocks: true,
    spreads: false,
  }),
  copper_outcrop: r({
    kind: 'copper_outcrop',
    name: 'Copper Outcrop',
    category: 'mineral',
    skill: 'mine',
    yields: [
      { item: 'copper_ore', amount: 2 },
      { item: 'stone', amount: 1 },
    ],
    workPerUnit: 28,
    units: 7,
    regrowDays: -1,
    radius: 1.2,
    blocks: true,
    spreads: false,
  }),
  coal_seam: r({
    kind: 'coal_seam',
    name: 'Coal Seam',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'coal', amount: 3 }],
    workPerUnit: 24,
    units: 8,
    regrowDays: -1,
    radius: 1.1,
    blocks: true,
    spreads: false,
  }),
  clay_pit: r({
    kind: 'clay_pit',
    name: 'Clay Bank',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'clay', amount: 3 }],
    workPerUnit: 12,
    units: 6,
    regrowDays: 30,
    radius: 1.0,
    blocks: false,
    spreads: false,
  }),
  sand_pit: r({
    kind: 'sand_pit',
    name: 'Sand Bank',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'sand', amount: 3 }],
    workPerUnit: 10,
    units: 6,
    regrowDays: 30,
    radius: 1.0,
    blocks: false,
    spreads: false,
  }),
};

export interface ResourceNode {
  id: number;
  kind: ResourceKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  /** Per-instance size multiplier, drives the variation seen in reference 8. */
  scale: number;
  /** Selects a geometry variant within the kind. */
  variant: number;
  /** Remaining harvestable units. */
  amount: number;
  maxAmount: number;
  /** 0..1 maturity. Saplings render small and yield nothing until grown. */
  growth: number;
  /** Game-days until replenished; <0 when not regrowing. */
  regrowIn: number;
  /** NPC id that has claimed this node, or 0. */
  reservedBy: number;
  /** Progress toward the next unit, in work units. */
  work: number;
  /** Set when the node has been fully consumed and awaits removal/regrow. */
  depleted: boolean;
}

export function resourceDef(kind: ResourceKind): ResourceDef {
  return RESOURCES[kind];
}

export function isTree(kind: ResourceKind): boolean {
  return RESOURCES[kind].category === 'tree';
}

/**
 * Per-biome vegetation and mineral mix.
 *
 * `density` is nodes per 100 square metres at maturity. Values are tuned so the
 * result matches the reference imagery: groves with open ground between them,
 * dense conifer cover on cold slopes, near-empty desert and tundra.
 */
export interface BiomeFlora {
  density: number;
  entries: { kind: ResourceKind; weight: number }[];
}

export const BIOME_FLORA: Partial<Record<Biome, BiomeFlora>> = {
  [Biome.Grassland]: {
    density: 0.18,
    entries: [
      { kind: 'oak', weight: 10 },
      { kind: 'birch', weight: 6 },
      { kind: 'bush', weight: 22 },
      { kind: 'berry_bush', weight: 10 },
      { kind: 'fiber_plant', weight: 30 },
      { kind: 'herb_patch', weight: 6 },
      { kind: 'rock', weight: 5 },
    ],
  },
  [Biome.TemperateForest]: {
    density: 0.72,
    entries: [
      { kind: 'oak', weight: 42 },
      { kind: 'birch', weight: 24 },
      { kind: 'pine', weight: 10 },
      { kind: 'bush', weight: 16 },
      { kind: 'berry_bush', weight: 9 },
      { kind: 'herb_patch', weight: 5 },
      { kind: 'rock', weight: 4 },
      { kind: 'dead_tree', weight: 2 },
    ],
  },
  [Biome.DenseForest]: {
    density: 1.35,
    entries: [
      { kind: 'oak', weight: 44 },
      { kind: 'pine', weight: 26 },
      { kind: 'birch', weight: 14 },
      { kind: 'bush', weight: 18 },
      { kind: 'berry_bush', weight: 8 },
      { kind: 'herb_patch', weight: 5 },
      { kind: 'dead_tree', weight: 3 },
    ],
  },
  [Biome.Taiga]: {
    density: 0.92,
    entries: [
      { kind: 'pine', weight: 62 },
      { kind: 'birch', weight: 12 },
      { kind: 'dead_tree', weight: 6 },
      { kind: 'bush', weight: 10 },
      { kind: 'rock', weight: 8 },
      { kind: 'berry_bush', weight: 4 },
    ],
  },
  [Biome.Tundra]: {
    density: 0.13,
    entries: [
      { kind: 'rock', weight: 34 },
      { kind: 'boulder', weight: 8 },
      { kind: 'bush', weight: 20 },
      { kind: 'dead_tree', weight: 10 },
      { kind: 'herb_patch', weight: 6 },
    ],
  },
  [Biome.Desert]: {
    density: 0.08,
    entries: [
      { kind: 'cactus', weight: 30 },
      { kind: 'rock', weight: 30 },
      { kind: 'boulder', weight: 10 },
      { kind: 'dead_tree', weight: 6 },
    ],
  },
  [Biome.Savanna]: {
    density: 0.2,
    entries: [
      { kind: 'oak', weight: 9 },
      { kind: 'palm', weight: 4 },
      { kind: 'fiber_plant', weight: 40 },
      { kind: 'bush', weight: 20 },
      { kind: 'rock', weight: 8 },
    ],
  },
  [Biome.Wetland]: {
    density: 0.5,
    entries: [
      { kind: 'reeds', weight: 46 },
      { kind: 'bush', weight: 16 },
      { kind: 'birch', weight: 10 },
      { kind: 'oak', weight: 6 },
      { kind: 'herb_patch', weight: 8 },
      { kind: 'clay_pit', weight: 4 },
    ],
  },
  [Biome.Beach]: {
    density: 0.08,
    entries: [
      { kind: 'palm', weight: 14 },
      { kind: 'rock', weight: 16 },
      { kind: 'sand_pit', weight: 10 },
      { kind: 'fiber_plant', weight: 12 },
    ],
  },
  [Biome.Mountain]: {
    density: 0.26,
    entries: [
      { kind: 'rock', weight: 44 },
      { kind: 'boulder', weight: 22 },
      { kind: 'pine', weight: 14 },
      { kind: 'dead_tree', weight: 4 },
    ],
  },
  [Biome.Alpine]: {
    density: 0.12,
    entries: [
      { kind: 'rock', weight: 50 },
      { kind: 'boulder', weight: 24 },
      { kind: 'pine', weight: 6 },
    ],
  },
};
