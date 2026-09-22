/**
 * The sky.
 *
 * These defend the claim that the sky is geometry rather than scenery: the
 * moon's phase follows from where it is, eclipses happen only when the three
 * bodies genuinely line up, and the same seed gives the same sky every time so
 * a world can have a calendar built on it.
 */

import { describe, expect, it } from 'vitest';
import { Astronomy, SYNODIC_DAYS } from '../sim/Astronomy';
import { Namer } from '../sim/Naming';
import { DAYS_PER_YEAR, GameTime, SECONDS_PER_GAME_HOUR } from '../sim/Time';
import { hashString } from '../core/rng';
import { buildTestWorld, makeTestConfig } from './harness';

function sky(seedText = 'stars'): Astronomy {
  const seed = hashString(seedText);
  return new Astronomy(seed, new Namer(seed));
}

describe('the star catalogue', () => {
  it('is the same sky for the same seed, and a different one otherwise', () => {
    const a = sky('alpha');
    const b = sky('alpha');
    const c = sky('beta');
    expect(a.stars.length).toBe(b.stars.length);
    expect(a.stars[100].ra).toBeCloseTo(b.stars[100].ra, 10);
    expect(a.constellations.map((x) => x.name)).toEqual(b.constellations.map((x) => x.name));
    expect(a.constellations.map((x) => x.name)).not.toEqual(c.constellations.map((x) => x.name));
  });

  it('has a few bright stars and a great many faint ones', () => {
    const a = sky();
    const bright = a.stars.filter((s) => s.magnitude < 2.5).length;
    const faint = a.stars.filter((s) => s.magnitude > 5).length;
    expect(bright).toBeGreaterThan(0);
    expect(faint).toBeGreaterThan(bright * 5);
  });

  it('gathers a dense band across the sky rather than scattering evenly', () => {
    const a = sky();
    const band = a.stars.filter((s) => s.inMilkyWay);
    expect(band.length).toBeGreaterThan(a.stars.length * 0.2);
    // The band is a band: its members cluster around one great circle, so
    // their distance from the galactic pole is tightly grouped near 90 degrees.
    let worst = 0;
    for (const s of band) {
      const cos =
        Math.sin(s.dec) * Math.sin(a.galacticPole.dec) +
        Math.cos(s.dec) * Math.cos(a.galacticPole.dec) * Math.cos(s.ra - a.galacticPole.ra);
      const fromPole = Math.acos(Math.max(-1, Math.min(1, cos)));
      worst = Math.max(worst, Math.abs(fromPole - Math.PI / 2));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('draws constellations from stars that are actually near each other', () => {
    const a = sky();
    expect(a.constellations.length).toBeGreaterThan(3);
    for (const c of a.constellations) {
      expect(c.stars.length).toBeGreaterThanOrEqual(4);
      expect(c.lines.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      for (const [x, y] of c.lines) {
        const sa = a.stars[x];
        const sb = a.stars[y];
        expect(sa).toBeDefined();
        expect(sb).toBeDefined();
        const cos =
          Math.sin(sa.dec) * Math.sin(sb.dec) +
          Math.cos(sa.dec) * Math.cos(sb.dec) * Math.cos(sa.ra - sb.ra);
        // No line stretches clean across the sky.
        expect(Math.acos(Math.max(-1, Math.min(1, cos)))).toBeLessThan(1.0);
      }
    }
    // No star belongs to two figures.
    const claimed = new Set<number>();
    for (const c of a.constellations) {
      for (const id of c.stars) {
        expect(claimed.has(id)).toBe(false);
        claimed.add(id);
      }
    }
  });
});

describe('the moon', () => {
  it('goes through a full cycle in a calendar month', () => {
    const a = sky();
    expect(a.moonPhase(0)).toBeCloseTo(0, 6);
    expect(a.moonPhase(SYNODIC_DAYS / 2)).toBeCloseTo(0.5, 6);
    expect(a.moonPhase(SYNODIC_DAYS)).toBeCloseTo(0, 6);
  });

  it('is dark when new and full when full, because of where it is', () => {
    const a = sky();
    expect(a.moonIllumination(0)).toBeCloseTo(0, 5);
    expect(a.moonIllumination(SYNODIC_DAYS / 2)).toBeCloseTo(1, 5);
    expect(a.moonIllumination(SYNODIC_DAYS / 4)).toBeCloseTo(0.5, 5);
  });

  it('names the phase it is actually in', () => {
    const a = sky();
    expect(a.moonPhaseName(0)).toBe('new');
    expect(a.moonPhaseName(SYNODIC_DAYS / 2)).toBe('full');
    expect(a.moonPhaseName(SYNODIC_DAYS / 4)).toBe('firstQuarter');
  });
});

describe('eclipses', () => {
  it('are rare, because the orbit is tilted', () => {
    const a = sky();
    const years = 20;
    const found = a.forecast(0, DAYS_PER_YEAR * years);
    const perYear = found.length / years;
    // A handful a year at most: they are events, not weather.
    expect(perYear).toBeGreaterThan(0);
    expect(perYear).toBeLessThan(6);
  });

  it('only happen at new or full moon', () => {
    const a = sky();
    for (const e of a.forecast(0, DAYS_PER_YEAR * 20)) {
      const phase = a.moonPhase(e.atDay);
      const nearNew = Math.min(phase, 1 - phase);
      const nearFull = Math.abs(phase - 0.5);
      if (e.kind === 'solar') expect(nearNew).toBeLessThan(0.06);
      else expect(nearFull).toBeLessThan(0.06);
    }
  });

  it('only happen when the moon is close to a node', () => {
    const a = sky();
    for (const e of a.forecast(0, DAYS_PER_YEAR * 20)) {
      expect(Math.abs(a.eclipticLatitude(e.atDay))).toBeLessThan(0.025);
    }
  });

  it('drift through the calendar instead of falling on the same day', () => {
    const a = sky();
    const found = a.forecast(0, DAYS_PER_YEAR * 30);
    if (found.length < 4) return;
    const daysOfYear = new Set(found.map((e) => Math.round(e.day % DAYS_PER_YEAR)));
    // If the nodes did not turn, every eclipse would land on the same dates.
    expect(daysOfYear.size).toBeGreaterThan(2);
  });

  it('are the same eclipses every time for the same world', () => {
    const a = sky('same');
    const b = sky('same');
    expect(a.forecast(0, DAYS_PER_YEAR * 10).map((e) => `${e.kind}${e.day}`)).toEqual(
      b.forecast(0, DAYS_PER_YEAR * 10).map((e) => `${e.kind}${e.day}`),
    );
  });
});

describe('meteor showers', () => {
  it('recur on the same days each year, because it is the same debris', () => {
    const a = sky();
    expect(a.showers.length).toBeGreaterThan(0);
    const time = new GameTime(0);

    for (const s of a.showers) {
      const rateOn = (day: number): number => {
        time.totalHours = day * 24 + 1;
        return a.at(time).meteorRate;
      };
      const peak = rateOn(s.peakDay);
      const nextYear = rateOn(s.peakDay + DAYS_PER_YEAR);
      const between = rateOn(s.peakDay + DAYS_PER_YEAR / 2);
      expect(peak).toBeGreaterThan(between);
      expect(nextYear).toBeCloseTo(peak, 4);
    }
  });

  it('leaves a background of a few sporadic ones the rest of the time', () => {
    const a = sky();
    const time = new GameTime(0);
    let quietest = Infinity;
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      time.totalHours = d * 24 + 1;
      quietest = Math.min(quietest, a.at(time).meteorRate);
    }
    expect(quietest).toBeGreaterThan(0);
    expect(quietest).toBeLessThan(5);
  });
});

describe('the sky as a calendar', () => {
  it('turns, so a different constellation is overhead as the year goes on', () => {
    const a = sky();
    const seen = new Set<string>();
    for (let d = 0; d < DAYS_PER_YEAR; d += 3) {
      const c = a.overhead(d);
      if (c) seen.add(c.name);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives everyone born in a year a sign, and not all the same one', () => {
    const a = sky();
    const signs = new Set<string>();
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      const c = a.signFor(d);
      if (c) signs.add(c.name);
    }
    expect(signs.size).toBeGreaterThan(2);
  });
});

describe('the world above the world', () => {
  it('is wired into the simulation and announces what it sees', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'skywatch' }));
    expect(world.astronomy.stars.length).toBeGreaterThan(1000);

    // Jump to a forecast eclipse and check the world notices it.
    const forecast = world.astronomy.forecast(0, DAYS_PER_YEAR * 6);
    if (forecast.length === 0) return;
    const target = forecast[0];
    world.time.totalHours = target.atDay * 24;
    // Enough ticks to cross an atmosphere step, which is where the sky is read.
    const ticks = Math.ceil(SECONDS_PER_GAME_HOUR / 2 / (1 / 15));
    for (let i = 0; i < ticks; i++) world.simulate(1 / 15);

    const announced = world.log
      .all()
      .some((e) => e.key === 'ev.solarEclipse' || e.key === 'ev.lunarEclipse');
    expect(announced).toBe(true);
  });

  it('remembers which eclipses it has already reported across a save', () => {
    const world = buildTestWorld();
    world.astronomy.update(world.time);
    if (world.astronomy.eclipses.length === 0) return;
    world.astronomy.eclipses[0].announced = true;

    const data = structuredClone(world.astronomy.serialize());
    const other = buildTestWorld();
    other.astronomy.update(other.time);
    other.astronomy.restore(data);
    expect(other.astronomy.eclipses[0].announced).toBe(true);
  });
});
