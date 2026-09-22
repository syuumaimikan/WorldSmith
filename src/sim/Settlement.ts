/**
 * The settlement: what the buildings and people add up to.
 *
 * Tier is not simply a population count. A camp with thirty people and no
 * storage, roads or food production is still a camp; a village is a place that
 * can keep itself running.
 */

import { Building } from './Building';
import { Npc } from './Npc';
import { clamp01 } from '../core/math';

export type SettlementTier = 'camp' | 'hamlet' | 'village' | 'town' | 'city';

export const TIER_LABELS: Record<SettlementTier, string> = {
  camp: 'Camp',
  hamlet: 'Hamlet',
  village: 'Village',
  town: 'Town',
  city: 'City',
};

export interface Infrastructure {
  road: number;
  food: number;
  housing: number;
  storage: number;
  safety: number;
  health: number;
  education: number;
  production: number;
}

const TIER_ORDER: SettlementTier[] = ['camp', 'hamlet', 'village', 'town', 'city'];

interface TierRequirement {
  population: number;
  housing: number;
  production: number;
  storage: number;
  food: number;
}

const TIER_REQUIREMENTS: Record<SettlementTier, TierRequirement> = {
  camp: { population: 0, housing: 0, production: 0, storage: 0, food: 0 },
  hamlet: { population: 6, housing: 6, production: 1, storage: 1, food: 1 },
  village: { population: 14, housing: 14, production: 5, storage: 4, food: 4 },
  town: { population: 32, housing: 32, production: 12, storage: 9, food: 9 },
  city: { population: 70, housing: 70, production: 26, storage: 18, food: 18 },
};

export class Settlement {
  name: string;
  centre = { x: 0, z: 0 };
  /** Radius in metres inside which building is considered "in town". */
  radius = 70;
  tier: SettlementTier = 'camp';
  population = 0;
  housingCapacity = 0;
  homeless = 0;
  unemployed = 0;
  averageMood = 70;
  foodStores = 0;
  /** Days of food remaining at current consumption. */
  foodDays = 0;
  foundedDay = 0;

  infrastructure: Infrastructure = {
    road: 0,
    food: 0,
    housing: 0,
    storage: 0,
    safety: 0,
    health: 0,
    education: 0,
    production: 0,
  };

  /** Set for one tick when the settlement grows to a new tier. */
  justPromoted: SettlementTier | null = null;

  constructor(name: string, x: number, z: number) {
    this.name = name;
    this.centre.x = x;
    this.centre.z = z;
  }

  /** Recomputed once per simulated minute rather than every tick. */
  recompute(buildings: Building[], npcs: Npc[], foodUnits: number, roadTiles: number): void {
    this.population = npcs.length;

    const infra: Infrastructure = {
      road: Math.min(40, roadTiles / 12),
      food: 0,
      housing: 0,
      storage: 0,
      safety: 0,
      health: 0,
      education: 0,
      production: 0,
    };

    let housing = 0;
    let cx = 0;
    let cz = 0;
    let weight = 0;

    for (const b of buildings) {
      if (!b.complete) continue;
      housing += b.def.housing ?? 0;
      const contrib = b.def.infrastructure;
      if (contrib) {
        for (const [k, v] of Object.entries(contrib) as [keyof Infrastructure, number][]) {
          if (k === 'road') continue; // road comes from actual tiles laid
          infra[k] += v * b.condition;
        }
      }
      // Centre of mass, weighted by how significant the building is.
      const w = 1 + (b.def.housing ?? 0) * 0.5 + (b.def.workSlots ?? 0) * 0.4;
      cx += b.worldX * w;
      cz += b.worldZ * w;
      weight += w;
    }

    if (weight > 0) {
      this.centre.x = cx / weight;
      this.centre.z = cz / weight;
    }

    this.infrastructure = infra;
    this.housingCapacity = housing;

    let homeless = 0;
    let unemployed = 0;
    let moodSum = 0;
    for (const n of npcs) {
      if (!n.homeId) homeless++;
      if (!n.workplaceId && n.profession === 'settler') unemployed++;
      moodSum += n.needs.mood;
    }
    this.homeless = homeless;
    this.unemployed = unemployed;
    this.averageMood = npcs.length > 0 ? moodSum / npcs.length : 70;

    this.foodStores = foodUnits;
    // Rough consumption: each settler eats about four units a day.
    this.foodDays = npcs.length > 0 ? foodUnits / (npcs.length * 4) : 99;

    // Settlement extent grows with what has been built.
    this.radius = 60 + Math.min(180, buildings.filter((b) => b.complete).length * 5.5);

    this.updateTier();
  }

  private updateTier(): void {
    let best: SettlementTier = 'camp';
    for (const tier of TIER_ORDER) {
      const req = TIER_REQUIREMENTS[tier];
      if (
        this.population >= req.population &&
        this.housingCapacity >= req.housing &&
        this.infrastructure.production >= req.production &&
        this.infrastructure.storage >= req.storage &&
        this.infrastructure.food >= req.food
      ) {
        best = tier;
      }
    }
    if (TIER_ORDER.indexOf(best) > TIER_ORDER.indexOf(this.tier)) {
      this.tier = best;
      this.justPromoted = best;
    } else if (TIER_ORDER.indexOf(best) < TIER_ORDER.indexOf(this.tier)) {
      // Settlements can decline, but not below what they have built.
      this.tier = best;
    }
  }

  clearPromotion(): void {
    this.justPromoted = null;
  }

  /** Requirements for the next tier, for the settlement panel. */
  nextTierNeeds(): { label: string; have: number; need: number }[] | null {
    const idx = TIER_ORDER.indexOf(this.tier);
    if (idx >= TIER_ORDER.length - 1) return null;
    const next = TIER_ORDER[idx + 1];
    const req = TIER_REQUIREMENTS[next];
    return [
      { label: 'Population', have: this.population, need: req.population },
      { label: 'Housing', have: this.housingCapacity, need: req.housing },
      { label: 'Production', have: Math.round(this.infrastructure.production), need: req.production },
      { label: 'Storage', have: Math.round(this.infrastructure.storage), need: req.storage },
      { label: 'Food', have: Math.round(this.infrastructure.food), need: req.food },
    ];
  }

  nextTierName(): string | null {
    const idx = TIER_ORDER.indexOf(this.tier);
    return idx >= TIER_ORDER.length - 1 ? null : TIER_LABELS[TIER_ORDER[idx + 1]];
  }

  /** True when a point is inside the settlement's area of influence. */
  contains(x: number, z: number): boolean {
    return Math.hypot(x - this.centre.x, z - this.centre.z) <= this.radius;
  }

  /** 0..1 overall health of the settlement, for the HUD. */
  get wellbeing(): number {
    const food = clamp01(this.foodDays / 8);
    const housed = this.population > 0 ? 1 - clamp01(this.homeless / this.population) : 1;
    const mood = clamp01(this.averageMood / 100);
    return food * 0.35 + housed * 0.25 + mood * 0.4;
  }

  serialize(): Record<string, unknown> {
    return {
      name: this.name,
      centre: this.centre,
      tier: this.tier,
      radius: this.radius,
      foundedDay: this.foundedDay,
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    if (typeof data.name === 'string') this.name = data.name;
    const c = data.centre as { x: number; z: number } | undefined;
    if (c && typeof c.x === 'number') this.centre = { x: c.x, z: c.z };
    if (typeof data.tier === 'string' && TIER_ORDER.includes(data.tier as SettlementTier)) {
      this.tier = data.tier as SettlementTier;
    }
    if (typeof data.radius === 'number') this.radius = data.radius;
    if (typeof data.foundedDay === 'number') this.foundedDay = data.foundedDay;
  }
}
