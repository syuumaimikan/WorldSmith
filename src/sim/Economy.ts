/**
 * Production tracking, prices, and shortage diagnosis.
 *
 * The interesting output here is not the money — it is telling the player *why*
 * their settlement has stalled. "No planks" is far less useful than "the
 * sawmill has no logs because nobody is hauling from the lumber camp".
 */

import { ItemId, ITEMS, ALL_ITEM_IDS } from '../data/items';
import { Building } from './Building';
import { clamp, clamp01 } from '../core/math';

export interface ItemStat {
  produced: number;
  consumed: number;
  stored: number;
  price: number;
}

export type BottleneckKind =
  | 'no_material'
  | 'no_workers'
  | 'storage_full'
  | 'no_haulers'
  | 'no_storage'
  | 'starving'
  | 'homeless'
  | 'idle_workshop';

/**
 * What is holding the settlement up, said in keys rather than in words.
 *
 * The simulation does not know what language anybody reads. It reports which
 * problem it found and the numbers involved; the HUD is where that turns into
 * a sentence.
 */
export interface Bottleneck {
  kind: BottleneckKind;
  /** Translation key for the one-line summary. */
  key: string;
  /** Translation key for the explanation behind it. */
  detailKey: string;
  params?: Record<string, string | number>;
  severity: 'info' | 'warn' | 'critical';
  buildingId?: number;
  item?: ItemId;
}

const DECAY = 0.92;

export class Economy {
  /** Rolling per-day production and consumption. */
  readonly stats = new Map<ItemId, ItemStat>();
  treasury = 240;
  bottlenecks: Bottleneck[] = [];

  constructor() {
    for (const id of ALL_ITEM_IDS) {
      this.stats.set(id, { produced: 0, consumed: 0, stored: 0, price: ITEMS[id].value });
    }
  }

  statOf(id: ItemId): ItemStat {
    let s = this.stats.get(id);
    if (!s) {
      s = { produced: 0, consumed: 0, stored: 0, price: ITEMS[id].value };
      this.stats.set(id, s);
    }
    return s;
  }

  recordProduction(item: ItemId, amount: number): void {
    this.statOf(item).produced += amount;
  }

  recordConsumption(item: ItemId, amount: number): void {
    this.statOf(item).consumed += amount;
  }

  /** Called once per game day. */
  rollDay(buildings: Building[]): void {
    const stored = new Map<ItemId, number>();
    for (const b of buildings) {
      if (!b.complete) continue;
      for (const s of b.inventory.slots) {
        if (!s) continue;
        stored.set(s.item, (stored.get(s.item) ?? 0) + s.count);
      }
    }

    for (const id of ALL_ITEM_IDS) {
      const st = this.statOf(id);
      st.stored = stored.get(id) ?? 0;

      // Price moves with scarcity: plentiful goods get cheap, scarce ones dear.
      const base = ITEMS[id].value;
      const demandPressure = st.consumed - st.produced;
      const scarcity = clamp(1.4 - st.stored / 40 + demandPressure * 0.02, 0.55, 2.4);
      st.price = st.price * 0.7 + base * scarcity * 0.3;

      st.produced *= DECAY;
      st.consumed *= DECAY;
    }
  }

  /**
   * What the settlement actually made today, valued at what it is worth. This
   * is what a tax is taken out of: a share of real goods, not of a number that
   * was invented to be taxed.
   */
  dailyOutput(known = 1): number {
    let total = 0;
    for (const [id, stat] of this.stats) {
      if (stat.produced <= 0) continue;
      // Dyed cloth, minted coin and a ship that can cross open water all mean
      // the same basket of goods is worth more than it was.
      total += stat.produced * ITEMS[id].value * known;
    }
    return total;
  }

  /**
   * What one of a thing fetches.
   *
   * @param known the settlement's trade multiplier -- dyes, coin and open
   *   water are each worth something on top of whatever the goods are.
   */
  priceOf(id: ItemId, known = 1): number {
    return Math.max(1, Math.round(this.statOf(id).price * known));
  }

  /**
   * Looks at the whole settlement and reports what is actually holding it up.
   */
  diagnose(
    buildings: Building[],
    haulerCount: number,
    foodDays: number,
    homeless: number,
    population: number,
  ): void {
    const out: Bottleneck[] = [];

    if (population > 0 && foodDays < 2) {
      out.push({
        kind: 'starving',
        key: 'bottleneck.starving',
        detailKey: 'bottleneck.starving.detail',
        params: { days: foodDays.toFixed(1) },
        severity: 'critical',
      });
    } else if (population > 0 && foodDays < 5) {
      out.push({
        kind: 'starving',
        key: 'bottleneck.foodLow',
        detailKey: 'bottleneck.foodLow.detail',
        params: { days: foodDays.toFixed(1) },
        severity: 'warn',
      });
    }

    if (homeless > 0) {
      out.push({
        kind: 'homeless',
        key: 'bottleneck.homeless',
        detailKey: 'bottleneck.homeless.detail',
        params: { count: homeless },
        severity: homeless > population * 0.4 ? 'critical' : 'warn',
      });
    }

    const stores = buildings.filter((b) => b.isStorage);
    if (stores.length === 0 && buildings.some((b) => b.complete)) {
      out.push({
        kind: 'no_storage',
        key: 'bottleneck.noStorage',
        detailKey: 'bottleneck.noStorage.detail',
        severity: 'warn',
      });
    } else if (stores.length > 0 && stores.every((s) => s.inventory.fullness > 0.96)) {
      out.push({
        kind: 'storage_full',
        key: 'bottleneck.storageFull',
        detailKey: 'bottleneck.storageFull.detail',
        severity: 'warn',
      });
    }

    if (haulerCount === 0 && buildings.filter((b) => b.complete).length > 2) {
      out.push({
        kind: 'no_haulers',
        key: 'bottleneck.noHaulers',
        detailKey: 'bottleneck.noHaulers.detail',
        severity: 'warn',
      });
    }

    // Stalled construction, with the specific missing material named.
    const missingTotals = new Map<ItemId, number>();
    let stalledSites = 0;
    for (const b of buildings) {
      if (b.complete || b.demolishing) continue;
      const missing = b.missingMaterials();
      if (missing.length === 0) continue;
      stalledSites++;
      for (const m of missing) {
        missingTotals.set(m.item, (missingTotals.get(m.item) ?? 0) + m.amount);
      }
    }
    if (stalledSites > 0) {
      const worst = [...missingTotals.entries()].sort((a, b) => b[1] - a[1])[0];
      if (worst) {
        out.push({
          kind: 'no_material',
          key: 'bottleneck.noMaterial',
          detailKey: 'bottleneck.noMaterial.detail',
          params: { sites: stalledSites, short: worst[1] },
          severity: 'info',
          item: worst[0],
        });
      }
    }

    // Workshops with nobody in them.
    for (const b of buildings) {
      if (!b.complete || b.def.workSlots === 0 || b.paused) continue;
      if (b.workerIds.length === 0) {
        out.push({
          kind: 'no_workers',
          key: 'bottleneck.noWorkers',
          detailKey: 'bottleneck.noWorkers.detail',
          severity: 'info',
          buildingId: b.id,
        });
      }
    }

    this.bottlenecks = out.slice(0, 8);
  }

  /** 0..1 how well supplied the settlement is with a given item. */
  supplyHealth(id: ItemId): number {
    const st = this.statOf(id);
    return clamp01(st.stored / 30);
  }

  serialize(): Record<string, unknown> {
    const stats: Record<string, ItemStat> = {};
    for (const [k, v] of this.stats) stats[k] = v;
    return { treasury: this.treasury, stats };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    if (typeof data.treasury === 'number') this.treasury = data.treasury;
    const stats = data.stats as Record<string, ItemStat> | undefined;
    if (stats) {
      for (const [k, v] of Object.entries(stats)) {
        if (ALL_ITEM_IDS.includes(k as ItemId)) this.stats.set(k as ItemId, v);
      }
    }
  }
}
