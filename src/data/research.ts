/**
 * The research tree.
 *
 * Research is not a currency you accumulate passively: it needs a study, a
 * scholar working in it, and in most cases physical materials to experiment
 * with. Unlocks gate buildings, recipes and logistics improvements.
 */

export type ResearchId =
  // stone
  | 'fire_making'
  | 'knapping'
  | 'basic_tools'
  | 'cordage'
  | 'hunting'
  | 'tanning'
  | 'woodworking'
  | 'forestry'
  | 'pottery_craft'
  | 'shelter'
  // farming and the settled life
  | 'agriculture'
  | 'irrigation'
  | 'crop_rotation'
  | 'animal_husbandry'
  | 'brewing'
  | 'food_preservation'
  | 'salting'
  | 'milling'
  | 'baking'
  // building
  | 'timber_framing'
  | 'masonry'
  | 'lime_burning'
  | 'arches'
  | 'advanced_construction'
  | 'roads'
  | 'bridges'
  | 'sanitation'
  // fire and metal
  | 'firing'
  | 'mining'
  | 'charcoal_burning'
  | 'smelting'
  | 'metalworking'
  | 'bronze_working'
  | 'iron_working'
  | 'steelmaking'
  | 'glassmaking'
  // cloth and goods
  | 'weaving'
  | 'dyeing'
  | 'soapmaking'
  | 'joinery'
  // the mind
  | 'organisation'
  | 'writing'
  | 'mathematics'
  | 'astronomy'
  | 'medicine'
  | 'surgery'
  | 'philosophy'
  // getting about
  | 'haulage'
  | 'the_wheel'
  | 'boatbuilding'
  | 'sailing'
  | 'navigation'
  | 'trade'
  | 'coinage';

/**
 * What knowing a thing actually does.
 *
 * Most of the tree opens a building or a recipe, which is a concrete unlock
 * anybody can see. The rest of it changes how well the settlement does
 * something it was already doing, and rather than scatter those as one-off
 * conditionals through the simulation, each one is a named figure here that
 * exactly one system reads. Every effect below is consulted somewhere; an
 * effect nothing reads is a lie printed in a menu.
 */
export interface ResearchEffects {
  /** Extra kilograms a person can carry. */
  carry: number;
  /** Multiplier on everyone's work rate. */
  work: number;
  /** Multiplier on what tilled ground yields. */
  farm: number;
  /** Multiplier on construction speed. */
  build: number;
  /** Added to the settlement's ability to look after its sick and hurt. */
  care: number;
  /** Multiplier on the rate studies accumulate. */
  study: number;
  /** Multiplier on what goods fetch in trade. */
  trade: number;
}

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
  /** What it changes, for the topics that change a figure rather than open a door. */
  effects?: Partial<ResearchEffects>;
}

export const RESEARCH: Record<ResearchId, ResearchNode> = {
  basic_tools: {
    id: 'basic_tools',
    name: 'Basic Tools',
    description: 'Hafting stone and iron onto handles. Everything else follows from this.',
    cost: 30,
    requires: ['knapping'],
    tier: 1,
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
  fire_making: {
    id: 'fire_making',
    name: 'Fire Making',
    description: 'A bow drill, dry tinder, and the patience to keep at it. Everything downstream of warmth starts here.',
    cost: 15,
    requires: [],
    tier: 0,
    unlocksText: ['Cooking', 'Warmth through a winter night'],
    effects: { care: 0.05 },
  },
  knapping: {
    id: 'knapping',
    name: 'Knapping',
    description: 'Striking flint so it breaks where you want it to. The first craft there was.',
    cost: 20,
    requires: [],
    tier: 0,
    unlocksText: ['Stone blades', 'Opens the tool line'],
    effects: { work: 1.04 },
  },
  cordage: {
    id: 'cordage',
    name: 'Cordage',
    description: 'Twisting plant fibre into something that will hold a weight.',
    cost: 28,
    requires: ['knapping'],
    tier: 1,
    unlocksText: ['Rope', 'Bindings for tools and shelters'],
    effects: { carry: 4 },
  },
  hunting: {
    id: 'hunting',
    name: 'Hunting',
    description: 'Reading tracks, working as a line, and killing at a distance.',
    cost: 45,
    requires: ['knapping'],
    tier: 1,
    unlocksText: ["Hunter's Lodge", 'More game brought back'],
  },
  tanning: {
    id: 'tanning',
    name: 'Tanning',
    description: 'Turning a hide into leather instead of into something the dogs fight over.',
    cost: 70,
    requires: ['hunting'],
    tier: 2,
    unlocksText: ['Leather', 'Harder-wearing clothing'],
    effects: { carry: 6 },
  },
  pottery_craft: {
    id: 'pottery_craft',
    name: 'Pottery',
    description: 'Coiling clay and firing it. Suddenly things can be stored, carried and measured.',
    cost: 80,
    requires: ['fire_making'],
    tier: 2,
    unlocksText: ['Pottery', 'Storing grain against a bad year'],
    effects: { carry: 5 },
  },
  shelter: {
    id: 'shelter',
    name: 'Shelter',
    description: 'A frame, a covering, and a floor that stays dry.',
    cost: 40,
    requires: ['cordage'],
    tier: 1,
    unlocksText: ['Sturdier tents', 'People sleep better'],
    effects: { care: 0.05 },
  },
  irrigation: {
    id: 'irrigation',
    name: 'Irrigation',
    description: 'Cutting a ditch from the river to the field, and knowing when to close it.',
    cost: 150,
    requires: ['agriculture'],
    tier: 3,
    unlocksText: ['Fields yield more', 'Dry seasons hurt less'],
    effects: { farm: 1.3 },
  },
  crop_rotation: {
    id: 'crop_rotation',
    name: 'Crop Rotation',
    description: 'Resting a field under beans instead of working it until it gives up.',
    cost: 230,
    requires: ['irrigation'],
    tier: 4,
    unlocksText: ['Fields stay fertile', 'Higher yields year on year'],
    effects: { farm: 1.35 },
  },
  animal_husbandry: {
    id: 'animal_husbandry',
    name: 'Animal Husbandry',
    description: 'Keeping animals rather than chasing them, and breeding the ones that give most.',
    cost: 170,
    requires: ['agriculture'],
    tier: 3,
    unlocksText: ['Barn', 'Milk, wool and a reliable meat supply'],
    effects: { farm: 1.15 },
  },
  brewing: {
    id: 'brewing',
    name: 'Brewing',
    description: 'Grain, water and time. Safer than the water on its own, and nobody argues about it.',
    cost: 160,
    requires: ['agriculture'],
    tier: 3,
    unlocksText: ['Tavern', 'People bear a hard year better'],
    effects: { care: 0.06 },
  },
  salting: {
    id: 'salting',
    name: 'Salting',
    description: 'Packing meat and fish in salt so that a good autumn feeds a bad spring.',
    cost: 140,
    requires: ['food_preservation'],
    tier: 4,
    unlocksText: ['Preserves keep far longer'],
    effects: { farm: 1.12 },
  },
  milling: {
    id: 'milling',
    name: 'Milling',
    description: 'Letting water or wind turn the stone instead of somebody s arms.',
    cost: 180,
    requires: ['agriculture', 'woodworking'],
    tier: 3,
    unlocksText: ['Mill', 'Flour in quantity'],
    effects: { work: 1.06 },
  },
  baking: {
    id: 'baking',
    name: 'Baking',
    description: 'An oven that holds its heat, and bread that keeps for a week.',
    cost: 160,
    requires: ['milling', 'firing'],
    tier: 4,
    unlocksText: ['Bakery', 'Bread'],
  },
  lime_burning: {
    id: 'lime_burning',
    name: 'Lime Burning',
    description: 'Burning limestone down to quicklime, which is what turns a pile of stones into a wall.',
    cost: 200,
    requires: ['masonry', 'firing'],
    tier: 4,
    unlocksText: ['Mortar', 'Walls that outlast their builders'],
    effects: { build: 1.15 },
  },
  arches: {
    id: 'arches',
    name: 'The Arch',
    description: 'Making stone carry a load across a gap by pushing sideways instead of down.',
    cost: 300,
    requires: ['lime_burning', 'mathematics'],
    tier: 5,
    unlocksText: ['Wider spans', 'Bridges that carry carts'],
    effects: { build: 1.12 },
  },
  roads: {
    id: 'roads',
    name: 'Road Building',
    description: 'A bed of rubble, a camber, and a ditch either side. Boring, and it changes everything.',
    cost: 190,
    requires: ['organisation'],
    tier: 3,
    unlocksText: ['Paved roads', 'Hauling gets much faster'],
    effects: { carry: 5 },
  },
  bridges: {
    id: 'bridges',
    name: 'Bridges',
    description: 'Getting a loaded cart over a river without unloading it.',
    cost: 240,
    requires: ['roads', 'timber_framing'],
    tier: 4,
    unlocksText: ['Bridge'],
  },
  sanitation: {
    id: 'sanitation',
    name: 'Sanitation',
    description: 'Drains, and keeping the well upstream of everything else. Nobody notices it working.',
    cost: 330,
    requires: ['masonry', 'medicine'],
    tier: 5,
    unlocksText: ['Outbreaks are far rarer and far milder'],
    effects: { care: 0.18 },
  },
  charcoal_burning: {
    id: 'charcoal_burning',
    name: 'Charcoal Burning',
    description: 'Smothering a wood stack so it cooks instead of burning. Hotter fires than wood alone will give.',
    cost: 110,
    requires: ['fire_making', 'forestry'],
    tier: 2,
    unlocksText: ['Charcoal', 'Opens smelting'],
  },
  smelting: {
    id: 'smelting',
    name: 'Smelting',
    description: 'Getting metal out of rock, which needs more heat than anything anyone had before.',
    cost: 220,
    requires: ['charcoal_burning', 'mining'],
    tier: 3,
    unlocksText: ['Smelter', 'Copper ingots'],
  },
  bronze_working: {
    id: 'bronze_working',
    name: 'Bronze Working',
    description: 'Copper is soft and tin is scarce; together they are neither, and an age is named after it.',
    cost: 300,
    requires: ['smelting'],
    tier: 4,
    unlocksText: ['Bronze', 'Better tools and arms'],
    effects: { work: 1.12 },
  },
  iron_working: {
    id: 'iron_working',
    name: 'Iron Working',
    description: 'Iron is everywhere and takes a great deal more fire. Once you can work it, bronze is jewellery.',
    cost: 420,
    requires: ['bronze_working'],
    tier: 5,
    unlocksText: ['Iron tools', 'Blacksmith'],
    effects: { work: 1.18 },
  },
  steelmaking: {
    id: 'steelmaking',
    name: 'Steelmaking',
    description: 'Iron with exactly the right amount of carbon in it, which took two thousand years to state that simply.',
    cost: 650,
    requires: ['iron_working', 'mathematics'],
    tier: 6,
    unlocksText: ['Steel tools', 'Edges that hold'],
    effects: { work: 1.2 },
  },
  weaving: {
    id: 'weaving',
    name: 'Weaving',
    description: 'A loom, a warp and a shuttle. Cloth instead of hides.',
    cost: 130,
    requires: ['cordage'],
    tier: 2,
    unlocksText: ["Weaver's Shed", 'Cloth'],
  },
  dyeing: {
    id: 'dyeing',
    name: 'Dyeing',
    description: 'Colour that stays in the cloth after it has been washed. Worth a great deal to people far away.',
    cost: 210,
    requires: ['weaving', 'pottery_craft'],
    tier: 3,
    unlocksText: ['Dyed cloth is worth far more'],
    effects: { trade: 1.15 },
  },
  soapmaking: {
    id: 'soapmaking',
    name: 'Soapmaking',
    description: 'Ash, fat and water. Unglamorous, and it saves more lives than most of the medicine line.',
    cost: 190,
    requires: ['lime_burning'],
    tier: 4,
    unlocksText: ['Wounds turn far less often'],
    effects: { care: 0.14 },
  },
  joinery: {
    id: 'joinery',
    name: 'Joinery',
    description: 'Wood held together by its own shape rather than by nails.',
    cost: 200,
    requires: ['woodworking'],
    tier: 3,
    unlocksText: ['Furniture', 'Buildings that do not rack'],
    effects: { build: 1.1 },
  },
  writing: {
    id: 'writing',
    name: 'Writing',
    description: 'Marks that hold a number, a name or a promise for longer than anybody remembers it.',
    cost: 260,
    requires: ['organisation'],
    tier: 3,
    unlocksText: ['Records', 'Study goes much faster'],
    effects: { study: 1.4 },
  },
  mathematics: {
    id: 'mathematics',
    name: 'Mathematics',
    description: 'Counting, then measuring, then proving. The tool that makes every other tool sharper.',
    cost: 360,
    requires: ['writing'],
    tier: 4,
    unlocksText: ['Surveying', 'Opens the arch, steel and navigation'],
    effects: { study: 1.25, build: 1.08 },
  },
  astronomy: {
    id: 'astronomy',
    name: 'Astronomy',
    description: 'Watching the sky long enough to predict it, which is the first time anybody predicted anything.',
    cost: 430,
    requires: ['mathematics'],
    tier: 5,
    unlocksText: ['A working calendar', 'Eclipses stop being omens'],
    effects: { farm: 1.1, study: 1.1 },
  },
  surgery: {
    id: 'surgery',
    name: 'Surgery',
    description: 'Setting bones, closing wounds and knowing when not to cut.',
    cost: 380,
    requires: ['medicine'],
    tier: 4,
    unlocksText: ['Broken limbs mend properly', 'Fewer die of their wounds'],
    effects: { care: 0.2 },
  },
  philosophy: {
    id: 'philosophy',
    name: 'Philosophy',
    description: 'Arguing about what a good life is, in public, at length. Settlements that do it hold together better.',
    cost: 400,
    requires: ['writing'],
    tier: 4,
    unlocksText: ['Higher morale', 'Faster study'],
    effects: { study: 1.2 },
  },
  the_wheel: {
    id: 'the_wheel',
    name: 'The Wheel',
    description: 'An axle that turns true. Obvious in hindsight and nobody had it for most of history.',
    cost: 150,
    requires: ['woodworking'],
    tier: 2,
    unlocksText: ['Cart Shed', 'Far more can be moved at once'],
    effects: { carry: 12 },
  },
  boatbuilding: {
    id: 'boatbuilding',
    name: 'Boatbuilding',
    description: 'A hull that keeps the water out with the people still inside.',
    cost: 200,
    requires: ['woodworking', 'cordage'],
    tier: 3,
    unlocksText: ['Fishing boats', 'Crossing rivers and inlets'],
  },
  sailing: {
    id: 'sailing',
    name: 'Sailing',
    description: 'Making the wind do the work, including when it is not blowing the way you want to go.',
    cost: 330,
    requires: ['boatbuilding', 'weaving'],
    tier: 4,
    unlocksText: ['Trade by sea', 'Distant markets'],
    effects: { trade: 1.2 },
  },
  navigation: {
    id: 'navigation',
    name: 'Navigation',
    description: 'Finding where you are when there is nothing to see in any direction.',
    cost: 470,
    requires: ['sailing', 'astronomy'],
    tier: 5,
    unlocksText: ['Open-water voyages', 'Trade with the far side of the world'],
    effects: { trade: 1.3 },
  },
  coinage: {
    id: 'coinage',
    name: 'Coinage',
    description: 'Stamped metal that everybody agrees is worth something, which is the whole trick.',
    cost: 290,
    requires: ['trade', 'smelting'],
    tier: 4,
    unlocksText: ['Prices settle', 'Trade gets much easier'],
    effects: { trade: 1.25 },
  },
};


export const ALL_RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];

export function researchDef(id: ResearchId): ResearchNode {
  return RESEARCH[id];
}

/** Nodes whose prerequisites are all satisfied and which are not yet taken. */
/**
 * The sum of everything the settlement knows, as one set of figures.
 *
 * Multipliers compound and flat bonuses add, which is what you would expect
 * of two separate improvements to the same thing.
 */
export function researchEffects(unlocked: Set<ResearchId>): ResearchEffects {
  const out: ResearchEffects = {
    carry: 0,
    work: 1,
    farm: 1,
    build: 1,
    care: 0,
    study: 1,
    trade: 1,
  };
  for (const id of unlocked) {
    const e = RESEARCH[id]?.effects;
    if (!e) continue;
    out.carry += e.carry ?? 0;
    out.care += e.care ?? 0;
    out.work *= e.work ?? 1;
    out.farm *= e.farm ?? 1;
    out.build *= e.build ?? 1;
    out.study *= e.study ?? 1;
    out.trade *= e.trade ?? 1;
  }
  return out;
}

export function availableResearch(unlocked: Set<ResearchId>): ResearchNode[] {
  return ALL_RESEARCH_IDS.map((id) => RESEARCH[id]).filter(
    (n) => !unlocked.has(n.id) && n.requires.every((r) => unlocked.has(r)),
  );
}
