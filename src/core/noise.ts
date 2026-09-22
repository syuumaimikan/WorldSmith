/**
 * Seeded gradient noise plus the fractal combinators world generation needs.
 *
 * Deliberately dependency-free and allocation-free in the hot path: terrain
 * generation calls these millions of times per world.
 */

import { mulberry32 } from './rng';

const GRAD2: readonly number[][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class Noise2D {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Perlin-style gradient noise in roughly [-1, 1]. */
  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;

    const u = fade(xf);
    const v = fade(yf);

    const p = this.perm;
    const aa = p[p[X] + Y] & 7;
    const ab = p[p[X] + Y + 1] & 7;
    const ba = p[p[X + 1] + Y] & 7;
    const bb = p[p[X + 1] + Y + 1] & 7;

    const g0 = GRAD2[aa][0] * xf + GRAD2[aa][1] * yf;
    const g1 = GRAD2[ba][0] * (xf - 1) + GRAD2[ba][1] * yf;
    const g2 = GRAD2[ab][0] * xf + GRAD2[ab][1] * (yf - 1);
    const g3 = GRAD2[bb][0] * (xf - 1) + GRAD2[bb][1] * (yf - 1);

    const x1 = g0 + u * (g1 - g0);
    const x2 = g2 + u * (g3 - g2);
    return (x1 + v * (x2 - x1)) * 1.4;
  }

  /** Standard fractal brownian motion. Returns roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal — produces the sharp mountain crests seen in the
   * reference diorama rather than rolling hills. Returns roughly [0, 1].
   */
  ridged(x: number, y: number, octaves: number, lacunarity = 2.05, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Billowy noise, good for cloud cover and moisture blobs. Roughly [0, 1]. */
  billow(x: number, y: number, octaves: number): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += Math.abs(this.sample(x * freq, y * freq)) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

/**
 * Domain warp: offsets the sample point by another noise field. This is what
 * stops continents looking like obvious blobby noise and gives the meandering
 * coastlines and valley shapes in the reference image.
 */
export function warp(
  n: Noise2D,
  x: number,
  y: number,
  strength: number,
  frequency: number,
): [number, number] {
  const wx = n.sample(x * frequency + 11.3, y * frequency + 5.7);
  const wy = n.sample(x * frequency - 7.1, y * frequency + 19.4);
  return [x + wx * strength, y + wy * strength];
}
