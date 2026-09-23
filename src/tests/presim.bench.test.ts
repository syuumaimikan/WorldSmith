/**
 * Where the centuries go.
 *
 * A world that begins in the middle ages has to live out seven hundred years
 * before the player sees anything, and a modern one fifteen hundred. That has
 * to happen in seconds. This measures it and prints which system is spending
 * the time, so a regression shows up as a number rather than as somebody at a
 * loading screen wondering whether it has hung.
 *
 * The budget is deliberately loose. It is a guard against something going an
 * order of magnitude wrong, not a benchmark to tune against, and it has to
 * pass on whatever machine happens to be running the tests.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import { DAYS_PER_YEAR, SECONDS_PER_GAME_HOUR } from '../sim/Time';

describe('the cost of a century', () => {
  it('lives out seven hundred years in seconds, not minutes', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'bench', era: 'ancient' }));
    world.seedNeighbours(1.3);
    world.editor.recordHistory = false;

    const years = 25;
    const stepDays = 5;
    const steps = Math.round((years * DAYS_PER_YEAR) / stepDays);
    const hours = stepDays * 24;

    const timings: Record<string, number> = {};
    const time = (name: string, fn: () => void): void => {
      const start = performance.now();
      fn();
      timings[name] = (timings[name] ?? 0) + (performance.now() - start);
    };

    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      time('clock', () => world.time.advance(hours * SECONDS_PER_GAME_HOUR, false));
      time('nations', () => world.nations.update(world, hours));
      time('diplomacy', () => world.diplomacy.update(world, hours));
      time('culture', () => world.culture.update(world, hours));
      time('technology', () => world.technology.update(world, hours));
      time('tectonics', () => world.tectonics.update(world, hours));
      time('history', () => world.history.update(world, hours));
      time('ecology', () => world.livePastEcology(stepDays));
    }
    const total = performance.now() - t0;
    const forSevenHundred = (total / years) * 700;

    const rows = Object.entries(timings).sort((a, b) => b[1] - a[1]);
    console.log(
      '\n' + years + ' years in ' + total.toFixed(0) + ' ms (' + steps + ' steps)\n' +
        rows.map(([k, v]) => '  ' + k.padEnd(12) + v.toFixed(0) + ' ms').join('\n') +
        '\n  => 700 years would be ' + (forSevenHundred / 1000).toFixed(1) + ' s\n',
    );

    expect(forSevenHundred).toBeLessThan(60000);
  });
});
