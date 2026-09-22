/**
 * Professions and skills.
 *
 * Cloak colour is tied to profession so that a settlement can be read from a
 * hilltop: a stream of green cloaks heading for the treeline is a logging
 * operation, orange cloaks on the road are the supply chain working.
 */

import { PALETTE } from '../render/Palette';

export type ProfessionId =
  | 'settler'
  | 'builder'
  | 'logger'
  | 'forester'
  | 'miner'
  | 'farmer'
  | 'hunter'
  | 'fisher'
  | 'hauler'
  | 'sawyer'
  | 'crafter'
  | 'smith'
  | 'cook'
  | 'trader'
  | 'researcher'
  | 'doctor'
  | 'clerk';

export type SkillId =
  | 'construction'
  | 'woodcutting'
  | 'mining'
  | 'farming'
  | 'woodworking'
  | 'smithing'
  | 'crafting'
  | 'cooking'
  | 'hauling'
  | 'research'
  | 'trading'
  | 'medicine'
  | 'hunting';

export const ALL_SKILLS: SkillId[] = [
  'construction',
  'woodcutting',
  'mining',
  'farming',
  'woodworking',
  'smithing',
  'crafting',
  'cooking',
  'hauling',
  'research',
  'trading',
  'medicine',
  'hunting',
];

export const SKILL_LABELS: Record<SkillId, string> = {
  construction: 'Construction',
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  farming: 'Farming',
  woodworking: 'Woodworking',
  smithing: 'Smithing',
  crafting: 'Crafting',
  cooking: 'Cooking',
  hauling: 'Hauling',
  research: 'Research',
  trading: 'Trading',
  medicine: 'Medicine',
  hunting: 'Hunting',
};

export interface ProfessionDef {
  id: ProfessionId;
  name: string;
  cloak: number;
  /** Skills this profession exercises and is good at. */
  primary: SkillId[];
  description: string;
}

export const PROFESSIONS: Record<ProfessionId, ProfessionDef> = {
  settler: {
    id: 'settler',
    name: 'Settler',
    cloak: PALETTE.cloak.idler,
    primary: [],
    description: 'Unassigned. Takes whatever work is going.',
  },
  builder: {
    id: 'builder',
    name: 'Builder',
    cloak: PALETTE.cloak.builder,
    primary: ['construction'],
    description: 'Works construction sites. Without builders, nothing gets finished.',
  },
  logger: {
    id: 'logger',
    name: 'Logger',
    cloak: PALETTE.cloak.logger,
    primary: ['woodcutting'],
    description: 'Fells trees and leaves logs where haulers can collect them.',
  },
  forester: {
    id: 'forester',
    name: 'Forester',
    cloak: PALETTE.cloak.forager,
    primary: ['woodcutting', 'farming'],
    description: 'Replants cleared ground so the forest survives being worked.',
  },
  miner: {
    id: 'miner',
    name: 'Miner',
    cloak: PALETTE.cloak.miner,
    primary: ['mining'],
    description: 'Cuts stone and ore.',
  },
  farmer: {
    id: 'farmer',
    name: 'Farmer',
    cloak: PALETTE.cloak.farmer,
    primary: ['farming'],
    description: 'Ploughs, sows, weeds and harvests. Busy in spring and autumn, idle in deep winter.',
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    cloak: PALETTE.cloak.forager,
    primary: ['hunting'],
    description: 'Brings in meat and hides from the wild.',
  },
  fisher: {
    id: 'fisher',
    name: 'Fisher',
    cloak: PALETTE.cloak.trader,
    primary: ['hunting'],
    description: 'Works the water. Slower than hunting, but far more reliable.',
  },
  hauler: {
    id: 'hauler',
    name: 'Hauler',
    cloak: PALETTE.cloak.hauler,
    primary: ['hauling'],
    description: 'Carries goods between stores, workshops and building sites. The settlement stops without them.',
  },
  sawyer: {
    id: 'sawyer',
    name: 'Sawyer',
    cloak: PALETTE.cloak.crafter,
    primary: ['woodworking'],
    description: 'Works the saw pit, turning logs into usable timber.',
  },
  crafter: {
    id: 'crafter',
    name: 'Crafter',
    cloak: PALETTE.cloak.crafter,
    primary: ['crafting', 'woodworking'],
    description: 'Works a bench: cloth, rope, pottery, furniture.',
  },
  smith: {
    id: 'smith',
    name: 'Smith',
    cloak: PALETTE.cloak.miner,
    primary: ['smithing'],
    description: 'Smelts ore and forges tools.',
  },
  cook: {
    id: 'cook',
    name: 'Cook',
    cloak: PALETTE.cloak.farmer,
    primary: ['cooking'],
    description: 'Turns raw produce into food people actually want to eat.',
  },
  trader: {
    id: 'trader',
    name: 'Trader',
    cloak: PALETTE.cloak.trader,
    primary: ['trading'],
    description: 'Runs the market stalls and deals with visiting merchants.',
  },
  researcher: {
    id: 'researcher',
    name: 'Scholar',
    cloak: PALETTE.cloak.researcher,
    primary: ['research'],
    description: 'Works in the study. Slow, expensive, and the only way anything improves.',
  },
  doctor: {
    id: 'doctor',
    name: 'Physician',
    cloak: PALETTE.cloak.researcher,
    primary: ['medicine'],
    description: 'Treats the sick and injured.',
  },
  clerk: {
    id: 'clerk',
    name: 'Clerk',
    cloak: PALETTE.cloak.trader,
    primary: ['trading', 'research'],
    description: 'Keeps the records at the town hall.',
  },
};

export const ALL_PROFESSIONS = Object.keys(PROFESSIONS) as ProfessionId[];

export function professionDef(id: ProfessionId): ProfessionDef {
  return PROFESSIONS[id] ?? PROFESSIONS.settler;
}

/**
 * Skill level 0..20. Returns a work-rate multiplier — an expert is roughly
 * twice as fast as a novice, which is enough to matter without making early
 * settlers feel useless.
 */
export function skillMultiplier(level: number): number {
  return 0.72 + Math.min(level, 20) * 0.064;
}

/** Experience needed to reach a given level. */
export function xpForLevel(level: number): number {
  return Math.round(60 * Math.pow(level + 1, 1.45));
}

export function levelFromXp(xp: number): number {
  let level = 0;
  while (level < 20 && xp >= xpForLevel(level)) level++;
  return level;
}

const FIRST_NAMES = [
  'Bryn', 'Oda', 'Tamsin', 'Corin', 'Maud', 'Elin', 'Rask', 'Sable', 'Wren', 'Hal',
  'Isolde', 'Garrick', 'Nell', 'Fenn', 'Marek', 'Ysolt', 'Dain', 'Perrin', 'Aud', 'Cade',
  'Lira', 'Thom', 'Ana', 'Ives', 'Rowan', 'Senna', 'Brant', 'Kestrel', 'Nara', 'Osric',
  'Vell', 'Jory', 'Tabor', 'Marda', 'Ansel', 'Pell', 'Rhona', 'Sigrid', 'Ewan', 'Linnet',
];

const SURNAMES = [
  'Ashdown', 'Byrne', 'Colter', 'Dunmore', 'Ellery', 'Fairweather', 'Gower', 'Hollis',
  'Ironwood', 'Jessop', 'Kettle', 'Larkspur', 'Mawes', 'Norrell', 'Oakhurst', 'Pike',
  'Quill', 'Ransom', 'Stoneley', 'Thatcher', 'Underhill', 'Vance', 'Wexford', 'Yarrow',
];

export function personName(rngInt: (min: number, max: number) => number): string {
  return `${FIRST_NAMES[rngInt(0, FIRST_NAMES.length - 1)]} ${SURNAMES[rngInt(0, SURNAMES.length - 1)]}`;
}
