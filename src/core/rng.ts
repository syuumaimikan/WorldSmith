/**
 * Deterministic random number generation.
 *
 * Every stochastic decision in WorldSmith flows through a seeded Rng so that a
 * world seed fully reproduces a world. Never call Math.random() in game code.
 */

/** Fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a style string hash, used to turn human-typed seeds into numbers. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Combine a base seed with arbitrary integer coordinates into a new seed. */
export function seedMix(seed: number, ...parts: number[]): number {
  let h = seed >>> 0;
  for (const p of parts) {
    h ^= Math.imul(p | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private nextFloat: () => number;
  readonly seed: number;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.nextFloat = mulberry32(this.seed);
  }

  /** Derive an independent stream from this one without disturbing it. */
  fork(...parts: number[]): Rng {
    return new Rng(seedMix(this.seed, ...parts, this.int(0, 0xffff)));
  }

  /** [0, 1) */
  next(): number {
    return this.nextFloat();
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.nextFloat() * arr.length)];
  }

  /** Pick using per-entry weights. */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T {
    let total = 0;
    for (const e of entries) total += e.weight;
    let r = this.nextFloat() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r <= 0) return e.value;
    }
    return entries[entries.length - 1].value;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Normally distributed value, mean 0 stddev 1 (Box-Muller). */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.nextFloat();
    while (v === 0) v = this.nextFloat();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Gaussian clamped to a range, useful for NPC stat rolls. */
  stat(mean: number, stddev: number, min: number, max: number): number {
    const v = mean + this.gaussian() * stddev;
    return v < min ? min : v > max ? max : v;
  }
}
