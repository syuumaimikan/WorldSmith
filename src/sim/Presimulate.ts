/**
 * Living the world out before the player gets there.
 *
 * "Ancient World" promises centuries of history that already happened. The
 * cheap way to keep that promise is to scatter some ruins and write a
 * paragraph of flavour. This does not do that. It runs the same systems the
 * game runs — polities, diplomacy, culture, faith, the crust — for as many
 * years as the world claims to be old, and whatever comes out is the past:
 * the borders on the map are where the wars actually left them, the faiths
 * are the ones that actually won, the chronicle's ages are what actually
 * happened, and the nations that are gone are gone because they failed.
 *
 * What is not run is anything at a human scale. There are no settlers yet, no
 * buildings, no jobs and no weather worth the name: the atmosphere moves in
 * quarter-hour steps and four hundred years of it would be about fourteen
 * million of them for a sky nobody was standing under. The world's memory of
 * that time is therefore political, not meteorological, which is also roughly
 * true of every real chronicle.
 */

import { DAYS_PER_YEAR, SECONDS_PER_GAME_HOUR } from './Time';
import type { World } from './World';

/** Days of history per step. Polities move at the pace of seasons anyway. */
const STEP_DAYS = 5;

/** Years the "ancient" option is worth, before the world's own size is felt. */
export const ANCIENT_YEARS = 320;

export interface PreSimProgress {
  /** 0..1 through the pre-simulation. */
  fraction: number;
  /** The year the world has reached. */
  year: number;
}

/**
 * Runs `years` of world-scale history. The world must already have its
 * foreign nations and their cultures; the player's own settlement is founded
 * afterwards, into whatever this leaves behind.
 */
export function preSimulate(
  world: World,
  years: number,
  onProgress?: (p: PreSimProgress) => void,
): void {
  const steps = Math.max(1, Math.round((years * DAYS_PER_YEAR) / STEP_DAYS));
  const hours = STEP_DAYS * 24;
  // Reported often enough that a loading bar moves, rarely enough that the
  // reporting is not the expensive part.
  const report = Math.max(1, Math.floor(steps / 60));

  for (let i = 0; i < steps; i++) {
    world.time.advance(hours * SECONDS_PER_GAME_HOUR);
    world.nations.update(world, hours);
    world.diplomacy.update(world, hours);
    world.culture.update(world, hours);
    world.technology.update(world, hours);
    world.tectonics.update(world, hours);
    world.history.update(world, hours);

    if (onProgress && (i % report === 0 || i === steps - 1)) {
      onProgress({
        fraction: (i + 1) / steps,
        year: world.time.snapshot().year,
      });
    }
  }
}
