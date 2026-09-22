/**
 * Item definitions — data-driven, not hard-coded into systems.
 *
 * Anything that can sit in an inventory, be hauled by a porter, be consumed by
 * a recipe or be demanded by a construction site is defined here and nowhere
 * else. Adding an item should never require touching a system.
 */

export type ItemId =
  // raw
  | 'log'
  | 'stone'
  | 'iron_ore'
  | 'copper_ore'
  | 'coal'
  | 'clay'
  | 'sand'
  | 'fiber'
  | 'berries'
  | 'grain'
  | 'vegetables'
  | 'fish'
  | 'meat'
  | 'hide'
  | 'herbs'
  | 'reed'
  | 'nuts'
  | 'mushrooms'
  | 'bamboo'
  | 'tin_ore'
  | 'gold_nugget'
  | 'silver_ore'
  | 'salt'
  | 'obsidian'
  | 'limestone'
  | 'flint'
  // processed
  | 'plank'
  | 'beam'
  | 'stone_block'
  | 'brick'
  | 'charcoal'
  | 'iron_ingot'
  | 'copper_ingot'
  | 'nails'
  | 'flour'
  | 'bread'
  | 'cloth'
  | 'rope'
  | 'thatch'
  | 'glass'
  | 'leather'
  | 'pottery'
  | 'furniture'
  | 'preserves'
  | 'bronze_ingot'
  // tools
  | 'axe'
  | 'pickaxe'
  | 'hammer'
  | 'hoe'
  | 'saw'
  | 'fishing_rod';

export type ItemCategory = 'raw' | 'material' | 'food' | 'tool' | 'good';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  /** Max units in one inventory slot / one hauler trip unit. */
  stackSize: number;
  /** Kilograms per unit — drives carry limits and cart capacity. */
  weight: number;
  /** Base trade value in coins. */
  value: number;
  /** Icon tint, matching the art palette. */
  color: number;
  /** Nutrition restored when eaten (food only). */
  nutrition?: number;
  /** Tool tier: higher works faster. */
  toolTier?: number;
  /** Which work a tool accelerates. */
  toolFor?: 'chop' | 'mine' | 'build' | 'farm' | 'saw' | 'fish';
  description: string;
}

function def(d: ItemDef): ItemDef {
  return d;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  log: def({
    id: 'log',
    name: 'Log',
    category: 'raw',
    stackSize: 8,
    weight: 22,
    value: 4,
    color: 0x6b4a2f,
    description: 'A felled trunk. Heavy, awkward, and the start of nearly everything.',
  }),
  stone: def({
    id: 'stone',
    name: 'Stone',
    category: 'raw',
    stackSize: 12,
    weight: 18,
    value: 3,
    color: 0x8a8d93,
    description: 'Rough quarried stone.',
  }),
  iron_ore: def({
    id: 'iron_ore',
    name: 'Iron Ore',
    category: 'raw',
    stackSize: 10,
    weight: 16,
    value: 9,
    color: 0x9a6b52,
    description: 'Rusty-red rock, worthless until smelted.',
  }),
  copper_ore: def({
    id: 'copper_ore',
    name: 'Copper Ore',
    category: 'raw',
    stackSize: 10,
    weight: 15,
    value: 8,
    color: 0x6fae8a,
    description: 'Green-streaked ore.',
  }),
  coal: def({
    id: 'coal',
    name: 'Coal',
    category: 'raw',
    stackSize: 12,
    weight: 12,
    value: 6,
    color: 0x2e2e34,
    description: 'Burns hot. The smelters cannot work without it.',
  }),
  clay: def({
    id: 'clay',
    name: 'Clay',
    category: 'raw',
    stackSize: 12,
    weight: 14,
    value: 3,
    color: 0xa87a5c,
    description: 'Dug from riverbanks.',
  }),
  sand: def({
    id: 'sand',
    name: 'Sand',
    category: 'raw',
    stackSize: 14,
    weight: 13,
    value: 2,
    color: 0xe0ce94,
    description: 'Coastal sand, useful for glass.',
  }),
  fiber: def({
    id: 'fiber',
    name: 'Plant Fiber',
    category: 'raw',
    stackSize: 20,
    weight: 2,
    value: 2,
    color: 0xa8b056,
    description: 'Stripped from tough grasses.',
  }),
  reed: def({
    id: 'reed',
    name: 'Reeds',
    category: 'raw',
    stackSize: 16,
    weight: 3,
    value: 2,
    color: 0x8fa84a,
    description: 'Wetland reeds, bundled for roofing.',
  }),
  berries: def({
    id: 'berries',
    name: 'Berries',
    category: 'food',
    stackSize: 20,
    weight: 1,
    value: 3,
    color: 0xd0405a,
    nutrition: 12,
    description: 'Forageable and perishable.',
  }),
  grain: def({
    id: 'grain',
    name: 'Grain',
    category: 'food',
    stackSize: 20,
    weight: 3,
    value: 4,
    color: 0xd9c04a,
    nutrition: 6,
    description: 'Harvested wheat, better milled than eaten.',
  }),
  vegetables: def({
    id: 'vegetables',
    name: 'Vegetables',
    category: 'food',
    stackSize: 18,
    weight: 3,
    value: 5,
    color: 0x7fb04a,
    nutrition: 18,
    description: 'Root crops from the fields.',
  }),
  fish: def({
    id: 'fish',
    name: 'Fish',
    category: 'food',
    stackSize: 12,
    weight: 4,
    value: 6,
    color: 0x7fa8c4,
    nutrition: 22,
    description: 'Fresh from the water.',
  }),
  meat: def({
    id: 'meat',
    name: 'Meat',
    category: 'food',
    stackSize: 10,
    weight: 6,
    value: 9,
    color: 0xc4564a,
    nutrition: 30,
    description: 'Game brought down by hunters.',
  }),
  hide: def({
    id: 'hide',
    name: 'Hide',
    category: 'raw',
    stackSize: 10,
    weight: 5,
    value: 7,
    color: 0xa07a52,
    description: 'Raw animal hide.',
  }),
  herbs: def({
    id: 'herbs',
    name: 'Herbs',
    category: 'raw',
    stackSize: 20,
    weight: 1,
    value: 6,
    color: 0x6fb37a,
    description: 'Gathered for medicine.',
  }),

  plank: def({
    id: 'plank',
    name: 'Plank',
    category: 'material',
    stackSize: 16,
    weight: 6,
    value: 11,
    color: 0xb07b45,
    description: 'Sawn timber. The backbone of construction.',
  }),
  beam: def({
    id: 'beam',
    name: 'Beam',
    category: 'material',
    stackSize: 8,
    weight: 16,
    value: 24,
    color: 0x7a5230,
    description: 'Heavy structural timber for frames and roofs.',
  }),
  stone_block: def({
    id: 'stone_block',
    name: 'Stone Block',
    category: 'material',
    stackSize: 10,
    weight: 20,
    value: 14,
    color: 0x9aa0a6,
    description: 'Dressed stone, squared and true.',
  }),
  brick: def({
    id: 'brick',
    name: 'Brick',
    category: 'material',
    stackSize: 20,
    weight: 4,
    value: 8,
    color: 0xb5462f,
    description: 'Fired clay brick.',
  }),
  charcoal: def({
    id: 'charcoal',
    name: 'Charcoal',
    category: 'material',
    stackSize: 16,
    weight: 5,
    value: 9,
    color: 0x33333a,
    description: 'Slow-burned wood. Fuel for metalwork.',
  }),
  iron_ingot: def({
    id: 'iron_ingot',
    name: 'Iron Ingot',
    category: 'material',
    stackSize: 10,
    weight: 12,
    value: 30,
    color: 0x8f9298,
    description: 'Smelted iron, ready for the forge.',
  }),
  copper_ingot: def({
    id: 'copper_ingot',
    name: 'Copper Ingot',
    category: 'material',
    stackSize: 10,
    weight: 11,
    value: 26,
    color: 0xc4794a,
    description: 'Smelted copper.',
  }),
  nails: def({
    id: 'nails',
    name: 'Nails',
    category: 'material',
    stackSize: 40,
    weight: 1,
    value: 5,
    color: 0x9a9da3,
    description: 'A handful of forged nails.',
  }),
  flour: def({
    id: 'flour',
    name: 'Flour',
    category: 'material',
    stackSize: 16,
    weight: 4,
    value: 9,
    color: 0xe8ddc4,
    description: 'Milled grain.',
  }),
  bread: def({
    id: 'bread',
    name: 'Bread',
    category: 'food',
    stackSize: 12,
    weight: 2,
    value: 16,
    color: 0xc99a58,
    nutrition: 42,
    description: 'Baked daily. Keeps a settlement standing.',
  }),
  preserves: def({
    id: 'preserves',
    name: 'Preserves',
    category: 'food',
    stackSize: 12,
    weight: 3,
    value: 20,
    color: 0xc4564a,
    nutrition: 38,
    description: 'Food that survives a winter.',
  }),
  cloth: def({
    id: 'cloth',
    name: 'Cloth',
    category: 'material',
    stackSize: 14,
    weight: 2,
    value: 18,
    color: 0xdcd2b8,
    description: 'Woven from fiber.',
  }),
  rope: def({
    id: 'rope',
    name: 'Rope',
    category: 'material',
    stackSize: 12,
    weight: 3,
    value: 14,
    color: 0xc4a05a,
    description: 'Twisted fiber. Needed for anything tall.',
  }),
  thatch: def({
    id: 'thatch',
    name: 'Thatch',
    category: 'material',
    stackSize: 16,
    weight: 4,
    value: 6,
    color: 0xc4a05a,
    description: 'Bundled reeds for simple roofing.',
  }),
  glass: def({
    id: 'glass',
    name: 'Glass',
    category: 'material',
    stackSize: 10,
    weight: 4,
    value: 28,
    color: 0xa8d8e8,
    description: 'Clear panes. A mark of a prosperous town.',
  }),
  leather: def({
    id: 'leather',
    name: 'Leather',
    category: 'material',
    stackSize: 12,
    weight: 3,
    value: 19,
    color: 0x8a5e3c,
    description: 'Tanned hide.',
  }),
  pottery: def({
    id: 'pottery',
    name: 'Pottery',
    category: 'good',
    stackSize: 8,
    weight: 5,
    value: 22,
    color: 0xb5674a,
    description: 'Fired vessels for storing food.',
  }),
  furniture: def({
    id: 'furniture',
    name: 'Furniture',
    category: 'good',
    stackSize: 4,
    weight: 18,
    value: 46,
    color: 0x8a5e3c,
    description: 'Tables, beds, chairs. Turns a shell into a home.',
  }),

  axe: def({
    id: 'axe',
    name: 'Axe',
    category: 'tool',
    stackSize: 1,
    weight: 4,
    value: 48,
    color: 0x8f9298,
    toolTier: 2,
    toolFor: 'chop',
    description: 'Fells trees far faster than bare hands.',
  }),
  pickaxe: def({
    id: 'pickaxe',
    name: 'Pickaxe',
    category: 'tool',
    stackSize: 1,
    weight: 5,
    value: 52,
    color: 0x8f9298,
    toolTier: 2,
    toolFor: 'mine',
    description: 'For stone and ore.',
  }),
  hammer: def({
    id: 'hammer',
    name: 'Hammer',
    category: 'tool',
    stackSize: 1,
    weight: 3,
    value: 44,
    color: 0x8f9298,
    toolTier: 2,
    toolFor: 'build',
    description: 'A builder is only as quick as their hammer.',
  }),
  hoe: def({
    id: 'hoe',
    name: 'Hoe',
    category: 'tool',
    stackSize: 1,
    weight: 3,
    value: 40,
    color: 0x8f9298,
    toolTier: 2,
    toolFor: 'farm',
    description: 'Breaks soil for planting.',
  }),
  saw: def({
    id: 'saw',
    name: 'Saw',
    category: 'tool',
    stackSize: 1,
    weight: 3,
    value: 46,
    color: 0x8f9298,
    toolTier: 2,
    toolFor: 'saw',
    description: 'Turns logs into planks with far less waste.',
  }),
  nuts: def({
    id: 'nuts',
    name: 'Nuts',
    category: 'food',
    stackSize: 16,
    weight: 1,
    value: 3,
    color: 0x8a6438,
    nutrition: 14,
    description: 'Hazel and chestnut. Keeps all winter if it stays dry.',
  }),
  mushrooms: def({
    id: 'mushrooms',
    name: 'Mushrooms',
    category: 'food',
    stackSize: 12,
    weight: 1,
    value: 4,
    color: 0xb08a6a,
    nutrition: 9,
    description: 'Good food, if you know which ones.',
  }),
  bamboo: def({
    id: 'bamboo',
    name: 'Bamboo',
    category: 'raw',
    stackSize: 12,
    weight: 6,
    value: 5,
    color: 0x9cb556,
    description: 'Light, straight and stronger than it looks. Grows back in a season.',
  }),
  tin_ore: def({
    id: 'tin_ore',
    name: 'Tin Ore',
    category: 'raw',
    stackSize: 10,
    weight: 15,
    value: 14,
    color: 0xa8aab0,
    description: 'Scarce, dull, and the difference between copper and bronze.',
  }),
  gold_nugget: def({
    id: 'gold_nugget',
    name: 'Gold',
    category: 'raw',
    stackSize: 8,
    weight: 19,
    value: 90,
    color: 0xe0b03c,
    description: 'Too soft to work with and worth more than anything you could make of it.',
  }),
  silver_ore: def({
    id: 'silver_ore',
    name: 'Silver Ore',
    category: 'raw',
    stackSize: 10,
    weight: 16,
    value: 38,
    color: 0xc8ccd4,
    description: 'Dark ore with a bright heart.',
  }),
  salt: def({
    id: 'salt',
    name: 'Salt',
    category: 'raw',
    stackSize: 16,
    weight: 8,
    value: 12,
    color: 0xeef0f2,
    description: 'Keeps meat through a winter, which is worth more than it sounds.',
  }),
  obsidian: def({
    id: 'obsidian',
    name: 'Obsidian',
    category: 'raw',
    stackSize: 10,
    weight: 14,
    value: 16,
    color: 0x241f2c,
    description: 'Volcanic glass. Takes an edge no metal of this age can match.',
  }),
  limestone: def({
    id: 'limestone',
    name: 'Limestone',
    category: 'raw',
    stackSize: 12,
    weight: 17,
    value: 4,
    color: 0xd2cdbc,
    description: 'Soft, pale rock. Burns down to mortar.',
  }),
  flint: def({
    id: 'flint',
    name: 'Flint',
    category: 'raw',
    stackSize: 16,
    weight: 4,
    value: 5,
    color: 0x4a4a52,
    description: 'Strikes a spark and breaks to an edge. The first tool material there was.',
  }),
  bronze_ingot: def({
    id: 'bronze_ingot',
    name: 'Bronze Ingot',
    category: 'material',
    stackSize: 8,
    weight: 15,
    value: 52,
    color: 0xb07840,
    description: 'Copper and tin together, and harder than either.',
  }),
  fishing_rod: def({
    id: 'fishing_rod',
    name: 'Fishing Rod',
    category: 'tool',
    stackSize: 1,
    weight: 2,
    value: 30,
    color: 0xb07b45,
    toolTier: 2,
    toolFor: 'fish',
    description: 'Patience, in stick form.',
  }),
};

export const ALL_ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function itemDef(id: ItemId): ItemDef {
  return ITEMS[id];
}

export function isFood(id: ItemId): boolean {
  return ITEMS[id].category === 'food';
}

export function nutritionOf(id: ItemId): number {
  return ITEMS[id].nutrition ?? 0;
}

/** Items a starving settlement will eat, best first. */
export const FOOD_PRIORITY: ItemId[] = [
  'bread',
  'preserves',
  'meat',
  'fish',
  'vegetables',
  'nuts',
  'mushrooms',
  'berries',
  'grain',
];
