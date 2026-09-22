/**
 * Building definitions.
 *
 * Every building is a *project*, not a purchase: it is described by an ordered
 * list of construction stages, each with its own material demand and labour
 * cost. Nothing here can be finished by paying for it — the materials must
 * physically arrive on site and a builder must do the work.
 *
 * Stage ids are meaningful: the building renderer uses them to decide what is
 * actually standing at any moment, so a half-built house looks half-built.
 */

import { ItemId } from './items';
import { ResearchId } from './research';
import { RecipeId } from './recipes';

export type BuildingId =
  | 'tent'
  | 'cottage'
  | 'house'
  | 'longhouse'
  | 'stockpile'
  | 'warehouse'
  | 'granary'
  | 'lumber_camp'
  | 'forester_hut'
  | 'quarry'
  | 'mine'
  | 'clay_pit_works'
  | 'fishing_hut'
  | 'hunter_lodge'
  | 'well'
  | 'sawmill'
  | 'carpenter'
  | 'smelter'
  | 'blacksmith'
  | 'kiln'
  | 'mill'
  | 'bakery'
  | 'weaver'
  | 'farm_field'
  | 'barn'
  | 'town_hall'
  | 'market'
  | 'research_hut'
  | 'tavern'
  | 'clinic'
  | 'road'
  | 'bridge'
  | 'fence'
  | 'lamp'
  | 'sign'
  | 'bench'
  | 'cart_shed';

export type BuildingCategory =
  | 'housing'
  | 'storage'
  | 'gathering'
  | 'production'
  | 'farming'
  | 'civic'
  | 'infrastructure'
  | 'decoration';

export const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  housing: 'Housing',
  storage: 'Storage',
  gathering: 'Gathering',
  production: 'Production',
  farming: 'Farming',
  civic: 'Public',
  infrastructure: 'Infrastructure',
  decoration: 'Decoration',
};

/** Stage identifiers the renderer knows how to draw. */
export type StageId =
  | 'planning'
  | 'clearing'
  | 'foundation'
  | 'frame'
  | 'floor'
  | 'walls'
  | 'roof'
  | 'openings'
  | 'interior'
  | 'fitout';

export interface ConstructionStage {
  id: StageId;
  name: string;
  /** Labour units required to finish this stage. */
  work: number;
  /** Materials that must be delivered before work can start. */
  materials: Partial<Record<ItemId, number>>;
}

export interface PlacementRules {
  maxSlope: number;
  /** Requires open water within this many tiles. */
  nearWater?: number;
  /** Requires a mineral node of this kind within range. */
  nearOre?: boolean;
  /** Must be placed on water (bridges). */
  onWater?: boolean;
  /** Requires fertile soil. */
  minFertility?: number;
  /** Requires trees within range. */
  nearTrees?: number;
  /** Requires being inside settlement influence. */
  needsSettlement?: boolean;
}

export type BuildingStyle =
  | 'tent'
  | 'cottage'
  | 'house'
  | 'longhouse'
  | 'warehouse'
  | 'granary'
  | 'shed'
  | 'workshop'
  | 'kiln'
  | 'mill'
  | 'hall'
  | 'market'
  | 'tower'
  | 'field'
  | 'stockpile'
  | 'well'
  | 'road'
  | 'bridge'
  | 'fence'
  | 'lamp'
  | 'sign'
  | 'bench'
  | 'quarry'
  | 'mine';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  category: BuildingCategory;
  style: BuildingStyle;
  description: string;
  /** Footprint in tiles. */
  width: number;
  depth: number;
  /** Visual height in metres, used for camera and placement checks. */
  height: number;
  stages: ConstructionStage[];
  /** Max simultaneous workers on site. */
  buildCrew: number;
  /** Jobs this building provides once complete. */
  workSlots: number;
  profession?: string;
  storageSlots?: number;
  storageFilter?: ItemId[];
  housing?: number;
  recipes?: RecipeId[];
  /** Gathering buildings extract from nearby nodes of these kinds. */
  gathers?: 'wood' | 'stone' | 'ore' | 'clay' | 'fish' | 'game' | 'water';
  /** Farm plots managed by this building. */
  farmPlots?: number;
  requiresResearch?: ResearchId;
  placement: PlacementRules;
  /** Drag-placed linear structures such as roads and fences. */
  linear?: boolean;
  /** Infrastructure contribution once complete. */
  infrastructure?: Partial<Record<'road' | 'food' | 'housing' | 'storage' | 'safety' | 'health' | 'education' | 'production', number>>;
  /** Total material cost, derived; filled in at module load. */
  totalMaterials: Partial<Record<ItemId, number>>;
  totalWork: number;
}

function stage(
  id: StageId,
  name: string,
  work: number,
  materials: Partial<Record<ItemId, number>> = {},
): ConstructionStage {
  return { id, name, work, materials };
}

type RawDef = Omit<BuildingDef, 'totalMaterials' | 'totalWork'>;

const RAW: RawDef[] = [
  // ------------------------------------------------------------- housing
  {
    id: 'tent',
    name: 'Tent',
    category: 'housing',
    style: 'tent',
    description:
      'Canvas over a frame of poles. Miserable in winter, but it goes up in an afternoon and gets people off the ground.',
    width: 3,
    depth: 3,
    height: 2.2,
    buildCrew: 2,
    workSlots: 0,
    housing: 2,
    stages: [
      stage('planning', 'Staking out', 20),
      stage('frame', 'Raising poles', 60, { log: 3 }),
      stage('walls', 'Stretching canvas', 70, { fiber: 8 }),
    ],
    placement: { maxSlope: 0.28 },
    infrastructure: { housing: 2 },
  },
  {
    id: 'cottage',
    name: 'Cottage',
    category: 'housing',
    style: 'cottage',
    description:
      'A single-room timber cottage with a thatched roof. The first thing most settlements build that is meant to last.',
    width: 4,
    depth: 4,
    height: 4.2,
    buildCrew: 3,
    workSlots: 0,
    housing: 3,
    stages: [
      stage('planning', 'Staking out', 30),
      stage('clearing', 'Levelling the ground', 70),
      stage('foundation', 'Laying footings', 110, { stone: 6 }),
      stage('frame', 'Raising the frame', 150, { log: 8 }),
      stage('walls', 'Building walls', 160, { plank: 10 }),
      stage('roof', 'Thatching the roof', 130, { plank: 4, thatch: 6 }),
      stage('interior', 'Fitting out', 90, { plank: 4 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { housing: 3 },
  },
  {
    id: 'house',
    name: 'House',
    category: 'housing',
    style: 'house',
    description:
      'A proper two-storey house with tiled roof and glazed windows. Families will wait years for one.',
    width: 5,
    depth: 5,
    height: 6.4,
    buildCrew: 4,
    workSlots: 0,
    housing: 5,
    requiresResearch: 'advanced_construction',
    stages: [
      stage('planning', 'Staking out', 40),
      stage('clearing', 'Levelling the ground', 90),
      stage('foundation', 'Laying footings', 180, { stone_block: 10 }),
      stage('frame', 'Raising the frame', 240, { beam: 8, log: 6 }),
      stage('floor', 'Laying floors', 130, { plank: 10 }),
      stage('walls', 'Building walls', 250, { plank: 18, nails: 20 }),
      stage('roof', 'Tiling the roof', 200, { beam: 4, brick: 16 }),
      stage('openings', 'Doors and windows', 120, { plank: 6, glass: 4 }),
      stage('interior', 'Fitting out', 150, { furniture: 2, cloth: 4 }),
    ],
    placement: { maxSlope: 0.17, needsSettlement: true },
    infrastructure: { housing: 5 },
  },
  {
    id: 'longhouse',
    name: 'Longhouse',
    category: 'housing',
    style: 'longhouse',
    description:
      'A long communal hall sleeping many. Cheaper per head than houses, and nobody is fond of it.',
    width: 8,
    depth: 5,
    height: 5.4,
    buildCrew: 5,
    workSlots: 0,
    housing: 10,
    requiresResearch: 'timber_framing',
    stages: [
      stage('planning', 'Staking out', 50),
      stage('clearing', 'Levelling the ground', 120),
      stage('foundation', 'Laying footings', 200, { stone: 16 }),
      stage('frame', 'Raising the frame', 340, { beam: 10, log: 10 }),
      stage('walls', 'Building walls', 320, { plank: 26 }),
      stage('roof', 'Thatching the roof', 260, { beam: 4, thatch: 18 }),
      stage('interior', 'Fitting out', 160, { plank: 8, cloth: 4 }),
    ],
    placement: { maxSlope: 0.17 },
    infrastructure: { housing: 10 },
  },

  // ------------------------------------------------------------- storage
  {
    id: 'stockpile',
    name: 'Stockpile',
    category: 'storage',
    style: 'stockpile',
    description:
      'An open square of cleared ground where haulers pile goods. Free, immediate, and exposed to the weather.',
    width: 4,
    depth: 4,
    height: 0.9,
    buildCrew: 2,
    workSlots: 0,
    storageSlots: 28,
    stages: [stage('clearing', 'Clearing the ground', 45)],
    placement: { maxSlope: 0.22 },
    infrastructure: { storage: 1 },
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    category: 'storage',
    style: 'warehouse',
    description:
      'A weathertight store with racks and a wide door. Nothing else keeps a settlement supplied through winter.',
    width: 6,
    depth: 6,
    height: 5.2,
    buildCrew: 4,
    workSlots: 1,
    profession: 'hauler',
    storageSlots: 110,
    stages: [
      stage('planning', 'Staking out', 40),
      stage('clearing', 'Levelling the ground', 100),
      stage('foundation', 'Laying footings', 190, { stone: 14 }),
      stage('frame', 'Raising the frame', 290, { log: 14, beam: 4 }),
      stage('floor', 'Laying floors', 150, { plank: 12 }),
      stage('walls', 'Building walls', 300, { plank: 22 }),
      stage('roof', 'Roofing', 220, { beam: 4, thatch: 12 }),
      stage('fitout', 'Building racks', 140, { plank: 10 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { storage: 4 },
  },
  {
    id: 'granary',
    name: 'Granary',
    category: 'storage',
    style: 'granary',
    description:
      'A raised, vented store for food alone. Keeps grain dry and out of reach of vermin.',
    width: 5,
    depth: 5,
    height: 4.8,
    buildCrew: 3,
    workSlots: 1,
    profession: 'hauler',
    storageSlots: 64,
    storageFilter: ['grain', 'flour', 'bread', 'vegetables', 'berries', 'fish', 'meat', 'preserves', 'herbs'],
    requiresResearch: 'agriculture',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Raising the platform', 160, { stone: 8, log: 6 }),
      stage('frame', 'Raising the frame', 200, { log: 8 }),
      stage('walls', 'Building walls', 210, { plank: 16 }),
      stage('roof', 'Roofing', 150, { thatch: 10 }),
      stage('fitout', 'Fitting bins', 100, { plank: 6 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { storage: 2, food: 1 },
  },

  // ----------------------------------------------------------- gathering
  {
    id: 'lumber_camp',
    name: 'Lumber Camp',
    category: 'gathering',
    style: 'shed',
    description:
      'A rough shelter and a saw-horse. Loggers based here fell trees nearby and stack the logs for collection.',
    width: 4,
    depth: 4,
    height: 2.8,
    buildCrew: 2,
    workSlots: 3,
    profession: 'logger',
    gathers: 'wood',
    storageSlots: 16,
    storageFilter: ['log'],
    stages: [
      stage('planning', 'Staking out', 20),
      stage('clearing', 'Clearing the ground', 60),
      stage('frame', 'Raising the frame', 120, { log: 6 }),
      stage('roof', 'Roofing', 90, { log: 3, fiber: 6 }),
    ],
    placement: { maxSlope: 0.3, nearTrees: 28 },
    infrastructure: { production: 1 },
  },
  {
    id: 'forester_hut',
    name: "Forester's Hut",
    category: 'gathering',
    style: 'shed',
    description:
      'A forester plants saplings in cleared ground. Without one, a heavily logged forest never comes back.',
    width: 3,
    depth: 3,
    height: 2.8,
    buildCrew: 2,
    workSlots: 1,
    profession: 'forester',
    storageSlots: 8,
    requiresResearch: 'forestry',
    stages: [
      stage('planning', 'Staking out', 20),
      stage('frame', 'Raising the frame', 110, { log: 5 }),
      stage('walls', 'Building walls', 100, { plank: 6 }),
      stage('roof', 'Roofing', 80, { thatch: 4 }),
    ],
    placement: { maxSlope: 0.3 },
  },
  {
    id: 'quarry',
    name: 'Stone Quarry',
    requiresResearch: 'masonry',
    category: 'gathering',
    style: 'quarry',
    description:
      'A cut face worked with hammers and wedges. Produces stone steadily wherever there is rock to cut.',
    width: 5,
    depth: 5,
    height: 2,
    buildCrew: 3,
    workSlots: 3,
    profession: 'miner',
    gathers: 'stone',
    storageSlots: 16,
    storageFilter: ['stone'],
    stages: [
      stage('planning', 'Surveying', 30),
      stage('clearing', 'Stripping topsoil', 130),
      stage('fitout', 'Cutting the first face', 180, { log: 6 }),
    ],
    placement: { maxSlope: 0.75 },
    infrastructure: { production: 1 },
  },
  {
    id: 'mine',
    name: 'Mine',
    category: 'gathering',
    style: 'mine',
    description:
      'A timbered adit driven into an ore body. Must be sited on a vein — no vein, no metal, ever.',
    width: 5,
    depth: 5,
    height: 3.4,
    buildCrew: 4,
    workSlots: 4,
    profession: 'miner',
    gathers: 'ore',
    storageSlots: 20,
    storageFilter: ['iron_ore', 'copper_ore', 'coal'],
    requiresResearch: 'mining',
    stages: [
      stage('planning', 'Surveying the seam', 40),
      stage('clearing', 'Cutting the bench', 140),
      stage('frame', 'Timbering the adit', 260, { log: 12, beam: 4 }),
      stage('fitout', 'Head frame and hoist', 190, { plank: 10, rope: 4 }),
    ],
    placement: { maxSlope: 0.7, nearOre: true },
    infrastructure: { production: 2 },
  },
  {
    id: 'clay_pit_works',
    name: 'Clay Works',
    category: 'gathering',
    style: 'shed',
    description: 'Diggers work the riverbank for clay and haul it up to the kilns.',
    width: 4,
    depth: 4,
    height: 2.6,
    buildCrew: 2,
    workSlots: 2,
    profession: 'miner',
    gathers: 'clay',
    storageSlots: 12,
    storageFilter: ['clay', 'sand'],
    stages: [
      stage('planning', 'Staking out', 20),
      stage('clearing', 'Cutting the bank', 90),
      stage('frame', 'Raising a shelter', 110, { log: 5 }),
    ],
    placement: { maxSlope: 0.4 },
  },
  {
    id: 'fishing_hut',
    name: 'Fishing Hut',
    requiresResearch: 'boatbuilding',
    category: 'gathering',
    style: 'shed',
    description: 'A jetty and a drying rack. Reliable food wherever there is water.',
    width: 4,
    depth: 4,
    height: 3,
    buildCrew: 2,
    workSlots: 2,
    profession: 'fisher',
    gathers: 'fish',
    storageSlots: 12,
    storageFilter: ['fish'],
    stages: [
      stage('planning', 'Staking out', 20),
      stage('frame', 'Building the jetty', 150, { log: 6, plank: 4 }),
      stage('walls', 'Raising the hut', 120, { plank: 8 }),
      stage('roof', 'Roofing', 80, { thatch: 4 }),
    ],
    placement: { maxSlope: 0.25, nearWater: 3 },
    infrastructure: { food: 2 },
  },
  {
    id: 'hunter_lodge',
    name: "Hunter's Lodge",
    requiresResearch: 'hunting',
    category: 'gathering',
    style: 'shed',
    description:
      'Hunters range out from here after game. Good meat and hides, but the herds thin if you overhunt.',
    width: 4,
    depth: 4,
    height: 3.2,
    buildCrew: 2,
    workSlots: 2,
    profession: 'hunter',
    gathers: 'game',
    storageSlots: 12,
    storageFilter: ['meat', 'hide'],
    stages: [
      stage('planning', 'Staking out', 20),
      stage('frame', 'Raising the frame', 140, { log: 7 }),
      stage('walls', 'Building walls', 130, { plank: 8 }),
      stage('roof', 'Roofing', 90, { thatch: 5 }),
    ],
    placement: { maxSlope: 0.3 },
    infrastructure: { food: 2 },
  },
  {
    id: 'well',
    name: 'Well',
    category: 'gathering',
    style: 'well',
    description: 'Clean water close to home. Saves hours of walking and keeps people healthy.',
    width: 2,
    depth: 2,
    height: 1.6,
    buildCrew: 2,
    workSlots: 0,
    gathers: 'water',
    stages: [
      stage('planning', 'Choosing the spot', 20),
      stage('clearing', 'Digging the shaft', 170),
      stage('walls', 'Lining the shaft', 140, { stone: 12 }),
      stage('fitout', 'Winch and bucket', 80, { log: 3, rope: 2 }),
    ],
    placement: { maxSlope: 0.15 },
    infrastructure: { health: 2 },
  },

  // ---------------------------------------------------------- production
  {
    id: 'sawmill',
    name: 'Sawmill',
    category: 'production',
    style: 'mill',
    description:
      'Turns logs into planks and beams. Every timber-framed building in the settlement depends on it.',
    width: 6,
    depth: 5,
    height: 4.6,
    buildCrew: 3,
    workSlots: 3,
    profession: 'sawyer',
    storageSlots: 32,
    recipes: ['planks', 'beams'],
    requiresResearch: 'woodworking',
    stages: [
      stage('planning', 'Staking out', 40),
      stage('clearing', 'Levelling the ground', 90),
      stage('foundation', 'Laying footings', 160, { stone: 10 }),
      stage('frame', 'Raising the frame', 250, { log: 12 }),
      stage('walls', 'Building walls', 200, { plank: 12 }),
      stage('roof', 'Roofing', 170, { thatch: 8, log: 3 }),
      stage('fitout', 'Installing the saw pit', 190, { plank: 8, rope: 3 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { production: 3 },
  },
  {
    id: 'carpenter',
    name: "Carpenter's Shop",
    category: 'production',
    style: 'workshop',
    description: 'Makes furniture, tool handles and the fine joinery better houses need.',
    width: 5,
    depth: 5,
    height: 4.2,
    buildCrew: 3,
    workSlots: 2,
    profession: 'crafter',
    storageSlots: 28,
    recipes: ['furniture', 'tool_handles', 'rope_craft'],
    requiresResearch: 'woodworking',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 140, { stone: 8 }),
      stage('frame', 'Raising the frame', 200, { log: 9 }),
      stage('walls', 'Building walls', 190, { plank: 14 }),
      stage('roof', 'Roofing', 150, { thatch: 7 }),
      stage('fitout', 'Benches and tools', 160, { plank: 8 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { production: 2 },
  },
  {
    id: 'smelter',
    name: 'Smelter',
    category: 'production',
    style: 'kiln',
    description:
      'A stone furnace that reduces ore to metal. Hungry for charcoal, and the whole valley knows when it is lit.',
    width: 5,
    depth: 5,
    height: 5.6,
    buildCrew: 3,
    workSlots: 2,
    profession: 'smith',
    storageSlots: 28,
    recipes: ['iron_smelt', 'copper_smelt'],
    requiresResearch: 'smelting',
    stages: [
      stage('planning', 'Staking out', 40),
      stage('foundation', 'Laying the hearth', 190, { stone: 16 }),
      stage('walls', 'Raising the stack', 280, { stone_block: 12, brick: 10 }),
      stage('roof', 'Sheltering the works', 150, { log: 6, thatch: 6 }),
      stage('fitout', 'Bellows and tools', 180, { plank: 8, leather: 3 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { production: 3 },
  },
  {
    id: 'blacksmith',
    name: 'Blacksmith',
    category: 'production',
    style: 'workshop',
    description: 'Forges tools and nails. Good tools make every other worker measurably faster.',
    width: 5,
    depth: 5,
    height: 4.4,
    buildCrew: 3,
    workSlots: 2,
    profession: 'smith',
    storageSlots: 28,
    recipes: ['nails_craft', 'axe_craft', 'pickaxe_craft', 'hammer_craft', 'hoe_craft', 'saw_craft'],
    requiresResearch: 'metalworking',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 160, { stone: 12 }),
      stage('frame', 'Raising the frame', 200, { log: 8 }),
      stage('walls', 'Building walls', 190, { plank: 12, brick: 8 }),
      stage('roof', 'Roofing', 150, { thatch: 7 }),
      stage('fitout', 'Anvil and forge', 220, { stone_block: 4, iron_ingot: 2 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { production: 3 },
  },
  {
    id: 'kiln',
    name: 'Kiln',
    category: 'production',
    style: 'kiln',
    description: 'Burns wood to charcoal and fires clay to brick and pottery.',
    width: 4,
    depth: 4,
    height: 3.6,
    buildCrew: 2,
    workSlots: 2,
    profession: 'crafter',
    storageSlots: 24,
    recipes: ['charcoal_burn', 'brick_fire', 'pottery_fire', 'glass_melt'],
    requiresResearch: 'firing',
    stages: [
      stage('planning', 'Staking out', 20),
      stage('foundation', 'Laying the base', 130, { stone: 10 }),
      stage('walls', 'Building the dome', 210, { stone: 14, clay: 8 }),
      stage('fitout', 'Grate and flue', 110, { plank: 4 }),
    ],
    placement: { maxSlope: 0.22 },
    infrastructure: { production: 2 },
  },
  {
    id: 'mill',
    name: 'Mill',
    category: 'production',
    style: 'mill',
    description: 'Grinds grain into flour. The first step from farming to actually eating well.',
    width: 4,
    depth: 4,
    height: 5.8,
    buildCrew: 3,
    workSlots: 1,
    profession: 'crafter',
    storageSlots: 24,
    recipes: ['flour_mill'],
    requiresResearch: 'agriculture',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 150, { stone: 10 }),
      stage('frame', 'Raising the tower', 240, { log: 10, beam: 4 }),
      stage('walls', 'Building walls', 180, { plank: 12 }),
      stage('roof', 'Roofing', 130, { thatch: 6 }),
      stage('fitout', 'Millstones and sails', 230, { stone_block: 6, cloth: 6, rope: 4 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { production: 2, food: 1 },
  },
  {
    id: 'bakery',
    name: 'Bakery',
    category: 'production',
    style: 'workshop',
    description: 'Bread keeps people fed far better than raw grain, and they are happier for it.',
    width: 5,
    depth: 4,
    height: 4,
    buildCrew: 3,
    workSlots: 2,
    profession: 'cook',
    storageSlots: 24,
    recipes: ['bread_bake', 'preserves_make'],
    requiresResearch: 'baking',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 140, { stone: 9 }),
      stage('frame', 'Raising the frame', 180, { log: 7 }),
      stage('walls', 'Building walls', 170, { plank: 11 }),
      stage('roof', 'Roofing', 130, { thatch: 6 }),
      stage('fitout', 'Building the oven', 180, { brick: 14, clay: 6 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { production: 2, food: 2 },
  },
  {
    id: 'weaver',
    name: "Weaver's Shop",
    requiresResearch: 'weaving',
    category: 'production',
    style: 'workshop',
    description: 'Spins fiber into cloth and rope. Cloth is wanted by every household.',
    width: 4,
    depth: 4,
    height: 3.9,
    buildCrew: 2,
    workSlots: 2,
    profession: 'crafter',
    storageSlots: 24,
    recipes: ['cloth_weave', 'rope_craft', 'thatch_bundle'],
    stages: [
      stage('planning', 'Staking out', 25),
      stage('foundation', 'Laying footings', 120, { stone: 7 }),
      stage('frame', 'Raising the frame', 170, { log: 7 }),
      stage('walls', 'Building walls', 160, { plank: 10 }),
      stage('roof', 'Roofing', 120, { thatch: 5 }),
      stage('fitout', 'Looms', 140, { plank: 6 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { production: 1 },
  },

  // ------------------------------------------------------------- farming
  {
    id: 'farm_field',
    name: 'Field',
    category: 'farming',
    style: 'field',
    description:
      'Ploughed ground. Crops are sown, grow through the season, and are cut at harvest — nothing happens in winter.',
    width: 6,
    depth: 6,
    height: 0.6,
    buildCrew: 3,
    workSlots: 2,
    profession: 'farmer',
    farmPlots: 36,
    storageSlots: 12,
    requiresResearch: 'agriculture',
    stages: [
      stage('planning', 'Marking the field', 25),
      stage('clearing', 'Clearing stones and roots', 140),
      stage('fitout', 'Breaking the soil', 180),
    ],
    placement: { maxSlope: 0.14, minFertility: 0.28 },
    infrastructure: { food: 3 },
  },
  {
    id: 'barn',
    name: 'Barn',
    category: 'farming',
    style: 'granary',
    description: 'Stores tools, seed and harvest close to the fields so farmers waste less of the day walking.',
    width: 5,
    depth: 5,
    height: 4.6,
    buildCrew: 3,
    workSlots: 1,
    profession: 'farmer',
    storageSlots: 48,
    requiresResearch: 'animal_husbandry',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 140, { stone: 8 }),
      stage('frame', 'Raising the frame', 210, { log: 10 }),
      stage('walls', 'Building walls', 190, { plank: 14 }),
      stage('roof', 'Roofing', 150, { thatch: 8 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { storage: 2, food: 1 },
  },

  // --------------------------------------------------------------- civic
  {
    id: 'town_hall',
    name: 'Town Hall',
    category: 'civic',
    style: 'hall',
    description:
      'The seat of the settlement. Extends the area people are willing to build in and lets them organise properly.',
    width: 7,
    depth: 7,
    height: 8.5,
    buildCrew: 6,
    workSlots: 2,
    profession: 'clerk',
    storageSlots: 32,
    requiresResearch: 'organisation',
    stages: [
      stage('planning', 'Drawing the plans', 70),
      stage('clearing', 'Levelling the square', 170),
      stage('foundation', 'Laying footings', 380, { stone_block: 24 }),
      stage('frame', 'Raising the frame', 480, { beam: 16, log: 12 }),
      stage('floor', 'Laying floors', 240, { plank: 18 }),
      stage('walls', 'Building walls', 460, { plank: 30, stone_block: 12, nails: 30 }),
      stage('roof', 'Roofing', 400, { beam: 8, brick: 26 }),
      stage('openings', 'Doors and windows', 260, { plank: 10, glass: 8 }),
      stage('interior', 'Fitting out', 320, { furniture: 4, cloth: 8 }),
    ],
    placement: { maxSlope: 0.14 },
    infrastructure: { education: 2, safety: 1 },
  },
  {
    id: 'market',
    name: 'Market',
    category: 'civic',
    style: 'market',
    description:
      'Stalls under awnings. People buy what they need instead of waiting for it to be carried to them.',
    width: 6,
    depth: 6,
    height: 3.2,
    buildCrew: 3,
    workSlots: 3,
    profession: 'trader',
    storageSlots: 56,
    requiresResearch: 'trade',
    stages: [
      stage('planning', 'Marking the square', 35),
      stage('clearing', 'Levelling the square', 120),
      stage('frame', 'Raising the stalls', 230, { log: 10, plank: 10 }),
      stage('roof', 'Awnings', 150, { cloth: 8, rope: 4 }),
    ],
    placement: { maxSlope: 0.16 },
    infrastructure: { food: 1 },
  },
  {
    id: 'research_hut',
    name: 'Study',
    category: 'civic',
    style: 'workshop',
    description:
      'Somewhere for a scholar to work. Research needs a person, a place, and time — it does not happen for free.',
    width: 5,
    depth: 4,
    height: 4.2,
    buildCrew: 3,
    workSlots: 2,
    profession: 'researcher',
    storageSlots: 16,
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 130, { stone: 8 }),
      stage('frame', 'Raising the frame', 180, { log: 8 }),
      stage('walls', 'Building walls', 170, { plank: 12 }),
      stage('roof', 'Roofing', 130, { thatch: 6 }),
      stage('fitout', 'Desks and shelves', 150, { plank: 8 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { education: 3 },
  },
  {
    id: 'tavern',
    name: 'Tavern',
    category: 'civic',
    style: 'house',
    description: 'Where people go when the work is done. Somewhere to be sociable keeps a settlement from souring.',
    width: 5,
    depth: 5,
    height: 5,
    buildCrew: 3,
    workSlots: 2,
    profession: 'cook',
    storageSlots: 24,
    requiresResearch: 'brewing',
    stages: [
      stage('planning', 'Staking out', 35),
      stage('foundation', 'Laying footings', 160, { stone: 10 }),
      stage('frame', 'Raising the frame', 220, { log: 9, beam: 2 }),
      stage('walls', 'Building walls', 220, { plank: 16 }),
      stage('roof', 'Roofing', 170, { thatch: 9 }),
      stage('interior', 'Fitting out', 190, { furniture: 3, plank: 6 }),
    ],
    placement: { maxSlope: 0.18 },
    infrastructure: { safety: 1 },
  },
  {
    id: 'clinic',
    name: 'Infirmary',
    category: 'civic',
    style: 'cottage',
    description: 'Treats injury and illness. In a hard winter it is the difference between a setback and a disaster.',
    width: 4,
    depth: 4,
    height: 4,
    buildCrew: 3,
    workSlots: 1,
    profession: 'doctor',
    storageSlots: 20,
    storageFilter: ['herbs', 'cloth'],
    requiresResearch: 'medicine',
    stages: [
      stage('planning', 'Staking out', 30),
      stage('foundation', 'Laying footings', 130, { stone: 8 }),
      stage('frame', 'Raising the frame', 180, { log: 7 }),
      stage('walls', 'Building walls', 170, { plank: 12 }),
      stage('roof', 'Roofing', 130, { thatch: 6 }),
      stage('fitout', 'Beds and stores', 150, { cloth: 6, plank: 6 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { health: 4 },
  },

  // ------------------------------------------------------ infrastructure
  {
    id: 'road',
    name: 'Road',
    category: 'infrastructure',
    style: 'road',
    description:
      'Gravel and hardcore. Roads roughly halve travel time, which matters more than almost anything else you can build.',
    width: 1,
    depth: 1,
    height: 0.1,
    buildCrew: 2,
    workSlots: 0,
    linear: true,
    stages: [
      stage('clearing', 'Clearing the line', 8),
      stage('fitout', 'Laying the surface', 16, { stone: 1 }),
    ],
    placement: { maxSlope: 0.5 },
    infrastructure: { road: 1 },
  },
  {
    id: 'bridge',
    name: 'Bridge',
    category: 'infrastructure',
    style: 'bridge',
    description: 'A timber crossing. Without one, a river is a wall.',
    width: 1,
    depth: 1,
    height: 1.4,
    buildCrew: 3,
    workSlots: 0,
    linear: true,
    requiresResearch: 'bridges',
    stages: [
      stage('planning', 'Setting the piles', 20, { log: 1 }),
      stage('fitout', 'Decking', 34, { plank: 2 }),
    ],
    placement: { maxSlope: 2, onWater: true },
    infrastructure: { road: 1 },
  },
  {
    id: 'fence',
    name: 'Fence',
    category: 'infrastructure',
    style: 'fence',
    description: 'Keeps animals out of the fields and marks what belongs to whom.',
    width: 1,
    depth: 1,
    height: 1.1,
    buildCrew: 1,
    workSlots: 0,
    linear: true,
    stages: [stage('fitout', 'Setting posts', 14, { log: 1 })],
    placement: { maxSlope: 0.6 },
  },
  {
    id: 'lamp',
    name: 'Lamp Post',
    category: 'infrastructure',
    style: 'lamp',
    description: 'Oil light on a post. People work later and feel safer after dark.',
    width: 1,
    depth: 1,
    height: 3,
    buildCrew: 1,
    workSlots: 0,
    requiresResearch: 'organisation',
    stages: [stage('fitout', 'Raising the post', 40, { log: 1, glass: 1 })],
    placement: { maxSlope: 0.3 },
    infrastructure: { safety: 1 },
  },
  {
    id: 'cart_shed',
    name: 'Cart Shed',
    category: 'infrastructure',
    style: 'shed',
    description:
      'Houses handcarts. Haulers based here carry far more per trip, and roads finally start paying off.',
    width: 4,
    depth: 4,
    height: 3.4,
    buildCrew: 2,
    workSlots: 2,
    profession: 'hauler',
    storageSlots: 16,
    requiresResearch: 'the_wheel',
    stages: [
      stage('planning', 'Staking out', 25),
      stage('foundation', 'Laying footings', 110, { stone: 6 }),
      stage('frame', 'Raising the frame', 170, { log: 8 }),
      stage('roof', 'Roofing', 130, { thatch: 6 }),
      stage('fitout', 'Building carts', 200, { plank: 12, rope: 4, iron_ingot: 2 }),
    ],
    placement: { maxSlope: 0.2 },
    infrastructure: { road: 1 },
  },

  // ---------------------------------------------------------- decoration
  {
    id: 'sign',
    name: 'Signpost',
    category: 'decoration',
    style: 'sign',
    description: 'Marks a place, or a direction, or simply that someone was here.',
    width: 1,
    depth: 1,
    height: 2,
    buildCrew: 1,
    workSlots: 0,
    stages: [stage('fitout', 'Carving the post', 18, { log: 1 })],
    placement: { maxSlope: 0.4 },
  },
  {
    id: 'bench',
    name: 'Bench',
    category: 'decoration',
    style: 'bench',
    description: 'Somewhere to sit. Small comforts add up.',
    width: 1,
    depth: 1,
    height: 0.8,
    buildCrew: 1,
    workSlots: 0,
    stages: [stage('fitout', 'Building the bench', 16, { plank: 2 })],
    placement: { maxSlope: 0.25 },
  },
];

function finalise(raw: RawDef): BuildingDef {
  const totalMaterials: Partial<Record<ItemId, number>> = {};
  let totalWork = 0;
  for (const s of raw.stages) {
    totalWork += s.work;
    for (const [item, n] of Object.entries(s.materials) as [ItemId, number][]) {
      totalMaterials[item] = (totalMaterials[item] ?? 0) + n;
    }
  }
  return { ...raw, totalMaterials, totalWork };
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = Object.fromEntries(
  RAW.map((r) => [r.id, finalise(r)]),
) as Record<BuildingId, BuildingDef>;

export const ALL_BUILDING_IDS = RAW.map((r) => r.id);

export function buildingDef(id: BuildingId): BuildingDef {
  return BUILDINGS[id];
}

export function buildingsInCategory(category: BuildingCategory): BuildingDef[] {
  return ALL_BUILDING_IDS.map((id) => BUILDINGS[id]).filter((b) => b.category === category);
}

/** Stage display order, used by the construction inspector. */
export const STAGE_ORDER: StageId[] = [
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
