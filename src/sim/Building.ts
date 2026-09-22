/**
 * A building instance — which for most of its life means a construction site.
 *
 * A building is created as a blueprint and then works its way through its
 * stages. Each stage needs its materials physically delivered before work on it
 * can start, and needs a builder on site to do the work. There is no path from
 * blueprint to finished building that does not pass through both.
 */

import { BuildingDef, BuildingId, buildingDef, ConstructionStage, StageId } from '../data/buildings';
import { ItemId } from '../data/items';
import { RecipeId } from '../data/recipes';
import { Inventory } from './Inventory';
import { clamp01 } from '../core/math';

export interface FarmPlot {
  tx: number;
  tz: number;
  crop: 'grain' | 'vegetables' | null;
  /** 0..1 maturity. */
  growth: number;
  /** 0..1, decays daily; dry crops grow slowly. */
  watered: number;
  planted: boolean;
  /** Set while a farmer is working this plot. */
  reservedBy: number;
}

export type BuildingState = 'blueprint' | 'under_construction' | 'complete' | 'demolishing';

export class Building {
  readonly id: number;
  readonly defId: BuildingId;
  readonly def: BuildingDef;
  /** Origin tile (minimum corner) of the footprint. */
  tx: number;
  tz: number;
  /** 0..3, quarter turns. */
  rotation: number;
  /** Ground level the building sits at, in metres. */
  groundY = 0;
  worldX = 0;
  worldZ = 0;

  stageIndex = 0;
  stageWork = 0;
  stageMaterialsConsumed = false;
  complete = false;
  demolishing = false;
  demolishWork = 0;
  /** 1 = new, decays with use and weather. */
  condition = 1;
  /**
   * Set when damage has dropped the building below a usable state. Repair is
   * handled as construction work so it reuses builders, the job board and the
   * same visible on-site progress.
   */
  repairNeeded = false;
  /** Work put into the current repair. */
  repairWork = 0;
  /**
   * What the repair will cost in materials, fixed when the damage was taken.
   * Left as a snapshot rather than recomputed from condition, so a building
   * damaged again mid-repair does not quietly rewrite the bill already being
   * hauled against.
   */
  repairBill: Partial<Record<ItemId, number>> = {};
  /** Set once the bill has been taken out of the site store. */
  repairMaterialsConsumed = false;

  /** Finished-building store (workshop inputs/outputs, warehouse contents). */
  readonly inventory: Inventory;
  /** Materials delivered to the site for construction. */
  readonly siteStore = new Inventory(16);
  /** Units already en route, so haulers do not all fetch the same thing. */
  readonly incoming = new Map<ItemId, number>();

  workerIds: number[] = [];
  residentIds: number[] = [];
  startedDay = 0;
  completedDay = -1;
  builtBy: string[] = [];

  /** Current production job. */
  activeRecipe: RecipeId | null = null;
  productionProgress = 0;
  /** Recipes the player has switched off. */
  disabledRecipes = new Set<RecipeId>();

  fields: FarmPlot[] = [];

  /** 0 = low, 1 = normal, 2 = high, 3 = critical. */
  priority = 1;
  paused = false;

  /** Rolling output counter for the production analytics panel. */
  outputHistory: { item: ItemId; amount: number; day: number }[] = [];

  constructor(id: number, defId: BuildingId, tx: number, tz: number, rotation: number) {
    this.id = id;
    this.defId = defId;
    this.def = buildingDef(defId);
    this.tx = tx;
    this.tz = tz;
    this.rotation = rotation & 3;
    this.inventory = new Inventory(this.def.storageSlots ?? 0);
    if (this.def.storageFilter) this.inventory.filter = new Set(this.def.storageFilter);
  }

  // ------------------------------------------------------------- geometry

  get footprintWidth(): number {
    return this.rotation % 2 === 0 ? this.def.width : this.def.depth;
  }

  get footprintDepth(): number {
    return this.rotation % 2 === 0 ? this.def.depth : this.def.width;
  }

  occupies(tx: number, tz: number): boolean {
    return (
      tx >= this.tx &&
      tz >= this.tz &&
      tx < this.tx + this.footprintWidth &&
      tz < this.tz + this.footprintDepth
    );
  }

  /** Point where workers and haulers stand to interact with the building. */
  accessPoint(tileSize: number): { x: number; z: number } {
    const w = this.footprintWidth;
    const d = this.footprintDepth;
    // Just outside the front edge, which faces -Z at rotation 0.
    const cx = (this.tx + w / 2) * tileSize;
    const cz = (this.tz + d / 2) * tileSize;
    const offsets = [
      { x: 0, z: -(d / 2 + 0.9) * tileSize },
      { x: (w / 2 + 0.9) * tileSize, z: 0 },
      { x: 0, z: (d / 2 + 0.9) * tileSize },
      { x: -(w / 2 + 0.9) * tileSize, z: 0 },
    ];
    const o = offsets[this.rotation & 3];
    return { x: cx + o.x, z: cz + o.z };
  }

  centre(tileSize: number): { x: number; z: number } {
    return {
      x: (this.tx + this.footprintWidth / 2) * tileSize,
      z: (this.tz + this.footprintDepth / 2) * tileSize,
    };
  }

  // --------------------------------------------------------- construction

  get state(): BuildingState {
    if (this.demolishing) return 'demolishing';
    if (this.complete) return 'complete';
    return this.stageIndex === 0 && this.stageWork === 0 ? 'blueprint' : 'under_construction';
  }

  get currentStage(): ConstructionStage | null {
    return this.complete ? null : (this.def.stages[this.stageIndex] ?? null);
  }

  get stageProgress(): number {
    const s = this.currentStage;
    if (!s) return 1;
    return clamp01(this.stageWork / s.work);
  }

  /** 0..1 across the whole project, weighted by stage labour cost. */
  get progress(): number {
    if (this.complete) return 1;
    let done = 0;
    for (let i = 0; i < this.stageIndex; i++) done += this.def.stages[i].work;
    done += this.stageWork;
    return clamp01(done / Math.max(1, this.def.totalWork));
  }

  /** Materials still needed on site before the current stage can start. */
  missingMaterials(): { item: ItemId; amount: number }[] {
    const s = this.currentStage;
    if (!s || this.stageMaterialsConsumed) return [];
    const out: { item: ItemId; amount: number }[] = [];
    for (const [item, need] of Object.entries(s.materials) as [ItemId, number][]) {
      const have = this.siteStore.count(item) + (this.incoming.get(item) ?? 0);
      if (have < need) out.push({ item, amount: need - have });
    }
    return out;
  }

  /** Materials needed that are not already accounted for by deliveries. */
  materialsDelivered(): { item: ItemId; need: number; have: number }[] {
    const s = this.currentStage;
    if (!s) return [];
    return (Object.entries(s.materials) as [ItemId, number][]).map(([item, need]) => ({
      item,
      need,
      have: this.stageMaterialsConsumed ? need : this.siteStore.count(item),
    }));
  }

  /** True when the current stage has everything it needs to be worked on. */
  readyForWork(): boolean {
    if (this.complete || this.demolishing || this.paused) return false;
    const s = this.currentStage;
    if (!s) return false;
    if (this.stageMaterialsConsumed) return true;
    for (const [item, need] of Object.entries(s.materials) as [ItemId, number][]) {
      if (this.siteStore.count(item) < need) return false;
    }
    return true;
  }

  /** Consumes the current stage's materials. Call once work begins. */
  consumeStageMaterials(): boolean {
    const s = this.currentStage;
    if (!s || this.stageMaterialsConsumed) return true;
    for (const [item, need] of Object.entries(s.materials) as [ItemId, number][]) {
      if (this.siteStore.count(item) < need) return false;
    }
    for (const [item, need] of Object.entries(s.materials) as [ItemId, number][]) {
      this.siteStore.remove(item, need);
    }
    this.stageMaterialsConsumed = true;
    return true;
  }

  /**
   * Applies builder labour. Returns 'stage' when a stage finished and
   * 'complete' when the whole project did.
   */
  applyWork(amount: number, builderName?: string): 'none' | 'stage' | 'complete' {
    const s = this.currentStage;
    if (!s || !this.stageMaterialsConsumed) return 'none';
    if (builderName && !this.builtBy.includes(builderName)) this.builtBy.push(builderName);

    this.stageWork += amount;
    if (this.stageWork < s.work) return 'none';

    this.stageWork = 0;
    this.stageMaterialsConsumed = false;
    this.stageIndex++;
    if (this.stageIndex >= this.def.stages.length) {
      this.complete = true;
      this.stageIndex = this.def.stages.length;
      return 'complete';
    }
    return 'stage';
  }

  /** How much of a stage's material demand is already on site, 0..1. */
  materialReadiness(): number {
    const s = this.currentStage;
    if (!s) return 1;
    if (this.stageMaterialsConsumed) return 1;
    const entries = Object.entries(s.materials) as [ItemId, number][];
    if (entries.length === 0) return 1;
    let have = 0;
    let need = 0;
    for (const [item, n] of entries) {
      need += n;
      have += Math.min(n, this.siteStore.count(item));
    }
    return need === 0 ? 1 : have / need;
  }

  reserveIncoming(item: ItemId, amount: number): void {
    this.incoming.set(item, (this.incoming.get(item) ?? 0) + amount);
  }

  releaseIncoming(item: ItemId, amount: number): void {
    const cur = this.incoming.get(item) ?? 0;
    const next = cur - amount;
    if (next <= 0) this.incoming.delete(item);
    else this.incoming.set(item, next);
  }

  // ---------------------------------------------------------------- roles

  get hasWorkSlots(): boolean {
    return this.complete && this.def.workSlots > 0 && this.workerIds.length < this.def.workSlots;
  }

  get hasHousing(): boolean {
    return this.complete && (this.def.housing ?? 0) > this.residentIds.length;
  }

  get isStorage(): boolean {
    return this.complete && (this.def.storageSlots ?? 0) > 0 && this.def.category === 'storage';
  }

  /** Any complete building that will accept goods, storage or not. */
  acceptsGoods(item: ItemId): boolean {
    if (!this.complete) return false;
    if ((this.def.storageSlots ?? 0) === 0) return false;
    return this.inventory.spaceFor(item) > 0;
  }

  displayName(): string {
    return this.def.name;
  }

  /** Total labour to bring a damaged building back to full condition. */
  get repairWorkRequired(): number {
    return Math.max(4, this.def.totalWork * 0.35 * (1 - this.condition));
  }

  /**
   * Works out what putting this building right will take.
   *
   * Repair costs a share of the original recipe in proportion to the damage,
   * with a floor of one unit of anything that is needed at all: you cannot
   * patch a wall with three-tenths of a stone block.
   */
  computeRepairBill(): void {
    const share = clamp01(1 - this.condition) * 0.6;
    const bill: Partial<Record<ItemId, number>> = {};
    for (const [item, total] of Object.entries(this.def.totalMaterials) as [ItemId, number][]) {
      const amount = Math.round(total * share);
      if (amount > 0) bill[item] = amount;
    }
    this.repairBill = bill;
    this.repairMaterialsConsumed = false;
    this.repairWork = 0;
  }

  /** Repair materials still to be delivered, net of what is already coming. */
  missingRepairMaterials(): { item: ItemId; amount: number }[] {
    if (!this.repairNeeded || this.repairMaterialsConsumed) return [];
    const out: { item: ItemId; amount: number }[] = [];
    for (const [item, need] of Object.entries(this.repairBill) as [ItemId, number][]) {
      const have = this.siteStore.count(item) + (this.incoming.get(item) ?? 0);
      if (have < need) out.push({ item, amount: need - have });
    }
    return out;
  }

  /** True when everything the repair needs is on site. */
  readyToRepair(): boolean {
    if (!this.repairNeeded || this.demolishing) return false;
    if (this.repairMaterialsConsumed) return true;
    for (const [item, need] of Object.entries(this.repairBill) as [ItemId, number][]) {
      if (this.siteStore.count(item) < need) return false;
    }
    return true;
  }

  /** Takes the repair materials out of the site store. Call once work begins. */
  consumeRepairMaterials(): boolean {
    if (this.repairMaterialsConsumed) return true;
    for (const [item, need] of Object.entries(this.repairBill) as [ItemId, number][]) {
      if (this.siteStore.count(item) < need) return false;
    }
    for (const [item, need] of Object.entries(this.repairBill) as [ItemId, number][]) {
      this.siteStore.remove(item, need);
    }
    this.repairMaterialsConsumed = true;
    return true;
  }

  /**
   * What this building is doing, as a key and its parameters rather than as a
   * sentence. The simulation should never decide what language the player
   * reads; `buildingStatus` in the i18n layer turns this into words.
   */
  status(): { key: string; stage?: StageId; stageName?: string } {
    if (this.demolishing) return { key: 'status.demolishing' };
    if (this.repairNeeded) {
      return { key: this.readyToRepair() ? 'status.repairing' : 'status.awaitingRepair' };
    }
    if (this.complete) {
      if (this.paused) return { key: 'status.paused' };
      if (this.def.workSlots > 0 && this.workerIds.length === 0) return { key: 'status.noWorkers' };
      return { key: 'status.operating' };
    }
    const s = this.currentStage;
    if (!s) return { key: 'status.complete' };
    return {
      key: this.readyForWork() ? 'status.working' : 'status.awaitingMaterials',
      stage: s.id,
      stageName: s.name,
    };
  }
}
