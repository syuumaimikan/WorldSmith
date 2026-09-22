/**
 * Production recipes.
 *
 * Every recipe consumes real items out of a building's store and produces real
 * items into it. If the inputs are not physically present, the workshop stands
 * idle — which is exactly the pressure that makes logistics interesting.
 */

import { ItemId } from './items';
import { ResearchId } from './research';

export type RecipeId =
  | 'planks'
  | 'beams'
  | 'furniture'
  | 'tool_handles'
  | 'rope_craft'
  | 'cloth_weave'
  | 'thatch_bundle'
  | 'charcoal_burn'
  | 'brick_fire'
  | 'pottery_fire'
  | 'glass_melt'
  | 'iron_smelt'
  | 'copper_smelt'
  | 'nails_craft'
  | 'axe_craft'
  | 'pickaxe_craft'
  | 'hammer_craft'
  | 'hoe_craft'
  | 'saw_craft'
  | 'flour_mill'
  | 'bread_bake'
  | 'preserves_make'
  | 'leather_tan';

export type CraftSkill = 'woodworking' | 'smithing' | 'crafting' | 'cooking' | 'masonry';

export interface Recipe {
  id: RecipeId;
  name: string;
  inputs: { item: ItemId; amount: number }[];
  outputs: { item: ItemId; amount: number }[];
  /** Work units required for one batch. */
  work: number;
  skill: CraftSkill;
  requiresResearch?: ResearchId;
  /** Lower priority recipes are only run when higher ones cannot be. */
  defaultPriority: number;
}

function r(recipe: Recipe): Recipe {
  return recipe;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  planks: r({
    id: 'planks',
    name: 'Saw Planks',
    inputs: [{ item: 'log', amount: 1 }],
    outputs: [{ item: 'plank', amount: 3 }],
    work: 26,
    skill: 'woodworking',
    defaultPriority: 10,
  }),
  beams: r({
    id: 'beams',
    name: 'Cut Beams',
    inputs: [{ item: 'log', amount: 2 }],
    outputs: [{ item: 'beam', amount: 1 }],
    work: 34,
    skill: 'woodworking',
    requiresResearch: 'timber_framing',
    defaultPriority: 8,
  }),
  furniture: r({
    id: 'furniture',
    name: 'Make Furniture',
    inputs: [
      { item: 'plank', amount: 4 },
      { item: 'nails', amount: 2 },
    ],
    outputs: [{ item: 'furniture', amount: 1 }],
    work: 62,
    skill: 'woodworking',
    defaultPriority: 5,
  }),
  tool_handles: r({
    id: 'tool_handles',
    name: 'Shape Handles',
    inputs: [{ item: 'log', amount: 1 }],
    outputs: [{ item: 'plank', amount: 2 }],
    work: 20,
    skill: 'woodworking',
    defaultPriority: 3,
  }),
  rope_craft: r({
    id: 'rope_craft',
    name: 'Twist Rope',
    inputs: [{ item: 'fiber', amount: 4 }],
    outputs: [{ item: 'rope', amount: 1 }],
    work: 24,
    skill: 'crafting',
    defaultPriority: 7,
    requiresResearch: 'cordage',
  }),
  cloth_weave: r({
    id: 'cloth_weave',
    name: 'Weave Cloth',
    inputs: [{ item: 'fiber', amount: 5 }],
    outputs: [{ item: 'cloth', amount: 2 }],
    work: 32,
    skill: 'crafting',
    defaultPriority: 7,
    requiresResearch: 'weaving',
  }),
  thatch_bundle: r({
    id: 'thatch_bundle',
    name: 'Bundle Thatch',
    inputs: [{ item: 'reed', amount: 3 }],
    outputs: [{ item: 'thatch', amount: 2 }],
    work: 16,
    skill: 'crafting',
    defaultPriority: 9,
  }),
  charcoal_burn: r({
    id: 'charcoal_burn',
    name: 'Burn Charcoal',
    inputs: [{ item: 'log', amount: 2 }],
    outputs: [{ item: 'charcoal', amount: 3 }],
    work: 40,
    skill: 'crafting',
    defaultPriority: 9,
    requiresResearch: 'charcoal_burning',
  }),
  brick_fire: r({
    id: 'brick_fire',
    name: 'Fire Bricks',
    inputs: [
      { item: 'clay', amount: 2 },
      { item: 'charcoal', amount: 1 },
    ],
    outputs: [{ item: 'brick', amount: 4 }],
    work: 34,
    skill: 'masonry',
    defaultPriority: 8,
  }),
  pottery_fire: r({
    id: 'pottery_fire',
    name: 'Fire Pottery',
    inputs: [
      { item: 'clay', amount: 3 },
      { item: 'charcoal', amount: 1 },
    ],
    outputs: [{ item: 'pottery', amount: 2 }],
    work: 38,
    skill: 'crafting',
    defaultPriority: 4,
    requiresResearch: 'pottery_craft',
  }),
  glass_melt: r({
    id: 'glass_melt',
    name: 'Melt Glass',
    inputs: [
      { item: 'sand', amount: 3 },
      { item: 'charcoal', amount: 2 },
    ],
    outputs: [{ item: 'glass', amount: 2 }],
    work: 46,
    skill: 'crafting',
    requiresResearch: 'glassmaking',
    defaultPriority: 6,
  }),
  iron_smelt: r({
    id: 'iron_smelt',
    name: 'Smelt Iron',
    inputs: [
      { item: 'iron_ore', amount: 2 },
      { item: 'charcoal', amount: 2 },
    ],
    outputs: [{ item: 'iron_ingot', amount: 1 }],
    work: 52,
    skill: 'smithing',
    defaultPriority: 9,
    requiresResearch: 'iron_working',
  }),
  copper_smelt: r({
    id: 'copper_smelt',
    name: 'Smelt Copper',
    inputs: [
      { item: 'copper_ore', amount: 2 },
      { item: 'charcoal', amount: 1 },
    ],
    outputs: [{ item: 'copper_ingot', amount: 1 }],
    work: 44,
    skill: 'smithing',
    defaultPriority: 6,
    requiresResearch: 'smelting',
  }),
  nails_craft: r({
    id: 'nails_craft',
    name: 'Forge Nails',
    inputs: [{ item: 'iron_ingot', amount: 1 }],
    outputs: [{ item: 'nails', amount: 12 }],
    work: 30,
    skill: 'smithing',
    defaultPriority: 9,
  }),
  axe_craft: r({
    id: 'axe_craft',
    name: 'Forge Axe',
    inputs: [
      { item: 'iron_ingot', amount: 1 },
      { item: 'plank', amount: 1 },
    ],
    outputs: [{ item: 'axe', amount: 1 }],
    work: 48,
    skill: 'smithing',
    defaultPriority: 8,
  }),
  pickaxe_craft: r({
    id: 'pickaxe_craft',
    name: 'Forge Pickaxe',
    inputs: [
      { item: 'iron_ingot', amount: 1 },
      { item: 'plank', amount: 1 },
    ],
    outputs: [{ item: 'pickaxe', amount: 1 }],
    work: 50,
    skill: 'smithing',
    defaultPriority: 8,
  }),
  hammer_craft: r({
    id: 'hammer_craft',
    name: 'Forge Hammer',
    inputs: [
      { item: 'iron_ingot', amount: 1 },
      { item: 'plank', amount: 1 },
    ],
    outputs: [{ item: 'hammer', amount: 1 }],
    work: 44,
    skill: 'smithing',
    defaultPriority: 8,
  }),
  hoe_craft: r({
    id: 'hoe_craft',
    name: 'Forge Hoe',
    inputs: [
      { item: 'iron_ingot', amount: 1 },
      { item: 'plank', amount: 1 },
    ],
    outputs: [{ item: 'hoe', amount: 1 }],
    work: 42,
    skill: 'smithing',
    defaultPriority: 7,
  }),
  saw_craft: r({
    id: 'saw_craft',
    name: 'Forge Saw',
    inputs: [
      { item: 'iron_ingot', amount: 1 },
      { item: 'plank', amount: 1 },
    ],
    outputs: [{ item: 'saw', amount: 1 }],
    work: 46,
    skill: 'smithing',
    defaultPriority: 7,
  }),
  flour_mill: r({
    id: 'flour_mill',
    name: 'Mill Flour',
    inputs: [{ item: 'grain', amount: 3 }],
    outputs: [{ item: 'flour', amount: 2 }],
    work: 24,
    skill: 'crafting',
    defaultPriority: 10,
    requiresResearch: 'milling',
  }),
  bread_bake: r({
    id: 'bread_bake',
    name: 'Bake Bread',
    inputs: [{ item: 'flour', amount: 2 }],
    outputs: [{ item: 'bread', amount: 3 }],
    work: 30,
    skill: 'cooking',
    defaultPriority: 10,
    requiresResearch: 'baking',
  }),
  preserves_make: r({
    id: 'preserves_make',
    name: 'Make Preserves',
    inputs: [
      { item: 'berries', amount: 6 },
      { item: 'pottery', amount: 1 },
    ],
    outputs: [{ item: 'preserves', amount: 2 }],
    work: 34,
    skill: 'cooking',
    requiresResearch: 'food_preservation',
    defaultPriority: 6,
  }),
  leather_tan: r({
    id: 'leather_tan',
    name: 'Tan Leather',
    inputs: [{ item: 'hide', amount: 2 }],
    outputs: [{ item: 'leather', amount: 1 }],
    work: 36,
    skill: 'crafting',
    defaultPriority: 5,
    requiresResearch: 'tanning',
  }),
};

export function recipeDef(id: RecipeId): Recipe {
  return RECIPES[id];
}

/** All recipes that can produce a given item — used by shortage diagnostics. */
export function producersOf(item: ItemId): Recipe[] {
  return Object.values(RECIPES).filter((r2) => r2.outputs.some((o) => o.item === item));
}
