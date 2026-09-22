/**
 * The job board.
 *
 * Two kinds of work are coordinated here because they are shared across the
 * whole settlement and the player wants control over them: hauling and
 * construction. Profession work (felling, mining, crafting, farming) is driven
 * by each worker's own workplace and does not need a queue.
 *
 * The board is reconciled rather than accumulated: every refresh it checks that
 * each open job is still meaningful and creates whatever is missing. That makes
 * it self-healing when the world changes underneath it.
 */

import { ItemId } from '../data/items';
import { Building } from './Building';
import { ItemPile } from './ItemPile';

export type JobKind = 'haul' | 'build' | 'repair' | 'demolish';

export const PRIORITY_LABELS = ['Low', 'Normal', 'High', 'Critical'];

export interface BaseJob {
  id: number;
  kind: JobKind;
  /** 0 low .. 3 critical. */
  priority: number;
  assignedTo: number;
  x: number;
  z: number;
  /** Ticks since creation; used to expire jobs nobody can do. */
  age: number;
}

export interface HaulJob extends BaseJob {
  kind: 'haul';
  item: ItemId;
  amount: number;
  /**
   * How much was promised to the destination when the job was created. The
   * carried amount can shrink (a porter can only lift so much), and releasing
   * the reservation must undo exactly what was reserved or the destination
   * stays permanently "already supplied" and never gets another delivery.
   */
  reserved: number;
  sourceType: 'pile' | 'building';
  sourceId: number;
  destId: number;
  /** True when the goods are for a construction site rather than a store. */
  toSite: boolean;
}

export interface BuildJob extends BaseJob {
  kind: 'build';
  buildingId: number;
}

export interface RepairJob extends BaseJob {
  kind: 'repair';
  buildingId: number;
}

export interface DemolishJob extends BaseJob {
  kind: 'demolish';
  buildingId: number;
}

export type Job = HaulJob | BuildJob | RepairJob | DemolishJob;

export interface JobContext {
  buildings: Building[];
  buildingById: Map<number, Building>;
  piles: ItemPile[];
  pileById: Map<number, ItemPile>;
  tileSize: number;
  /** Finds the best store holding `item`, nearest to (x, z). */
  findSource: (item: ItemId, amount: number, x: number, z: number, excludeId: number) => Building | null;
  /** Finds the best store that will accept `item`, nearest to (x, z). */
  findDestination: (item: ItemId, x: number, z: number) => Building | null;
}

const MAX_HAUL_JOBS = 220;
const JOB_EXPIRY_TICKS = 900;

export class JobBoard {
  private jobs: Job[] = [];
  private nextId = 1;
  /** item -> units already promised to a destination, keyed by destination id. */
  private reservations = new Map<string, number>();

  get all(): readonly Job[] {
    return this.jobs;
  }

  get openCount(): number {
    let n = 0;
    for (const j of this.jobs) if (j.assignedTo === 0) n++;
    return n;
  }

  countByKind(kind: JobKind): number {
    let n = 0;
    for (const j of this.jobs) if (j.kind === kind) n++;
    return n;
  }

  byId(id: number): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  jobFor(npcId: number): Job | undefined {
    return this.jobs.find((j) => j.assignedTo === npcId);
  }

  release(jobId: number): void {
    const j = this.byId(jobId);
    if (j) j.assignedTo = 0;
  }

  remove(jobId: number): void {
    const i = this.jobs.findIndex((j) => j.id === jobId);
    if (i < 0) return;
    const job = this.jobs[i];
    if (job.kind === 'haul') this.unreserve(job);
    this.jobs.splice(i, 1);
  }

  /** Frees any jobs held by an NPC that has stopped working. */
  releaseAllFor(npcId: number): void {
    for (const j of this.jobs) if (j.assignedTo === npcId) j.assignedTo = 0;
  }

  private key(destId: number, item: ItemId): string {
    return `${destId}:${item}`;
  }

  private reserve(job: HaulJob): void {
    const k = this.key(job.destId, job.item);
    job.reserved = job.amount;
    this.reservations.set(k, (this.reservations.get(k) ?? 0) + job.reserved);
  }

  private unreserve(job: HaulJob): void {
    const k = this.key(job.destId, job.item);
    const next = (this.reservations.get(k) ?? 0) - (job.reserved ?? job.amount);
    if (next <= 0) this.reservations.delete(k);
    else this.reservations.set(k, next);
  }

  reservedFor(destId: number, item: ItemId): number {
    return this.reservations.get(this.key(destId, item)) ?? 0;
  }

  // -------------------------------------------------------- reconciliation

  refresh(ctx: JobContext): void {
    // 0. Release ground piles whose claimant no longer has a live job. Without
    //    this, one abandoned haul task strands a pile forever.
    const claimedPiles = new Set<number>();
    for (const j of this.jobs) {
      if (j.kind === 'haul' && j.sourceType === 'pile' && j.assignedTo !== 0) {
        claimedPiles.add(j.sourceId);
      }
    }
    for (const pile of ctx.piles) {
      if (pile.reservedBy !== 0 && !claimedPiles.has(pile.id)) pile.reservedBy = 0;
    }

    // 1. Drop jobs that no longer make sense.
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      j.age++;
      if (!this.isStillValid(j, ctx) || (j.assignedTo === 0 && j.age > JOB_EXPIRY_TICKS)) {
        if (j.kind === 'haul') this.unreserve(j);
        this.jobs.splice(i, 1);
      }
    }

    // 2. Construction work.
    for (const b of ctx.buildings) {
      if (b.complete || b.demolishing || b.paused) continue;
      if (!b.readyForWork()) continue;
      const existing = this.jobs.filter((j) => j.kind === 'build' && j.buildingId === b.id).length;
      const wanted = Math.min(b.def.buildCrew, Math.max(1, b.def.buildCrew));
      for (let k = existing; k < wanted; k++) {
        const p = b.accessPoint(ctx.tileSize);
        this.jobs.push({
          id: this.nextId++,
          kind: 'build',
          priority: b.priority,
          assignedTo: 0,
          buildingId: b.id,
          x: p.x,
          z: p.z,
          age: 0,
        });
      }
    }

    // 3. Repairs. A damaged building is worth more attention than a new one,
    //    because the settlement is already relying on it.
    for (const b of ctx.buildings) {
      if (!b.repairNeeded || b.demolishing || b.paused) continue;
      if (!b.readyToRepair()) continue;
      if (this.jobs.some((j) => j.kind === 'repair' && j.buildingId === b.id)) continue;
      const p = b.accessPoint(ctx.tileSize);
      this.jobs.push({
        id: this.nextId++,
        kind: 'repair',
        priority: Math.max(b.priority, 2),
        assignedTo: 0,
        buildingId: b.id,
        x: p.x,
        z: p.z,
        age: 0,
      });
    }

    // 4. Demolition.
    for (const b of ctx.buildings) {
      if (!b.demolishing) continue;
      const existing = this.jobs.some((j) => j.kind === 'demolish' && j.buildingId === b.id);
      if (existing) continue;
      const p = b.accessPoint(ctx.tileSize);
      this.jobs.push({
        id: this.nextId++,
        kind: 'demolish',
        priority: b.priority,
        assignedTo: 0,
        buildingId: b.id,
        x: p.x,
        z: p.z,
        age: 0,
      });
    }

    if (this.jobs.length >= MAX_HAUL_JOBS) return;

    // 5. Supply construction sites and repairs. This is the highest-value
    //    hauling in the game: a site without materials is a site standing idle.
    for (const b of ctx.buildings) {
      if (b.demolishing || b.paused) continue;
      const missing = b.complete ? b.missingRepairMaterials() : b.missingMaterials();
      if (missing.length === 0) continue;
      const dest = b.accessPoint(ctx.tileSize);
      for (const m of missing) {
        const promised = this.reservedFor(b.id, m.item);
        const stillNeeded = m.amount - promised;
        if (stillNeeded <= 0) continue;
        const source = ctx.findSource(m.item, 1, dest.x, dest.z, b.id);
        if (!source) continue;
        const take = Math.min(stillNeeded, source.inventory.count(m.item));
        if (take <= 0) continue;
        const sp = source.accessPoint(ctx.tileSize);
        const job: HaulJob = {
          id: this.nextId++,
          kind: 'haul',
          priority: Math.max(b.priority, 2),
          assignedTo: 0,
          item: m.item,
          amount: take,
          reserved: take,
          sourceType: 'building',
          sourceId: source.id,
          destId: b.id,
          toSite: true,
          x: sp.x,
          z: sp.z,
          age: 0,
        };
        this.jobs.push(job);
        this.reserve(job);
        if (this.jobs.length >= MAX_HAUL_JOBS) return;
      }
    }

    // 6. Collect loose piles from the ground.
    for (const pile of ctx.piles) {
      if (pile.reservedBy !== 0) continue;
      if (this.jobs.some((j) => j.kind === 'haul' && j.sourceType === 'pile' && j.sourceId === pile.id)) {
        continue;
      }
      const dest = ctx.findDestination(pile.item, pile.x, pile.z);
      if (!dest) continue;
      const job: HaulJob = {
        id: this.nextId++,
        kind: 'haul',
        priority: 1,
        assignedTo: 0,
        item: pile.item,
        amount: pile.count,
        reserved: pile.count,
        sourceType: 'pile',
        sourceId: pile.id,
        destId: dest.id,
        toSite: false,
        x: pile.x,
        z: pile.z,
        age: 0,
      };
      this.jobs.push(job);
      this.reserve(job);
      if (this.jobs.length >= MAX_HAUL_JOBS) return;
    }

    // 7. Feed workshops their recipe inputs.
    for (const b of ctx.buildings) {
      if (!b.complete || b.paused) continue;
      const needs = workshopNeeds(b);
      if (needs.length === 0) continue;
      const dest = b.accessPoint(ctx.tileSize);
      for (const n of needs) {
        const promised = this.reservedFor(b.id, n.item);
        const stillNeeded = n.amount - b.inventory.count(n.item) - promised;
        if (stillNeeded <= 0) continue;
        const source = ctx.findSource(n.item, 1, dest.x, dest.z, b.id);
        if (!source) continue;
        const take = Math.min(stillNeeded, source.inventory.count(n.item), b.inventory.spaceFor(n.item));
        if (take <= 0) continue;
        const sp = source.accessPoint(ctx.tileSize);
        const job: HaulJob = {
          id: this.nextId++,
          kind: 'haul',
          priority: b.priority,
          assignedTo: 0,
          item: n.item,
          amount: take,
          reserved: take,
          sourceType: 'building',
          sourceId: source.id,
          destId: b.id,
          toSite: false,
          x: sp.x,
          z: sp.z,
          age: 0,
        };
        this.jobs.push(job);
        this.reserve(job);
        if (this.jobs.length >= MAX_HAUL_JOBS) return;
      }
    }

    // 7. Clear finished goods out of workshops into proper storage, so the
    //    workshop does not clog and stop.
    for (const b of ctx.buildings) {
      if (!b.complete || b.def.category === 'storage') continue;
      if ((b.def.storageSlots ?? 0) === 0) continue;
      if (b.inventory.fullness < 0.55) continue;
      const outputs = workshopOutputs(b);
      for (const item of outputs) {
        const have = b.inventory.count(item);
        if (have < 4) continue;
        if (this.jobs.some((j) => j.kind === 'haul' && j.sourceId === b.id && j.item === item)) continue;
        const sp = b.accessPoint(ctx.tileSize);
        const dest = ctx.findDestination(item, sp.x, sp.z);
        if (!dest || dest.id === b.id) continue;
        const job: HaulJob = {
          id: this.nextId++,
          kind: 'haul',
          priority: 1,
          assignedTo: 0,
          item,
          amount: Math.min(have, 8),
          reserved: Math.min(have, 8),
          sourceType: 'building',
          sourceId: b.id,
          destId: dest.id,
          toSite: false,
          x: sp.x,
          z: sp.z,
          age: 0,
        };
        this.jobs.push(job);
        this.reserve(job);
        if (this.jobs.length >= MAX_HAUL_JOBS) return;
      }
    }
  }

  private isStillValid(job: Job, ctx: JobContext): boolean {
    if (job.kind === 'build') {
      const b = ctx.buildingById.get(job.buildingId);
      return !!b && !b.complete && !b.demolishing && !b.paused && b.readyForWork();
    }
    if (job.kind === 'repair') {
      const b = ctx.buildingById.get(job.buildingId);
      return !!b && b.repairNeeded && !b.demolishing && !b.paused && b.readyToRepair();
    }
    if (job.kind === 'demolish') {
      const b = ctx.buildingById.get(job.buildingId);
      return !!b && b.demolishing;
    }
    const dest = ctx.buildingById.get(job.destId);
    if (!dest) return false;
    // Site deliveries are for construction or for a repair; either way they
    // stop mattering once there is nothing left to deliver them for.
    if (job.toSite && dest.complete && !dest.repairNeeded) return false;
    if (job.sourceType === 'pile') {
      const p = ctx.pileById.get(job.sourceId);
      return !!p && (p.reservedBy === 0 || p.reservedBy === job.assignedTo);
    }
    const src = ctx.buildingById.get(job.sourceId);
    if (!src) return false;
    // Keep the job alive while a carrier already holds the goods.
    if (job.assignedTo !== 0) return true;
    return src.inventory.count(job.item) > 0;
  }

  // --------------------------------------------------------------- claiming

  /**
   * Picks the best open job for a worker. Preference order is priority first,
   * then distance, with a bonus for work the worker is good at — so a builder
   * across the settlement still loses a hauling job to an idle hauler stood
   * next to the pile.
   */
  claim(
    npcId: number,
    x: number,
    z: number,
    canDo: (job: Job) => boolean,
    affinity: (job: Job) => number,
  ): Job | null {
    let best: Job | null = null;
    let bestScore = -Infinity;
    for (const j of this.jobs) {
      if (j.assignedTo !== 0) continue;
      if (!canDo(j)) continue;
      const dist = Math.hypot(j.x - x, j.z - z);
      const score = j.priority * 120 + affinity(j) * 60 - dist;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best) best.assignedTo = npcId;
    return best;
  }

  serialize(): { id: number; kind: string; priority: number; assignedTo: number; data: Record<string, unknown> }[] {
    return this.jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      priority: j.priority,
      assignedTo: j.assignedTo,
      data: { ...j },
    }));
  }

  restore(rows: { id: number; kind: string; priority: number; assignedTo: number; data: Record<string, unknown> }[]): void {
    this.jobs = [];
    this.reservations.clear();
    for (const row of rows ?? []) {
      const j = row.data as unknown as Job;
      if (!j || !j.kind) continue;
      this.jobs.push(j);
      if (j.kind === 'haul') this.reserve(j);
      if (j.id >= this.nextId) this.nextId = j.id + 1;
    }
  }
}

/** Inputs a workshop wants stocked, based on the recipes it can run. */
export function workshopNeeds(b: Building): { item: ItemId; amount: number }[] {
  if (!b.def.recipes || b.def.recipes.length === 0) return [];
  const wanted = new Map<ItemId, number>();
  for (const rid of b.def.recipes) {
    if (b.disabledRecipes.has(rid)) continue;
    const recipe = RECIPE_LOOKUP[rid];
    if (!recipe) continue;
    for (const inp of recipe.inputs) {
      // Keep roughly four batches of each input on hand.
      wanted.set(inp.item, Math.max(wanted.get(inp.item) ?? 0, inp.amount * 4));
    }
  }
  return [...wanted.entries()].map(([item, amount]) => ({ item, amount }));
}

export function workshopOutputs(b: Building): ItemId[] {
  if (!b.def.recipes) return [];
  const out = new Set<ItemId>();
  for (const rid of b.def.recipes) {
    const recipe = RECIPE_LOOKUP[rid];
    if (!recipe) continue;
    for (const o of recipe.outputs) out.add(o.item);
  }
  // Gathering buildings also accumulate their harvest.
  if (b.def.gathers === 'wood') out.add('log');
  if (b.def.gathers === 'stone') out.add('stone');
  if (b.def.gathers === 'fish') out.add('fish');
  if (b.def.gathers === 'game') {
    out.add('meat');
    out.add('hide');
  }
  if (b.def.gathers === 'clay') {
    out.add('clay');
    out.add('sand');
  }
  if (b.def.gathers === 'ore') {
    out.add('iron_ore');
    out.add('copper_ore');
    out.add('coal');
  }
  if (b.def.farmPlots) {
    out.add('grain');
    out.add('vegetables');
  }
  return [...out];
}

// Imported lazily to avoid a cycle between data and simulation modules.
import { RECIPES } from '../data/recipes';
const RECIPE_LOOKUP = RECIPES;
