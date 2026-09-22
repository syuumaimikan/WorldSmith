/**
 * What makes a disaster happen, and what a disaster makes happen next.
 *
 * Nothing here rolls a die against the clock. Each hazard has a risk that is
 * read off the world as it actually is — how dry the forest has got, how much
 * pressure is under a volcano, how steep and how sodden a hillside is — and a
 * hazard only fires when its risk is genuinely high. That is the difference
 * between a world that has droughts and a world that plays a drought animation
 * every forty minutes.
 *
 * Cascades work the same way. An earthquake does not "trigger a landslide"; it
 * shakes ground that was already loose, and the ground goes. A drought does not
 * schedule a wildfire; it dries the fuel, and then a single lightning strike
 * does what it could not have done in a wet spring.
 */

import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import type { World } from './World';
import { beginEruption } from './Volcano';

export type HazardKind =
  | 'wildfire'
  | 'flood'
  | 'landslide'
  | 'eruption'
  | 'earthquake'
  | 'famine'
  | 'disease';

export interface HazardRisk {
  kind: HazardKind;
  /** 0..1, read off the world rather than accumulated on a timer. */
  risk: number;
  /** What is driving it, for the player to read. */
  cause: string;
}

/** A disaster that happened, and what it set off. */
export interface DisasterRecord {
  id: number;
  kind: HazardKind;
  day: number;
  x: number;
  z: number;
  severity: number;
  /** The record this one cascaded from, if any. */
  causedBy: number;
}

/** Game hours between risk assessments. Hazards build over days, not seconds. */
const ASSESS_HOURS = 6;

/**
 * How long the world runs before the director will act on anything. Several
 * of the readings it takes (food stores, infrastructure) are only meaningful
 * once the settlement has reported itself at least once.
 */
const GRACE_HOURS = 72;

export class DisasterDirector {
  readonly history: DisasterRecord[] = [];
  /** Latest risk reading per hazard, for the UI. */
  readonly risks = new Map<HazardKind, HazardRisk>();

  private rng: Rng;
  /** Game hours this director has been watching. */
  private elapsed = 0;
  private hoursToAssess = ASSESS_HOURS;
  private nextId = 1;
  /** Record a new disaster should be attributed to, while a cascade runs. */
  private cascadeFrom = 0;
  /** Game hours since the last disaster of each kind, to avoid pile-ups. */
  private quiet = new Map<HazardKind, number>();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xd15c);
  }

  update(world: World, hours: number): void {
    this.elapsed += hours;
    for (const [kind, h] of this.quiet) this.quiet.set(kind, h + hours);

    this.hoursToAssess -= hours;
    if (this.hoursToAssess > 0) return;
    this.hoursToAssess = ASSESS_HOURS;

    this.assess(world);

    // A settlement that landed yesterday is not in the middle of a famine,
    // whatever its empty stores look like on paper. Give the world time to
    // report itself honestly before acting on what it says.
    if (this.elapsed < GRACE_HOURS) return;

    for (const risk of this.risks.values()) {
      if (risk.risk < 0.55) continue;
      const since = this.quiet.get(risk.kind) ?? 1e6;
      if (since < minimumGap(risk.kind)) continue;
      // Even at high risk a hazard is a chance, not a certainty. What the risk
      // buys is that it is possible at all.
      const chance = clamp01((risk.risk - 0.55) * 0.5);
      if (!this.rng.chance(chance)) continue;
      this.fire(world, risk.kind, risk.risk);
    }
  }

  // =======================================================================
  // Reading the world
  // =======================================================================

  private assess(world: World): void {
    this.risks.clear();
    const set = (kind: HazardKind, risk: number, cause: string): void => {
      this.risks.set(kind, { kind, risk: clamp01(risk), cause });
    };

    const climate = world.climate;
    const drought = climate.extremes.find((e) => e.kind === 'drought');
    const heat = climate.extremes.find((e) => e.kind === 'heatwave');
    const monsoon = climate.extremes.find((e) => e.kind === 'monsoon');

    // --- wildfire: dry fuel, warm air, wind ------------------------------
    {
      const dryness = clamp01(1 - climate.meanPrecipitation() * 6);
      const warmth = clamp01((climate.meanTemperature() - 12) / 18);
      const fuel = clamp01(world.nodes.length / Math.max(1, world.terrain.gridSize * 6));
      let risk = dryness * 0.5 + warmth * 0.3 + fuel * 0.2;
      if (drought) risk += 0.3 + drought.severity * 0.2;
      if (heat) risk += 0.15;
      if (monsoon) risk -= 0.5;
      set('wildfire', risk, drought ? 'cause.drought' : 'cause.dryHeat');
    }

    // --- flood: sodden ground, hard rain, thawing snow -------------------
    {
      const rain = clamp01(climate.meanPrecipitation() * 2.5);
      const thaw = clamp01(world.snowmeltCarried / 4000);
      let risk = rain * 0.65 + thaw * 0.45;
      if (monsoon) risk += 0.25 + monsoon.severity * 0.25;
      if (drought) risk -= 0.3;
      set('flood', risk, thaw > 0.3 ? 'cause.snowmelt' : 'cause.heavyRain');
    }

    // --- landslide: steep wet ground -------------------------------------
    {
      const wet = clamp01(climate.meanPrecipitation() * 2.2);
      const steep = world.steepGroundFraction();
      set('landslide', wet * 0.7 * clamp01(steep * 3), 'cause.saturatedSlopes');
    }

    // --- eruption: pressure under a volcano ------------------------------
    {
      let worst = 0;
      for (const v of world.volcanoes) {
        if (v.state === 'erupting' || v.state === 'spent') continue;
        worst = Math.max(worst, v.pressure);
      }
      set('eruption', worst * 0.85, 'cause.magmaPressure');
    }

    // --- famine: not enough food for the people there are ----------------
    {
      const people = world.npcs.length;
      if (people > 0) {
        const days = world.foodDaysRemaining();
        const hungry =
          world.npcs.reduce((n, npc) => n + (npc.needs.hunger < 35 ? 1 : 0), 0) / people;
        // Empty stores alone are not a famine; a settlement can be living
        // hand to mouth off what it forages that morning. It is a famine when
        // the stores are empty AND people are actually going without.
        const stores = clamp01(1 - days / 5);
        const risk = Math.min(stores, hungry * 1.6) * 1.2;
        set('famine', risk, days < 2 ? 'cause.emptyStores' : 'cause.thinHarvest');
      }
    }

    // --- disease: crowding, poor health, warmth --------------------------
    {
      const people = world.npcs.length;
      if (people >= 6) {
        const unwell =
          world.npcs.reduce((n, npc) => n + (npc.needs.health < 60 ? 1 : 0), 0) / people;
        const crowding = clamp01((people - 8) / 40);
        const warmth = clamp01((climate.meanTemperature() - 14) / 16);
        set('disease', unwell * 0.7 + crowding * 0.25 + warmth * 0.15, 'cause.crowding');
      }
    }
  }

  /** Whatever is most likely to go wrong next, for the player to read. */
  topRisk(): HazardRisk | null {
    let best: HazardRisk | null = null;
    for (const r of this.risks.values()) {
      if (!best || r.risk > best.risk) best = r;
    }
    return best;
  }

  // =======================================================================
  // Making it happen
  // =======================================================================

  /** Fires a hazard for a stated reason, and lets it set off what follows. */
  fire(world: World, kind: HazardKind, severity: number): DisasterRecord | null {
    const spot = this.placeFor(world, kind);
    if (!spot) return null;

    const record: DisasterRecord = {
      id: this.nextId++,
      kind,
      day: world.time.totalDays,
      x: spot.x,
      z: spot.z,
      severity: clamp01(severity),
      causedBy: this.cascadeFrom,
    };

    switch (kind) {
      case 'wildfire':
        if (!world.disasters.ignite(world, spot.x, spot.z, 0.5 + severity * 0.4)) return null;
        break;
      case 'flood':
        world.disasters.flood(
          world,
          spot.x,
          spot.z,
          world.terrain.worldSize * (0.05 + severity * 0.08),
          1 + severity * 3,
          160 + severity * 400,
        );
        break;
      case 'landslide':
        world.landslide(spot.x, spot.z, 6 + severity * 14);
        break;
      case 'earthquake':
        world.disasters.earthquake(
          world,
          spot.x,
          spot.z,
          severity,
          world.terrain.worldSize * (0.12 + severity * 0.2),
        );
        break;
      case 'eruption': {
        const v = world.volcanoes.find((x) => x.state === 'unrest') ?? world.volcanoes[0];
        if (!v) return null;
        beginEruption(world, v);
        record.x = v.x;
        record.z = v.z;
        break;
      }
      case 'famine':
        world.beginFamine(severity);
        break;
      case 'disease':
        world.beginOutbreak(spot.x, spot.z, severity);
        break;
    }

    this.quiet.set(kind, 0);
    this.history.push(record);
    if (this.history.length > 500) this.history.shift();

    this.cascade(world, record);
    return record;
  }

  /**
   * What one disaster makes possible for the next.
   *
   * These are not scripted sequels. Each one re-reads the world the first
   * disaster just changed and only goes ahead if the new state warrants it.
   */
  private cascade(world: World, from: DisasterRecord): void {
    if (from.causedBy !== 0) return; // one link deep; no runaway chains
    const previous = this.cascadeFrom;
    this.cascadeFrom = from.id;

    switch (from.kind) {
      case 'earthquake': {
        // Shaking loosens wet ground and can crack a dam or a lake shore.
        this.assess(world);
        const slide = this.risks.get('landslide');
        if (slide && slide.risk > 0.3 && this.rng.chance(from.severity * 0.8)) {
          this.fire(world, 'landslide', Math.max(slide.risk, from.severity * 0.7));
        }
        break;
      }
      case 'eruption':
        // Ash and lava: the fires come from the lava, the cold from the ash,
        // and both are handled by the volcano itself. What follows the winter
        // is hunger, if the stores were already thin.
        this.assess(world);
        if ((this.risks.get('famine')?.risk ?? 0) > 0.4) {
          this.fire(world, 'famine', 0.5 + from.severity * 0.3);
        }
        break;
      case 'wildfire':
        // Burnt hillsides have nothing holding them together any more.
        this.assess(world);
        if ((this.risks.get('landslide')?.risk ?? 0) > 0.5 && this.rng.chance(0.4)) {
          this.fire(world, 'landslide', 0.5);
        }
        break;
      case 'flood':
        // Standing water and spoiled stores make people ill.
        this.assess(world);
        if ((this.risks.get('disease')?.risk ?? 0) > 0.35 && this.rng.chance(0.5)) {
          this.fire(world, 'disease', 0.4 + from.severity * 0.3);
        }
        break;
      case 'famine':
        // Hungry people are easy for a sickness to take.
        if (this.rng.chance(0.35)) this.fire(world, 'disease', 0.4);
        break;
      default:
        break;
    }

    this.cascadeFrom = previous;
  }

  /** Where a hazard of this kind would actually happen. */
  private placeFor(world: World, kind: HazardKind): { x: number; z: number } | null {
    const t = world.terrain;
    const centre = world.settlement.centre;

    switch (kind) {
      case 'wildfire':
        return world.driestFuelNear(centre.x, centre.z, t.worldSize * 0.45);
      case 'flood':
        return world.lowestGroundNear(centre.x, centre.z, t.worldSize * 0.3);
      case 'landslide':
        return world.steepestGroundNear(centre.x, centre.z, t.worldSize * 0.35);
      case 'earthquake':
      case 'famine':
      case 'disease':
        return { x: centre.x, z: centre.z };
      case 'eruption': {
        const v = world.volcanoes[0];
        return v ? { x: v.x, z: v.z } : null;
      }
      default:
        return null;
    }
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return { history: this.history.slice(-200) };
  }

  restore(data: Record<string, unknown> | undefined): void {
    this.history.length = 0;
    if (!data || !Array.isArray(data.history)) return;
    const kinds: HazardKind[] = [
      'wildfire',
      'flood',
      'landslide',
      'eruption',
      'earthquake',
      'famine',
      'disease',
    ];
    for (const raw of data.history as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (!kinds.includes(raw.kind as HazardKind)) continue;
      const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      this.history.push({
        id: this.nextId++,
        kind: raw.kind as HazardKind,
        day: Math.max(0, num(raw.day, 0)),
        x: num(raw.x, 0),
        z: num(raw.z, 0),
        severity: clamp01(num(raw.severity, 0.5)),
        causedBy: Math.max(0, num(raw.causedBy, 0)),
      });
    }
  }
}

/** Minimum quiet period between two disasters of the same kind, in hours. */
function minimumGap(kind: HazardKind): number {
  switch (kind) {
    case 'wildfire':
      return 120;
    case 'flood':
      return 200;
    case 'landslide':
      return 80;
    case 'eruption':
      return 1400;
    case 'earthquake':
      return 900;
    case 'famine':
      return 700;
    case 'disease':
      return 500;
    default:
      return 200;
  }
}
