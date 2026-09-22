/**
 * What a people know how to do.
 *
 * This is not the player's research tree. That one is a settlement deciding to
 * work out how to frame a roof, and it needs a study, a scholar and materials.
 * This is the other scale: a whole polity's accumulated know-how, which grows
 * because there are people with time to think, spreads along exactly the roads
 * that goods and faiths use, and — this is the part most simulations leave out
 * — can be lost. A country that tears itself apart forgets things.
 *
 * Knowledge is one number per polity rather than a tree, because at this scale
 * a tree would be a tree nobody ever looks at. What it buys is concrete: land
 * that feeds more people, fields that yield more, and soldiers who are worth
 * more than the same number of soldiers the century before.
 *
 * The player's own nation does not get an abstract counter. Its knowledge is
 * whatever its settlement has actually worked out, so the era on the panel is
 * earned in the study rather than accrued for existing.
 */

import { clamp01 } from '../core/math';
import { ALL_RESEARCH_IDS } from '../data/research';
import type { Nation } from './Nations';
import type { World } from './World';

export type EraId = 'stone' | 'bronze' | 'iron' | 'classical' | 'medieval';

export interface EraDef {
  id: EraId;
  /** Knowledge at which a people are said to have reached it. */
  threshold: number;
  /** Multiplier on how many people the land will feed. */
  carrying: number;
  /** Multiplier on what the land and its people produce. */
  production: number;
  /** Multiplier on what an army is worth in the field. */
  martial: number;
}

/**
 * The eras, in order. The thresholds are set so that a large, stable,
 * studious nation crosses two or three of them in three centuries and a
 * struggling one crosses one, which is roughly the spread a world wants.
 */
export const ERAS: EraDef[] = [
  { id: 'stone', threshold: 0, carrying: 1, production: 1, martial: 1 },
  { id: 'bronze', threshold: 140, carrying: 1.15, production: 1.2, martial: 1.25 },
  { id: 'iron', threshold: 420, carrying: 1.35, production: 1.5, martial: 1.6 },
  { id: 'classical', threshold: 1000, carrying: 1.6, production: 1.9, martial: 2 },
  { id: 'medieval', threshold: 2100, carrying: 1.9, production: 2.4, martial: 2.5 },
];

/** Game hours between passes. Knowledge moves at the pace of lifetimes. */
const STEP_HOURS = 24 * 5;

/** What the player's whole research tree is worth, in this currency. */
const PLAYER_KNOWLEDGE_PER_UNLOCK = 2100 / Math.max(1, ALL_RESEARCH_IDS.length);

export class TechnologySystem {
  /** Accumulated know-how per nation. The player's is derived, not stored. */
  readonly knowledge = new Map<number, number>();
  /** The era each nation was last reported to have reached. */
  private reported = new Map<number, EraId>();
  private pending = 0;

  // =========================================================================
  // Readouts
  // =========================================================================

  knowledgeOf(world: World, nation: Nation): number {
    if (nation.isPlayer) {
      return world.research.unlocked.size * PLAYER_KNOWLEDGE_PER_UNLOCK;
    }
    return this.knowledge.get(nation.id) ?? 0;
  }

  eraOf(world: World, nation: Nation): EraDef {
    const k = this.knowledgeOf(world, nation);
    let era = ERAS[0];
    for (const e of ERAS) if (k >= e.threshold) era = e;
    return era;
  }

  /** How far through the current era a people are, 0..1. */
  progressOf(world: World, nation: Nation): number {
    const k = this.knowledgeOf(world, nation);
    const era = this.eraOf(world, nation);
    const next = ERAS[ERAS.indexOf(era) + 1];
    if (!next) return 1;
    return clamp01((k - era.threshold) / (next.threshold - era.threshold));
  }

  /** The most advanced anyone in the world is, for the statistics screens. */
  foremost(world: World): { nation: Nation; era: EraDef } | null {
    let best: { nation: Nation; era: EraDef } | null = null;
    for (const n of world.nations.nations) {
      const era = this.eraOf(world, n);
      if (!best || era.threshold > best.era.threshold) best = { nation: n, era };
    }
    return best;
  }

  // =========================================================================
  // The turn of the generations
  // =========================================================================

  update(world: World, hours: number): void {
    this.pending += hours;
    if (this.pending < STEP_HOURS) return;
    const days = this.pending / 24;
    this.pending = 0;

    this.learn(world, days);
    this.diffuse(world, days);
    this.report(world);
    this.prune(world);
  }

  /**
   * Knowing more is what happens when there are people with time to think.
   *
   * It follows from how many of them there are, whether the state can feed
   * anyone who is not farming, whether the country is calm enough for anyone
   * to bother, and whether these are a people who think study is worth doing.
   */
  private learn(world: World, days: number): void {
    for (const nation of world.nations.nations) {
      if (nation.isPlayer) continue;
      // A faction in the field is not endowing a library.
      if (nation.rebelAgainst !== 0) continue;

      let k = this.knowledge.get(nation.id) ?? 0;

      // A country coming apart forgets. Not quickly, but it forgets: the
      // people who knew how are dead or gone and nobody was taught.
      if (nation.inCivilWar || nation.stability < 0.25) {
        k = Math.max(0, k - k * 0.00035 * days);
        this.knowledge.set(nation.id, k);
        continue;
      }

      // More hands, but with diminishing returns: ten times the people are not
      // ten times the ideas, they are about three times.
      let rate = 0.00075 * Math.sqrt(Math.max(1, nation.population));
      rate *= 0.35 + nation.stability * 0.9;
      rate *= nation.treasury > 0 ? 1.2 : 0.7;

      const culture = world.culture.cultureFor(nation.id);
      if (culture) rate *= 0.6 + culture.values.industry * 0.8;
      const faith = world.culture.faithFor(nation.id);
      if (faith?.tenets.has('scholarship')) rate *= 1.35;
      if (faith?.tenets.has('asceticism')) rate *= 0.85;
      if (nation.laws.has('guildCharter')) rate *= 1.15;

      this.knowledge.set(nation.id, k + rate * days);
    }
  }

  /**
   * Know-how travels the same roads as everything else.
   *
   * A backward neighbour catches up towards whoever is ahead of it, and never
   * past them: you can be taught what somebody else worked out, but being
   * taught is not the same as working it out.
   */
  private diffuse(world: World, days: number): void {
    const nations = world.nations.nations;
    for (const nation of nations) {
      if (nation.isPlayer || nation.rebelAgainst !== 0) continue;
      const mine = this.knowledge.get(nation.id) ?? 0;
      let gain = 0;

      for (const other of nations) {
        if (other.id === nation.id) continue;
        const theirs = this.knowledgeOf(world, other);
        if (theirs <= mine) continue;
        const contact = this.contact(world, nation.id, other.id);
        if (contact === 0) continue;
        gain += (theirs - mine) * contact * 0.00035 * days;
      }

      if (gain > 0) this.knowledge.set(nation.id, mine + gain);
    }
  }

  /**
   * How open the road is. A conquering army carries what it knows with it,
   * which is why war teaches almost as readily as trade.
   */
  private contact(world: World, a: number, b: number): number {
    if (world.diplomacy.atWar(a, b)) return 0.45;
    const treaty = world.diplomacy.relation(a, b).treaty;
    if (treaty === 'alliance') return 1;
    if (treaty === 'trade') return 0.9;
    if (treaty === 'nonAggression') return 0.6;
    // Even strangers leak a little: a trader, a captive, a wanderer with a
    // better way of doing something. Only a little, or every people in the
    // world ends up knowing exactly as much as every other.
    return 0.04;
  }

  /** A people crossing into a new era is worth writing down. */
  private report(world: World): void {
    for (const nation of world.nations.nations) {
      if (nation.rebelAgainst !== 0) continue;
      const era = this.eraOf(world, nation).id;
      const was = this.reported.get(nation.id);
      this.reported.set(nation.id, era);
      // Nothing is announced the first time a nation is seen: that is where it
      // already was, not somewhere it has just arrived.
      if (was === undefined || was === era) continue;
      const forward = ERAS.findIndex((e) => e.id === era) > ERAS.findIndex((e) => e.id === was);
      world.log.add(
        world.time,
        'discovery',
        forward ? 'ev.eraReached' : 'ev.eraLost',
        { nation: nation.name, era: `era.${era}` },
        { notable: true, x: nation.x, z: nation.z },
      );
    }
  }

  private prune(world: World): void {
    const live = new Set(world.nations.nations.map((n) => n.id));
    for (const id of [...this.knowledge.keys()]) if (!live.has(id)) this.knowledge.delete(id);
    for (const id of [...this.reported.keys()]) if (!live.has(id)) this.reported.delete(id);
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  serialize(): Record<string, unknown> {
    return {
      knowledge: [...this.knowledge.entries()],
      reported: [...this.reported.entries()],
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    this.knowledge.clear();
    this.reported.clear();

    if (Array.isArray(data.knowledge)) {
      for (const pair of data.knowledge as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [id, k] = pair as [unknown, unknown];
        if (typeof id !== 'number' || typeof k !== 'number' || !Number.isFinite(k)) continue;
        this.knowledge.set(Math.round(id), Math.max(0, Math.min(1e6, k)));
      }
    }
    const ids = new Set(ERAS.map((e) => e.id));
    if (Array.isArray(data.reported)) {
      for (const pair of data.reported as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [id, era] = pair as [unknown, unknown];
        if (typeof id !== 'number' || !ids.has(era as EraId)) continue;
        this.reported.set(Math.round(id), era as EraId);
      }
    }
  }
}
