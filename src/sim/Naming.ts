/**
 * Procedural naming.
 *
 * Names are built from a sound palette rather than drawn from a fixed list, so
 * a world's places, storms and people sound like they come from the same
 * tongue. Each language picks its own consonants, vowels and word shapes at
 * world creation, which is why one world is full of hard, clipped names and
 * another of long soft ones.
 *
 * Names are deterministic for a given seed and key, so the same mountain is
 * called the same thing every time it is asked about.
 */

import { Rng, hashString } from '../core/rng';

const CONSONANT_POOLS = [
  ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v', 'w'],
  ['br', 'dr', 'f', 'gr', 'h', 'k', 'l', 'm', 'n', 'r', 'sk', 'st', 'th', 'v'],
  ['c', 'ch', 'd', 'h', 'j', 'l', 'm', 'n', 'q', 'r', 's', 'sh', 't', 'y'],
  ['b', 'f', 'k', 'kh', 'l', 'm', 'n', 'p', 'r', 's', 't', 'z'],
];

const VOWEL_POOLS = [
  ['a', 'e', 'i', 'o', 'u'],
  ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ou'],
  ['a', 'i', 'u', 'ai', 'au'],
  ['a', 'e', 'o', 'y', 'ea', 'io'],
];

const CODAS = [
  ['', '', '', 'n', 'r', 's'],
  ['', '', 'l', 'ld', 'n', 'nd', 'rn', 'st'],
  ['', '', '', 'm', 'n', 'sh'],
  ['', '', 'k', 'l', 'r', 'th'],
];

/** Suffixes that turn a root into a settlement name. */
const SETTLEMENT_SUFFIXES = [
  ['hollow', 'ford', 'stead', 'wick', 'thorpe', 'bury'],
  ['gard', 'heim', 'vik', 'holm', 'fell', 'dal'],
  ['por', 'sar', 'mir', 'tal', 'kesh', 'anu'],
  ['ton', 'combe', 'mere', 'field', 'bridge', 'gate'],
];

export type FeatureKind =
  | 'mountain'
  | 'volcano'
  | 'river'
  | 'lake'
  | 'forest'
  | 'sea'
  | 'plain'
  | 'cave'
  | 'region';

/** Words for landscape, used when naming a feature after what it is. */
const FEATURE_WORDS: Record<FeatureKind, string[]> = {
  mountain: ['Peak', 'Horn', 'Crag', 'Tor', 'Spire', 'Cap'],
  volcano: ['Furnace', 'Ashcone', 'Emberpeak', 'Smokecrown', 'Firehorn'],
  river: ['Water', 'Run', 'Flow', 'Race', 'Brook'],
  lake: ['Mere', 'Tarn', 'Pool', 'Basin', 'Eye'],
  forest: ['Wood', 'Weald', 'Thicket', 'Grove', 'Shaw'],
  sea: ['Deep', 'Reach', 'Sound', 'Strait', 'Gulf'],
  plain: ['Flats', 'Downs', 'Meadows', 'Sweep', 'Verge'],
  cave: ['Hollow', 'Delve', 'Maw', 'Swallet', 'Undercroft'],
  region: ['March', 'Marches', 'Reach', 'Vale', 'Expanse'],
};

export class Namer {
  private consonants: string[];
  private vowels: string[];
  private codas: string[];
  private suffixes: string[];
  /** Average syllables in a root word for this language. */
  private wordiness: number;
  private seed: number;
  private used = new Set<string>();

  constructor(seed: number) {
    this.seed = seed;
    const rng = new Rng(seed ^ 0x4e41);
    const palette = rng.int(0, CONSONANT_POOLS.length - 1);
    this.consonants = CONSONANT_POOLS[palette];
    this.vowels = VOWEL_POOLS[rng.int(0, VOWEL_POOLS.length - 1)];
    this.codas = CODAS[palette];
    this.suffixes = SETTLEMENT_SUFFIXES[palette];
    this.wordiness = rng.range(1.6, 2.6);
  }

  /** A root word in this world's language. */
  root(rng: Rng): string {
    const syllables = Math.max(1, Math.round(rng.stat(this.wordiness, 0.6, 1, 4)));
    let out = '';
    for (let i = 0; i < syllables; i++) {
      out += rng.pick(this.consonants) + rng.pick(this.vowels);
      if (i === syllables - 1) out += rng.pick(this.codas);
    }
    return capitalise(out);
  }

  /** Deterministic for a key: the same place always has the same name. */
  private rngFor(key: string): Rng {
    return new Rng(this.seed ^ hashString(key));
  }

  /** Makes sure two things in one world do not end up with the same name. */
  private unique(base: string): string {
    let name = base;
    let attempts = 0;
    while (this.used.has(name) && attempts < 24) {
      name = `${base} ${romanNumeral(attempts + 2)}`;
      attempts++;
    }
    this.used.add(name);
    return name;
  }

  settlementName(key: string | number): string {
    const rng = this.rngFor(`town:${key}`);
    const base = rng.chance(0.55)
      ? `${this.root(rng)}${rng.pick(this.suffixes)}`
      : `${this.root(rng)} ${capitalise(rng.pick(this.suffixes))}`;
    return this.unique(base);
  }

  /** Names a piece of landscape, e.g. "Kadren Peak". */
  featureName(kind: FeatureKind, key: string | number): string {
    const rng = this.rngFor(`${kind}:${key}`);
    const word = rng.pick(FEATURE_WORDS[kind]);
    const base = rng.chance(0.3) ? `The ${word} of ${this.root(rng)}` : `${this.root(rng)} ${word}`;
    return this.unique(base);
  }

  /** Places named for where they are, used for storms and landmarks. */
  placeName(x: number, z: number): string {
    return this.featureName('region', `${Math.round(x)},${Math.round(z)}`);
  }

  personName(key: string | number): string {
    const rng = this.rngFor(`person:${key}`);
    const given = this.root(rng);
    const family = rng.chance(0.75) ? ` ${this.root(rng)}` : '';
    return `${given}${family}`;
  }

  nationName(key: string | number): string {
    const rng = this.rngFor(`nation:${key}`);
    const root = this.root(rng);
    const forms = [
      `The ${root} ${rng.pick(['Realm', 'Dominion', 'Reach', 'Compact', 'League'])}`,
      `${root}ia`,
      `${root}land`,
      `The ${rng.pick(['Free', 'Grand', 'Elder', 'High'])} ${rng.pick(['Cities', 'Holds', 'Coast', 'Vale'])} of ${root}`,
    ];
    return this.unique(rng.pick(forms));
  }

  /**
   * A faith is named for the thing at the centre of it, so a sect that splits
   * off can be given the same stem and come out sounding like what it broke
   * from — which is exactly how it sounds to the people arguing about it.
   */
  faithName(key: string | number, stem: string): string {
    const rng = this.rngFor(`faith:${key}`);
    const forms = [
      `The Way of ${stem}`,
      `The ${stem} Rite`,
      `The ${stem} Path`,
      `${stem}ism`,
      `The Keepers of ${stem}`,
    ];
    return this.unique(rng.pick(forms));
  }

  /**
   * A root word that sounds like it came from another one: the head of the
   * old word with a new ending grown onto it. A sect named this way is
   * recognisably a sect of what it broke from.
   */
  stemVariant(key: string | number, stem: string): string {
    const rng = this.rngFor(`stemvar:${key}`);
    const keep = Math.max(2, Math.round(stem.length * 0.55));
    const head = stem.slice(0, keep);
    return capitalise(head + rng.pick(this.consonants) + rng.pick(this.vowels) + rng.pick(this.codas));
  }

  /** A people's name for themselves. */
  cultureName(key: string | number): string {
    const rng = this.rngFor(`culture:${key}`);
    const root = this.root(rng);
    return this.unique(rng.pick([`${root}i`, `${root}an`, `${root}ic`, root]));
  }

  /** Stars and constellations get the same tongue as everything else. */
  skyName(key: string | number): string {
    const rng = this.rngFor(`sky:${key}`);
    return rng.chance(0.4) ? `The ${this.root(rng)}` : this.root(rng);
  }
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function romanNumeral(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  let v = n;
  for (const [value, symbol] of table) {
    while (v >= value) {
      out += symbol;
      v -= value;
    }
  }
  return out;
}
