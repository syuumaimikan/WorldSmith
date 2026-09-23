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
  // broadleaf trees
  | 'oak'
  | 'beech'
  | 'maple'
  | 'ash'
  | 'chestnut'
  | 'birch'
  | 'willow'
  | 'acacia'
  | 'baobab'
  | 'mangrove'
  | 'teak'
  // conifers
  | 'pine'
  | 'spruce'
  | 'fir'
  | 'cedar'
  | 'larch'
  | 'redwood'
  // other trees
  | 'palm'
  | 'banana'
  | 'joshua_tree'
  | 'dead_tree'
  // shrubs and ground cover
  | 'bamboo'
  | 'cactus'
  | 'bush'
  | 'berry_bush'
  | 'hazel'
  | 'olive'
  | 'tea_shrub'
  | 'fern'
  | 'wildflowers'
  | 'mushroom_ring'
  | 'herb_patch'
  | 'reeds'
  | 'papyrus'
  | 'wild_wheat'
  | 'wild_flax'
  | 'fiber_plant'
  // minerals
  | 'rock'
  | 'boulder'
  | 'iron_outcrop'
  | 'copper_outcrop'
  | 'tin_outcrop'
  | 'coal_seam'
  | 'gold_vein'
  | 'silver_vein'
  | 'salt_flat'
  | 'obsidian_flow'
  | 'limestone_outcrop'
  | 'flint_nodule'
  | 'clay_pit'
  | 'sand_pit'
  | 'meteoric_iron';

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
  /**
   * How a tree lives, for the kinds that do.
   *
   * A birch is an old tree at eighty and a cedar is barely started. Giving
   * every species its own clock is what lets a wood that has stood undisturbed
   * for a thousand years look nothing like one planted four generations ago:
   * the birches have come and gone twice over, and the cedars in the middle of
   * it are now the size of buildings.
   */
  life?: TreeLife;
}

export interface TreeLife {
  /** Years to reach working size -- the size the geometry is drawn at. */
  matureYears: number;
  /** Years before old age starts taking them. */
  maxYears: number;
  /**
   * How many times its mature size the very oldest of them get to. A cedar
   * left alone for two thousand years is not a bigger tree, it is a different
   * kind of object; this is the number that says so.
   */
  ancientScale: number;
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
    life: { matureYears: 70, maxYears: 900, ancientScale: 1.9 },
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
    life: { matureYears: 50, maxYears: 400, ancientScale: 1.45 },
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
    life: { matureYears: 30, maxYears: 140, ancientScale: 1.3 },
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
    life: { matureYears: 20, maxYears: 90, ancientScale: 1.25 },
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
  beech: r({
    kind: 'beech',
    name: 'Beech',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 27,
    units: 4,
    regrowDays: -1,
    radius: 1.15,
    blocks: true,
    spreads: true,
    life: { matureYears: 60, maxYears: 300, ancientScale: 1.5 },
  }),
  maple: r({
    kind: 'maple',
    name: 'Maple',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 24,
    units: 3,
    regrowDays: -1,
    radius: 1.05,
    blocks: true,
    spreads: true,
    life: { matureYears: 45, maxYears: 220, ancientScale: 1.4 },
  }),
  ash: r({
    kind: 'ash',
    name: 'Ash',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 23,
    units: 3,
    regrowDays: -1,
    radius: 1.0,
    blocks: true,
    spreads: true,
    life: { matureYears: 40, maxYears: 200, ancientScale: 1.35 },
  }),
  chestnut: r({
    kind: 'chestnut',
    name: 'Chestnut',
    category: 'tree',
    skill: 'chop',
    yields: [
      { item: 'log', amount: 1 },
      { item: 'nuts', amount: 2 },
    ],
    workPerUnit: 26,
    units: 4,
    regrowDays: -1,
    radius: 1.2,
    blocks: true,
    spreads: true,
    life: { matureYears: 55, maxYears: 600, ancientScale: 1.7 },
  }),
  willow: r({
    kind: 'willow',
    name: 'Willow',
    category: 'tree',
    skill: 'chop',
    yields: [
      { item: 'log', amount: 1 },
      { item: 'fiber', amount: 2 },
    ],
    workPerUnit: 18,
    units: 3,
    regrowDays: -1,
    radius: 1.1,
    blocks: true,
    spreads: true,
    life: { matureYears: 25, maxYears: 110, ancientScale: 1.3 },
  }),
  acacia: r({
    kind: 'acacia',
    name: 'Acacia',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 25,
    units: 2,
    regrowDays: -1,
    radius: 1.3,
    blocks: true,
    spreads: true,
    life: { matureYears: 35, maxYears: 160, ancientScale: 1.35 },
  }),
  baobab: r({
    kind: 'baobab',
    name: 'Baobab',
    category: 'tree',
    skill: 'chop',
    yields: [
      { item: 'log', amount: 2 },
      { item: 'vegetables', amount: 2 },
    ],
    workPerUnit: 40,
    units: 5,
    regrowDays: -1,
    radius: 2.2,
    blocks: true,
    spreads: false,
    life: { matureYears: 200, maxYears: 2200, ancientScale: 2.1 },
  }),
  mangrove: r({
    kind: 'mangrove',
    name: 'Mangrove',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 24,
    units: 2,
    regrowDays: -1,
    radius: 1.4,
    blocks: true,
    spreads: true,
    life: { matureYears: 30, maxYears: 130, ancientScale: 1.25 },
  }),
  teak: r({
    kind: 'teak',
    name: 'Teak',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 2 }],
    workPerUnit: 34,
    units: 4,
    regrowDays: -1,
    radius: 1.25,
    blocks: true,
    spreads: true,
    life: { matureYears: 70, maxYears: 380, ancientScale: 1.6 },
  }),
  spruce: r({
    kind: 'spruce',
    name: 'Spruce',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 21,
    units: 3,
    regrowDays: -1,
    radius: 0.95,
    blocks: true,
    spreads: true,
    life: { matureYears: 55, maxYears: 450, ancientScale: 1.5 },
  }),
  fir: r({
    kind: 'fir',
    name: 'Fir',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 20,
    units: 3,
    regrowDays: -1,
    radius: 0.9,
    blocks: true,
    spreads: true,
    life: { matureYears: 50, maxYears: 300, ancientScale: 1.45 },
  }),
  cedar: r({
    kind: 'cedar',
    name: 'Cedar',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 2 }],
    workPerUnit: 32,
    units: 5,
    regrowDays: -1,
    radius: 1.3,
    blocks: true,
    spreads: true,
    // Left alone for two thousand years, a cedar stops being a tree you fell
    // and becomes the thing a shrine gets built around.
    life: { matureYears: 90, maxYears: 2600, ancientScale: 2.6 },
  }),
  larch: r({
    kind: 'larch',
    name: 'Larch',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 22,
    units: 3,
    regrowDays: -1,
    radius: 0.9,
    blocks: true,
    spreads: true,
    life: { matureYears: 45, maxYears: 500, ancientScale: 1.5 },
  }),
  redwood: r({
    kind: 'redwood',
    name: 'Redwood',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 3 }],
    workPerUnit: 44,
    units: 7,
    regrowDays: -1,
    radius: 1.9,
    blocks: true,
    spreads: true,
    life: { matureYears: 120, maxYears: 2800, ancientScale: 3.1 },
  }),
  banana: r({
    kind: 'banana',
    name: 'Banana Palm',
    category: 'tree',
    skill: 'forage',
    yields: [{ item: 'vegetables', amount: 3 }],
    workPerUnit: 9,
    units: 3,
    regrowDays: 22,
    radius: 0.8,
    blocks: false,
    spreads: true,
    life: { matureYears: 4, maxYears: 25, ancientScale: 1.1 },
  }),
  joshua_tree: r({
    kind: 'joshua_tree',
    name: 'Joshua Tree',
    category: 'tree',
    skill: 'chop',
    yields: [{ item: 'log', amount: 1 }],
    workPerUnit: 18,
    units: 1,
    regrowDays: -1,
    radius: 1.1,
    blocks: true,
    spreads: false,
    life: { matureYears: 60, maxYears: 900, ancientScale: 1.8 },
  }),
  bamboo: r({
    kind: 'bamboo',
    name: 'Bamboo Grove',
    category: 'plant',
    skill: 'chop',
    yields: [{ item: 'bamboo', amount: 4 }],
    workPerUnit: 10,
    units: 4,
    regrowDays: 30,
    radius: 1.0,
    blocks: true,
    spreads: true,
  }),
  hazel: r({
    kind: 'hazel',
    name: 'Hazel',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'nuts', amount: 3 }],
    workPerUnit: 8,
    units: 2,
    regrowDays: 40,
    radius: 0.7,
    blocks: false,
    spreads: true,
  }),
  olive: r({
    kind: 'olive',
    name: 'Wild Olive',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'vegetables', amount: 2 }],
    workPerUnit: 9,
    units: 2,
    regrowDays: 45,
    radius: 0.85,
    blocks: false,
    spreads: true,
  }),
  tea_shrub: r({
    kind: 'tea_shrub',
    name: 'Tea Shrub',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'herbs', amount: 3 }],
    workPerUnit: 7,
    units: 2,
    regrowDays: 30,
    radius: 0.6,
    blocks: false,
    spreads: true,
  }),
  fern: r({
    kind: 'fern',
    name: 'Ferns',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'fiber', amount: 2 }],
    workPerUnit: 5,
    units: 2,
    regrowDays: 16,
    radius: 0.5,
    blocks: false,
    spreads: true,
  }),
  wildflowers: r({
    kind: 'wildflowers',
    name: 'Wildflowers',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'herbs', amount: 2 }],
    workPerUnit: 4,
    units: 2,
    regrowDays: 14,
    radius: 0.45,
    blocks: false,
    spreads: true,
  }),
  mushroom_ring: r({
    kind: 'mushroom_ring',
    name: 'Mushrooms',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'mushrooms', amount: 3 }],
    workPerUnit: 5,
    units: 2,
    regrowDays: 12,
    radius: 0.5,
    blocks: false,
    spreads: true,
  }),
  papyrus: r({
    kind: 'papyrus',
    name: 'Papyrus',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'reed', amount: 4 }],
    workPerUnit: 6,
    units: 3,
    regrowDays: 18,
    radius: 0.6,
    blocks: false,
    spreads: true,
  }),
  wild_wheat: r({
    kind: 'wild_wheat',
    name: 'Wild Wheat',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'grain', amount: 3 }],
    workPerUnit: 6,
    units: 2,
    regrowDays: 24,
    radius: 0.5,
    blocks: false,
    spreads: true,
  }),
  wild_flax: r({
    kind: 'wild_flax',
    name: 'Wild Flax',
    category: 'plant',
    skill: 'forage',
    yields: [{ item: 'fiber', amount: 3 }],
    workPerUnit: 5,
    units: 2,
    regrowDays: 20,
    radius: 0.45,
    blocks: false,
    spreads: true,
  }),
  tin_outcrop: r({
    kind: 'tin_outcrop',
    name: 'Tin Outcrop',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'tin_ore', amount: 1 }],
    workPerUnit: 36,
    units: 5,
    regrowDays: -1,
    radius: 0.9,
    blocks: true,
    spreads: false,
  }),
  gold_vein: r({
    kind: 'gold_vein',
    name: 'Gold Vein',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'gold_nugget', amount: 1 }],
    workPerUnit: 52,
    units: 3,
    regrowDays: -1,
    radius: 0.85,
    blocks: true,
    spreads: false,
  }),
  silver_vein: r({
    kind: 'silver_vein',
    name: 'Silver Vein',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'silver_ore', amount: 1 }],
    workPerUnit: 44,
    units: 4,
    regrowDays: -1,
    radius: 0.85,
    blocks: true,
    spreads: false,
  }),
  salt_flat: r({
    kind: 'salt_flat',
    name: 'Salt Pan',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'salt', amount: 2 }],
    workPerUnit: 14,
    units: 6,
    regrowDays: 90,
    radius: 1.6,
    blocks: false,
    spreads: false,
  }),
  meteoric_iron: r({
    kind: 'meteoric_iron',
    name: 'Sky-iron',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'meteoric_iron', amount: 2 }],
    workPerUnit: 34,
    units: 3,
    regrowDays: -1,
    radius: 0.9,
    blocks: true,
    spreads: false,
  }),
  obsidian_flow: r({
    kind: 'obsidian_flow',
    name: 'Obsidian',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'obsidian', amount: 2 }],
    workPerUnit: 28,
    units: 4,
    regrowDays: -1,
    radius: 1.1,
    blocks: true,
    spreads: false,
  }),
  limestone_outcrop: r({
    kind: 'limestone_outcrop',
    name: 'Limestone',
    category: 'mineral',
    skill: 'mine',
    yields: [{ item: 'limestone', amount: 2 }],
    workPerUnit: 24,
    units: 7,
    regrowDays: -1,
    radius: 1.2,
    blocks: true,
    spreads: false,
  }),
  flint_nodule: r({
    kind: 'flint_nodule',
    name: 'Flint',
    category: 'mineral',
    skill: 'forage',
    yields: [{ item: 'flint', amount: 2 }],
    workPerUnit: 9,
    units: 3,
    regrowDays: -1,
    radius: 0.5,
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
  /**
   * How old it is, in years. Trees keep growing long after they are useful,
   * and eventually die of it; everything else ignores this.
   */
  age: number;
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
 * How big this particular individual is, as a multiple of the size its species
 * is drawn at when mature.
 *
 * Growth is fast and then slow. A tree puts on most of its height in its first
 * few decades and then spends centuries thickening, which is why a wood of
 * eighty-year-old oaks looks like a wood and one nine-hundred-year-old oak
 * looks like a landmark. The curve below is that shape: a sharp rise to
 * maturity, then an approach to the species' ancient size that never quite
 * arrives.
 */
export function sizeOf(node: ResourceNode): number {
  const life = RESOURCES[node.kind].life;
  if (!life) return 0.4 + node.growth * 0.6;
  if (node.age <= life.matureYears) {
    return 0.14 + Math.pow(Math.max(0, node.age) / life.matureYears, 0.6) * 0.86;
  }
  const over = (node.age - life.matureYears) / Math.max(1, life.maxYears - life.matureYears);
  return 1 + (life.ancientScale - 1) * (1 - Math.exp(-2.6 * over));
}

/**
 * How much timber is standing in it.
 *
 * Volume goes up faster than height does, so the giants are worth felling out
 * of all proportion to how much taller they are -- and take proportionally
 * longer to bring down.
 */
export function yieldOf(node: ResourceNode): number {
  const def = RESOURCES[node.kind];
  if (!def.life) return def.units;
  return Math.max(1, Math.round(def.units * Math.pow(sizeOf(node), 2.1)));
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
    density: 0.22,
    entries: [
      { kind: 'oak', weight: 7 },
      { kind: 'ash', weight: 5 },
      { kind: 'birch', weight: 5 },
      { kind: 'hazel', weight: 8 },
      { kind: 'bush', weight: 18 },
      { kind: 'berry_bush', weight: 9 },
      { kind: 'fiber_plant', weight: 26 },
      { kind: 'wild_wheat', weight: 10 },
      { kind: 'wild_flax', weight: 8 },
      { kind: 'wildflowers', weight: 14 },
      { kind: 'herb_patch', weight: 5 },
      { kind: 'rock', weight: 5 },
      { kind: 'flint_nodule', weight: 3 },
    ],
  },
  [Biome.TemperateForest]: {
    density: 0.78,
    entries: [
      { kind: 'oak', weight: 30 },
      { kind: 'beech', weight: 22 },
      { kind: 'birch', weight: 18 },
      { kind: 'ash', weight: 14 },
      { kind: 'maple', weight: 14 },
      { kind: 'chestnut', weight: 8 },
      { kind: 'pine', weight: 8 },
      { kind: 'hazel', weight: 12 },
      { kind: 'bush', weight: 14 },
      { kind: 'berry_bush', weight: 8 },
      { kind: 'fern', weight: 16 },
      { kind: 'mushroom_ring', weight: 9 },
      { kind: 'herb_patch', weight: 5 },
      { kind: 'rock', weight: 4 },
      { kind: 'dead_tree', weight: 3 },
    ],
  },
  [Biome.DenseForest]: {
    density: 1.4,
    entries: [
      { kind: 'oak', weight: 26 },
      { kind: 'beech', weight: 20 },
      { kind: 'cedar', weight: 14 },
      { kind: 'redwood', weight: 6 },
      { kind: 'teak', weight: 10 },
      { kind: 'maple', weight: 12 },
      { kind: 'birch', weight: 10 },
      { kind: 'bamboo', weight: 12 },
      { kind: 'fern', weight: 22 },
      { kind: 'mushroom_ring', weight: 12 },
      { kind: 'bush', weight: 14 },
      { kind: 'berry_bush', weight: 7 },
      { kind: 'tea_shrub', weight: 6 },
      { kind: 'herb_patch', weight: 5 },
      { kind: 'dead_tree', weight: 3 },
    ],
  },
  [Biome.Taiga]: {
    density: 0.95,
    entries: [
      { kind: 'spruce', weight: 34 },
      { kind: 'pine', weight: 28 },
      { kind: 'fir', weight: 22 },
      { kind: 'larch', weight: 16 },
      { kind: 'birch', weight: 10 },
      { kind: 'dead_tree', weight: 6 },
      { kind: 'bush', weight: 9 },
      { kind: 'mushroom_ring', weight: 7 },
      { kind: 'rock', weight: 8 },
      { kind: 'berry_bush', weight: 5 },
    ],
  },
  [Biome.Tundra]: {
    density: 0.15,
    entries: [
      { kind: 'rock', weight: 30 },
      { kind: 'boulder', weight: 8 },
      { kind: 'bush', weight: 18 },
      { kind: 'larch', weight: 5 },
      { kind: 'dead_tree', weight: 9 },
      { kind: 'mushroom_ring', weight: 5 },
      { kind: 'herb_patch', weight: 6 },
      { kind: 'flint_nodule', weight: 5 },
    ],
  },
  [Biome.Desert]: {
    density: 0.1,
    entries: [
      { kind: 'cactus', weight: 22 },
      { kind: 'joshua_tree', weight: 8 },
      { kind: 'acacia', weight: 6 },
      { kind: 'rock', weight: 26 },
      { kind: 'boulder', weight: 10 },
      { kind: 'salt_flat', weight: 7 },
      { kind: 'dead_tree', weight: 5 },
      { kind: 'flint_nodule', weight: 4 },
      { kind: 'limestone_outcrop', weight: 4 },
    ],
  },
  [Biome.Savanna]: {
    density: 0.24,
    entries: [
      { kind: 'acacia', weight: 16 },
      { kind: 'baobab', weight: 3 },
      { kind: 'olive', weight: 8 },
      { kind: 'palm', weight: 4 },
      { kind: 'fiber_plant', weight: 34 },
      { kind: 'wild_wheat', weight: 10 },
      { kind: 'bush', weight: 16 },
      { kind: 'rock', weight: 8 },
      { kind: 'salt_flat', weight: 2 },
    ],
  },
  [Biome.Wetland]: {
    density: 0.58,
    entries: [
      { kind: 'reeds', weight: 36 },
      { kind: 'papyrus', weight: 18 },
      { kind: 'willow', weight: 14 },
      { kind: 'mangrove', weight: 12 },
      { kind: 'bush', weight: 12 },
      { kind: 'birch', weight: 6 },
      { kind: 'fern', weight: 10 },
      { kind: 'herb_patch', weight: 8 },
      { kind: 'clay_pit', weight: 5 },
    ],
  },
  [Biome.Beach]: {
    density: 0.1,
    entries: [
      { kind: 'palm', weight: 12 },
      { kind: 'banana', weight: 4 },
      { kind: 'mangrove', weight: 5 },
      { kind: 'rock', weight: 14 },
      { kind: 'sand_pit', weight: 10 },
      { kind: 'salt_flat', weight: 5 },
      { kind: 'fiber_plant', weight: 10 },
      { kind: 'flint_nodule', weight: 4 },
    ],
  },
  [Biome.Mountain]: {
    density: 0.3,
    entries: [
      { kind: 'rock', weight: 38 },
      { kind: 'boulder', weight: 20 },
      { kind: 'pine', weight: 10 },
      { kind: 'fir', weight: 8 },
      { kind: 'larch', weight: 6 },
      { kind: 'limestone_outcrop', weight: 7 },
      { kind: 'flint_nodule', weight: 5 },
      { kind: 'dead_tree', weight: 4 },
    ],
  },
  [Biome.Alpine]: {
    density: 0.13,
    entries: [
      { kind: 'rock', weight: 46 },
      { kind: 'boulder', weight: 24 },
      { kind: 'pine', weight: 5 },
      { kind: 'larch', weight: 4 },
      { kind: 'limestone_outcrop', weight: 6 },
    ],
  },
};

/**
 * Species that only belong at one end of the world.
 *
 * Biome alone is too coarse: a temperate forest at the edge of the ice and one
 * on the tropic line are the same biome and should not be the same wood. Each
 * entry says which band of annual mean temperature a species will actually
 * grow in, and the placement pass drops anything outside its band. What is
 * left is a gradient -- birch giving way to beech giving way to teak -- rather
 * than a hard line where one biome stops.
 */
export const CLIMATE_RANGE: Partial<Record<ResourceKind, { minT: number; maxT: number }>> = {
  larch: { minT: -25, maxT: 8 },
  spruce: { minT: -22, maxT: 11 },
  fir: { minT: -20, maxT: 13 },
  birch: { minT: -18, maxT: 16 },
  pine: { minT: -16, maxT: 22 },
  oak: { minT: 2, maxT: 24 },
  beech: { minT: 3, maxT: 22 },
  ash: { minT: 1, maxT: 21 },
  maple: { minT: 0, maxT: 21 },
  chestnut: { minT: 5, maxT: 23 },
  hazel: { minT: 0, maxT: 20 },
  willow: { minT: -5, maxT: 24 },
  cedar: { minT: 3, maxT: 26 },
  redwood: { minT: 5, maxT: 22 },
  teak: { minT: 18, maxT: 40 },
  bamboo: { minT: 8, maxT: 34 },
  mangrove: { minT: 17, maxT: 40 },
  banana: { minT: 19, maxT: 40 },
  palm: { minT: 16, maxT: 40 },
  baobab: { minT: 18, maxT: 40 },
  acacia: { minT: 12, maxT: 40 },
  olive: { minT: 11, maxT: 30 },
  tea_shrub: { minT: 10, maxT: 28 },
  joshua_tree: { minT: 8, maxT: 34 },
  cactus: { minT: 6, maxT: 40 },
  papyrus: { minT: 14, maxT: 40 },
  fern: { minT: 0, maxT: 30 },
  mushroom_ring: { minT: -4, maxT: 26 },
  wild_wheat: { minT: 4, maxT: 30 },
  wild_flax: { minT: 2, maxT: 26 },
};

/** Whether this species will grow at that annual mean temperature. */
export function growsAt(kind: ResourceKind, temperature: number): boolean {
  const band = CLIMATE_RANGE[kind];
  if (!band) return true;
  return temperature >= band.minT && temperature <= band.maxT;
}
