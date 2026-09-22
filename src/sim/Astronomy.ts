/**
 * The sky above the world.
 *
 * Everything here is geometry rather than decoration. The moon is on an orbit
 * with a tilt, so its phase follows from where it actually is relative to the
 * sun, and an eclipse happens when it is genuinely in line — which is rare,
 * because the orbit is tilted, and which drifts from year to year, because the
 * orbit's nodes turn. Meteor showers recur because the world passes through
 * the same streams of debris each year, on the same days.
 *
 * The stars are fixed and catalogued once from the seed: the same sky every
 * night, which is the whole point of a sky people can navigate by, name and
 * build a calendar on. Constellations are drawn from the bright ones and named
 * in the world's own language, and what people believe about them is a thing
 * the culture holds rather than a fact about the universe.
 */

import { Rng, hashString } from '../core/rng';
import { clamp01, TAU } from '../core/math';
import { DAYS_PER_YEAR, DAYS_PER_MONTH, GameTime } from './Time';
import type { Namer } from './Naming';

/**
 * A lunar cycle, in days. Close to a calendar month, so the months are still
 * recognisably the moons, but deliberately not a whole number of days: an
 * exact five would put every new moon at the stroke of midnight, which would
 * mean no solar eclipse could ever be seen from the daylit side of the world.
 * The small mismatch is also why a lunar count and a solar year drift apart,
 * as they do for every people who have tried to reconcile the two.
 */
export const SYNODIC_DAYS = DAYS_PER_MONTH + 0.19;

/**
 * How long the moon's orbital nodes take to turn all the way round. Because
 * this is not a whole number of years, eclipse seasons drift through the
 * calendar instead of falling on the same date for ever.
 */
const NODE_PERIOD_DAYS = 313;

/** Tilt of the moon's orbit, in radians. Small, which is why eclipses are rare. */
const ORBIT_TILT = 0.09;

/** Angular radius of the sun and moon discs as seen from the ground. */
const DISC_RADIUS = 0.0095;

export interface Star {
  id: number;
  /** Right ascension, radians, 0..TAU. */
  ra: number;
  /** Declination, radians, -PI/2..PI/2. */
  dec: number;
  /** Apparent magnitude: lower is brighter, as astronomers have it. */
  magnitude: number;
  /** 0 = red, 1 = blue-white. */
  colour: number;
  /** True for the dense band of the galaxy. */
  inMilkyWay: boolean;
}

export interface Constellation {
  id: number;
  name: string;
  /** Indices into the star catalogue. */
  stars: number[];
  /** Pairs of star indices to draw a line between. */
  lines: [number, number][];
  /** What this world's people say it is. */
  loreKey: string;
  /** The part of life it is held to govern, for astrology. */
  domain: string;
  /** Centre of the figure, for pointing at it. */
  ra: number;
  dec: number;
}

export type EclipseKind = 'solar' | 'lunar';

export interface Eclipse {
  kind: EclipseKind;
  /** Whole day it falls on, for the calendar. */
  day: number;
  /**
   * The moment it peaks, in fractional days. The moon moves a fifth of its
   * cycle in a day, so rounding this to the nearest sunrise would put the
   * alignment somewhere it never was.
   */
  atDay: number;
  /** 0..1 how complete it is. */
  magnitude: number;
  /** Set once the world has been told. */
  announced: boolean;
}

export interface MeteorShower {
  id: number;
  name: string;
  /** Day of the year the world passes closest to the stream. */
  peakDay: number;
  /** Days either side that it is visible at all. */
  spread: number;
  /** Meteors an hour at the peak. */
  peakRate: number;
  /** Constellation the trails appear to come from. */
  radiant: number;
}

export interface SkyMoment {
  /** 0 new, 0.5 full, 1 new again. */
  moonPhase: number;
  /** 0..1 how much of the disc is lit. */
  moonIllumination: number;
  /** Radians above the horizon; negative means it is down. */
  moonAltitude: number;
  moonAzimuth: number;
  sunAltitude: number;
  sunAzimuth: number;
  /** An eclipse happening right now, or null. */
  eclipse: { kind: EclipseKind; magnitude: number } | null;
  /** Meteors an hour right now. */
  meteorRate: number;
  /** The shower responsible, if any. */
  shower: MeteorShower | null;
}

const MOON_PHASE_NAMES = [
  'new',
  'waxingCrescent',
  'firstQuarter',
  'waxingGibbous',
  'full',
  'waningGibbous',
  'lastQuarter',
  'waningCrescent',
] as const;

export type MoonPhaseName = (typeof MOON_PHASE_NAMES)[number];

const DOMAINS = [
  'harvest',
  'travel',
  'war',
  'love',
  'death',
  'craft',
  'storm',
  'birth',
  'luck',
  'memory',
];

const LORE_KEYS = [
  'sky.lore.hunter',
  'sky.lore.ferryman',
  'sky.lore.weaver',
  'sky.lore.serpent',
  'sky.lore.crown',
  'sky.lore.hound',
  'sky.lore.plough',
  'sky.lore.sisters',
  'sky.lore.forge',
  'sky.lore.wanderer',
];

export class Astronomy {
  readonly stars: Star[] = [];
  readonly constellations: Constellation[] = [];
  readonly showers: MeteorShower[] = [];
  /** Eclipses already worked out, soonest first. */
  readonly eclipses: Eclipse[] = [];

  /** Pole of the galactic band, which is what makes the Milky Way a band. */
  readonly galacticPole: { ra: number; dec: number };

  /** The world's latitude, which decides which stars ever rise. */
  private latitude: number;
  private rng: Rng;
  private lastCheckedDay = -1;

  constructor(seed: number, namer: Namer, latitude = 0.62) {
    this.rng = new Rng(seed ^ 0x57a1);
    this.latitude = latitude;
    this.galacticPole = {
      ra: this.rng.range(0, TAU),
      dec: this.rng.range(-0.6, 0.6),
    };

    this.buildStars();
    this.buildConstellations(namer);
    this.buildShowers(namer);
  }

  // =======================================================================
  // The fixed sky
  // =======================================================================

  private buildStars(): void {
    const COUNT = 2400;
    for (let i = 0; i < COUNT; i++) {
      const ra = this.rng.range(0, TAU);
      // Uniform on the sphere, not uniform in declination, or the poles crowd.
      const dec = Math.asin(this.rng.range(-1, 1));

      // How far this star is from the galactic plane decides whether it is
      // part of the band. Stars near the plane are dimmer and more numerous.
      const fromPlane = Math.abs(
        angularDistance(ra, dec, this.galacticPole.ra, this.galacticPole.dec) - Math.PI / 2,
      );
      const inMilkyWay = fromPlane < 0.22;

      // Magnitudes follow a steep distribution: a handful of bright stars and
      // a great many faint ones, which is what makes a sky look deep.
      const roll = this.rng.next();
      let magnitude = 1.2 + Math.pow(roll, 0.35) * 5.2;
      if (inMilkyWay) magnitude += 0.9;

      this.stars.push({
        id: i,
        ra,
        dec,
        magnitude,
        // Bright stars skew blue-white, faint ones red, as real ones do.
        colour: clamp01(this.rng.stat(0.55 - (magnitude - 3) * 0.06, 0.22, 0, 1)),
        inMilkyWay,
      });
    }

    // A denser dust along the band itself, too faint to resolve individually.
    for (let i = 0; i < 1800; i++) {
      const alongPlane = this.rng.range(0, TAU);
      const offset = this.rng.gaussian() * 0.11;
      const point = pointOnGreatCircle(this.galacticPole, alongPlane, offset);
      this.stars.push({
        id: this.stars.length,
        ra: point.ra,
        dec: point.dec,
        magnitude: 6.2 + this.rng.range(0, 1.4),
        colour: clamp01(0.45 + this.rng.gaussian() * 0.12),
        inMilkyWay: true,
      });
    }
  }

  /**
   * Groups the brightest stars into figures.
   *
   * Real constellations are not drawn from all the stars but from the ones
   * people can actually see, so this starts from the bright ones and walks to
   * the nearest unused neighbour, which produces figures that hang together
   * the way an eye would join them.
   */
  private buildConstellations(namer: Namer): void {
    const bright = this.stars
      .filter((s) => s.magnitude < 3.1 && !s.inMilkyWay)
      .sort((a, b) => a.magnitude - b.magnitude);
    const used = new Set<number>();

    for (const seed of bright) {
      if (this.constellations.length >= 14) break;
      if (used.has(seed.id)) continue;

      const members: Star[] = [seed];
      used.add(seed.id);
      const wanted = this.rng.int(4, 8);

      // Walk outward to the nearest unused bright star each time.
      while (members.length < wanted) {
        const from = members[members.length - 1];
        let best: Star | null = null;
        let bestD = 0.55; // a figure has to fit in a patch of sky
        for (const candidate of bright) {
          if (used.has(candidate.id)) continue;
          const d = angularDistance(from.ra, from.dec, candidate.ra, candidate.dec);
          if (d < bestD) {
            bestD = d;
            best = candidate;
          }
        }
        if (!best) break;
        used.add(best.id);
        members.push(best);
      }

      if (members.length < 4) continue;

      const lines: [number, number][] = [];
      for (let i = 1; i < members.length; i++) lines.push([members[i - 1].id, members[i].id]);
      // A closing line turns a chain into a shape, but only when the two ends
      // are near enough that an eye would actually join them.
      const first = members[0];
      const last = members[members.length - 1];
      if (
        members.length >= 5 &&
        angularDistance(first.ra, first.dec, last.ra, last.dec) < 0.55 &&
        this.rng.chance(0.45)
      ) {
        lines.push([last.id, first.id]);
      }

      const id = this.constellations.length;
      this.constellations.push({
        id,
        name: namer.skyName(`constellation${id}`),
        stars: members.map((m) => m.id),
        lines,
        loreKey: LORE_KEYS[id % LORE_KEYS.length],
        domain: DOMAINS[this.rng.int(0, DOMAINS.length - 1)],
        ra: circularMean(members.map((m) => m.ra)),
        dec: members.reduce((s, m) => s + m.dec, 0) / members.length,
      });
    }
  }

  private buildShowers(namer: Namer): void {
    const count = this.rng.int(2, 4);
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let peakDay = this.rng.int(0, DAYS_PER_YEAR - 1);
      let guard = 0;
      while (used.has(peakDay) && guard++ < 40) peakDay = this.rng.int(0, DAYS_PER_YEAR - 1);
      used.add(peakDay);
      const radiant =
        this.constellations.length > 0 ? this.rng.int(0, this.constellations.length - 1) : 0;
      this.showers.push({
        id: i,
        name:
          this.constellations[radiant]?.name ?? namer.skyName(`shower${i}`),
        peakDay,
        spread: this.rng.range(1.2, 3.5),
        peakRate: this.rng.range(14, 90),
        radiant,
      });
    }
  }

  // =======================================================================
  // Where things are tonight
  // =======================================================================

  /** The moon's phase, 0 new through 0.5 full and back to 1. */
  moonPhase(totalDays: number): number {
    return (totalDays / SYNODIC_DAYS) % 1;
  }

  moonPhaseName(totalDays: number): MoonPhaseName {
    const p = this.moonPhase(totalDays);
    const index = Math.round(p * 8) % 8;
    return MOON_PHASE_NAMES[index];
  }

  /** Fraction of the moon's disc that is lit. */
  moonIllumination(totalDays: number): number {
    return (1 - Math.cos(this.moonPhase(totalDays) * TAU)) / 2;
  }

  /**
   * Where the moon is in its orbit relative to the nodes. Near zero is where
   * the sun, the world and the moon can line up.
   */
  private nodeAngle(totalDays: number): number {
    const moonLongitude = (totalDays / SYNODIC_DAYS) * TAU;
    const node = -(totalDays / NODE_PERIOD_DAYS) * TAU;
    return moonLongitude - node;
  }

  /** How far the moon sits off the line of the sun, in radians. */
  eclipticLatitude(totalDays: number): number {
    return ORBIT_TILT * Math.sin(this.nodeAngle(totalDays));
  }

  /**
   * Reads the sky at a moment: where the sun and moon are, whether anything is
   * eclipsing, and how many meteors an hour are falling.
   */
  at(time: GameTime): SkyMoment {
    const snap = time.snapshot();
    const totalDays = snap.totalHours / 24;

    // The sun goes round once a day; the moon lags a little each day, which
    // is why it rises later and later and why its phase changes at all.
    const sunAngle = (snap.timeOfDay - 0.25) * TAU;
    const sunAltitude = Math.sin(sunAngle);
    const phase = this.moonPhase(totalDays);
    const moonAngle = sunAngle - phase * TAU;
    const latitude = this.eclipticLatitude(totalDays);

    const eclipse = this.eclipseNow(totalDays, snap.timeOfDay);

    const doy = totalDays % DAYS_PER_YEAR;
    let meteorRate = 0.6; // there are always a few
    let shower: MeteorShower | null = null;
    for (const s of this.showers) {
      const gap = Math.min(
        Math.abs(doy - s.peakDay),
        DAYS_PER_YEAR - Math.abs(doy - s.peakDay),
      );
      if (gap > s.spread) continue;
      const strength = Math.exp(-(gap * gap) / (2 * (s.spread * 0.45) ** 2));
      const rate = s.peakRate * strength;
      if (rate > meteorRate) {
        meteorRate = rate;
        shower = s;
      }
    }

    return {
      moonPhase: phase,
      moonIllumination: this.moonIllumination(totalDays),
      moonAltitude: Math.sin(moonAngle) + latitude,
      moonAzimuth: moonAngle,
      sunAltitude,
      sunAzimuth: sunAngle,
      eclipse,
      meteorRate,
      shower,
    };
  }

  /**
   * An eclipse is not scheduled. The moon has to be new or full AND close
   * enough to a node that the three bodies are actually in line.
   */
  private eclipseNow(
    totalDays: number,
    timeOfDay: number,
  ): { kind: EclipseKind; magnitude: number } | null {
    const phase = this.moonPhase(totalDays);
    const latitude = Math.abs(this.eclipticLatitude(totalDays));
    if (latitude > DISC_RADIUS * 2.4) return null;

    const nearNew = Math.min(phase, 1 - phase);
    const nearFull = Math.abs(phase - 0.5);

    // How exactly aligned, 1 = dead centre.
    const alignment = 1 - latitude / (DISC_RADIUS * 2.4);

    if (nearNew < 0.035) {
      // A solar eclipse is only visible from where the sun is up.
      if (timeOfDay < 0.25 || timeOfDay > 0.78) return null;
      const closeness = 1 - nearNew / 0.035;
      return { kind: 'solar', magnitude: clamp01(alignment * closeness) };
    }
    if (nearFull < 0.035) {
      if (timeOfDay > 0.24 && timeOfDay < 0.76) return null; // the moon is down
      const closeness = 1 - nearFull / 0.035;
      return { kind: 'lunar', magnitude: clamp01(alignment * closeness) };
    }
    return null;
  }

  /**
   * Looks ahead for eclipses so the world can know one is coming, the way a
   * people who watch the sky carefully would.
   */
  forecast(fromDay: number, days = DAYS_PER_YEAR * 4): Eclipse[] {
    const found: Eclipse[] = [];
    for (let d = Math.floor(fromDay); d < fromDay + days; d++) {
      // Check a handful of moments through the day.
      for (let k = 0; k < 8; k++) {
        const timeOfDay = k / 8;
        const e = this.eclipseNow(d + timeOfDay, timeOfDay);
        if (!e || e.magnitude < 0.25) continue;
        const already = found.find((f) => f.day === d && f.kind === e.kind);
        if (already) {
          // Several samples can catch the same eclipse; keep the deepest.
          if (e.magnitude > already.magnitude) {
            already.magnitude = e.magnitude;
            already.atDay = d + timeOfDay;
          }
          continue;
        }
        found.push({
          kind: e.kind,
          day: d,
          atDay: d + timeOfDay,
          magnitude: e.magnitude,
          announced: false,
        });
      }
    }
    return found;
  }

  /** Refreshes the forecast once a day and returns anything newly due. */
  update(time: GameTime): void {
    const day = time.totalDays;
    if (day === this.lastCheckedDay) return;
    this.lastCheckedDay = day;
    if (this.eclipses.length === 0 || this.eclipses[this.eclipses.length - 1].day < day + 40) {
      const fresh = this.forecast(day, DAYS_PER_YEAR * 4);
      for (const e of fresh) {
        if (this.eclipses.some((x) => x.day === e.day && x.kind === e.kind)) continue;
        this.eclipses.push(e);
      }
      this.eclipses.sort((a, b) => a.day - b.day);
    }
    // Forget what is long past.
    while (this.eclipses.length > 0 && this.eclipses[0].day < day - 2) this.eclipses.shift();
  }

  /** The next eclipse of either kind, or null if none is forecast. */
  nextEclipse(day: number): Eclipse | null {
    return this.eclipses.find((e) => e.day >= day) ?? null;
  }

  /** The next meteor shower, and how many days until it peaks. */
  nextShower(day: number): { shower: MeteorShower; inDays: number } | null {
    let best: { shower: MeteorShower; inDays: number } | null = null;
    const doy = day % DAYS_PER_YEAR;
    for (const s of this.showers) {
      let gap = s.peakDay - doy;
      if (gap < 0) gap += DAYS_PER_YEAR;
      if (!best || gap < best.inDays) best = { shower: s, inDays: gap };
    }
    return best;
  }

  /**
   * Which constellation is overhead at a moment. The sky turns once a day and
   * once a year, so this is what a calendar built on the stars would read.
   */
  overhead(totalDays: number): Constellation | null {
    if (this.constellations.length === 0) return null;
    const siderealAngle = ((totalDays * (1 + 1 / DAYS_PER_YEAR)) % 1) * TAU;
    let best: Constellation | null = null;
    let bestGap = Infinity;
    for (const c of this.constellations) {
      let gap = Math.abs(wrapAngle(c.ra - siderealAngle));
      gap += Math.abs(c.dec - this.latitude) * 0.5;
      if (gap < bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    return best;
  }

  /**
   * The sign someone born on a given day is held to have been born under.
   * The astronomy is real; what it is taken to mean is culture.
   */
  signFor(totalDays: number): Constellation | null {
    if (this.constellations.length === 0) return null;
    const index =
      Math.floor(((totalDays % DAYS_PER_YEAR) / DAYS_PER_YEAR) * this.constellations.length) %
      this.constellations.length;
    return this.constellations[index];
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  /**
   * Only what has been noticed needs saving. The sky itself is rebuilt from
   * the seed, so a saved world has exactly the sky it had before.
   */
  serialize(): Record<string, unknown> {
    return {
      announced: this.eclipses.filter((e) => e.announced).map((e) => `${e.kind}:${e.day}`),
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data || !Array.isArray(data.announced)) return;
    const seen = new Set(
      (data.announced as unknown[]).filter((v): v is string => typeof v === 'string'),
    );
    for (const e of this.eclipses) {
      if (seen.has(`${e.kind}:${e.day}`)) e.announced = true;
    }
  }
}

// ------------------------------------------------------------------ helpers

function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const cos =
    Math.sin(dec1) * Math.sin(dec2) +
    Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** A point at `offset` radians from the great circle whose pole is given. */
function pointOnGreatCircle(
  pole: { ra: number; dec: number },
  along: number,
  offset: number,
): { ra: number; dec: number } {
  // Build an orthonormal frame around the pole and walk round its equator.
  const p = toVector(pole.ra, pole.dec);
  const ref = Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalise(cross(ref, p));
  const v = cross(p, u);
  const c = Math.cos(offset);
  const s = Math.sin(offset);
  const point: [number, number, number] = [
    (u[0] * Math.cos(along) + v[0] * Math.sin(along)) * c + p[0] * s,
    (u[1] * Math.cos(along) + v[1] * Math.sin(along)) * c + p[1] * s,
    (u[2] * Math.cos(along) + v[2] * Math.sin(along)) * c + p[2] * s,
  ];
  return fromVector(point);
}

function toVector(ra: number, dec: number): [number, number, number] {
  return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra)];
}

function fromVector(v: [number, number, number]): { ra: number; dec: number } {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const dec = Math.asin(Math.max(-1, Math.min(1, v[1] / len)));
  let ra = Math.atan2(v[2], v[0]);
  if (ra < 0) ra += TAU;
  return { ra, dec };
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalise(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

function circularMean(angles: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let mean = Math.atan2(sy, sx);
  if (mean < 0) mean += TAU;
  return mean;
}

/** Stable key for a constellation, so lore can be looked up by it. */
export function constellationKey(c: Constellation): number {
  return hashString(c.name);
}
