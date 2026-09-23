/**
 * What a mod is allowed to say.
 *
 * A mod is JSON. Not a script, not a bundle, not a thing that is handed the
 * running game and trusted with it: a document that declares content and
 * behaviour, which the game reads, checks, and applies through the same
 * registries its own content lives in. That is the difference between a mod
 * system and an arbitrary-code-execution feature wearing a hat.
 *
 * This is not a limitation dressed up as a principle. Nearly everything a
 * content mod wants to do is declarative -- here is an item, here is a
 * creature, here is a recipe that turns one into the other, here is a panel
 * that shows how many of them there are. The part that usually needs code is
 * behaviour, and behaviour here is a trigger and a list of effects drawn from
 * a fixed vocabulary, so a mod can make something *happen* without being
 * handed the keys to the page it is running on.
 *
 * Everything in a manifest is untrusted input. Nothing here is rendered as
 * markup, nothing is evaluated, and every field is checked and clamped on the
 * way in (see `validate.ts`).
 */

/** Strings a mod supplies are plain text and are rendered as plain text. */
export type ModText = string;

export interface ModManifest {
  /** Unique, lower-case, letters digits and underscores. Namespaces the content. */
  id: string;
  name: ModText;
  version: ModText;
  author?: ModText;
  description?: ModText;
  /** The game version this was written against, for a warning rather than a refusal. */
  gameVersion?: string;

  items?: ModItem[];
  /** Things that stand on the ground and can be harvested: trees, ore, plants. */
  blocks?: ModBlock[];
  creatures?: ModCreature[];
  recipes?: ModRecipe[];
  /** Declarative behaviour: when this happens, do these things. */
  systems?: ModSystem[];
  /** Extra panels, built from a fixed set of widgets. */
  ui?: ModPanel[];
  /** Text in the player's language. Keys are namespaced automatically. */
  strings?: Record<string, Record<string, ModText>>;
}

// ---------------------------------------------------------------- content

export interface ModItem {
  id: string;
  name: ModText;
  category: 'raw' | 'material' | 'food' | 'tool' | 'good';
  stackSize: number;
  /** Kilograms. Decides what it costs to carry and how far it can be thrown. */
  weight: number;
  value: number;
  /** 0xRRGGBB. */
  color: number;
  description?: ModText;
  nutrition?: number;
  toolTier?: number;
  toolFor?: 'chop' | 'mine' | 'build' | 'farm' | 'saw' | 'fish';
}

export interface ModBlock {
  id: string;
  name: ModText;
  category: 'tree' | 'plant' | 'mineral';
  skill: 'chop' | 'mine' | 'forage';
  yields: { item: string; amount: number }[];
  workPerUnit: number;
  units: number;
  /** Days to come back, or -1 for never. */
  regrowDays: number;
  radius: number;
  blocks: boolean;
  spreads: boolean;
  /**
   * Which biomes it grows in and how heavily, as a weight per biome name.
   * Omitted means it is placed by nothing and only appears if a system does.
   */
  biomes?: Record<string, number>;
  /** Which of the built-in shapes to draw it with, and what colour. */
  look?: { shape: 'tree' | 'conifer' | 'bush' | 'rock' | 'ore' | 'crystal'; color: number };
}

export interface ModCreature {
  id: string;
  name: ModText;
  diet: 'herbivore' | 'predator' | 'scavenger';
  speed: number;
  fleeSpeed: number;
  awareness: number;
  yields: { item: string; amount: number }[];
  biomes: string[];
  color: number;
  bellyColor: number;
  size: number;
  herdSize: [number, number];
  /** Population target per square kilometre of suitable ground. */
  density: number;
  lifespan: [number, number];
  build?: 'standard' | 'heavy' | 'sprawling' | 'flyer';
  /** Which ages of the world it exists in. Omitted means all of them. */
  life?: ('primeval' | 'settled' | 'late')[];
}

export interface ModRecipe {
  id: string;
  name: ModText;
  /** Which building does it. Must be one that exists. */
  building: string;
  inputs: { item: string; amount: number }[];
  outputs: { item: string; amount: number }[];
  /** Work units. Comparable to the built-in recipes. */
  work: number;
}

// --------------------------------------------------------------- behaviour

/**
 * When something happens.
 *
 * A closed list, on purpose. Each one is a place in the simulation that
 * already exists and already knows what it is about; a mod chooses one rather
 * than asking to be called on every frame with the world in its hands.
 */
export type ModTrigger =
  | { on: 'day' }
  | { on: 'season'; season?: 'spring' | 'summer' | 'autumn' | 'winter' }
  | { on: 'year' }
  | { on: 'weather'; kind?: string }
  | { on: 'harvest'; block?: string }
  | { on: 'craft'; recipe?: string }
  | { on: 'disaster'; kind?: string };

/**
 * What to do about it.
 *
 * Also a closed list. Each effect is something the game can already do to
 * itself through a public method, so a mod cannot reach anywhere the game
 * would not go on its own.
 */
export type ModEffect =
  | { do: 'log'; key: string; notable?: boolean }
  | { do: 'give'; item: string; amount: number }
  | { do: 'spawnBlock'; block: string; count: number; radius: number }
  | { do: 'spawnCreature'; creature: string; count: number; radius: number }
  | { do: 'weather'; kind: string; hours: number }
  | { do: 'setCounter'; counter: string; value: number }
  | { do: 'addCounter'; counter: string; amount: number };

export interface ModSystem {
  id: string;
  when: ModTrigger;
  /** 0..1. Rolled once per trigger; omitted means always. */
  chance?: number;
  /** Only fires when this counter is at least this much. */
  requires?: { counter: string; atLeast: number };
  then: ModEffect[];
}

// ---------------------------------------------------------------------- UI

export type ModWidget =
  | { kind: 'text'; text: ModText }
  | { kind: 'heading'; text: ModText }
  | { kind: 'counter'; label: ModText; counter: string }
  | { kind: 'itemCount'; label: ModText; item: string }
  | { kind: 'bar'; label: ModText; counter: string; max: number }
  | { kind: 'button'; label: ModText; then: ModEffect[] }
  | { kind: 'list'; label: ModText; source: 'items' | 'blocks' | 'creatures' };

export interface ModPanel {
  id: string;
  title: ModText;
  widgets: ModWidget[];
}

/** A mod as the game holds it: the manifest plus whether it is switched on. */
export interface InstalledMod {
  manifest: ModManifest;
  enabled: boolean;
  /** Where it came from, for the list. */
  source: 'bundled' | 'file';
  /** Anything that was wrong with it, reported rather than thrown away silently. */
  problems: string[];
}
