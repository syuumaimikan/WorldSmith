/**
 * The research tree.
 *
 * Research is not a currency you accumulate passively: it needs a study, a
 * scholar working in it, and in most cases physical materials to experiment
 * with. Unlocks gate buildings, recipes and logistics improvements.
 */

export type ResearchId =
  | 'basic_tools'
  | 'woodworking'
  | 'forestry'
  | 'timber_framing'
  | 'advanced_construction'
  | 'masonry'
  | 'firing'
  | 'mining'
  | 'metalworking'
  | 'agriculture'
  | 'food_preservation'
  | 'organisation'
  | 'trade'
  | 'haulage'
  | 'medicine'
  | 'glassmaking';

export interface ResearchNode {
  id: ResearchId;
  name: string;
  description: string;
  /** Research points required. */
  cost: number;
  requires: ResearchId[];
  /** Tier is only used for tree layout. */
  tier: number;
  unlocksText: string[];
}

export const RESEARCH: Record<ResearchId, ResearchNode> = {
  basic_tools: {
    id: 'basic_tools',
    name: 'Basic Tools',
    description: 'Hafting stone and iron onto handles. Everything else follows from this.',
    cost: 30,
    requires: [],
    tier: 0,
    unlocksText: ['Faster manual gathering', 'Opens the woodworking and mining lines'],
  },
  woodworking: {
    id: 'woodworking',
    name: 'Woodworking',
    description: 'Sawing timber to consistent dimensions instead of using whole logs.',
    cost: 60,
    requires: ['basic_tools'],
    tier: 1,
    unlocksText: ['Sawmill', "Carpenter's Shop", 'Planks'],
  },
  forestry: {
    id: 'forestry',
    name: 'Forestry',
    description: 'Managing woodland so that it survives being cut.',
    cost: 70,
    requires: ['woodworking'],
    tier: 2,
    unlocksText: ["Forester's Hut", 'Replanting'],
  },
  timber_framing: {
    id: 'timber_framing',
    name: 'Timber Framing',
    description: 'Jointed frames that carry a roof across a long span.',
    cost: 110,
    requires: ['woodworking'],
    tier: 2,
    unlocksText: ['Longhouse', 'Bridge', 'Beams'],
  },
  masonry: {
    id: 'masonry',
    name: 'Masonry',
    description: 'Dressing stone into blocks that sit square and carry load.',
    cost: 120,
    requires: ['basic_tools'],
    tier: 2,
    unlocksText: ['Stone blocks', 'Stone foundations'],
  },
  firing: {
    id: 'firing',
    name: 'Firing',
    description: 'Controlled burns hot enough to change clay and wood permanently.',
    cost: 100,
    requires: ['basic_tools'],
    tier: 2,
    unlocksText: ['Kiln', 'Charcoal', 'Brick', 'Pottery'],
  },
  advanced_construction: {
    id: 'advanced_construction',
    name: 'Advanced Construction',
    description: 'Two storeys, tiled roofs, and buildings meant to outlive their builders.',
    cost: 200,
    requires: ['timber_framing', 'masonry'],
    tier: 3,
    unlocksText: ['House', 'Tiled roofs'],
  },
  mining: {
    id: 'mining',
    name: 'Mining',
    description: 'Driving a timbered tunnel into rock without it falling on you.',
    cost: 140,
    requires: ['basic_tools'],
    tier: 2,
    unlocksText: ['Mine', 'Deep ore extraction'],
  },
  metalworking: {
    id: 'metalworking',
    name: 'Metalworking',
    description: 'Smelting ore and working the result at the forge.',
    cost: 220,
    requires: ['mining', 'firing'],
    tier: 3,
    unlocksText: ['Smelter', 'Blacksmith', 'Iron tools', 'Nails'],
  },
  agriculture: {
    id: 'agriculture',
    name: 'Agriculture',
    description: 'Sowing, tending and harvesting instead of only gathering.',
    cost: 90,
    requires: ['basic_tools'],
    tier: 1,
    unlocksText: ['Field', 'Barn', 'Granary', 'Mill', 'Bakery'],
  },
  food_preservation: {
    id: 'food_preservation',
    name: 'Food Preservation',
    description: 'Making the harvest last until the next one.',
    cost: 150,
    requires: ['agriculture', 'firing'],
    tier: 3,
    unlocksText: ['Preserves', 'Reduced food spoilage'],
  },
  organisation: {
    id: 'organisation',
    name: 'Civic Organisation',
    description: 'Writing things down, and agreeing who does what.',
    cost: 160,
    requires: ['basic_tools'],
    tier: 2,
    unlocksText: ['Town Hall', 'Tavern', 'Lamp Post', 'Wider settlement area'],
  },
  trade: {
    id: 'trade',
    name: 'Trade',
    description: 'Exchange at a fixed place, on agreed terms.',
    cost: 180,
    requires: ['organisation'],
    tier: 3,
    unlocksText: ['Market', 'Trade routes'],
  },
  haulage: {
    id: 'haulage',
    name: 'Haulage',
    description: 'Carts, harness and made roads.',
    cost: 170,
    requires: ['organisation', 'woodworking'],
    tier: 3,
    unlocksText: ['Cart Shed', 'Carts carry far more per trip'],
  },
  medicine: {
    id: 'medicine',
    name: 'Medicine',
    description: 'Herbs, splints, and keeping wounds clean.',
    cost: 190,
    requires: ['organisation'],
    tier: 3,
    unlocksText: ['Infirmary', 'Illness recovery'],
  },
  glassmaking: {
    id: 'glassmaking',
    name: 'Glassmaking',
    description: 'Melting sand into something you can see through.',
    cost: 210,
    requires: ['firing'],
    tier: 3,
    unlocksText: ['Glass', 'Glazed windows'],
  },
};

export const ALL_RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];

export function researchDef(id: ResearchId): ResearchNode {
  return RESEARCH[id];
}

/** Nodes whose prerequisites are all satisfied and which are not yet taken. */
export function availableResearch(unlocked: Set<ResearchId>): ResearchNode[] {
  return ALL_RESEARCH_IDS.map((id) => RESEARCH[id]).filter(
    (n) => !unlocked.has(n.id) && n.requires.every((r) => unlocked.has(r)),
  );
}
