/**
 * What age the world is in when you walk into it.
 *
 * A world does not start. It is already going, and the only question is how
 * long it has been going for. Picking an era is picking where on that line
 * you arrive: at the very beginning, when nothing has invented anything and
 * the plants have not worked out flowers yet; or in the middle of somebody
 * else's middle ages, as one more person in a kingdom that was old before you
 * were born.
 *
 * Everything an era changes it changes for a reason that is in the world
 * rather than in a difficulty setting. There are no nations in the primordial
 * world because nobody is there to found one. There are cycads and tree ferns
 * and no grass because grass had not happened yet. The towns of a medieval
 * start are real towns with real populations because three centuries of the
 * same simulation the game runs put them there.
 *
 * And the line keeps going. Skipping time out of the middle ages runs the
 * same machinery forward, so a world can reach the modern age while you are
 * living in it -- or fail to, because a world that tears itself apart forgets
 * things, and that is allowed too.
 */

export type WorldEra = 'primordial' | 'prehistory' | 'ancient' | 'medieval' | 'industrial' | 'modern';

/** In order, oldest first. The order is the timeline. */
export const WORLD_ERAS: WorldEra[] = [
  'primordial',
  'prehistory',
  'ancient',
  'medieval',
  'industrial',
  'modern',
];

/**
 * Which flora and fauna the world has evolved.
 *
 * `primeval` is the world before flowering plants: ferns, horsetails, cycads,
 * clubmosses and conifers, and no grasses at all, which is why there is no
 * such thing as a meadow in it. `settled` is everything since -- the flora we
 * would recognise, with the megafauna still in it. `late` is that world after
 * the megafauna were hunted out of it and after people started planting
 * things on purpose.
 */
export type LifeStage = 'primeval' | 'settled' | 'late';

export interface EraProfile {
  id: WorldEra;
  /** Years of world history run before the player arrives. */
  presimYears: number;
  /**
   * Know-how each foreign people begins with, in the units the technology
   * system counts in. The thresholds there are what turn this into an era
   * name on the panel.
   */
  startingKnowledge: number;
  /**
   * How crowded the world is with other peoples, as a multiplier on the
   * number its own size supports.
   */
  peoples: number;
  /** Which flora and fauna have evolved by now. */
  life: LifeStage;
  /**
   * Whether the player arrives as one more inhabitant of a country that
   * already exists, rather than as the founder of a new one.
   */
  bornIntoNation: boolean;
  /**
   * How much of the research tree the world at large already takes for
   * granted, 0..1. What the player's own settlement knows is drawn from the
   * topics at or below this depth -- you are not a genius, you grew up
   * somewhere that already knew how to make rope.
   */
  commonKnowledge: number;
}

export const ERA_PROFILES: Record<WorldEra, EraProfile> = {
  // Nobody has arrived. The world is rock, weather and whatever crawled out
  // of the sea. Starting here is starting before history.
  primordial: {
    id: 'primordial',
    presimYears: 0,
    startingKnowledge: 0,
    peoples: 0,
    life: 'primeval',
    bornIntoNation: false,
    commonKnowledge: 0,
  },
  // Bands of people, fire, stone. No polity is big enough to be called a
  // country and none of them writes anything down.
  prehistory: {
    id: 'prehistory',
    presimYears: 0,
    startingKnowledge: 0,
    peoples: 0.6,
    life: 'settled',
    bornIntoNation: false,
    commonKnowledge: 0.05,
  },
  // Cities, bronze, kings, and enough history behind them to argue about.
  ancient: {
    id: 'ancient',
    presimYears: 320,
    startingKnowledge: 180,
    peoples: 1,
    life: 'settled',
    bornIntoNation: false,
    commonKnowledge: 0.25,
  },
  // Kingdoms with walls round their capitals, and you are somebody's
  // subject in one of them from the first morning.
  medieval: {
    id: 'medieval',
    presimYears: 700,
    startingKnowledge: 1100,
    peoples: 1.3,
    life: 'settled',
    bornIntoNation: true,
    commonKnowledge: 0.5,
  },
  industrial: {
    id: 'industrial',
    presimYears: 1100,
    startingKnowledge: 2400,
    peoples: 1.5,
    life: 'late',
    bornIntoNation: true,
    commonKnowledge: 0.78,
  },
  modern: {
    id: 'modern',
    presimYears: 1500,
    startingKnowledge: 4200,
    peoples: 1.7,
    life: 'late',
    bornIntoNation: true,
    commonKnowledge: 1,
  },
};

export function eraProfile(era: WorldEra): EraProfile {
  return ERA_PROFILES[era] ?? ERA_PROFILES.prehistory;
}

/** How far along the timeline an era is, 0..1. Used for anything that scales. */
export function eraProgress(era: WorldEra): number {
  const i = WORLD_ERAS.indexOf(era);
  return i < 0 ? 0 : i / (WORLD_ERAS.length - 1);
}

/**
 * Reads an era out of untrusted data.
 *
 * Save files and settings come from the disk, which means they come from
 * anywhere. Worlds written before the timeline existed say 'fresh' or
 * 'ancient', and those still mean something, so they are translated rather
 * than rejected.
 */
export function readEra(value: unknown): WorldEra {
  if (value === 'fresh') return 'prehistory';
  if (typeof value === 'string' && (WORLD_ERAS as string[]).includes(value)) {
    return value as WorldEra;
  }
  return 'prehistory';
}
