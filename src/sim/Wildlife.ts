/**
 * Wild animals.
 *
 * Herbivores graze and flee, predators hunt them, and populations respond to
 * the biome they live in and to how hard the settlement hunts them. Enough of a
 * food chain that over-hunting has consequences, without becoming a second game.
 */

import { Rng } from '../core/rng';
import { Biome } from '../world/types';
import { ItemId } from '../data/items';
import { PALETTE } from '../render/Palette';
import type { LifeStage } from '../world/eras';

export type AnimalSpecies =
  | 'deer'
  | 'boar'
  | 'rabbit'
  | 'wolf'
  | 'fox'
  | 'sheep'
  | 'bird'
  // Things a modern world does not have, because people ate them.
  | 'aurochs'
  | 'mammoth'
  | 'bear'
  | 'horse'
  | 'goat'
  // And things no world with people in it ever had.
  | 'labyrinthodont'
  | 'sail_lizard'
  | 'giant_dragonfly';

/**
 * How an animal is put together, which decides how it is drawn.
 *
 * A sprawling amphibian does not stand on its legs the way a deer does -- it
 * lies between them -- and a mammoth is not a big deer. The silhouette is
 * most of what makes a creature recognisable at any distance, so it is a
 * property of the species rather than something the renderer guesses.
 */
export type AnimalBuild = 'standard' | 'heavy' | 'sprawling' | 'flyer';

export type AnimalState = 'idle' | 'wander' | 'graze' | 'flee' | 'hunt' | 'sleep';

export interface AnimalDef {
  species: AnimalSpecies;
  name: string;
  /** Body plan, for the renderer. Defaults to a four-legged standard build. */
  build?: AnimalBuild;
  /**
   * Which stages of life's history this creature exists in.
   *
   * Not a spawn table: an aurochs is absent from a modern world because
   * aurochsen were hunted to extinction, and a labyrinthodont is absent from
   * every world with people in it because it was three hundred million years
   * too early.
   */
  life?: LifeStage[];
  diet: 'herbivore' | 'predator' | 'scavenger';
  speed: number;
  fleeSpeed: number;
  /** Detection radius for threats. */
  awareness: number;
  yields: { item: ItemId; amount: number }[];
  /** Biomes this animal is found in. */
  biomes: Biome[];
  colour: number;
  bellyColour: number;
  size: number;
  herdSize: [number, number];
  /** Population target per square kilometre of suitable terrain. */
  density: number;
  /** Years this kind lives, before an individual's own luck is drawn. */
  lifespan: [number, number];
}

export const ANIMALS: Record<AnimalSpecies, AnimalDef> = {
  deer: {
    species: 'deer',
    life: ['settled', 'late'],
    name: 'Deer',
    diet: 'herbivore',
    speed: 1.5,
    fleeSpeed: 7.2,
    awareness: 22,
    yields: [
      { item: 'meat', amount: 3 },
      { item: 'hide', amount: 2 },
    ],
    biomes: [Biome.TemperateForest, Biome.DenseForest, Biome.Grassland, Biome.Taiga],
    colour: PALETTE.wildlife.deer,
    bellyColour: PALETTE.wildlife.deerBelly,
    size: 1,
    herdSize: [2, 5],
    density: 26,
    lifespan: [9, 16],
  },
  boar: {
    species: 'boar',
    life: ['settled', 'late'],
    name: 'Boar',
    diet: 'herbivore',
    speed: 1.2,
    fleeSpeed: 5.4,
    awareness: 14,
    yields: [
      { item: 'meat', amount: 4 },
      { item: 'hide', amount: 1 },
    ],
    biomes: [Biome.DenseForest, Biome.TemperateForest, Biome.Wetland],
    colour: PALETTE.wildlife.boar,
    bellyColour: PALETTE.wildlife.boar,
    size: 0.85,
    herdSize: [1, 3],
    density: 14,
    lifespan: [8, 14],
  },
  rabbit: {
    species: 'rabbit',
    life: ['settled', 'late'],
    name: 'Rabbit',
    diet: 'herbivore',
    speed: 1.1,
    fleeSpeed: 6.5,
    awareness: 16,
    yields: [{ item: 'meat', amount: 1 }],
    biomes: [Biome.Grassland, Biome.TemperateForest, Biome.Savanna],
    colour: PALETTE.wildlife.rabbit,
    bellyColour: PALETTE.wildlife.rabbit,
    size: 0.4,
    herdSize: [1, 4],
    density: 40,
    lifespan: [2, 5],
  },
  fox: {
    species: 'fox',
    life: ['settled', 'late'],
    name: 'Fox',
    diet: 'predator',
    speed: 1.8,
    fleeSpeed: 6.2,
    awareness: 20,
    yields: [{ item: 'hide', amount: 1 }],
    biomes: [Biome.TemperateForest, Biome.Grassland, Biome.Taiga],
    colour: PALETTE.wildlife.fox,
    bellyColour: PALETTE.wildlife.rabbit,
    size: 0.5,
    herdSize: [1, 1],
    density: 8,
    lifespan: [4, 9],
  },
  wolf: {
    species: 'wolf',
    life: ['settled', 'late'],
    name: 'Wolf',
    diet: 'predator',
    speed: 2.1,
    fleeSpeed: 7.5,
    awareness: 34,
    yields: [{ item: 'hide', amount: 2 }],
    biomes: [Biome.Taiga, Biome.DenseForest, Biome.Mountain, Biome.Tundra],
    colour: PALETTE.wildlife.wolf,
    bellyColour: PALETTE.wildlife.wolf,
    size: 0.8,
    herdSize: [2, 4],
    density: 6,
    lifespan: [7, 14],
  },
  sheep: {
    species: 'sheep',
    life: ['settled', 'late'],
    name: 'Wild Sheep',
    diet: 'herbivore',
    speed: 1.1,
    fleeSpeed: 4.6,
    awareness: 18,
    yields: [
      { item: 'meat', amount: 2 },
      { item: 'fiber', amount: 4 },
    ],
    biomes: [Biome.Mountain, Biome.Alpine, Biome.Tundra, Biome.Grassland],
    colour: PALETTE.wildlife.sheep,
    bellyColour: PALETTE.wildlife.sheep,
    size: 0.7,
    herdSize: [3, 6],
    density: 16,
    lifespan: [9, 15],
  },
  bird: {
    species: 'bird',
    life: ['settled', 'late'],
    name: 'Bird',
    diet: 'scavenger',
    speed: 3.2,
    fleeSpeed: 8,
    awareness: 26,
    yields: [],
    biomes: [
      Biome.Grassland,
      Biome.TemperateForest,
      Biome.DenseForest,
      Biome.Wetland,
      Biome.Beach,
      Biome.Savanna,
    ],
    colour: PALETTE.wildlife.bird,
    bellyColour: PALETTE.wildlife.bird,
    size: 0.22,
    herdSize: [2, 6],
    density: 34,
    lifespan: [3, 8],
  },
  // ------------------------------------------------------ the great beasts
  //
  // Every one of these was alive when people arrived and dead by the time
  // they had cities. They are in the world for the ages when they were, and
  // gone from the ages when they were not, which is the difference between
  // a history and a bestiary.
  aurochs: {
    species: 'aurochs',
    name: 'Aurochs',
    build: 'heavy',
    life: ['settled'],
    diet: 'herbivore',
    speed: 1.2,
    fleeSpeed: 6.4,
    awareness: 24,
    yields: [
      { item: 'meat', amount: 9 },
      { item: 'hide', amount: 4 },
      { item: 'bone', amount: 3 },
    ],
    biomes: [Biome.Grassland, Biome.TemperateForest, Biome.Wetland, Biome.Savanna],
    colour: 0x3c332b,
    bellyColour: 0x5c4c3c,
    size: 1.6,
    herdSize: [3, 8],
    density: 9,
    lifespan: [14, 25],
  },
  mammoth: {
    species: 'mammoth',
    name: 'Mammoth',
    build: 'heavy',
    life: ['settled'],
    diet: 'herbivore',
    speed: 0.95,
    fleeSpeed: 4.6,
    awareness: 30,
    yields: [
      { item: 'meat', amount: 22 },
      { item: 'hide', amount: 8 },
      { item: 'bone', amount: 10 },
    ],
    biomes: [Biome.Tundra, Biome.Taiga],
    colour: 0x6b4f38,
    bellyColour: 0x8a6c4e,
    size: 2.6,
    herdSize: [2, 6],
    density: 4,
    lifespan: [40, 70],
  },
  bear: {
    species: 'bear',
    name: 'Bear',
    build: 'heavy',
    life: ['settled', 'late'],
    diet: 'predator',
    speed: 1.4,
    fleeSpeed: 6.8,
    awareness: 28,
    yields: [
      { item: 'meat', amount: 6 },
      { item: 'hide', amount: 3 },
    ],
    biomes: [Biome.DenseForest, Biome.Taiga, Biome.Mountain],
    colour: 0x4a3a2e,
    bellyColour: 0x3a2e26,
    size: 1.15,
    herdSize: [1, 1],
    density: 4,
    lifespan: [15, 28],
  },
  horse: {
    species: 'horse',
    name: 'Wild Horse',
    life: ['settled', 'late'],
    diet: 'herbivore',
    speed: 1.9,
    fleeSpeed: 9.4,
    awareness: 30,
    yields: [
      { item: 'meat', amount: 6 },
      { item: 'hide', amount: 3 },
    ],
    biomes: [Biome.Grassland, Biome.Savanna, Biome.Tundra],
    colour: 0x7a5c3e,
    bellyColour: 0x9a7a58,
    size: 1.25,
    herdSize: [4, 10],
    density: 12,
    lifespan: [18, 30],
  },
  goat: {
    species: 'goat',
    name: 'Wild Goat',
    life: ['settled', 'late'],
    diet: 'herbivore',
    speed: 1.3,
    fleeSpeed: 6,
    awareness: 22,
    yields: [
      { item: 'meat', amount: 2 },
      { item: 'hide', amount: 1 },
      { item: 'fiber', amount: 2 },
    ],
    biomes: [Biome.Mountain, Biome.Alpine, Biome.Desert],
    colour: 0x8a7a62,
    bellyColour: 0xc4b498,
    size: 0.62,
    herdSize: [3, 7],
    density: 18,
    lifespan: [8, 16],
  },

  // --------------------------------------------------------- the old world
  labyrinthodont: {
    // A four-metre amphibian with a skull like a paving slab, lying in the
    // shallows of a coal swamp waiting for something to swim past.
    species: 'labyrinthodont',
    name: 'Labyrinthodont',
    build: 'sprawling',
    life: ['primeval'],
    diet: 'predator',
    speed: 0.7,
    fleeSpeed: 3.2,
    awareness: 18,
    yields: [
      { item: 'meat', amount: 7 },
      { item: 'hide', amount: 3 },
    ],
    biomes: [Biome.Wetland, Biome.Beach, Biome.DenseForest],
    colour: 0x4a5a44,
    bellyColour: 0x8a9a72,
    size: 1.3,
    herdSize: [1, 2],
    density: 8,
    lifespan: [12, 30],
  },
  sail_lizard: {
    species: 'sail_lizard',
    name: 'Sail-back',
    build: 'sprawling',
    life: ['primeval'],
    diet: 'herbivore',
    speed: 0.8,
    fleeSpeed: 3.8,
    awareness: 20,
    yields: [
      { item: 'meat', amount: 8 },
      { item: 'hide', amount: 4 },
      { item: 'bone', amount: 2 },
    ],
    biomes: [Biome.Grassland, Biome.Savanna, Biome.Desert, Biome.Wetland],
    colour: 0x6d5a3e,
    bellyColour: 0xa89060,
    size: 1.5,
    herdSize: [1, 3],
    density: 7,
    lifespan: [15, 35],
  },
  giant_dragonfly: {
    // Meganeura. Seventy centimetres across, and only possible because the
    // air of that world had far more oxygen in it than this one does.
    species: 'giant_dragonfly',
    name: 'Meganeura',
    build: 'flyer',
    life: ['primeval'],
    diet: 'scavenger',
    speed: 4.2,
    fleeSpeed: 9,
    awareness: 22,
    yields: [],
    biomes: [Biome.Wetland, Biome.DenseForest, Biome.TemperateForest, Biome.Beach],
    colour: 0x2f6a5e,
    bellyColour: 0x58a08a,
    size: 0.5,
    herdSize: [1, 4],
    density: 26,
    lifespan: [1, 2],
  },
};

export interface Animal {
  id: number;
  species: AnimalSpecies;
  x: number;
  z: number;
  y: number;
  yaw: number;
  speed: number;
  state: AnimalState;
  stateTimer: number;
  targetX: number;
  targetZ: number;
  /** Set when hunted; the animal is removed next tick. */
  dead: boolean;
  /** NPC currently hunting this animal. */
  huntedBy: number;
  age: number;
  /** The age this one starts failing around. Its own, not its species'. */
  lifespan: number;
  /** Flight altitude for birds. */
  altitude: number;
  rngSeed: number;
}

export function createAnimal(
  id: number,
  species: AnimalSpecies,
  x: number,
  z: number,
  rng: Rng,
): Animal {
  return {
    id,
    species,
    x,
    z,
    y: 0,
    yaw: rng.range(0, Math.PI * 2),
    speed: 0,
    state: 'wander',
    stateTimer: rng.range(1, 6),
    targetX: x,
    targetZ: z,
    dead: false,
    huntedBy: 0,
    age: rng.range(0, Math.max(1, (ANIMALS[species]?.lifespan[0] ?? 6) * 0.7)),
    lifespan: (() => {
      const def = ANIMALS[species];
      if (!def) return 6;
      const [lo, hi] = def.lifespan;
      return rng.stat((lo + hi) / 2, (hi - lo) / 4, lo * 0.5, hi * 1.25);
    })(),
    altitude: species === 'bird' ? rng.range(6, 16) : 0,
    rngSeed: rng.int(0, 1e9),
  };
}

export function speciesForBiome(biome: Biome, life: LifeStage = 'settled'): AnimalSpecies[] {
  const out: AnimalSpecies[] = [];
  for (const def of Object.values(ANIMALS)) {
    if (!def.biomes.includes(biome)) continue;
    // A species with no stages listed is one that has been here the whole
    // time people have; the ones that name their stages are the ones that
    // came and went.
    if (def.life && !def.life.includes(life)) continue;
    out.push(def.species);
  }
  return out;
}
