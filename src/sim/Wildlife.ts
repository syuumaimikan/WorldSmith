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

export type AnimalSpecies = 'deer' | 'boar' | 'rabbit' | 'wolf' | 'fox' | 'sheep' | 'bird';

export type AnimalState = 'idle' | 'wander' | 'graze' | 'flee' | 'hunt' | 'sleep';

export interface AnimalDef {
  species: AnimalSpecies;
  name: string;
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

export function speciesForBiome(biome: Biome): AnimalSpecies[] {
  const out: AnimalSpecies[] = [];
  for (const def of Object.values(ANIMALS)) {
    if (def.biomes.includes(biome)) out.push(def.species);
  }
  return out;
}
