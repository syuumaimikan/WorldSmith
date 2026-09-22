/**
 * The world's long memory.
 *
 * The event log is what is happening: it holds the last few hundred things
 * and throws away the rest, which is right for a feed and useless for a
 * history. This is the other half — what a world still remembers about itself
 * after four hundred years.
 *
 * Three things are kept. An annal of what mattered, weighted so that a
 * founding, a war or a revolution survives while a finished roof does not.
 * A set of ages, named after what was going on in them, which the world works
 * out for itself from what was actually recorded rather than from a script.
 * And a series of snapshots of the map, so the borders can be watched moving.
 *
 * All three are bounded. When the annal fills it is thinned by importance,
 * and the far past thins first, because that is what remembering is.
 */

import { EventCategory, EventParams, WorldEvent } from './EventLog';
import { DAYS_PER_YEAR } from './Time';
import type { World } from './World';

/** What kind of time a stretch of years turned out to be. */
export type AgeKind =
  | 'founding'
  | 'growth'
  | 'war'
  | 'plague'
  | 'faith'
  | 'calamity'
  | 'collapse'
  | 'peace';

export interface Age {
  id: number;
  kind: AgeKind;
  /** A proper noun the age is remembered by: a people, a faith, a sickness. */
  subject: string;
  startDay: number;
  /** -1 while this is the age the world is still in. */
  endDay: number;
}

/** One thing worth still knowing about, long after the feed has forgotten it. */
export interface Annal {
  id: number;
  day: number;
  year: number;
  category: EventCategory;
  key: string;
  params?: EventParams;
  /** How much it mattered, 0..1. What survives a thinning. */
  weight: number;
  x?: number;
  z?: number;
}

/** The state of the world on one day, kept so the map can be wound back. */
export interface Snapshot {
  day: number;
  year: number;
  /** Who held each claim cell, at the nation grid's own resolution. */
  claims: Uint8Array;
  cells: number;
  /** Everyone alive in a polity. */
  population: number;
  /** The player's own settlers, who are simulated one by one. */
  settlers: number;
  nations: number;
  faiths: number;
  wars: number;
  meanTemperature: number;
  /** Enough to draw a key beside the map. */
  powers: { id: number; name: string; population: number; territory: number }[];
}

const MAX_ANNALS = 3000;
const THIN_TO = 2600;
const MAX_SNAPSHOTS = 140;
const SNAPSHOT_YEARS = 10;
const AGE_REVIEW_YEARS = 5;
/**
 * How long a stretch of time has to run before the world will call it
 * something else. Without this a decade of bad weather in the middle of two
 * centuries of quiet reads as three separate ages, which is a feed again.
 */
const MIN_AGE_YEARS = 15;
/** Nothing lighter than this is worth remembering for four centuries. */
const REMEMBER_ABOVE = 0.4;

/**
 * What a kind of event is worth to a history. A finished wall is the whole
 * point of the game and still does not belong in a chronicle of four hundred
 * years; the fall of a country does.
 */
const CATEGORY_WEIGHT: Record<EventCategory, number> = {
  construction: 0.1,
  production: 0.05,
  settlement: 0.5,
  weather: 0.05,
  people: 0.2,
  discovery: 0.35,
  economy: 0.1,
  warning: 0.05,
  history: 0.9,
  nature: 0.2,
  disaster: 0.45,
  politics: 0.8,
};

const KEY_WEIGHT: Record<string, number> = {
  'ev.founded': 1,
  'ev.promoted': 0.75,
  'ev.nationDissolved': 0.95,
  'ev.revolution': 0.9,
  'ev.civilWar': 0.95,
  'ev.civilWarWon': 0.92,
  'ev.civilWarLost': 0.8,
  'ev.warDeclared': 0.85,
  'ev.peaceVictory': 0.85,
  'ev.peaceDefeat': 0.85,
  'ev.peaceWhite': 0.7,
  'ev.citySacked': 0.85,
  'ev.battle': 0.55,
  'ev.siegeBegins': 0.6,
  'ev.siegeLifted': 0.5,
  'ev.sally': 0.45,
  'ev.uprising': 0.7,
  'ev.uprisingCrushed': 0.65,
  'ev.leaderDeposed': 0.7,
  'ev.leaderSucceeds': 0.5,
  'ev.treatyAlliance': 0.6,
  'ev.treatyBroken': 0.6,
  'ev.treatyTrade': 0.42,
  'ev.treatyNonAggression': 0.42,
  'ev.conversion': 0.7,
  'ev.schism': 0.8,
  'ev.faithLost': 0.7,
  'ev.outbreak': 0.75,
  'ev.outbreakEnds': 0.5,
  'ev.famine': 0.8,
  'ev.famineEnds': 0.5,
  'ev.researchDone': 0.45,
  'ev.settlersArrive': 0.42,
  'event.eruption': 0.85,
  'event.meteor': 0.85,
  'event.volcanoUnrest': 0.45,
  'event.buildingDestroyed': 0.42,
  'ev.hurricane': 0.55,
  'ev.diedOfHunger': 0.45,
  'ev.diedOfIllness': 0.45,
  // Weather. A century from now nobody remembers the funnel; they remember
  // the year the mill came down, which is its own entry.
  'ev.tornado': 0.3,
  'ev.tornadoEnds': 0,
  'ev.hurricaneEnds': 0,
  'event.flood': 0.35,
  'event.floodOver': 0,
  'event.ashfall': 0.2,
  'event.eruptionEnds': 0.3,
  'event.buildingDamaged': 0.1,
  // Loud, frequent, and not history.
  'ev.weatherTurns': 0,
  'ev.seasonArrives': 0,
  'ev.stageDone': 0,
  'ev.blueprint': 0,
  'ev.felled': 0,
};

/**
 * Some things are history or not depending on what they did. A tremor that
 * cracked nothing is not remembered for four hundred years; the one that
 * levelled a quarter of the settlement is, and the difference is in the event
 * itself rather than in a judgement made afterwards.
 */
const BY_CONSEQUENCE: Record<string, (p: EventParams | undefined) => number> = {
  'event.earthquake': (p) =>
    0.25 + Math.min(0.65, count(p, 'damaged') * 0.06 + count(p, 'destroyed') * 0.2),
  'ev.outbreakEnds': (p) => 0.25 + Math.min(0.55, count(p, 'deaths') * 0.06),
  // The sky does something every year. What gets written down is the day it
  // went dark, not the afternoon a bite was taken out of the sun.
  'ev.solarEclipse': (p) => (count(p, 'percent') >= 85 ? 0.65 : 0.2),
  'ev.lunarEclipse': (p) => (count(p, 'percent') >= 92 ? 0.45 : 0.15),
};

function count(p: EventParams | undefined, key: string): number {
  const v = p?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** What has been happening lately, which is what an age is made of. */
interface Tally {
  warDays: number;
  days: number;
  deaths: number;
  disasters: number;
  faithShifts: number;
  populationAtStart: number;
}

export class Chronicle {
  readonly annals: Annal[] = [];
  readonly ages: Age[] = [];
  readonly snapshots: Snapshot[] = [];

  private nextAnnalId = 1;
  private nextAgeId = 1;
  private lastSnapshotDay = -1e9;
  private lastReviewDay = -1e9;
  /** Where the world's running total of war days stood at the last look. */
  private lastWarDays = 0;
  private tally: Tally = {
    warDays: 0,
    days: 0,
    deaths: 0,
    disasters: 0,
    faithShifts: 0,
    populationAtStart: 0,
  };

  // =========================================================================
  // Taking it down
  // =========================================================================

  /**
   * Called for everything that happens. Most of it is not history; this is
   * where that is decided, once, rather than by a reader scrolling past it.
   */
  note(e: WorldEvent): void {
    const weight = weightOf(e);

    // One line decides both what is kept and what the years are counted as.
    // A funnel that touched down in an empty field is neither remembered nor
    // evidence that these were hard years.
    if (e.category === 'disaster' && weight >= REMEMBER_ABOVE) this.tally.disasters++;
    if (e.key === 'ev.conversion' || e.key === 'ev.schism') this.tally.faithShifts++;
    if (e.key === 'ev.diedOfHunger' || e.key === 'ev.diedOfIllness') this.tally.deaths++;

    if (weight < REMEMBER_ABOVE) return;

    this.annals.push({
      id: this.nextAnnalId++,
      day: e.day,
      year: e.year,
      category: e.category,
      key: e.key,
      params: e.params,
      weight,
      x: e.x,
      z: e.z,
    });
    if (this.annals.length > MAX_ANNALS) this.thin(e.day);
  }

  /**
   * Forgetting, done on purpose.
   *
   * What goes first is what mattered least, and of two things that mattered
   * equally the older one goes, because that is how a people's memory of
   * itself actually works.
   */
  private thin(now: number): void {
    const span = Math.max(1, now);
    const scored = this.annals.map((a) => ({
      a,
      score: a.weight + (a.day / span) * 0.15,
    }));
    scored.sort((x, y) => y.score - x.score || y.a.day - x.a.day);
    const keep = new Set(scored.slice(0, THIN_TO).map((s) => s.a.id));
    for (let i = this.annals.length - 1; i >= 0; i--) {
      if (!keep.has(this.annals[i].id)) this.annals.splice(i, 1);
    }
  }

  // =========================================================================
  // The turn of the ages
  // =========================================================================

  update(world: World, hours: number): void {
    const day = world.time.totalDays;
    const days = hours / 24;
    this.tally.days += days;
    // However coarsely the world is being stepped, this is the real number of
    // days there was a war on, not the number of times there happened to be
    // one when the chronicle looked.
    const warDays = world.diplomacy.warDays;
    this.tally.warDays += Math.max(0, warDays - this.lastWarDays);
    this.lastWarDays = warDays;

    if (this.ages.length === 0) {
      this.ages.push({
        id: this.nextAgeId++,
        kind: 'founding',
        // The player's own settlement, when the record opens with it. In an
        // ancient world it will not exist for another three hundred years, so
        // the first age belongs to whoever was actually the great power then.
        subject: world.nations.playerNation?.name ?? this.subjectFor(world, 'founding'),
        startDay: day,
        endDay: -1,
      });
      this.tally.populationAtStart = worldPopulation(world);
      this.tally.warDays = 0;
      this.lastReviewDay = day;
      this.lastSnapshotDay = day;
      this.snapshots.push(this.snapshot(world));
      return;
    }

    if (day - this.lastSnapshotDay >= DAYS_PER_YEAR * SNAPSHOT_YEARS) {
      this.lastSnapshotDay = day;
      this.snapshots.push(this.snapshot(world));
      if (this.snapshots.length > MAX_SNAPSHOTS) this.thinSnapshots();
    }

    if (day - this.lastReviewDay >= DAYS_PER_YEAR * AGE_REVIEW_YEARS) {
      this.review(world, day);
      this.lastReviewDay = day;
    }
  }

  /**
   * Decides what the last few years were, and whether they were a different
   * kind of time from the years before them.
   *
   * Nothing here is scheduled. An age of war is an age in which there was war;
   * if the world simply gets on with itself for three hundred years, that is
   * one long age and the chronicle says so.
   */
  private review(world: World, day: number): void {
    const t = this.tally;
    const population = worldPopulation(world);
    const before = Math.max(1, t.populationAtStart);
    const change = (population - before) / before;
    const warShare = t.days > 0 ? t.warDays / t.days : 0;

    let kind: AgeKind;
    if (change < -0.2) kind = 'collapse';
    else if (t.deaths > 6 && world.disease.outbreaks.some((o) => !o.over)) kind = 'plague';
    else if (warShare > 0.4) kind = 'war';
    else if (t.disasters >= 3) kind = 'calamity';
    else if (t.faithShifts >= 2) kind = 'faith';
    else if (change > 0.18) kind = 'growth';
    else kind = 'peace';

    const current = this.ages[this.ages.length - 1];
    if (current.kind !== kind && day - current.startDay >= DAYS_PER_YEAR * MIN_AGE_YEARS) {
      current.endDay = day;
      this.ages.push({
        id: this.nextAgeId++,
        kind,
        subject: this.subjectFor(world, kind),
        startDay: day,
        endDay: -1,
      });
    }

    this.tally = {
      warDays: 0,
      days: 0,
      deaths: 0,
      disasters: 0,
      faithShifts: 0,
      populationAtStart: population,
    };
  }

  /** What an age gets named after depends on what kind of age it was. */
  private subjectFor(world: World, kind: AgeKind): string {
    if (kind === 'plague') {
      const live = world.disease.outbreaks.find((o) => !o.over) ?? world.disease.outbreaks.at(-1);
      if (live) return live.name;
    }
    if (kind === 'faith') {
      let best = '';
      let most = 0;
      for (const r of world.culture.religions) {
        let held = 0;
        for (const hold of r.followers.values()) held += hold;
        if (held > most) {
          most = held;
          best = r.name;
        }
      }
      if (best) return best;
    }
    const strongest = [...world.nations.nations].sort((a, b) => b.population - a.population)[0];
    return strongest?.name ?? world.config.name;
  }

  // =========================================================================
  // The map, as it was
  // =========================================================================

  private snapshot(world: World): Snapshot {
    return {
      day: world.time.totalDays,
      year: world.time.snapshot().year,
      claims: new Uint8Array(world.nations.claims),
      cells: world.nations.cells,
      population: worldPopulation(world),
      settlers: world.npcs.length,
      nations: world.nations.nations.filter((n) => n.rebelAgainst === 0).length,
      faiths: world.culture.religions.length,
      wars: world.diplomacy.wars.length,
      meanTemperature: world.climate.meanTemperature(),
      powers: world.nations.nations
        .filter((n) => n.rebelAgainst === 0)
        .map((n) => ({
          id: n.id,
          name: n.name,
          population: Math.round(n.population),
          territory: n.territory,
        })),
    };
  }

  /**
   * When there are too many, the deep past is kept at half the resolution:
   * every other snapshot from the older half goes. The record gets vaguer the
   * further back it reaches, and never stops reaching.
   */
  private thinSnapshots(): void {
    const half = Math.floor(this.snapshots.length / 2);
    for (let i = half - 1; i >= 1; i -= 2) this.snapshots.splice(i, 1);
  }

  // =========================================================================
  // Readouts
  // =========================================================================

  /** The age the world is in now. */
  currentAge(): Age | null {
    return this.ages[this.ages.length - 1] ?? null;
  }

  /** Everything the world still remembers from within one age. */
  annalsOf(age: Age): Annal[] {
    const end = age.endDay < 0 ? Number.POSITIVE_INFINITY : age.endDay;
    return this.annals.filter((a) => a.day >= age.startDay && a.day < end);
  }

  /** The snapshot nearest a given day, for winding the map back to it. */
  snapshotNear(day: number): Snapshot | null {
    let best: Snapshot | null = null;
    let gap = Number.POSITIVE_INFINITY;
    for (const s of this.snapshots) {
      const d = Math.abs(s.day - day);
      if (d < gap) {
        gap = d;
        best = s;
      }
    }
    return best;
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  serialize(): Record<string, unknown> {
    return {
      annals: this.annals.map((a) => ({ ...a })),
      ages: this.ages.map((a) => ({ ...a })),
      snapshots: this.snapshots.map((s) => ({
        ...s,
        claims: Array.from(s.claims),
        powers: s.powers.map((p) => ({ ...p })),
      })),
      lastSnapshotDay: this.lastSnapshotDay,
      lastReviewDay: this.lastReviewDay,
      lastWarDays: this.lastWarDays,
      tally: { ...this.tally },
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    this.annals.length = 0;
    this.ages.length = 0;
    this.snapshots.length = 0;

    const num = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const str = (v: unknown, max: number): string =>
      typeof v === 'string' ? v.slice(0, max) : '';

    const kinds: AgeKind[] = [
      'founding',
      'growth',
      'war',
      'plague',
      'faith',
      'calamity',
      'collapse',
      'peace',
    ];

    if (Array.isArray(data.ages)) {
      for (const raw of (data.ages as Record<string, unknown>[]).slice(0, 400)) {
        if (!raw || typeof raw !== 'object') continue;
        this.ages.push({
          id: Math.max(1, Math.round(num(raw.id, this.nextAgeId))),
          kind: kinds.includes(raw.kind as AgeKind) ? (raw.kind as AgeKind) : 'peace',
          subject: str(raw.subject, 80) || 'Unnamed',
          startDay: Math.max(0, num(raw.startDay, 0)),
          endDay: num(raw.endDay, -1),
        });
      }
    }

    if (Array.isArray(data.annals)) {
      for (const raw of (data.annals as Record<string, unknown>[]).slice(0, MAX_ANNALS)) {
        if (!raw || typeof raw !== 'object') continue;
        const key = str(raw.key, 64);
        if (!key) continue;
        this.annals.push({
          id: Math.max(1, Math.round(num(raw.id, this.nextAnnalId))),
          day: Math.max(0, num(raw.day, 0)),
          year: Math.max(0, Math.round(num(raw.year, 1))),
          category: (raw.category as EventCategory) in CATEGORY_WEIGHT
            ? (raw.category as EventCategory)
            : 'settlement',
          key,
          params: readParams(raw.params),
          weight: Math.min(1, Math.max(0, num(raw.weight, 0.5))),
          x: typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : undefined,
          z: typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : undefined,
        });
      }
    }

    if (Array.isArray(data.snapshots)) {
      for (const raw of (data.snapshots as Record<string, unknown>[]).slice(0, MAX_SNAPSHOTS)) {
        if (!raw || typeof raw !== 'object') continue;
        const cells = Math.round(num(raw.cells, 48));
        if (cells < 1 || cells > 256) continue;
        const claims = readClaims(raw.claims, cells * cells);
        if (!claims) continue;
        this.snapshots.push({
          day: Math.max(0, num(raw.day, 0)),
          year: Math.max(0, Math.round(num(raw.year, 1))),
          claims,
          cells,
          population: Math.max(0, num(raw.population, 0)),
          settlers: Math.max(0, Math.round(num(raw.settlers, 0))),
          nations: Math.max(0, Math.round(num(raw.nations, 0))),
          faiths: Math.max(0, Math.round(num(raw.faiths, 0))),
          wars: Math.max(0, Math.round(num(raw.wars, 0))),
          meanTemperature: num(raw.meanTemperature, 10),
          powers: (Array.isArray(raw.powers) ? raw.powers : [])
            .filter((p: unknown): p is Record<string, unknown> => !!p && typeof p === 'object')
            .slice(0, 64)
            .map((p) => ({
              id: Math.max(0, Math.round(num(p.id, 0))),
              name: str(p.name, 80) || 'Unnamed',
              population: Math.max(0, Math.round(num(p.population, 0))),
              territory: Math.max(0, Math.round(num(p.territory, 0))),
            })),
        });
      }
    }

    for (const a of this.ages) this.nextAgeId = Math.max(this.nextAgeId, a.id + 1);
    for (const a of this.annals) this.nextAnnalId = Math.max(this.nextAnnalId, a.id + 1);
    this.lastSnapshotDay = num(data.lastSnapshotDay, -1e9);
    this.lastReviewDay = num(data.lastReviewDay, -1e9);
    this.lastWarDays = Math.max(0, num(data.lastWarDays, 0));

    const raw = (data.tally ?? {}) as Record<string, unknown>;
    this.tally = {
      warDays: Math.max(0, num(raw.warDays, 0)),
      days: Math.max(0, num(raw.days, 0)),
      deaths: Math.max(0, num(raw.deaths, 0)),
      disasters: Math.max(0, num(raw.disasters, 0)),
      faithShifts: Math.max(0, num(raw.faithShifts, 0)),
      populationAtStart: Math.max(0, num(raw.populationAtStart, 0)),
    };
  }
}

function weightOf(e: WorldEvent): number {
  const byConsequence = BY_CONSEQUENCE[e.key];
  if (byConsequence !== undefined) return byConsequence(e.params);
  const byKey = KEY_WEIGHT[e.key];
  if (byKey !== undefined) return byKey;
  if (e.literal) return 0.9;
  return CATEGORY_WEIGHT[e.category] ?? 0.2;
}

function worldPopulation(world: World): number {
  let n = 0;
  for (const nation of world.nations.nations) {
    if (nation.rebelAgainst !== 0) continue;
    n += nation.population;
  }
  return n;
}

/** Save data is outside the program, so params come back as strings or numbers or not at all. */
function readParams(raw: unknown): EventParams | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: EventParams = {};
  let any = false;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.length > 32) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else continue;
    any = true;
  }
  return any ? out : undefined;
}

function readClaims(raw: unknown, length: number): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw.length === length ? new Uint8Array(raw) : null;
  if (!Array.isArray(raw) || raw.length !== length) return null;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const v = raw[i];
    out[i] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(255, v | 0)) : 0;
  }
  return out;
}
