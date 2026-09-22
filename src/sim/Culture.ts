/**
 * What a people believe, and what they hold worth doing.
 *
 * A religion here is not a label on a nation. It begins somewhere, in one
 * place, built out of what those people could actually see — the figures they
 * named in their own sky and the things those figures were said to govern. It
 * spreads along the routes goods and armies already travel, which is why a
 * trading partner's faith arrives long before a distant stranger's. It splits
 * when its followers end up on opposite sides of a war for long enough that
 * they stop recognising each other's version of it. And it dies out when the
 * last people who held it are gone.
 *
 * Culture works the same way: a set of things a people value, inherited when
 * they split off from someone else and drifting apart afterwards, with real
 * effects on how they govern, fight and get along.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import { DAYS_PER_YEAR } from './Time';
import type { World } from './World';
import type { Nation } from './Nations';
import type { Namer } from './Naming';
import type { Constellation } from './Astronomy';

/** The things a people can hold worth doing. Each 0..1. */
export interface Values {
  honour: number;
  industry: number;
  piety: number;
  freedom: number;
  hospitality: number;
  martial: number;
}

export type ValueId = keyof Values;

export const VALUE_IDS: ValueId[] = [
  'honour',
  'industry',
  'piety',
  'freedom',
  'hospitality',
  'martial',
];

export interface Culture {
  id: number;
  name: string;
  values: Values;
  /**
   * What these people were like when they began. History moves a culture, but
   * it moves it away from somewhere: without this every people in the world
   * would converge on whatever the current century happens to reward.
   */
  origin: Values;
  /** The culture this one grew out of, or 0. */
  parent: number;
  foundedDay: number;
}

export type FaithKind = 'animist' | 'ancestral' | 'polytheist' | 'monotheist';

export interface Deity {
  name: string;
  /** The constellation this figure is seen in, if any. */
  constellation: number;
  /** What they are held to govern. */
  domain: string;
}

export type TenetId =
  | 'sacrifice'
  | 'pilgrimage'
  | 'charity'
  | 'crusade'
  | 'asceticism'
  | 'scholarship';

export interface TenetDef {
  id: TenetId;
  /** What holding it does to unrest each year. Negative calms. */
  unrest: number;
  /** Multiplier on how readily the faith spreads. */
  zeal: number;
  /** Multiplier on how many soldiers the faithful will field. */
  levy: number;
  /** What it does to opinion of those who do not share it. */
  tolerance: number;
}

export const TENETS: Record<TenetId, TenetDef> = {
  sacrifice: { id: 'sacrifice', unrest: 0.02, zeal: 1.15, levy: 1.1, tolerance: -0.25 },
  pilgrimage: { id: 'pilgrimage', unrest: -0.03, zeal: 1.35, levy: 0.95, tolerance: 0.1 },
  charity: { id: 'charity', unrest: -0.08, zeal: 1.1, levy: 0.9, tolerance: 0.25 },
  crusade: { id: 'crusade', unrest: 0.04, zeal: 1.25, levy: 1.35, tolerance: -0.5 },
  asceticism: { id: 'asceticism', unrest: -0.02, zeal: 0.9, levy: 1, tolerance: 0.05 },
  scholarship: { id: 'scholarship', unrest: -0.04, zeal: 1.05, levy: 0.9, tolerance: 0.3 },
};

export interface Religion {
  id: number;
  name: string;
  /** The root word the faith is named for. A sect inherits it. */
  stem: string;
  kind: FaithKind;
  deities: Deity[];
  tenets: Set<TenetId>;
  foundedDay: number;
  /** Where it began, in world metres. Pilgrimages go here. */
  holyX: number;
  holyZ: number;
  /** The faith this one split from, or 0. */
  schismOf: number;
  /** Day this faith last broke in two, so it does not do it every decade. */
  lastSchismDay: number;
  /** Nation ids that have adopted it, to how strongly, 0..1. */
  followers: Map<number, number>;
}

/** "The Ashkur" -> "Ashkur". Names carry articles; stems do not. */
function lastWord(name: string): string {
  const parts = name.split(' ');
  return parts[parts.length - 1] ?? name;
}

/** Game hours between culture and faith updates. These move over generations. */
const STEP_HOURS = 24 * 5;

export class CultureSystem {
  readonly cultures: Culture[] = [];
  readonly religions: Religion[] = [];
  /** Which culture and faith each nation holds. */
  readonly cultureOf = new Map<number, number>();
  readonly faithOf = new Map<number, number>();

  private rng: Rng;
  private namer: Namer;
  private nextCultureId = 1;
  private nextReligionId = 1;
  private pending = 0;

  constructor(seed: number, namer: Namer) {
    this.rng = new Rng(seed ^ 0xc017);
    this.namer = namer;
  }

  // =======================================================================
  // Founding
  // =======================================================================

  /**
   * Gives every nation in the world a culture and a faith of its own.
   *
   * The faiths are built out of the constellations those people named, which
   * is why every world's religions are about different things: a sky with a
   * ferryman in it produces a people who think hard about death.
   */
  seed(world: World): void {
    for (const nation of world.nations.nations) {
      if (this.cultureFor(nation.id)) continue;
      const culture = this.makeCulture(nation, 0, world.time.totalDays);
      this.cultures.push(culture);
      this.cultureOf.set(nation.id, culture.id);

      const religion = this.makeReligion(world, nation, null);
      this.religions.push(religion);
      religion.followers.set(nation.id, this.rng.range(0.55, 0.95));
      this.faithOf.set(nation.id, religion.id);
    }
  }

  /**
   * Nations that appeared after the world was founded -- neighbours that
   * settled later, factions that broke away -- need a people and a faith too.
   * A faction takes both from the country it rose against, because that is
   * where it came from: a civil war is not fought between strangers.
   */
  private ensureCultures(world: World): void {
    for (const nation of world.nations.nations) {
      const parent = nation.rebelAgainst !== 0 ? world.nations.byId(nation.rebelAgainst) : null;

      if (!this.cultureFor(nation.id)) {
        const inherited = parent ? this.cultureOf.get(parent.id) : undefined;
        if (inherited !== undefined) {
          this.cultureOf.set(nation.id, inherited);
        } else {
          const culture = this.makeCulture(nation, 0, world.time.totalDays);
          this.cultures.push(culture);
          this.cultureOf.set(nation.id, culture.id);
        }
      }

      if (this.faithFor(nation.id)) continue;
      // Whatever these people already mostly believe, if they believe anything.
      const held = this.strongestFaith(nation.id);
      const inheritedFaith = held ?? (parent ? this.faithFor(parent.id) : null);
      if (inheritedFaith) {
        if (!inheritedFaith.followers.has(nation.id)) {
          const share = parent ? (inheritedFaith.followers.get(parent.id) ?? 0.6) : 0.6;
          inheritedFaith.followers.set(nation.id, share);
        }
        this.faithOf.set(nation.id, inheritedFaith.id);
      } else {
        const religion = this.makeReligion(world, nation, null);
        this.religions.push(religion);
        religion.followers.set(nation.id, this.rng.range(0.4, 0.8));
        this.faithOf.set(nation.id, religion.id);
      }
    }
  }

  private makeCulture(nation: Nation, parent: number, day: number): Culture {
    const values: Values = {
      honour: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
      industry: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
      piety: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
      freedom: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
      hospitality: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
      martial: clamp01(this.rng.stat(0.5, 0.22, 0, 1)),
    };
    return {
      id: this.nextCultureId++,
      name: this.namer.cultureName(`${this.nextCultureId}:${nation.id}`),
      values,
      origin: { ...values },
      parent,
      foundedDay: day,
    };
  }

  /**
   * Builds a faith. Given a parent, it builds the sect that broke off it
   * instead: the same figures in the sky, the same shape of belief, one more
   * thing demanded of the faithful, and a name that still sounds like what it
   * came from -- which is most of why the argument is so bitter.
   */
  private makeReligion(world: World, nation: Nation, parent: Religion | null): Religion {
    const tenetIds = Object.keys(TENETS) as TenetId[];
    const id = this.nextReligionId++;

    if (parent) {
      // A sect is an argument about one thing, not a new religion: it keeps
      // what it came from and either demands something more of the faithful
      // or stops demanding something they were tired of.
      const tenets = new Set(parent.tenets);
      const spare = tenetIds.filter((x) => !tenets.has(x));
      if (spare.length > 0 && (tenets.size < 2 || this.rng.chance(0.5))) {
        tenets.add(this.rng.pick(spare));
      } else {
        tenets.delete(this.rng.pick([...tenets]));
      }
      const stem = this.namer.stemVariant(`${id}:${parent.id}`, parent.stem);
      return {
        id,
        name: this.namer.faithName(`sect${id}:${parent.id}`, stem),
        stem,
        kind: parent.kind,
        deities: parent.deities.map((d) => ({ ...d })),
        tenets,
        foundedDay: world.time.totalDays,
        holyX: nation.x,
        holyZ: nation.z,
        schismOf: parent.id,
        lastSchismDay: world.time.totalDays,
        followers: new Map(),
      };
    }

    const sky = world.astronomy;
    const kind = this.rng.weighted<FaithKind>([
      { value: 'animist', weight: 3 },
      { value: 'ancestral', weight: 3 },
      { value: 'polytheist', weight: 4 },
      { value: 'monotheist', weight: 2 },
    ]);

    // How many figures in the sky this faith recognises follows from its shape.
    const wanted = kind === 'monotheist' ? 1 : kind === 'ancestral' ? 2 : this.rng.int(3, 6);
    const pool = [...sky.constellations];
    const deities: Deity[] = [];
    for (let i = 0; i < wanted && pool.length > 0; i++) {
      const pick = pool.splice(this.rng.int(0, pool.length - 1), 1)[0] as Constellation;
      deities.push({
        name: this.namer.skyName(`deity${id}:${pick.id}`),
        constellation: pick.id,
        domain: pick.domain,
      });
    }

    const tenets = new Set<TenetId>();
    const count = this.rng.int(1, 3);
    for (let i = 0; i < count; i++) tenets.add(this.rng.pick(tenetIds));

    // A faith is named for the figure at the centre of it, or, where there is
    // no such figure, for a word in the language of the people who began it.
    const stem = deities.length > 0 ? lastWord(deities[0].name) : this.namer.root(this.rng);
    return {
      id,
      name: this.namer.faithName(`faith${id}:${nation.id}`, stem),
      stem,
      kind,
      deities,
      tenets,
      foundedDay: world.time.totalDays,
      holyX: nation.x,
      holyZ: nation.z,
      schismOf: 0,
      lastSchismDay: -1e9,
      followers: new Map(),
    };
  }

  // =======================================================================
  // Readouts
  // =======================================================================

  cultureFor(nationId: number): Culture | null {
    const id = this.cultureOf.get(nationId);
    return id ? (this.cultures.find((c) => c.id === id) ?? null) : null;
  }

  faithFor(nationId: number): Religion | null {
    const id = this.faithOf.get(nationId);
    return id ? (this.religions.find((r) => r.id === id) ?? null) : null;
  }

  /** How far apart two peoples' values are, 0 identical, 1 opposite. */
  culturalDistance(a: number, b: number): number {
    const ca = this.cultureFor(a);
    const cb = this.cultureFor(b);
    if (!ca || !cb) return 0.5;
    let sum = 0;
    for (const id of VALUE_IDS) sum += Math.abs(ca.values[id] - cb.values[id]);
    return sum / VALUE_IDS.length;
  }

  /**
   * Whether two peoples share a faith, and how nearly.
   *
   * A faith and the sect that split from it are not the same thing, but they
   * are not strangers either, which is most of why schisms are so bitter.
   */
  faithAffinity(a: number, b: number): number {
    const fa = this.faithFor(a);
    const fb = this.faithFor(b);
    if (!fa || !fb) return 0;
    if (fa.id === fb.id) return 1;
    if (fa.schismOf === fb.id || fb.schismOf === fa.id) return 0.35;
    if (fa.schismOf !== 0 && fa.schismOf === fb.schismOf) return 0.3;
    return 0;
  }

  /** Combined tolerance of everyone else, from the tenets a faith holds. */
  toleranceOf(nationId: number): number {
    const faith = this.faithFor(nationId);
    if (!faith) return 0;
    let t = 0;
    for (const id of faith.tenets) t += TENETS[id].tolerance;
    return clamp(t, -1, 1);
  }

  /** How strongly a nation holds its faith, 0..1. */
  fervourOf(nationId: number): number {
    const faith = this.faithFor(nationId);
    return faith?.followers.get(nationId) ?? 0;
  }

  // =======================================================================
  // The turn of the generations
  // =======================================================================

  update(world: World, hours: number): void {
    this.pending += hours;
    if (this.pending < STEP_HOURS) return;
    const days = this.pending / 24;
    this.pending = 0;
    if (world.nations.nations.length === 0) return;

    this.ensureCultures(world);
    this.driftValues(world, days);
    this.spreadFaiths(world, days);
    this.considerSchisms(world, days);
    this.applyEffects(world, days);
    this.prune(world);
  }

  /**
   * What a people value follows from what has been happening to them.
   *
   * Generations of war make a people martial; generations of being governed
   * by someone they did not choose make them value freedom; a faith that
   * demands much of them makes them pious. None of it is instant, and none of
   * it is set at creation and left.
   */
  private driftValues(world: World, days: number): void {
    // Values move towards what circumstance is teaching, never past it. A
    // people at war for a century become warlike; they do not become nothing
    // but war, and when the fighting stops they drift back. The pace is
    // generational: about eighty years to cover half the distance.
    const k = days / (DAYS_PER_YEAR * 115);
    const towards = (v: number, target: number, weight = 1): number =>
      clamp01(v + (target - v) * k * weight);

    for (const nation of world.nations.nations) {
      const culture = this.cultureFor(nation.id);
      if (!culture) continue;
      const v = culture.values;

      // Half what circumstance teaches, half who these people already were.
      const o = culture.origin;
      const pull = (id: ValueId, taught: number): number => (o[id] + taught) / 2;

      const atWar = world.diplomacy.warsOf(nation.id).length > 0;
      v.martial = towards(v.martial, pull('martial', atWar ? 0.95 : 0.2));
      v.freedom = towards(v.freedom, pull('freedom', nation.unrest > 0.4 ? 0.9 : 0.25));
      v.industry = towards(v.industry, pull('industry', nation.treasury > 0 ? 0.85 : 0.2), 0.6);
      v.honour = towards(v.honour, pull('honour', nation.leader.cruelty > 0.6 ? 0.1 : 0.8), 0.5);
      v.hospitality = towards(
        v.hospitality,
        pull('hospitality', this.toleranceOf(nation.id) > 0 ? 0.9 : 0.15),
        0.7,
      );
      v.piety = towards(v.piety, pull('piety', this.fervourOf(nation.id) > 0.6 ? 0.9 : 0.15), 0.8);
    }
  }

  /**
   * Faiths travel the routes that are already open.
   *
   * A trading partner's religion arrives with their goods; an ally's arrives
   * with their envoys; a conqueror's arrives with their soldiers. Nobody is
   * converted by a nation they have never dealt with.
   */
  private spreadFaiths(world: World, days: number): void {
    for (const nation of world.nations.nations) {
      // What each faith wins over here this step, before anyone gives up
      // anything: a people can hear several neighbours at once.
      const gains = new Map<number, number>();

      for (const other of world.nations.nations) {
        if (other.id === nation.id) continue;
        const theirs = this.faithFor(other.id);
        if (!theirs) continue;
        const contact = this.contactBetween(world, nation.id, other.id);
        if (contact === 0) continue;

        let zeal = 1;
        for (const id of theirs.tenets) zeal *= TENETS[id].zeal;
        const theirHold = theirs.followers.get(other.id) ?? 0;
        const here = theirs.followers.get(nation.id) ?? 0;

        // A people already sure of their own faith are hard to move, and a
        // people who have nothing in common with the missionary harder still.
        const resistance =
          1 + this.fervourOf(nation.id) * 1.5 + this.culturalDistance(nation.id, other.id) * 2;
        const pull = (contact * zeal * theirHold * days * 0.0018 * (1 - here)) / resistance;
        if (pull <= 0) continue;
        gains.set(theirs.id, (gains.get(theirs.id) ?? 0) + pull);
      }

      if (gains.size === 0) continue;
      this.shiftBelief(nation.id, gains);
      this.settleFaith(world, nation);
    }
  }

  /**
   * How open the road between two peoples is. Nobody is converted by a nation
   * they have never dealt with: a trading partner's religion arrives with
   * their goods, an ally's with their envoys, a besieger's with their army.
   */
  private contactBetween(world: World, a: number, b: number): number {
    if (world.diplomacy.atWar(a, b)) return 0.35;
    const treaty = world.diplomacy.relation(a, b).treaty;
    if (treaty === 'alliance') return 0.9;
    if (treaty === 'nonAggression') return 0.6;
    if (treaty === 'trade') return 0.5;
    return 0;
  }

  /**
   * Moves a share of a people from what they kept to what they are hearing.
   * What one faith wins another loses, in proportion to how much of the people
   * it held: a faith with two believers left does not supply most of the
   * converts. A people's belief is a whole that gets divided up, not a set of
   * numbers that can all rise at once.
   */
  private shiftBelief(nationId: number, gains: Map<number, number>): void {
    for (const [faithId, wanted] of gains) {
      const target = this.religions.find((r) => r.id === faithId);
      if (!target) continue;

      let pool = 0;
      for (const r of this.religions) {
        if (r.id === faithId) continue;
        pool += r.followers.get(nationId) ?? 0;
      }
      const moved = Math.min(wanted, pool);
      if (moved <= 0) continue;

      for (const r of this.religions) {
        if (r.id === faithId) continue;
        const hold = r.followers.get(nationId) ?? 0;
        if (hold <= 0) continue;
        r.followers.set(nationId, Math.max(0, hold - moved * (hold / pool)));
      }
      target.followers.set(nationId, clamp01((target.followers.get(nationId) ?? 0) + moved));
    }
  }

  /**
   * The faith a people keep is whichever most of them keep -- but they do not
   * change it over a hair's difference and change back the following season.
   * A conversion is a thing that happens once and is remembered.
   */
  private settleFaith(world: World, nation: Nation): void {
    const currentId = this.faithOf.get(nation.id);
    const current = currentId ? this.religions.find((r) => r.id === currentId) : undefined;
    const held = current?.followers.get(nation.id) ?? 0;
    const best = this.strongestFaith(nation.id);
    if (!best || best.id === currentId) return;

    const bestHold = best.followers.get(nation.id) ?? 0;
    if (current && bestHold < held + 0.12) return;

    this.faithOf.set(nation.id, best.id);
    world.log.add(world.time, 'settlement', 'ev.conversion', {
      nation: nation.name,
      faith: best.name,
    }, { notable: true, x: nation.x, z: nation.z });
  }

  private strongestFaith(nationId: number): Religion | null {
    let best: Religion | null = null;
    let bestHold = 0;
    for (const r of this.religions) {
      const hold = r.followers.get(nationId) ?? 0;
      if (hold > bestHold) {
        bestHold = hold;
        best = r;
      }
    }
    return best;
  }

  /**
   * A faith splits when the people who keep it stop recognising each other's
   * version of it. Being at opposite ends of a war does that quickly; simply
   * living differently for long enough does it too, which is why a religion
   * that wins the whole world does not stay one religion afterwards.
   */
  private considerSchisms(world: World, days: number): void {
    // A world can only keep track of so many sects before they stop meaning
    // anything, and so can a player.
    if (this.religions.length > 14) return;

    // A faith that has just broken in two has its hands full. Another split a
    // decade later would be noise, not history.
    const generation = DAYS_PER_YEAR * 45;

    for (const faith of [...this.religions]) {
      if (world.time.totalDays - faith.lastSchismDay < generation) continue;
      if (world.time.totalDays - faith.foundedDay < generation) continue;
      const holders = world.nations.nations.filter(
        (n) => this.faithOf.get(n.id) === faith.id,
      );
      if (holders.length < 2) continue;

      for (let i = 0; i < holders.length; i++) {
        for (let j = i + 1; j < holders.length; j++) {
          const a = holders[i];
          const b = holders[j];
          // Peoples close enough in what they value, and close enough to
          // walk to, read the same faith the same way. Otherwise the two
          // versions of it drift until they are two faiths.
          const apart = Math.hypot(a.x - b.x, a.z - b.z) / world.terrain.worldSize;
          let pressure = Math.max(0, this.culturalDistance(a.id, b.id) - 0.12) + apart * 0.2;
          if (world.diplomacy.atWar(a.id, b.id)) pressure += 0.45;
          if (pressure <= 0) continue;
          if (!this.rng.chance(clamp01(days * 0.0015 * pressure))) continue;

          // The weaker of the two goes its own way.
          const breaker = a.population < b.population ? a : b;
          const sect = this.makeReligion(world, breaker, faith);
          sect.followers.set(breaker.id, faith.followers.get(breaker.id) ?? 0.6);
          faith.lastSchismDay = world.time.totalDays;
          faith.followers.set(breaker.id, 0);

          this.religions.push(sect);
          this.faithOf.set(breaker.id, sect.id);
          world.log.add(world.time, 'settlement', 'ev.schism', {
            faith: faith.name,
            sect: sect.name,
            nation: breaker.name,
          }, { notable: true, x: breaker.x, z: breaker.z });
          return;
        }
      }
    }
  }

  /** What belief and values actually do to the world. */
  private applyEffects(world: World, days: number): void {
    for (const nation of world.nations.nations) {
      const culture = this.cultureFor(nation.id);
      const faith = this.faithFor(nation.id);
      if (!culture) continue;

      // Tenets press on unrest one way or the other. The figures in TENETS
      // are what a year of holding that tenet is worth.
      const year = days / DAYS_PER_YEAR;
      if (faith) {
        let unrest = 0;
        for (const id of faith.tenets) unrest += TENETS[id].unrest;
        nation.unrest = clamp01(nation.unrest + unrest * year * this.fervourOf(nation.id));
      }

      // A people who value freedom will not be ruled as easily as one who
      // values honour, and a martial one keeps more of itself under arms.
      nation.unrest = clamp01(nation.unrest + (culture.values.freedom - 0.5) * 0.12 * year);
      if (culture.values.martial > 0.65) {
        nation.army = Math.min(nation.population * 0.1, nation.army * (1 + 0.0015 * days));
      }
    }

    // Shared belief brings peoples together; a schism sets them at odds.
    const list = world.nations.nations;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const affinity = this.faithAffinity(a.id, b.id);
        const tolerance = (this.toleranceOf(a.id) + this.toleranceOf(b.id)) / 2;
        const distance = this.culturalDistance(a.id, b.id);
        // Sharing a faith helps; an intolerant faith you do not share hurts.
        const drift =
          affinity * 0.05 + (1 - affinity) * tolerance * 0.06 - distance * 0.03;
        const r = world.diplomacy.relation(a.id, b.id);
        r.opinion = clamp(r.opinion + drift * days, -100, 100);
      }
    }
  }

  /** A faith with nobody left to hold it is gone. */
  private prune(world: World): void {
    const live = new Set(world.nations.nations.map((n) => n.id));
    for (const r of this.religions) {
      for (const id of [...r.followers.keys()]) {
        if (!live.has(id)) r.followers.delete(id);
      }
    }
    for (let i = this.religions.length - 1; i >= 0; i--) {
      const r = this.religions[i];
      let held = 0;
      for (const hold of r.followers.values()) held = Math.max(held, hold);
      if (held > 0.02) continue;
      // Nobody holds it any more.
      for (const [nationId, faithId] of [...this.faithOf]) {
        if (faithId === r.id) this.faithOf.delete(nationId);
      }
      // Anything that split from it is now the eldest of its line.
      for (const other of this.religions) {
        if (other.schismOf === r.id) other.schismOf = 0;
      }
      world.log.add(world.time, 'settlement', 'ev.faithLost', { faith: r.name }, {
        notable: true,
      });
      this.religions.splice(i, 1);
    }
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return {
      cultures: this.cultures.map((c) => ({
        ...c,
        values: { ...c.values },
        origin: { ...c.origin },
      })),
      religions: this.religions.map((r) => ({
        ...r,
        tenets: [...r.tenets],
        deities: r.deities.map((d) => ({ ...d })),
        followers: [...r.followers.entries()],
      })),
      cultureOf: [...this.cultureOf.entries()],
      faithOf: [...this.faithOf.entries()],
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    this.cultures.length = 0;
    this.religions.length = 0;
    this.cultureOf.clear();
    this.faithOf.clear();

    const num = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    if (Array.isArray(data.cultures)) {
      for (const raw of data.cultures as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        const rawValues = (raw.values ?? {}) as Record<string, unknown>;
        const rawOrigin = (raw.origin ?? rawValues) as Record<string, unknown>;
        const values = {} as Values;
        const origin = {} as Values;
        for (const id of VALUE_IDS) {
          values[id] = clamp01(num(rawValues[id], 0.5));
          origin[id] = clamp01(num(rawOrigin[id], values[id]));
        }
        this.cultures.push({
          id: Math.max(1, Math.round(num(raw.id, this.nextCultureId))),
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Unnamed',
          values,
          origin,
          parent: Math.max(0, Math.round(num(raw.parent, 0))),
          foundedDay: Math.max(0, num(raw.foundedDay, 0)),
        });
      }
    }

    const kinds: FaithKind[] = ['animist', 'ancestral', 'polytheist', 'monotheist'];
    const tenetIds = Object.keys(TENETS) as TenetId[];
    if (Array.isArray(data.religions)) {
      for (const raw of data.religions as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        const followers = new Map<number, number>();
        if (Array.isArray(raw.followers)) {
          for (const pair of raw.followers as unknown[]) {
            if (!Array.isArray(pair) || pair.length !== 2) continue;
            const [id, hold] = pair as [unknown, unknown];
            if (typeof id !== 'number') continue;
            followers.set(Math.round(id), clamp01(num(hold, 0)));
          }
        }
        this.religions.push({
          id: Math.max(1, Math.round(num(raw.id, this.nextReligionId))),
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Unnamed',
          stem: typeof raw.stem === 'string' ? raw.stem.slice(0, 40) : 'Unnamed',
          kind: kinds.includes(raw.kind as FaithKind) ? (raw.kind as FaithKind) : 'animist',
          deities: (Array.isArray(raw.deities) ? raw.deities : [])
            .filter((d: unknown): d is Record<string, unknown> => !!d && typeof d === 'object')
            .slice(0, 12)
            .map((d) => ({
              name: typeof d.name === 'string' ? d.name.slice(0, 64) : 'Unnamed',
              constellation: Math.max(0, Math.round(num(d.constellation, 0))),
              domain: typeof d.domain === 'string' ? d.domain.slice(0, 32) : 'luck',
            })),
          tenets: new Set(
            (Array.isArray(raw.tenets) ? raw.tenets : []).filter((x: unknown): x is TenetId =>
              tenetIds.includes(x as TenetId),
            ),
          ),
          foundedDay: Math.max(0, num(raw.foundedDay, 0)),
          holyX: num(raw.holyX, 0),
          holyZ: num(raw.holyZ, 0),
          schismOf: Math.max(0, Math.round(num(raw.schismOf, 0))),
          lastSchismDay: num(raw.lastSchismDay, -1e9),
          followers,
        });
      }
    }

    for (const c of this.cultures) this.nextCultureId = Math.max(this.nextCultureId, c.id + 1);
    for (const r of this.religions) this.nextReligionId = Math.max(this.nextReligionId, r.id + 1);

    const cultureIds = new Set(this.cultures.map((c) => c.id));
    const faithIds = new Set(this.religions.map((r) => r.id));
    const readMap = (raw: unknown, valid: Set<number>, into: Map<number, number>): void => {
      if (!Array.isArray(raw)) return;
      for (const pair of raw as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [a, b] = pair as [unknown, unknown];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        if (!valid.has(b)) continue;
        into.set(Math.round(a), Math.round(b));
      }
    };
    readMap(data.cultureOf, cultureIds, this.cultureOf);
    readMap(data.faithOf, faithIds, this.faithOf);
  }
}
