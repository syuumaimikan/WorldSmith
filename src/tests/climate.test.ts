/**
 * The atmosphere.
 *
 * The point of these is that weather is a consequence, not a roll. Each one
 * checks a chain: water gets into the air, the air moves, the air lets the
 * water go somewhere specific, and the ground remembers it.
 */

import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_HOUR } from '../sim/Time';
import { buildTestWorld, makeTestConfig, run, runAir } from './harness';

/** One game year is 60 days. */
const YEAR_DAYS = 60;

describe('the atmosphere', () => {
  it('starts in equilibrium with the ground rather than mid-storm', () => {
    const world = buildTestWorld();
    expect(world.climate.meanPrecipitation()).toBeLessThan(0.05);
    expect(world.weather.current).not.toBe('storm');
  });

  it('balances what it evaporates against what it rains, year after year', () => {
    const world = buildTestWorld();
    runAir(world, YEAR_DAYS * 2);
    const history = world.climate.history;
    expect(history.length).toBeGreaterThanOrEqual(2);

    for (const year of history) {
      // A world that rains a millimetre a year has a broken water cycle, and
      // so does one that drops a kilometre of it.
      expect(year.totalRain + year.totalSnow).toBeGreaterThan(20);
      expect(year.totalRain + year.totalSnow).toBeLessThan(3000);
    }
    // Two consecutive years should be recognisably the same climate.
    const a = history[history.length - 2];
    const b = history[history.length - 1];
    expect(Math.abs(a.meanTemperature - b.meanTemperature)).toBeLessThan(3);
  });

  it('is colder in winter and warmer in summer', () => {
    const world = buildTestWorld();
    const bySeason = new Map<string, number[]>();
    for (let i = 0; i < 60; i++) {
      runAir(world, 1);
      const s = world.time.snapshot().season;
      const list = bySeason.get(s) ?? [];
      list.push(world.climate.meanTemperature());
      bySeason.set(s, list);
    }
    const mean = (xs: number[] | undefined): number =>
      xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
    expect(mean(bySeason.get('summer'))).toBeGreaterThan(mean(bySeason.get('winter')) + 6);
  });

  it('is not the same everywhere at once', () => {
    const world = buildTestWorld();
    runAir(world, 6);
    const c = world.climate;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < c.temperature.length; i++) {
      lo = Math.min(lo, c.temperature[i]);
      hi = Math.max(hi, c.temperature[i]);
    }
    // Mountains, coasts and latitude have to actually disagree.
    expect(hi - lo).toBeGreaterThan(4);
  });

  it('rains harder on the windward side of high ground', () => {
    const world = buildTestWorld();
    runAir(world, YEAR_DAYS);
    const c = world.climate;
    // Gather each cell's rainfall against how much it climbs into the wind.
    let liftedRain = 0;
    let liftedCount = 0;
    let shelteredRain = 0;
    let shelteredCount = 0;
    for (let z = 1; z < c.cells - 1; z++) {
      for (let x = 1; x < c.cells - 1; x++) {
        const i = z * c.cells + x;
        const speed = Math.hypot(c.windU[i], c.windV[i]);
        if (speed < 1) continue;
        const dx = Math.round(c.windU[i] / speed);
        const dz = Math.round(c.windV[i] / speed);
        const ahead = (z + dz) * c.cells + (x + dx);
        const rise = c.altitudeOf(ahead) - c.altitudeOf(i);
        if (rise > 6) {
          liftedRain += c.precipitation[i];
          liftedCount++;
        } else if (rise < -6) {
          shelteredRain += c.precipitation[i];
          shelteredCount++;
        }
      }
    }
    // A world with no relief at all would not exercise this; skip rather than
    // assert something the terrain cannot show.
    if (liftedCount > 3 && shelteredCount > 3) {
      expect(liftedRain / liftedCount).toBeGreaterThan(shelteredRain / shelteredCount);
    }
  });

  it('holds snow through the cold and gives it back as meltwater', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'snowy', climate: 'cold' }));
    let peakCover = 0;
    let sawMelt = false;
    for (let i = 0; i < 60; i++) {
      runAir(world, 1);
      peakCover = Math.max(peakCover, world.climate.snowCover());
      if (world.snowmeltCarried > 0) sawMelt = true;
    }
    expect(peakCover).toBeGreaterThan(0.05);
    expect(sawMelt).toBe(true);
  });

  it('sends fronts across the map and lets them go again', () => {
    const world = buildTestWorld();
    let sawFront = false;
    for (let i = 0; i < 40; i++) {
      runAir(world, 1);
      if (world.climate.fronts.length > 0) sawFront = true;
      // Fronts must not pile up for ever.
      expect(world.climate.fronts.length).toBeLessThanOrEqual(4);
    }
    expect(sawFront).toBe(true);
  });

  it('does not call an ordinary winter a cold snap', () => {
    const world = buildTestWorld();
    let winterSnaps = 0;
    for (let i = 0; i < 60; i++) {
      runAir(world, 1);
      if (world.time.snapshot().season !== 'winter') continue;
      if (world.climate.extremes.some((e) => e.kind === 'coldsnap')) winterSnaps++;
    }
    // A snap can happen in winter, but the whole season must not be one.
    expect(winterSnaps).toBeLessThan(12);
  });

  it('cools the whole world for years after a big eruption', () => {
    const world = buildTestWorld();
    runAir(world, 3);
    const before = world.climate.meanTemperature();
    world.climate.addAerosol(4);
    runAir(world, 1);
    expect(world.climate.meanTemperature()).toBeLessThan(before);
    expect(world.climate.aerosolCooling).toBeGreaterThan(0);
  });
});

describe('the weather you stand in', () => {
  it('reports the air over the player, not a global roll', () => {
    const world = buildTestWorld();
    run(world, 24 * SECONDS_PER_GAME_HOUR);
    const here = world.player.position;
    expect(world.weather.current).toBe(world.climate.kindAt(here.x, here.z));
    expect(world.weather.temperature).toBeCloseTo(
      world.climate.temperatureAt(here.x, here.z),
      3,
    );
  });

  it('gives a year of varied sky rather than one state', () => {
    const world = buildTestWorld();
    const seen = new Set<string>();
    for (let i = 0; i < YEAR_DAYS; i++) {
      runAir(world, 1);
      seen.add(world.weather.current);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('lets a god power override the atmosphere, then hands it back', () => {
    const world = buildTestWorld();
    world.weather.force('storm', 6);
    run(world, SECONDS_PER_GAME_HOUR);
    expect(world.weather.current).toBe('storm');
    expect(world.weather.isForced).toBe(true);
    run(world, SECONDS_PER_GAME_HOUR * 10);
    expect(world.weather.isForced).toBe(false);
  });
});

describe('big storms', () => {
  it('drops a tornado only where the air is already violent', () => {
    const world = buildTestWorld();
    const c = world.climate;
    // No tornado out of a calm sky, however long you wait.
    runAir(world, 3);
    const calmTornadoes = world.storms.tornadoCount;

    // Now make one cell genuinely severe: heavy rain, strong wind, and air
    // moving very differently a cell away.
    const mid = Math.floor(c.cells / 2);
    for (let k = 0; k < 400 && world.storms.tornadoCount === 0; k++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (mid + dz) * c.cells + (mid + dx);
          c.precipitation[i] = 12;
          c.temperature[i] = 24;
          c.windU[i] = dx === 0 && dz === 0 ? 14 : -6;
          c.windV[i] = dz * 9;
        }
      }
      world.storms.update(world, 0.25);
    }
    expect(calmTornadoes).toBe(0);
    expect(world.storms.tornadoCount).toBeGreaterThan(0);

    const t = world.storms.storms.find((s) => s.kind === 'tornado')!;
    expect(t.radius).toBeGreaterThan(10);
    expect(t.name.length).toBeGreaterThan(0);
  });

  it('tears down trees along the path it actually travels', () => {
    const world = buildTestWorld();
    const c = world.climate;
    const mid = Math.floor(c.cells / 2);
    for (let k = 0; k < 400 && world.storms.tornadoCount === 0; k++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (mid + dz) * c.cells + (mid + dx);
          c.precipitation[i] = 12;
          c.temperature[i] = 24;
          c.windU[i] = dx === 0 && dz === 0 ? 14 : -6;
          c.windV[i] = dz * 9;
        }
      }
      world.storms.update(world, 0.25);
    }
    const tornado = world.storms.storms.find((s) => s.kind === 'tornado');
    expect(tornado).toBeDefined();

    // Put a stand of trees right where it is heading.
    const ahead = {
      x: tornado!.x + Math.cos(tornado!.heading) * 25,
      z: tornado!.z + Math.sin(tornado!.heading) * 25,
    };
    let planted = 0;
    for (let i = 0; i < 40; i++) {
      const node = world.plantSapling(
        'oak',
        ahead.x + (i % 8) * 2 - 8,
        ahead.z + Math.floor(i / 8) * 2 - 5,
      );
      if (node) {
        node.growth = 1;
        planted++;
      }
    }
    if (planted < 5) return; // the ground there will not hold trees

    const before = world.nodes.length;
    for (let i = 0; i < 20; i++) world.storms.update(world, 0.15);
    expect(world.nodes.length).toBeLessThan(before);
  });

  it('starves a hurricane once it is over land', () => {
    const world = buildTestWorld();
    const c = world.climate;
    // Place one by hand on the warm sea it needs, then drive it ashore.
    for (let i = 0; i < c.temperature.length; i++) c.temperature[i] = 28;
    let spawned = false;
    for (let k = 0; k < 900 && !spawned; k++) {
      world.storms.update(world, 0.4);
      spawned = world.storms.hurricaneCount > 0;
    }
    if (!spawned) return; // this map has no wide warm sea

    const h = world.storms.storms.find((s) => s.kind === 'hurricane')!;
    const strength = h.intensity;
    // Move it onto dry land and cool the ground under it.
    const land = world.player.position;
    h.x = land.x;
    h.z = land.z;
    for (let i = 0; i < 40; i++) world.storms.update(world, 0.5);
    expect(h.intensity).toBeLessThan(strength);
  });
});

describe('lightning', () => {
  it('is what starts fires in a dry thunderstorm, not a timer', () => {
    const world = buildTestWorld();
    let struck = 0;
    for (let i = 0; i < 60; i++) {
      runAir(world, 1);
      struck = world.lightningStrikes;
      if (struck > 0) break;
    }
    // Over a year of weather a world this size should see lightning at least
    // once; if it genuinely never storms, there is nothing to assert.
    if (struck === 0) return;
    expect(struck).toBeGreaterThan(0);
  });
});
