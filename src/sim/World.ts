/**
 * The simulated world: terrain, resources, people, buildings, economy, time.
 *
 * This object owns all mutable game state. Rendering reads from it and never
 * writes to it, which keeps the simulation authoritative and makes save/load
 * and headless testing straightforward.
 *
 * The one rule that shapes everything here: goods and labour are physical.
 * Nothing is created by a number going up — a thing exists somewhere, someone
 * walks to it, and someone carries it to where it is needed.
 */

import { Terrain, OVERLAY } from '../world/Terrain';
import { ResourceNode, RESOURCES, ResourceKind } from '../world/resources';
import { Biome, OreVein, PointOfInterest, WorldConfig } from '../world/types';
import { SpatialGrid } from '../core/SpatialGrid';
import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import { GameTime, SeasonName } from './Time';
import { Player, Obstacle } from './Player';
import { ItemId, ITEMS, FOOD_PRIORITY, isFood } from '../data/items';
import { EventLog } from './EventLog';
import { Building, FarmPlot } from './Building';
import { BuildingId, BUILDINGS, buildingDef } from '../data/buildings';
import { Recipe, RECIPES, RecipeId } from '../data/recipes';
import { Npc } from './Npc';
import { ProfessionId, PROFESSIONS, personName } from '../data/professions';
import { JobBoard, JobContext } from './Jobs';
import { Navigation } from './Navigation';
import { WeatherSystem } from './Weather';
import { ClimateSystem } from './Climate';
import { StormSystem } from './Storms';
import { Namer } from './Naming';
import { ResearchSystem } from './Research';
import { Settlement } from './Settlement';
import { Economy } from './Economy';
import { Animal, ANIMALS, AnimalSpecies, createAnimal, speciesForBiome } from './Wildlife';
import { ItemPile, createPile } from './ItemPile';
import { updateNpc } from './systems/NpcAI';
import { updateAnimals } from './systems/WildlifeAI';
import { TerrainEditor } from '../world/TerrainEdit';
import { DisasterManager } from './Disasters';
import { DisasterDirector } from './DisasterDirector';
import { DiseaseSystem } from './Disease';
import { Tectonics } from './Tectonics';
import { Astronomy } from './Astronomy';
import { NationSystem } from './Nations';
import { DiplomacySystem } from './Diplomacy';
import type { Volcano, VolcanoState } from './Volcano';
import { updateVolcanoes } from './Volcano';
import { SavedBuilding, SavedNpc, SavedJob, SavedVolcano } from '../persistence/schema';
import { Inventory } from './Inventory';

export interface HarvestResult {
  items: { item: ItemId; amount: number }[];
  completedUnit: boolean;
  nodeDepleted: boolean;
}

export interface PlacementCheck {
  ok: boolean;
  reason: string;
  groundY: number;
}

const JOB_REFRESH_INTERVAL = 1.4;
const SETTLEMENT_INTERVAL = 4;
const ASSIGNMENT_INTERVAL = 6;
const PILE_LIMIT = 900;
/**
 * Game hours between atmosphere steps. Fifteen minutes of weather is fine
 * grain for something that moves at the speed of a cloud, and it keeps the
 * grid work off the hot path.
 */
const CLIMATE_STEP_HOURS = 0.25;

export class World {
  readonly config: WorldConfig;
  readonly terrain: Terrain;
  readonly time: GameTime;
  readonly player: Player;
  readonly rng: Rng;
  log: EventLog;

  readonly nodes: ResourceNode[] = [];
  readonly nodeById = new Map<number, ResourceNode>();
  readonly nodeGrid = new SpatialGrid<ResourceNode>(8);
  readonly veins: OreVein[];
  readonly pois: PointOfInterest[];

  readonly piles: ItemPile[] = [];
  readonly pileById = new Map<number, ItemPile>();
  readonly pileGrid = new SpatialGrid<ItemPile>(10);

  readonly buildings: Building[] = [];
  readonly buildingById = new Map<number, Building>();
  /** Tile index -> building id, for fast "what is here" lookups. */
  private buildingAtTile = new Map<number, number>();

  readonly npcs: Npc[] = [];
  readonly npcById = new Map<number, Npc>();
  readonly npcGrid = new SpatialGrid<Npc>(12);

  readonly volcanoes: Volcano[] = [];
  readonly wildlife: Animal[] = [];
  readonly wildlifeById = new Map<number, Animal>();

  readonly jobs = new JobBoard();
  readonly nav: Navigation;
  readonly weather: WeatherSystem;
  readonly climate: ClimateSystem;
  readonly storms: StormSystem;
  readonly namer: Namer;
  readonly research = new ResearchSystem();
  readonly settlement: Settlement;
  readonly economy = new Economy();
  readonly editor: TerrainEditor;
  readonly disasters: DisasterManager;
  readonly director: DisasterDirector;
  readonly tectonics: Tectonics;
  readonly astronomy: Astronomy;
  readonly nations: NationSystem;
  readonly diplomacy: DiplomacySystem;
  readonly disease: DiseaseSystem;
  /**
   * How hard the settlement is rationing, 0 when there is plenty. A famine is
   * not an effect applied to people; it is the state of there being nothing to
   * eat, and this is only how severe that has got.
   */
  famineSeverity = 0;

  /** Per-tile exploration mask driving fog of war on the world map. */
  readonly explored: Uint8Array;
  /** Npc currently being played directly in god mode, or 0. */
  possessed = 0;
  /** Index of the tutorial step the player has reached. */
  tutorialStep = 0;
  /** Set when the player has an entity selected in the inspector. */
  selection: { kind: 'npc' | 'building' | 'node' | 'pile'; id: number } | null = null;

  private nextEntityId = 1;
  treesFelled = 0;
  private regrowing: ResourceNode[] = [];
  private jobTimer = 0;
  private settlementTimer = 0;
  private assignmentTimer = 0;
  /** Ore kind each mine is working, decided by the vein it sits on. */
  private mineOre = new Map<number, ItemId[]>();
  /** Throttles repeated ashfall messages during a long eruption. */
  private lastAshReport = -99;
  /** Day a meteor shower was last reported, so it is announced once. */
  private lastShowerDay = -1;
  /** Game hours of weather owed to the atmosphere since it last stepped. */
  private climateAccum = 0;
  /** Running totals, for the chronicle and the statistics screens. */
  lightningStrikes = 0;
  snowmeltCarried = 0;
  /** Cached share of steep dry land; recomputed when the terrain is edited. */
  private steepFraction = 0;
  private steepFractionDirty = true;

  constructor(
    config: WorldConfig,
    terrain: Terrain,
    nodes: ResourceNode[],
    veins: OreVein[],
    pois: PointOfInterest[],
    startX: number,
    startZ: number,
    time?: GameTime,
  ) {
    this.config = config;
    this.terrain = terrain;
    this.veins = veins;
    this.pois = pois;
    this.rng = new Rng(config.seed ^ 0xa17c);
    this.time = time ?? new GameTime(6.5);
    this.log = new EventLog();
    this.nav = new Navigation(terrain);
    this.explored = new Uint8Array(terrain.gridSize * terrain.gridSize);
    this.weather = new WeatherSystem(config.seed, config.climate);
    this.namer = new Namer(config.seed);
    this.climate = new ClimateSystem(terrain, config.seed, config.climate);
    this.storms = new StormSystem(config.seed);
    this.settlement = new Settlement(config.name, startX, startZ);
    this.editor = new TerrainEditor(terrain);
    this.disasters = new DisasterManager(config.seed);
    this.director = new DisasterDirector(config.seed);
    this.tectonics = new Tectonics(terrain, config.seed, (i) =>
      this.namer.featureName('region', `plate${i}`),
    );
    this.astronomy = new Astronomy(config.seed, this.namer);
    this.nations = new NationSystem(terrain, config.seed, this.namer);
    this.diplomacy = new DiplomacySystem(config.seed);
    this.disease = new DiseaseSystem(config.seed);

    for (const n of nodes) this.addNode(n);
    for (const n of nodes) if (n.id >= this.nextEntityId) this.nextEntityId = n.id + 1;

    this.player = new Player(startX, startZ);
    this.player.placeOnGround(terrain);

    this.time.onNewDay.push((day) => this.onNewDay(day));
  }

  /** Called once after a fresh world is generated. */
  bootstrap(): void {
    // The people who are here become a polity, and the world gets neighbours.
    // How many depends on how much room there is for them.
    this.nations.foundPlayerNation(this);
    const room = Math.round((this.terrain.worldSize / 420) * 3);
    this.nations.seedForeignNations(this, Math.max(2, Math.min(6, room)));
    this.settlement.foundedDay = this.time.totalDays;
    this.spawnStartingSettlers();
    this.spawnWildlife();
    this.giveStartingSupplies();
    this.log.add(
      this.time,
      'settlement',
      'ev.founded',
      { name: this.config.name, count: this.npcs.length },
      { notable: true, x: this.settlement.centre.x, z: this.settlement.centre.z },
    );
  }

  nextId(): number {
    return this.nextEntityId++;
  }

  peekNextId(): number {
    return this.nextEntityId;
  }

  restoreNextId(v: number): void {
    this.nextEntityId = Math.max(this.nextEntityId, v);
  }

  replaceLog(log: EventLog): void {
    this.log = log;
  }

  // =======================================================================
  // Resource nodes
  // =======================================================================

  addNode(node: ResourceNode): void {
    this.nodes.push(node);
    this.nodeById.set(node.id, node);
    this.nodeGrid.insert(node.x, node.z, node);
  }

  removeNode(node: ResourceNode): void {
    const i = this.nodes.indexOf(node);
    if (i >= 0) {
      this.nodes[i] = this.nodes[this.nodes.length - 1];
      this.nodes.pop();
    }
    this.nodeById.delete(node.id);
    this.nodeGrid.remove(node.x, node.z, node);
  }

  findNode(
    x: number,
    z: number,
    radius: number,
    predicate: (n: ResourceNode) => boolean,
  ): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = radius * radius;
    this.nodeGrid.forEachNear(x, z, radius, (n) => {
      if (n.depleted || n.growth < 0.85) return;
      if (!predicate(n)) return;
      const dx = n.x - x;
      const dz = n.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = n;
      }
    });
    return best;
  }

  harvestNode(node: ResourceNode, work: number): HarvestResult {
    const def = RESOURCES[node.kind];
    const result: HarvestResult = { items: [], completedUnit: false, nodeDepleted: false };
    if (node.depleted || node.amount <= 0) {
      result.nodeDepleted = true;
      return result;
    }

    node.work += work;
    while (node.work >= def.workPerUnit && node.amount > 0) {
      node.work -= def.workPerUnit;
      node.amount--;
      result.completedUnit = true;
      for (const y of def.yields) {
        const existing = result.items.find((i) => i.item === y.item);
        if (existing) existing.amount += y.amount;
        else result.items.push({ item: y.item, amount: y.amount });
      }
    }

    if (node.amount <= 0) {
      node.depleted = true;
      node.work = 0;
      node.reservedBy = 0;
      result.nodeDepleted = true;
      if (def.category === 'tree') this.treesFelled++;
      if (def.regrowDays > 0) {
        node.regrowIn = def.regrowDays;
        this.regrowing.push(node);
      } else {
        this.removeNode(node);
      }
    }

    for (const it of result.items) this.economy.recordProduction(it.item, it.amount);
    return result;
  }

  /** Plants a sapling, used by foresters and natural regrowth. */
  plantSapling(kind: ResourceKind, x: number, z: number): ResourceNode | null {
    const tx = this.terrain.tileX(x);
    const tz = this.terrain.tileZ(z);
    if (!this.terrain.inBounds(tx, tz)) return null;
    if (this.terrain.isWaterTile(tx, tz)) return null;
    if (this.terrain.overlayAt(tx, tz) !== 0) return null;
    if (this.buildingAtTile.has(this.terrain.index(tx, tz))) return null;

    let crowded = false;
    this.nodeGrid.forEachNear(x, z, 2.4, (n) => {
      if (!n.depleted && RESOURCES[n.kind].category === 'tree') crowded = true;
    });
    if (crowded) return null;

    const def = RESOURCES[kind];
    const node: ResourceNode = {
      id: this.nextId(),
      kind,
      x,
      z,
      y: this.terrain.heightAt(x, z),
      rot: this.rng.range(0, Math.PI * 2),
      scale: 0.9 + this.rng.next() * 0.35,
      variant: this.rng.int(0, 3),
      amount: def.units,
      maxAmount: def.units,
      growth: 0.08,
      regrowIn: -1,
      reservedBy: 0,
      work: 0,
      depleted: false,
    };
    this.addNode(node);
    return node;
  }

  // =======================================================================
  // Ground piles
  // =======================================================================

  dropPile(item: ItemId, count: number, x: number, z: number): ItemPile | null {
    if (count <= 0) return null;

    // Merge into a nearby pile of the same item rather than littering.
    let merged: ItemPile | null = null;
    this.pileGrid.forEachNear(x, z, 2.6, (p) => {
      if (merged) return;
      if (p.item === item && p.reservedBy === 0 && p.count < ITEMS[item].stackSize * 3) merged = p;
    });
    if (merged) {
      (merged as ItemPile).count += count;
      return merged;
    }

    if (this.piles.length >= PILE_LIMIT) {
      // Hard cap: drop the oldest unreserved pile so we never grow without bound.
      const victim = this.piles.find((p) => p.reservedBy === 0);
      if (victim) this.removePile(victim);
    }

    const pile = createPile(
      this.nextId(),
      item,
      count,
      x,
      this.terrain.heightAt(x, z),
      z,
      this.time.totalDays,
      this.rng.range(0, Math.PI * 2),
    );
    this.piles.push(pile);
    this.pileById.set(pile.id, pile);
    this.pileGrid.insert(pile.x, pile.z, pile);
    return pile;
  }

  removePile(pile: ItemPile): void {
    const i = this.piles.indexOf(pile);
    if (i >= 0) {
      this.piles[i] = this.piles[this.piles.length - 1];
      this.piles.pop();
    }
    this.pileById.delete(pile.id);
    this.pileGrid.remove(pile.x, pile.z, pile);
  }

  // =======================================================================
  // Buildings
  // =======================================================================

  /** Checks whether a building may be placed at a tile, and why not if so. */
  canPlace(defId: BuildingId, tx: number, tz: number, rotation: number): PlacementCheck {
    const def = buildingDef(defId);
    const w = rotation % 2 === 0 ? def.width : def.depth;
    const d = rotation % 2 === 0 ? def.depth : def.width;
    const t = this.terrain;

    if (!this.research.buildingUnlocked(defId)) {
      return { ok: false, reason: 'Not researched yet', groundY: 0 };
    }

    if (tx < 1 || tz < 1 || tx + w > t.gridSize - 1 || tz + d > t.gridSize - 1) {
      return { ok: false, reason: 'Outside the world', groundY: 0 };
    }

    // Bridges are the one thing that must be on water.
    if (def.placement.onWater) {
      let anyWater = false;
      for (let z = tz; z < tz + d; z++)
        for (let x = tx; x < tx + w; x++) if (t.isWaterTile(x, z)) anyWater = true;
      if (!anyWater) return { ok: false, reason: 'Bridges must span water', groundY: 0 };
      return { ok: true, reason: '', groundY: t.waterAtTile(tx, tz) };
    }

    let minH = Infinity;
    let maxH = -Infinity;
    let slopeSum = 0;
    let tiles = 0;
    for (let z = tz; z < tz + d; z++) {
      for (let x = tx; x < tx + w; x++) {
        const i = t.index(x, z);
        if (t.isWaterTile(x, z)) return { ok: false, reason: 'Cannot build on water', groundY: 0 };
        if (this.buildingAtTile.has(i)) {
          return { ok: false, reason: 'Something is already here', groundY: 0 };
        }
        slopeSum += t.data.slope[i];
        tiles++;
        const h = t.data.height[i];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }

    // Judged on the *average* slope over the footprint rather than the worst
    // tile: the first construction stage is site clearance, so a builder can
    // level out local bumps. What they cannot do is flatten a hillside, which
    // the height-range check below catches.
    if (tiles > 0 && slopeSum / tiles > def.placement.maxSlope) {
      return { ok: false, reason: 'Ground is too steep', groundY: 0 };
    }

    // Levelling tolerance scales with footprint: a road can follow a slope, a
    // town hall cannot.
    const tolerance = def.linear ? 4 : 1.6 + Math.max(w, d) * 0.45;
    if (maxH - minH > tolerance) {
      return { ok: false, reason: 'Ground is too uneven', groundY: 0 };
    }

    const cx = (tx + w / 2) * t.tileSize;
    const cz = (tz + d / 2) * t.tileSize;

    if (def.placement.nearWater !== undefined) {
      let found = false;
      const r = def.placement.nearWater;
      for (let z = tz - r; z <= tz + d + r && !found; z++)
        for (let x = tx - r; x <= tx + w + r; x++) {
          if (t.isWaterTile(x, z)) {
            found = true;
            break;
          }
        }
      if (!found) return { ok: false, reason: 'Must be built beside water', groundY: 0 };
    }

    if (def.placement.nearOre) {
      const vein = this.nearestVein(cx, cz, 26);
      if (!vein) return { ok: false, reason: 'No ore vein here', groundY: 0 };
    }

    if (def.placement.minFertility !== undefined) {
      let total = 0;
      let count = 0;
      for (let z = tz; z < tz + d; z++)
        for (let x = tx; x < tx + w; x++) {
          total += t.data.fertility[t.index(x, z)];
          count++;
        }
      if (count === 0 || total / count < def.placement.minFertility) {
        return { ok: false, reason: 'Soil is too poor to farm', groundY: 0 };
      }
    }

    if (def.placement.nearTrees !== undefined) {
      let trees = 0;
      this.nodeGrid.forEachNear(cx, cz, def.placement.nearTrees, (n) => {
        if (!n.depleted && RESOURCES[n.kind].category === 'tree') trees++;
      });
      if (trees < 6) return { ok: false, reason: 'Not enough timber nearby', groundY: 0 };
    }

    if (def.placement.needsSettlement && !this.settlement.contains(cx, cz)) {
      return { ok: false, reason: 'Too far from the settlement', groundY: 0 };
    }

    return { ok: true, reason: '', groundY: (minH + maxH) / 2 };
  }

  nearestVein(x: number, z: number, maxDist: number): OreVein | null {
    let best: OreVein | null = null;
    let bestD = maxDist * maxDist;
    for (const v of this.veins) {
      const d2 = (v.x - x) ** 2 + (v.z - z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = v;
      }
    }
    return best;
  }

  /** Creates a blueprint. It is a construction site from this moment on. */
  placeBuilding(defId: BuildingId, tx: number, tz: number, rotation: number): Building | null {
    const check = this.canPlace(defId, tx, tz, rotation);
    if (!check.ok) return null;

    const b = new Building(this.nextId(), defId, tx, tz, rotation);
    b.groundY = check.groundY;
    const c = b.centre(this.terrain.tileSize);
    b.worldX = c.x;
    b.worldZ = c.z;
    b.startedDay = this.time.totalDays;
    b.priority = 1;

    this.buildings.push(b);
    this.buildingById.set(b.id, b);
    for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
      for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
        this.buildingAtTile.set(this.terrain.index(x, z), b.id);
      }
    }

    // Clear anything growing on the footprint; the materials are salvaged.
    this.clearFootprint(b);

    if (b.def.gathers === 'ore') {
      const vein = this.nearestVein(b.worldX, b.worldZ, 30);
      this.mineOre.set(b.id, oreItemsFor(vein));
    }

    this.log.add(this.time, 'construction', 'ev.blueprint', { name: b.defId }, {
      x: b.worldX,
      z: b.worldZ,
    });
    this.advanceTutorial(1);
    return b;
  }

  private clearFootprint(b: Building): void {
    const ts = this.terrain.tileSize;
    const cx = b.worldX;
    const cz = b.worldZ;
    const radius = Math.max(b.footprintWidth, b.footprintDepth) * ts * 0.75;
    const doomed: ResourceNode[] = [];
    this.nodeGrid.forEachNear(cx, cz, radius + 2, (n) => {
      const tx = this.terrain.tileX(n.x);
      const tz = this.terrain.tileZ(n.z);
      if (b.occupies(tx, tz)) doomed.push(n);
    });
    for (const n of doomed) {
      // Salvage: clearing a wooded plot yields some of its timber.
      if (!n.depleted) {
        const def = RESOURCES[n.kind];
        for (const y of def.yields) {
          const salvaged = Math.max(1, Math.round(y.amount * n.amount * 0.5));
          this.dropPile(y.item, salvaged, n.x, n.z);
        }
      }
      this.removeNode(n);
    }
  }

  cancelBuilding(b: Building): void {
    // Return any delivered materials to the ground so nothing is destroyed.
    for (const slot of b.siteStore.slots) {
      if (slot) this.dropPile(slot.item, slot.count, b.worldX, b.worldZ);
    }
    this.destroyBuilding(b);
    this.log.add(this.time, 'construction', 'ev.cancelled', { name: b.defId });
  }

  startDemolition(b: Building): void {
    if (!b.complete) {
      this.cancelBuilding(b);
      return;
    }
    b.demolishing = true;
    b.demolishWork = 0;
    this.log.add(this.time, 'construction', 'ev.demolishScheduled', { name: b.defId });
  }

  completeDemolition(b: Building): void {
    // Recover roughly half the materials that went into it.
    for (const [item, amount] of Object.entries(b.def.totalMaterials) as [ItemId, number][]) {
      const recovered = Math.floor(amount * 0.45);
      if (recovered > 0) this.dropPile(item, recovered, b.worldX, b.worldZ);
    }
    for (const slot of b.inventory.slots) {
      if (slot) this.dropPile(slot.item, slot.count, b.worldX, b.worldZ);
    }
    this.log.add(this.time, 'construction', 'ev.demolished', { name: b.defId }, {
      x: b.worldX,
      z: b.worldZ,
    });
    this.destroyBuilding(b);
  }

  private destroyBuilding(b: Building): void {
    for (const id of b.residentIds) {
      const n = this.npcById.get(id);
      if (n) n.homeId = 0;
    }
    for (const id of b.workerIds) {
      const n = this.npcById.get(id);
      if (n) {
        n.workplaceId = 0;
        n.clearTask();
      }
    }
    for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
      for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
        const i = this.terrain.index(x, z);
        if (this.buildingAtTile.get(i) === b.id) this.buildingAtTile.delete(i);
        this.terrain.clearOverlay(x, z, OVERLAY.Floor | OVERLAY.Field | OVERLAY.Tilled | OVERLAY.Road);
        this.nav.setBlocked(x, z, false);
      }
    }
    this.jobs.releaseAllFor(0);
    for (const j of [...this.jobs.all]) {
      if ((j.kind === 'build' || j.kind === 'demolish') && j.buildingId === b.id) this.jobs.remove(j.id);
      if (j.kind === 'haul' && (j.destId === b.id || j.sourceId === b.id)) this.jobs.remove(j.id);
    }
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    this.buildingById.delete(b.id);
    this.mineOre.delete(b.id);
    this.nav.markCostDirty();
  }

  buildingAt(tx: number, tz: number): Building | undefined {
    const id = this.buildingAtTile.get(this.terrain.index(tx, tz));
    return id === undefined ? undefined : this.buildingById.get(id);
  }

  /** Called when a construction stage finishes. */
  onStageCompleted(b: Building): void {
    const justDone = b.def.stages[b.stageIndex - 1];
    if (!justDone) return;

    // Clearing levels the ground visually and makes it walkable floor.
    if (justDone.id === 'clearing' || justDone.id === 'foundation') {
      for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
        for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
          if (b.def.style === 'field') this.terrain.setOverlay(x, z, OVERLAY.Field);
          else if (b.def.style === 'road') this.terrain.setOverlay(x, z, OVERLAY.Road);
          else this.terrain.setOverlay(x, z, OVERLAY.Floor);
        }
      }
      this.nav.markCostDirty();
    }

    this.log.add(
      this.time,
      'construction',
      'ev.stageDone',
      { name: b.defId, stage: justDone.id },
      { x: b.worldX, z: b.worldZ },
    );
  }

  onBuildingCompleted(b: Building, builder?: Npc): void {
    b.completedDay = this.time.totalDays;
    b.condition = 1;

    for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
      for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
        if (b.def.style === 'road' || b.def.style === 'bridge') {
          this.terrain.setOverlay(x, z, OVERLAY.Road);
        } else if (b.def.style === 'field') {
          this.terrain.setOverlay(x, z, OVERLAY.Field);
        } else if (b.def.style !== 'stockpile' && b.def.style !== 'fence' && b.def.style !== 'lamp') {
          this.terrain.setOverlay(x, z, OVERLAY.Floor);
          // Solid buildings block movement; people walk around them.
          this.nav.setBlocked(x, z, true);
        }
      }
    }
    this.nav.markCostDirty();

    if (b.def.farmPlots) this.createFarmPlots(b);

    this.log.add(
      this.time,
      'construction',
      builder ? 'ev.completedBy' : 'ev.completed',
      { name: b.defId, who: builder ? builder.name : '' },
      { notable: true, x: b.worldX, z: b.worldZ },
    );

    if (b.def.housing) this.advanceTutorial(5);
    this.advanceTutorial(4);
  }

  private createFarmPlots(b: Building): void {
    b.fields = [];
    for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
      for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
        b.fields.push({ tx: x, tz: z, crop: null, growth: 0, watered: 0.5, planted: false, reservedBy: 0 });
        this.terrain.setOverlay(x, z, OVERLAY.Field);
      }
    }
  }

  onGoodsDelivered(dest: Building, item: ItemId, amount: number): void {
    void amount;
    if (!dest.complete) this.advanceTutorial(3);
    if (isFood(item)) this.economy.statOf(item).stored += 0;
  }

  // =======================================================================
  // Production
  // =======================================================================

  /** Work needed per unit extracted at a quarry, mine or fishery. */
  extractionCost(b: Building): number {
    switch (b.def.gathers) {
      case 'stone':
        return 20;
      case 'ore':
        return 30;
      case 'clay':
        return 14;
      case 'fish':
        return 24;
      default:
        return 20;
    }
  }

  produceExtraction(b: Building, npc: Npc): void {
    let items: { item: ItemId; amount: number }[];
    switch (b.def.gathers) {
      case 'stone':
        items = [{ item: 'stone', amount: 2 }];
        break;
      case 'ore': {
        const pool = this.mineOre.get(b.id) ?? ['iron_ore'];
        items = [{ item: this.rng.pick(pool), amount: 2 }];
        break;
      }
      case 'clay':
        items = [{ item: this.rng.chance(0.7) ? 'clay' : 'sand', amount: 2 }];
        break;
      case 'fish':
        items = [{ item: 'fish', amount: 1 }];
        break;
      default:
        return;
    }
    for (const it of items) {
      const added = b.inventory.add(it.item, it.amount);
      if (added < it.amount) {
        this.dropPile(it.item, it.amount - added, b.worldX, b.worldZ);
      }
      this.economy.recordProduction(it.item, it.amount);
      b.outputHistory.push({ item: it.item, amount: it.amount, day: this.time.totalDays });
      if (b.outputHistory.length > 60) b.outputHistory.shift();
    }
    npc.needs.mood += 0.02;
  }

  /** Picks the best recipe a workshop can actually run right now. */
  chooseRecipe(b: Building): Recipe | null {
    if (!b.def.recipes) return null;
    let best: Recipe | null = null;
    let bestScore = -Infinity;
    for (const rid of b.def.recipes) {
      if (b.disabledRecipes.has(rid)) continue;
      if (!this.research.recipeUnlocked(rid)) continue;
      const recipe = RECIPES[rid];
      let canRun = true;
      for (const inp of recipe.inputs) {
        if (b.inventory.count(inp.item) < inp.amount) {
          canRun = false;
          break;
        }
      }
      if (!canRun) continue;
      let hasSpace = true;
      for (const out of recipe.outputs) {
        if (b.inventory.spaceFor(out.item) < out.amount) {
          hasSpace = false;
          break;
        }
      }
      if (!hasSpace) continue;

      // Prefer recipes whose output the settlement is short of.
      let score = recipe.defaultPriority;
      for (const out of recipe.outputs) {
        score += (1 - this.economy.supplyHealth(out.item)) * 6;
      }
      if (score > bestScore) {
        bestScore = score;
        best = recipe;
      }
    }
    return best;
  }

  completeRecipe(b: Building, recipe: Recipe, npc: Npc): void {
    for (const inp of recipe.inputs) {
      b.inventory.remove(inp.item, inp.amount);
      this.economy.recordConsumption(inp.item, inp.amount);
    }
    for (const out of recipe.outputs) {
      const added = b.inventory.add(out.item, out.amount);
      if (added < out.amount) this.dropPile(out.item, out.amount - added, b.worldX, b.worldZ);
      this.economy.recordProduction(out.item, out.amount);
      b.outputHistory.push({ item: out.item, amount: out.amount, day: this.time.totalDays });
      if (b.outputHistory.length > 60) b.outputHistory.shift();
    }
    b.condition = clamp(b.condition - 0.0006, 0.25, 1);
    npc.needs.mood += 0.05;
    this.advanceTutorial(6);
  }

  // =======================================================================
  // Farming
  // =======================================================================

  /** Index of the plot most in need of attention, or -1. */
  findFarmWork(b: Building, npc: Npc): number {
    const season = this.time.season;
    const canPlant = season === 'spring' || season === 'summer';
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < b.fields.length; i++) {
      const f = b.fields[i];
      if (f.reservedBy !== 0 && f.reservedBy !== npc.id) continue;
      let score = 0;
      if (f.planted && f.growth >= 1) score = 10;
      else if (!f.planted && canPlant) score = 6;
      else if (f.planted && f.watered < 0.35) score = 3;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  applyFarmWork(b: Building, plot: FarmPlot, npc: Npc): void {
    if (plot.planted && plot.growth >= 1) {
      // Harvest.
      const item: ItemId = plot.crop === 'vegetables' ? 'vegetables' : 'grain';
      const fertility = this.terrain.data.fertility[this.terrain.index(plot.tx, plot.tz)];
      const yieldAmount = Math.max(1, Math.round(3 + fertility * 4 + npc.skill('farming') * 0.18));
      const added = b.inventory.add(item, yieldAmount);
      if (added < yieldAmount) this.dropPile(item, yieldAmount - added, npc.x, npc.z);
      this.economy.recordProduction(item, yieldAmount);
      b.outputHistory.push({ item, amount: yieldAmount, day: this.time.totalDays });
      if (b.outputHistory.length > 60) b.outputHistory.shift();
      plot.planted = false;
      plot.growth = 0;
      plot.crop = null;
      this.terrain.clearOverlay(plot.tx, plot.tz, OVERLAY.Tilled);
      this.terrain.setOverlay(plot.tx, plot.tz, OVERLAY.Field);
      this.advanceTutorial(6);
    } else if (!plot.planted) {
      plot.crop = this.rng.chance(0.62) ? 'grain' : 'vegetables';
      plot.planted = true;
      plot.growth = 0;
      plot.watered = 0.6;
      this.terrain.setOverlay(plot.tx, plot.tz, OVERLAY.Tilled);
    } else {
      plot.watered = 1;
    }
  }

  private growCrops(hours: number): void {
    const season = this.time.season;
    const seasonRate: Record<SeasonName, number> = { spring: 1.15, summer: 1.35, autumn: 0.6, winter: 0 };
    const rate = seasonRate[season] * this.weather.cropGrowthMultiplier;
    if (rate <= 0) return;

    for (const b of this.buildings) {
      if (!b.complete || b.fields.length === 0) continue;
      for (const f of b.fields) {
        if (!f.planted) continue;
        const fertility = this.terrain.data.fertility[this.terrain.index(f.tx, f.tz)];
        const water = 0.45 + f.watered * 0.55;
        // A crop takes roughly five game days of good conditions to ripen.
        f.growth = Math.min(1, f.growth + (hours / 120) * rate * (0.55 + fertility) * water);
        f.watered = Math.max(0, f.watered - hours * 0.018 * (this.weather.isPrecipitating ? -0.5 : 1));
        f.watered = Math.min(1, f.watered);
      }
    }
  }

  // =======================================================================
  // People
  // =======================================================================

  private spawnStartingSettlers(): void {
    const count = clamp(this.config.startingSettlers, 3, 24);
    const cx = this.settlement.centre.x;
    const cz = this.settlement.centre.z;
    // Start with a balanced crew: someone to build, someone to carry, and
    // enough hands to gather.
    const roles: ProfessionId[] = ['builder', 'hauler', 'logger', 'builder', 'hauler', 'settler'];

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 3 + (i % 3) * 2;
      const x = clamp(cx + Math.cos(a) * r, 5, this.terrain.worldSize - 5);
      const z = clamp(cz + Math.sin(a) * r, 5, this.terrain.worldSize - 5);
      const npc = this.spawnNpc(x, z, roles[i % roles.length]);
      // Early settlers know a little of their trade already.
      const prof = PROFESSIONS[npc.profession];
      for (const s of prof.primary) npc.addXp(s, 180);
    }
  }

  spawnNpc(x: number, z: number, profession: ProfessionId = 'settler'): Npc {
    const id = this.nextId();
    const seed = (this.config.seed ^ (id * 2654435761)) >>> 0;
    const rng = new Rng(seed);
    const npc = new Npc(id, personName((a, b) => rng.int(a, b)), seed);
    npc.profession = profession;
    npc.x = x;
    npc.z = z;
    npc.y = this.terrain.heightAt(x, z);
    this.npcs.push(npc);
    this.npcById.set(id, npc);
    this.npcGrid.insert(x, z, npc);
    return npc;
  }

  removeNpc(npc: Npc): void {
    this.jobs.releaseAllFor(npc.id);
    const home = this.buildingById.get(npc.homeId);
    if (home) home.residentIds = home.residentIds.filter((i) => i !== npc.id);
    const work = this.buildingById.get(npc.workplaceId);
    if (work) work.workerIds = work.workerIds.filter((i) => i !== npc.id);
    const i = this.npcs.indexOf(npc);
    if (i >= 0) this.npcs.splice(i, 1);
    this.npcById.delete(npc.id);
    this.npcGrid.remove(npc.x, npc.z, npc);
  }

  private giveStartingSupplies(): void {
    // Enough to raise the first shelter, and no more.
    const cx = this.settlement.centre.x;
    const cz = this.settlement.centre.z;
    const drops: [ItemId, number][] = [
      ['log', 14],
      ['stone', 10],
      ['fiber', 16],
      ['bread', 10],
      ['berries', 12],
    ];
    let i = 0;
    for (const [item, count] of drops) {
      const a = (i++ / drops.length) * Math.PI * 2;
      this.dropPile(item, count, cx + Math.cos(a) * 4.5, cz + Math.sin(a) * 4.5);
    }
    // One of each essential tool, carried by whoever needs it.
    const tools: [ItemId, ProfessionId][] = [
      ['axe', 'logger'],
      ['hammer', 'builder'],
      ['pickaxe', 'miner'],
    ];
    for (const [tool, prof] of tools) {
      const owner = this.npcs.find((n) => n.profession === prof && !n.tool);
      if (owner) owner.tool = tool;
      else this.dropPile(tool, 1, cx + this.rng.range(-4, 4), cz + this.rng.range(-4, 4));
    }
  }

  nearestNpc(from: Npc, radius: number): Npc | null {
    let best: Npc | null = null;
    let bestD = radius * radius;
    this.npcGrid.forEachNear(from.x, from.z, radius, (n) => {
      if (n.id === from.id) return;
      const d2 = (n.x - from.x) ** 2 + (n.z - from.z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = n;
      }
    });
    return best;
  }

  /** Nearest person to an arbitrary point, used by animals sensing threats. */
  nearestNpcTo(x: number, z: number, radius: number): Npc | null {
    let best: Npc | null = null;
    let bestD = radius * radius;
    this.npcGrid.forEachNear(x, z, radius, (n) => {
      const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = n;
      }
    });
    return best;
  }

  /** Somewhere sociable: the tavern, the market, or the settlement centre. */
  findSocialSpot(npc: Npc): { x: number; z: number; id: number } {
    const social = this.buildings.find(
      (b) => b.complete && (b.defId === 'tavern' || b.defId === 'market' || b.defId === 'well'),
    );
    if (social) {
      const p = social.accessPoint(this.terrain.tileSize);
      return { x: p.x + npc.rng.range(-2, 2), z: p.z + npc.rng.range(-2, 2), id: social.id };
    }
    const c = this.settlement.centre;
    return { x: c.x + npc.rng.range(-6, 6), z: c.z + npc.rng.range(-6, 6), id: 0 };
  }

  findFoodStore(x: number, z: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (!b.complete) continue;
      if ((b.def.storageSlots ?? 0) === 0) continue;
      const hasFood = b.inventory.findFirst((i) => FOOD_PRIORITY.includes(i));
      if (!hasFood) continue;
      const d = (b.worldX - x) ** 2 + (b.worldZ - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Best store to take `item` from. Prefers the nearest that actually has it. */
  findSourceFor(item: ItemId, x: number, z: number, excludeId: number): Building | null {
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const b of this.buildings) {
      if (!b.complete || b.id === excludeId) continue;
      if (b.inventory.count(item) <= 0) continue;
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      // Prefer real storage over pulling stock back out of a workshop.
      const penalty = b.def.category === 'storage' ? 0 : 35;
      const score = d + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  /** Best store to put `item` into. */
  findDestinationFor(item: ItemId, x: number, z: number): Building | null {
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const b of this.buildings) {
      if (!b.complete) continue;
      if ((b.def.storageSlots ?? 0) === 0) continue;
      if (b.inventory.spaceFor(item) <= 0) continue;
      // Only storage buildings are general-purpose destinations.
      if (b.def.category !== 'storage') continue;
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      const fullnessPenalty = b.inventory.fullness * 40;
      const score = d + fullnessPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ assignment

  /** Assigns homes, workplaces and professions to anyone without them. */
  private runAssignments(): void {
    // Housing.
    for (const npc of this.npcs) {
      if (npc.homeId && this.buildingById.has(npc.homeId)) continue;
      npc.homeId = 0;
      const home = this.buildings.find((b) => b.hasHousing);
      if (home) {
        home.residentIds.push(npc.id);
        npc.homeId = home.id;
      }
    }

    // Workplaces.
    for (const npc of this.npcs) {
      if (npc.workplaceId) {
        const wp = this.buildingById.get(npc.workplaceId);
        if (wp && wp.complete && wp.workerIds.includes(npc.id)) continue;
        npc.workplaceId = 0;
      }
      if (npc.profession === 'builder' || npc.profession === 'hauler') continue;

      // Prefer a workplace matching the person's current trade.
      let chosen: Building | null = null;
      for (const b of this.buildings) {
        if (!b.hasWorkSlots || !b.def.profession) continue;
        if (b.def.profession === npc.profession) {
          chosen = b;
          break;
        }
      }
      if (!chosen) {
        for (const b of this.buildings) {
          if (!b.hasWorkSlots || !b.def.profession) continue;
          if (npc.profession === 'settler') {
            chosen = b;
            break;
          }
        }
      }
      if (chosen && chosen.def.profession) {
        chosen.workerIds.push(npc.id);
        npc.workplaceId = chosen.id;
        if (npc.profession === 'settler') {
          npc.profession = chosen.def.profession as ProfessionId;
          npc.remember(this.time.totalDays, `Took work at the ${chosen.def.name.toLowerCase()}.`);
        }
        npc.clearTask();
      }
    }

    // Keep a minimum of builders and haulers among the unemployed, or nothing
    // ever gets carried or finished.
    const counts = new Map<ProfessionId, number>();
    for (const n of this.npcs) counts.set(n.profession, (counts.get(n.profession) ?? 0) + 1);
    const target = Math.max(1, Math.round(this.npcs.length * 0.2));
    for (const role of ['builder', 'hauler'] as ProfessionId[]) {
      let have = counts.get(role) ?? 0;
      while (have < target) {
        const spare = this.npcs.find((n) => n.profession === 'settler' && !n.workplaceId);
        if (!spare) break;
        spare.profession = role;
        spare.clearTask();
        have++;
      }
    }
  }

  /** Player-facing: move a person to a different trade. */
  setProfession(npc: Npc, profession: ProfessionId): void {
    if (npc.profession === profession) return;
    const wp = this.buildingById.get(npc.workplaceId);
    if (wp) {
      wp.workerIds = wp.workerIds.filter((i) => i !== npc.id);
      npc.workplaceId = 0;
    }
    npc.profession = profession;
    npc.clearTask();
    this.jobs.releaseAllFor(npc.id);
  }

  // =======================================================================
  // Wildlife
  // =======================================================================

  private spawnWildlife(): void {
    const t = this.terrain;
    const areaKm2 = (t.worldSize * t.worldSize) / 1_000_000;
    const totalTarget = Math.min(260, Math.round(areaKm2 * 90 * this.config.resourceDensity));
    let attempts = 0;

    while (this.wildlife.length < totalTarget && attempts < totalTarget * 40) {
      attempts++;
      const tx = this.rng.int(4, t.gridSize - 5);
      const tz = this.rng.int(4, t.gridSize - 5);
      if (t.isWaterTile(tx, tz)) continue;
      const biome = t.biomeAtTile(tx, tz);
      const options = speciesForBiome(biome);
      if (options.length === 0) continue;
      const species = this.rng.pick(options);
      const def = ANIMALS[species];
      const herd = this.rng.int(def.herdSize[0], def.herdSize[1]);
      const bx = tx * t.tileSize;
      const bz = tz * t.tileSize;
      for (let i = 0; i < herd && this.wildlife.length < totalTarget; i++) {
        const x = clamp(bx + this.rng.range(-6, 6), 3, t.worldSize - 3);
        const z = clamp(bz + this.rng.range(-6, 6), 3, t.worldSize - 3);
        if (t.waterDepthAt(x, z) > 0.4) continue;
        this.addAnimal(species, x, z);
      }
    }
  }

  addAnimal(species: AnimalSpecies, x: number, z: number): Animal {
    const a = createAnimal(this.nextId(), species, x, z, this.rng);
    a.y = this.terrain.heightAt(x, z);
    this.wildlife.push(a);
    this.wildlifeById.set(a.id, a);
    return a;
  }

  removeAnimal(a: Animal): void {
    const i = this.wildlife.indexOf(a);
    if (i >= 0) {
      this.wildlife[i] = this.wildlife[this.wildlife.length - 1];
      this.wildlife.pop();
    }
    this.wildlifeById.delete(a.id);
  }

  findHuntTarget(x: number, z: number, radius: number, npcId: number): Animal | null {
    let best: Animal | null = null;
    let bestD = radius * radius;
    for (const a of this.wildlife) {
      if (a.dead || a.species === 'bird') continue;
      if (ANIMALS[a.species].yields.length === 0) continue;
      if (a.huntedBy !== 0 && a.huntedBy !== npcId) continue;
      const d2 = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = a;
      }
    }
    if (best) (best as Animal).huntedBy = npcId;
    return best;
  }

  killAnimal(a: Animal, hunter: Npc): void {
    a.dead = true;
    const def = ANIMALS[a.species];
    for (const y of def.yields) {
      this.dropPile(y.item, y.amount, a.x, a.z);
      this.economy.recordProduction(y.item, y.amount);
    }
    hunter.remember(this.time.totalDays, `Brought down a ${def.name.toLowerCase()}.`);
    this.removeAnimal(a);
  }

  // =======================================================================
  // Collision
  // =======================================================================

  queryObstacles = (x: number, z: number, radius: number, out: Obstacle[]): void => {
    this.nodeGrid.forEachNear(x, z, radius, (n) => {
      if (n.depleted) return;
      const def = RESOURCES[n.kind];
      if (!def.blocks) return;
      out.push({ x: n.x, z: n.z, radius: def.radius * n.scale * 0.72 });
    });

    // Buildings are axis-aligned boxes, approximated by their inscribed circle
    // plus per-edge clamping in the caller; a circle is enough at this scale.
    const ts = this.terrain.tileSize;
    for (const b of this.buildings) {
      if (!b.complete) continue;
      if (b.def.style === 'road' || b.def.style === 'field' || b.def.style === 'stockpile' ||
          b.def.style === 'bridge') continue;
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      const r = Math.max(b.footprintWidth, b.footprintDepth) * ts * 0.5;
      if (d < radius + r) out.push({ x: b.worldX, z: b.worldZ, radius: r * 0.82 });
    }
  };

  // =======================================================================
  // Simulation
  // =======================================================================

  /**
   * One fixed simulation step. `dt` is *simulated* seconds — the game loop has
   * already applied the speed multiplier. The player is deliberately not
   * updated here: they move in real time so that controlling them stays
   * comfortable while the world runs fast around them.
   */
  simulate(dt: number): void {
    this.time.advance(dt);
    const hours = this.time.hoursFor(dt);

    this.updateAtmosphere(hours);

    this.nav.resetBudget(6);

    // People.
    for (const npc of this.npcs) {
      const px = npc.x;
      const pz = npc.z;
      updateNpc(this, npc, dt);
      if (px !== npc.x || pz !== npc.z) this.npcGrid.move(px, pz, npc.x, npc.z, npc);
    }
    this.separateCrowd(dt);

    // Animals.
    updateAnimals(this, dt);

    // Fire and floodwater run on the same tick as everything else, so a
    // burning forest is genuinely racing the rain.
    this.disasters.updateFires(this, dt);
    this.disasters.updateFloods(this, dt);
    updateVolcanoes(this, dt);

    // Crops.
    this.growCrops(hours);

    // Job board.
    this.jobTimer += dt;
    if (this.jobTimer >= JOB_REFRESH_INTERVAL) {
      this.jobTimer = 0;
      this.jobs.refresh(this.jobContext());
    }

    // Settlement statistics and diagnostics.
    this.settlementTimer += dt;
    if (this.settlementTimer >= SETTLEMENT_INTERVAL) {
      this.settlementTimer = 0;
      this.recomputeSettlement();
    }

    this.assignmentTimer += dt;
    if (this.assignmentTimer >= ASSIGNMENT_INTERVAL) {
      this.assignmentTimer = 0;
      this.runAssignments();
    }

    if (this.research.justCompleted) {
      const id = this.research.justCompleted;
      this.research.clearJustCompleted();
      this.log.add(this.time, 'settlement', 'ev.researchDone', { name: id }, { notable: true });
    }

    if (this.settlement.justPromoted) {
      const tier = this.settlement.justPromoted;
      this.settlement.clearPromotion();
      this.log.add(
        this.time,
        'settlement',
        'ev.promoted',
        { name: this.config.name, tier },
        { notable: true, x: this.settlement.centre.x, z: this.settlement.centre.z },
      );
    }
  }

  private jobContext(): JobContext {
    return {
      buildings: this.buildings,
      buildingById: this.buildingById,
      piles: this.piles,
      pileById: this.pileById,
      tileSize: this.terrain.tileSize,
      findSource: (item, _amount, x, z, exclude) => this.findSourceFor(item, x, z, exclude),
      findDestination: (item, x, z) => this.findDestinationFor(item, x, z),
    };
  }

  /** Keeps people from standing inside each other. */
  private separateCrowd(dt: number): void {
    const RADIUS = 0.62;
    for (const a of this.npcs) {
      if (a.activity === 'sleeping') continue;
      let pushX = 0;
      let pushZ = 0;
      this.npcGrid.forEachNear(a.x, a.z, RADIUS * 2, (b) => {
        if (b.id === a.id) return;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        const min = RADIUS * 2;
        if (d2 >= min * min || d2 < 1e-6) return;
        const d = Math.sqrt(d2);
        const strength = (min - d) / min;
        pushX += (dx / d) * strength;
        pushZ += (dz / d) * strength;
      });
      if (pushX !== 0 || pushZ !== 0) {
        const px = a.x;
        const pz = a.z;
        a.x = clamp(a.x + pushX * dt * 2.4, 2, this.terrain.worldSize - 2);
        a.z = clamp(a.z + pushZ * dt * 2.4, 2, this.terrain.worldSize - 2);
        this.npcGrid.move(px, pz, a.x, a.z, a);
      }
    }
  }

  private recomputeSettlement(): void {
    let roadTiles = 0;
    for (let i = 0; i < this.terrain.overlay.length; i += 7) {
      if (this.terrain.overlay[i] & OVERLAY.Road) roadTiles += 7;
    }
    let food = 0;
    for (const b of this.buildings) {
      if (!b.complete) continue;
      for (const s of b.inventory.slots) {
        if (s && isFood(s.item)) food += s.count;
      }
    }
    this.settlement.recompute(this.buildings, this.npcs, food, roadTiles);

    const haulers = this.npcs.filter((n) => n.profession === 'hauler').length;
    this.economy.diagnose(
      this.buildings,
      haulers,
      this.settlement.foodDays,
      this.settlement.homeless,
      this.npcs.length,
    );
  }

  private onNewDay(day: number): void {
    // Regrowth.
    for (let i = this.regrowing.length - 1; i >= 0; i--) {
      const n = this.regrowing[i];
      n.regrowIn -= 1;
      if (n.regrowIn <= 0) {
        n.depleted = false;
        n.amount = n.maxAmount;
        n.growth = 1;
        n.regrowIn = -1;
        this.regrowing[i] = this.regrowing[this.regrowing.length - 1];
        this.regrowing.pop();
      }
    }

    for (const n of this.nodes) {
      if (n.growth < 1) n.growth = Math.min(1, n.growth + 1 / 42);
    }

    // Natural forest spread, so woodland recovers where it is left alone.
    this.spreadForest();

    // Buildings weather.
    for (const b of this.buildings) {
      if (!b.complete) continue;
      const wear = 0.0016 + this.weather.severity * 0.004;
      b.condition = clamp(b.condition - wear, 0.2, 1);
    }

    // Food spoils on the ground.
    for (let i = this.piles.length - 1; i >= 0; i--) {
      const p = this.piles[i];
      if (!isFood(p.item)) continue;
      if (day - p.droppedDay > 6) {
        p.count = Math.max(0, p.count - Math.ceil(p.count * 0.3));
        if (p.count <= 0) this.removePile(p);
      }
    }

    this.economy.rollDay(this.buildings);
    this.maybeSpawnMigrant();
    this.rollDailyEvent();
  }

  /** Woodland reseeds into open ground near surviving trees. */
  private spreadForest(): void {
    const trees = this.nodes.filter((n) => !n.depleted && RESOURCES[n.kind].spreads && RESOURCES[n.kind].category === 'tree');
    if (trees.length === 0) return;
    const attempts = Math.min(28, Math.ceil(trees.length * 0.02));
    for (let i = 0; i < attempts; i++) {
      const parent = this.rng.pick(trees);
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(3, 11);
      const x = parent.x + Math.cos(a) * r;
      const z = parent.z + Math.sin(a) * r;
      if (x < 4 || z < 4 || x > this.terrain.worldSize - 4 || z > this.terrain.worldSize - 4) continue;
      const biome = this.terrain.biomeAt(x, z);
      if (biome === Biome.Desert || biome === Biome.Alpine || biome === Biome.Tundra) continue;
      if (this.terrain.slopeAt(x, z) > 0.6) continue;
      if (this.settlement.contains(x, z)) continue;
      this.plantSapling(parent.kind, x, z);
    }
  }

  /** New people arrive if the settlement looks like somewhere worth living. */
  private maybeSpawnMigrant(): void {
    if (this.npcs.length >= 140) return;
    const s = this.settlement;
    const spareHousing = s.housingCapacity - s.population;
    if (spareHousing <= 0) return;
    if (s.foodDays < 4) return;
    const chance = clamp01(0.08 + spareHousing * 0.05 + s.wellbeing * 0.12);
    if (!this.rng.chance(chance)) return;

    const a = this.rng.range(0, Math.PI * 2);
    const r = s.radius * 0.6;
    const x = clamp(s.centre.x + Math.cos(a) * r, 5, this.terrain.worldSize - 5);
    const z = clamp(s.centre.z + Math.sin(a) * r, 5, this.terrain.worldSize - 5);
    const npc = this.spawnNpc(x, z, 'settler');
    this.log.add(this.time, 'people', 'ev.migrant', { name: npc.name }, { notable: true, x, z });
  }

  private rollDailyEvent(): void {
    if (!this.rng.chance(0.14)) return;
    const s = this.settlement;
    const options: (() => void)[] = [];

    options.push(() => {
      this.log.add(this.time, 'discovery', 'ev.goodForaging');
      let planted = 0;
      for (let i = 0; i < 24 && planted < 12; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(20, s.radius + 40);
        const x = s.centre.x + Math.cos(a) * r;
        const z = s.centre.z + Math.sin(a) * r;
        if (this.plantSapling('berry_bush', x, z)) planted++;
      }
    });

    if (this.buildings.some((b) => b.complete)) {
      options.push(() => {
        const roads = this.buildings.filter((b) => b.complete && b.defId === 'road');
        if (roads.length > 0 && this.weather.severity > 0.4) {
          const victim = this.rng.pick(roads);
          victim.condition = 0.4;
          this.log.add(this.time, 'weather', 'ev.roadWashedOut', undefined, {
            notable: true,
            x: victim.worldX,
            z: victim.worldZ,
          });
        }
      });
    }

    if (this.wildlife.length > 10) {
      options.push(() => {
        this.log.add(this.time, 'discovery', 'ev.gameMoving');
        for (let i = 0; i < 6; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(30, 90);
          const x = clamp(s.centre.x + Math.cos(a) * r, 4, this.terrain.worldSize - 4);
          const z = clamp(s.centre.z + Math.sin(a) * r, 4, this.terrain.worldSize - 4);
          if (this.terrain.waterDepthAt(x, z) > 0.3) continue;
          this.addAnimal('deer', x, z);
        }
      });
    }

    this.rng.pick(options)();
  }

  // =======================================================================
  // Tutorial
  // =======================================================================

  advanceTutorial(step: number): void {
    if (step > this.tutorialStep) this.tutorialStep = step;
  }

  // =======================================================================
  // Discovery
  // =======================================================================

  /** Reveals map tiles around a point. */
  markExplored(x: number, z: number, radius: number): void {
    const t = this.terrain;
    const r = Math.ceil(radius / t.tileSize);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);
    const r2 = r * r;
    for (let dz = -r; dz <= r; dz++) {
      const tz = cz + dz;
      if (tz < 0 || tz >= t.gridSize) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const tx = cx + dx;
        if (tx < 0 || tx >= t.gridSize) continue;
        this.explored[tz * t.gridSize + tx] = 1;
      }
    }
  }

  /** Marks nearby landmarks as found. Called as the player explores. */
  updateDiscovery(x: number, z: number): PointOfInterest | null {
    this.markExplored(x, z, 95);
    for (const p of this.pois) {
      if (p.discovered) continue;
      if (Math.hypot(p.x - x, p.z - z) < 38) {
        p.discovered = true;
        this.log.add(
          this.time,
          'discovery',
          'ev.discovered',
          { name: p.name, lore: p.lore },
          { notable: true, x: p.x, z: p.z },
        );
        return p;
      }
    }
    return null;
  }

  // =======================================================================
  // Damage, fire and upheaval
  // =======================================================================

  /**
   * Applies damage to a building. Returns true if it was destroyed outright.
   * Anything short of that leaves a standing wreck that builders can repair,
   * which is far more interesting than a building vanishing.
   */
  damageBuilding(b: Building, amount: number): boolean {
    if (amount <= 0) return false;
    b.condition = clamp(b.condition - amount, 0, 1);

    if (b.condition <= 0.08) {
      this.log.add(this.time, 'disaster', 'event.buildingDestroyed', { name: b.defId }, {
        notable: true,
        x: b.worldX,
        z: b.worldZ,
      });
      // Rubble is left behind rather than the materials simply evaporating.
      for (const [item, total] of Object.entries(b.def.totalMaterials) as [ItemId, number][]) {
        const salvage = Math.floor(total * 0.2);
        if (salvage > 0) this.dropPile(item, salvage, b.worldX, b.worldZ);
      }
      this.destroyBuilding(b);
      return true;
    }

    if (b.complete && b.condition < 0.72 && !b.repairNeeded) {
      b.repairNeeded = true;
      b.computeRepairBill();
      this.log.add(this.time, 'disaster', 'event.buildingDamaged', { name: b.defId }, {
        x: b.worldX,
        z: b.worldZ,
      });
    }
    return false;
  }

  /** Builders putting a damaged building back together. */
  applyRepair(b: Building, amount: number): boolean {
    if (!b.repairNeeded) return true;
    b.repairWork += amount;
    if (b.repairWork < b.repairWorkRequired) return false;
    b.repairWork = 0;
    b.repairNeeded = false;
    b.repairMaterialsConsumed = false;
    b.repairBill = {};
    b.condition = 1;
    return true;
  }

  /** A building is sound again. */
  onBuildingRepaired(b: Building, by: Npc): void {
    this.log.add(this.time, 'settlement', 'ev.repaired', { name: b.defId, who: by.name }, {
      x: b.worldX,
      z: b.worldZ,
    });
  }

  /**
   * The air, and everything the air does.
   *
   * The atmosphere runs on a slower cadence than the rest of the tick because
   * air does not need fifteen updates a second, but the hours it is given are
   * exactly the hours that passed, so nothing is lost at high game speeds.
   */
  private updateAtmosphere(hours: number): void {
    this.climateAccum += hours;
    if (this.climateAccum >= CLIMATE_STEP_HOURS) {
      const step = this.climateAccum;
      this.climateAccum = 0;
      this.stepAtmosphere(step);
    }

    // The weather the player experiences is the air they are standing in.
    const ob = this.observer;
    this.weather.driveFrom(this.climate, ob.x, ob.z, hours);
    if (this.weather.justChanged) {
      this.log.add(this.time, 'weather', 'ev.weatherTurns', { weather: this.weather.current });
    }
  }

  /**
   * One step of the air and everything that rides on it. Public because the
   * atmosphere is worth exercising on its own, without paying for a whole
   * settlement's worth of simulation to do it.
   */
  stepAtmosphere(hours: number): void {
    this.climate.update(this.time, hours);
    this.storms.update(this, hours);
    this.tectonics.update(this, hours);
    this.nations.update(this, hours);
    this.diplomacy.update(this, hours);
    this.updateSky();
    this.director.update(this, hours);
    this.disease.update(this, hours);
    this.updateFamine(hours);
    this.resolveLightning();
    this.reportClimate();
    this.applyMeltwater(hours);
  }

  /**
   * Keeps the eclipse forecast current and tells the world about what it can
   * see coming. A people who watch the sky know an eclipse is due; they are
   * not surprised by one, and neither is the chronicle.
   */
  private updateSky(): void {
    this.astronomy.update(this.time);
    const day = this.time.totalDays;
    for (const e of this.astronomy.eclipses) {
      if (e.announced || e.day > day) continue;
      e.announced = true;
      this.log.add(
        this.time,
        'discovery',
        e.kind === 'solar' ? 'ev.solarEclipse' : 'ev.lunarEclipse',
        { percent: Math.round(e.magnitude * 100) },
        { notable: true },
      );
    }

    const moment = this.astronomy.at(this.time);
    if (moment.shower && moment.meteorRate > 20 && this.lastShowerDay !== day) {
      this.lastShowerDay = day;
      this.log.add(this.time, 'discovery', 'ev.meteorShower', { name: moment.shower.name }, {
        notable: true,
      });
    }
  }

  /** Where the weather is being watched from: the player, or a possessed body. */
  get observer(): { x: number; z: number } {
    return this.player.position;
  }

  /** Lightning sets fire to whatever it hits, if that will burn. */
  private resolveLightning(): void {
    for (const strike of this.climate.strikes) {
      this.lightningStrikes++;
      this.disasters.ignite(this, strike.x, strike.z, 0.55);
    }
  }

  /** Announces the slow things: a heat wave beginning, a drought breaking. */
  private reportClimate(): void {
    for (const e of this.climate.extremes) {
      if (e.announced) continue;
      e.announced = true;
      this.log.add(this.time, 'weather', `ev.${e.kind}`, undefined, { notable: true });
    }
  }

  /**
   * Snow that thaws has to go somewhere. It wets the ground it came off and
   * swells the rivers below, which is why a warm spell after a hard winter
   * floods the low ground.
   */
  private applyMeltwater(hours: number): void {
    const melt = this.climate.meltwater(hours);
    if (melt <= 0.01) return;
    const t = this.terrain;
    // Spread the thaw over the map in proportion to where the snow was.
    const c = this.climate;
    for (let cz = 0; cz < c.cells; cz++) {
      for (let cx = 0; cx < c.cells; cx++) {
        const ci = cz * c.cells + cx;
        if (c.snowpack[ci] <= 0 || c.temperature[ci] <= 0.5) continue;
        const wx = (cx + 0.5) * c.cellSize;
        const wz = (cz + 0.5) * c.cellSize;
        const i = t.index(t.tileX(wx), t.tileZ(wz));
        t.data.moisture[i] = clamp01(t.data.moisture[i] + hours * 0.004);
      }
    }
    this.snowmeltCarried += melt;
  }

  // =====================================================================
  // Readings the disaster director takes off the world
  // =====================================================================

  /** The ground has been reshaped, so anything measured off it is stale. */
  markTerrainChanged(): void {
    this.steepFractionDirty = true;
  }

  /** Fraction of dry land steep enough to slide. Cached; terrain rarely moves. */
  steepGroundFraction(): number {
    if (this.steepFractionDirty) {
      const t = this.terrain;
      let steep = 0;
      let land = 0;
      for (let i = 0; i < t.data.slope.length; i += 7) {
        if (t.waterHeight[i] > t.data.height[i]) continue;
        land++;
        if (t.data.slope[i] > 0.55) steep++;
      }
      this.steepFraction = land > 0 ? steep / land : 0;
      this.steepFractionDirty = false;
    }
    return this.steepFraction;
  }

  /** Days of food left at the rate these people are eating it. */
  foodDaysRemaining(): number {
    return this.settlement.foodDays;
  }

  /**
   * How well someone would be looked after if they fell ill: a clinic, a well
   * and a full belly between them account for most of surviving a sickness.
   */
  careQuality(npc: Npc): number {
    const infra = this.settlement.infrastructure;
    const clinic = clamp01(infra.health / 6);
    const water = clamp01(infra.food / 8) * 0.3;
    const fed = clamp01(npc.needs.hunger / 100) * 0.35;
    const rested = clamp01(npc.needs.rest / 100) * 0.15;
    return clamp01(clinic * 0.55 + water + fed * 0.5 + rested);
  }

  /** Clean water and somewhere to put waste, which is what slows a plague. */
  sanitationQuality(): number {
    const infra = this.settlement.infrastructure;
    const perPerson = this.npcs.length > 0 ? infra.health / this.npcs.length : 0;
    return clamp01(perPerson * 3);
  }

  /** The driest patch of burnable ground within reach, or null. */
  driestFuelNear(x: number, z: number, radius: number): { x: number; z: number } | null {
    const t = this.terrain;
    let best: { x: number; z: number } | null = null;
    let bestScore = -1;
    for (let i = 0; i < 90; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * radius;
      const px = clamp(x + Math.cos(a) * r, 2, t.worldSize - 2);
      const pz = clamp(z + Math.sin(a) * r, 2, t.worldSize - 2);
      if (t.waterDepthAt(px, pz) > 0) continue;
      let fuel = 0;
      this.nodeGrid.forEachNear(px, pz, 10, (n) => {
        fuel += RESOURCES[n.kind].category === 'tree' ? 1 : 0.3;
      });
      if (fuel <= 0) continue;
      const score = fuel * (1 - t.moistureAt(px, pz));
      if (score > bestScore) {
        bestScore = score;
        best = { x: px, z: pz };
      }
    }
    return best;
  }

  /** The lowest ground within reach: where water would actually collect. */
  lowestGroundNear(x: number, z: number, radius: number): { x: number; z: number } | null {
    const t = this.terrain;
    let best: { x: number; z: number } | null = null;
    let bestH = Infinity;
    for (let i = 0; i < 90; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * radius;
      const px = clamp(x + Math.cos(a) * r, 2, t.worldSize - 2);
      const pz = clamp(z + Math.sin(a) * r, 2, t.worldSize - 2);
      const h = t.heightAt(px, pz);
      if (h < 0.4) continue; // already sea
      if (h < bestH) {
        bestH = h;
        best = { x: px, z: pz };
      }
    }
    return best;
  }

  /** The steepest ground within reach: where a slope would give way. */
  steepestGroundNear(x: number, z: number, radius: number): { x: number; z: number } | null {
    const t = this.terrain;
    let best: { x: number; z: number } | null = null;
    let bestSlope = 0.45;
    for (let i = 0; i < 90; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * radius;
      const px = clamp(x + Math.cos(a) * r, 2, t.worldSize - 2);
      const pz = clamp(z + Math.sin(a) * r, 2, t.worldSize - 2);
      const i2 = t.index(t.tileX(px), t.tileZ(pz));
      if (t.waterHeight[i2] > t.data.height[i2]) continue;
      if (t.data.slope[i2] > bestSlope) {
        bestSlope = t.data.slope[i2];
        best = { x: px, z: pz };
      }
    }
    return best;
  }

  // =====================================================================
  // Famine and sickness
  // =====================================================================

  /** Notes that the settlement has run out of food. */
  beginFamine(severity: number): void {
    if (this.famineSeverity > 0.05) return;
    this.famineSeverity = clamp01(severity);
    this.log.add(this.time, 'disaster', 'ev.famine', { name: this.config.name }, {
      notable: true,
      x: this.settlement.centre.x,
      z: this.settlement.centre.z,
    });
  }

  /**
   * A famine lasts exactly as long as the stores are empty. It is not a timer,
   * and it cannot be waited out: it ends when there is food again.
   */
  private updateFamine(hours: number): void {
    if (this.famineSeverity <= 0) return;
    const days = this.settlement.foodDays;
    if (days > 3) {
      this.famineSeverity = 0;
      this.log.add(this.time, 'settlement', 'ev.famineEnds', { name: this.config.name }, {
        notable: true,
      });
      return;
    }
    // While it lasts, going without wears people down faster than hunger alone.
    const bite = this.famineSeverity * hours * 0.5;
    for (const npc of this.npcs) {
      if (npc.needs.hunger > 45) continue;
      npc.needs.health = clamp(npc.needs.health - bite, 0, 100);
      if (npc.needs.health <= 0) {
        this.killNpc(npc, 'ev.diedOfHunger', { name: npc.name });
      }
    }
  }

  /** Starts an outbreak, if there is anybody to catch it. */
  beginOutbreak(x: number, z: number, severity: number): void {
    this.disease.begin(this, x, z, severity);
  }

  /** Someone has died. Their things stay where they were. */
  killNpc(npc: Npc, reasonKey: string, params: Record<string, string | number>): void {
    // Whatever they were carrying falls where they fell.
    for (const entry of npc.inventory.summary()) {
      this.dropPile(entry.item, entry.count, npc.x, npc.z);
    }
    npc.inventory.clear();
    this.log.add(this.time, 'settlement', reasonKey, params, {
      notable: true,
      x: npc.x,
      z: npc.z,
    });
    // The people who knew them feel it.
    for (const other of this.npcs) {
      if (other.id === npc.id) continue;
      const bond = other.relationships.get(npc.id) ?? 0;
      if (bond > 20) other.needs.mood = clamp(other.needs.mood - bond * 0.25, 0, 100);
    }
    this.removeNpc(npc);
  }

  /** Someone is under a roof, so the weather cannot reach them. */
  isSheltered(npc: Npc): boolean {
    // Standing inside the footprint of a finished, roofed building.
    for (const b of this.buildings) {
      if (!b.complete || b.def.height < 1.2) continue;
      const half = Math.max(b.def.width, b.def.depth) * this.terrain.tileSize * 0.6;
      if (Math.abs(b.worldX - npc.x) <= half && Math.abs(b.worldZ - npc.z) <= half) return true;
    }
    return false;
  }

  /**
   * Puts the volcanoes back from a save. Every field is checked, because a
   * save file is data from outside the program however it got here.
   */
  restoreVolcanoes(saved: SavedVolcano[]): void {
    this.volcanoes.length = 0;
    if (!Array.isArray(saved)) return;
    const states: VolcanoState[] = ['dormant', 'unrest', 'erupting', 'spent'];
    for (const raw of saved) {
      if (!raw || typeof raw !== 'object') continue;
      const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      const size = this.terrain.worldSize;
      this.volcanoes.push({
        id: num(raw.id, this.nextId()),
        x: clamp(num(raw.x, size / 2), 0, size),
        z: clamp(num(raw.z, size / 2), 0, size),
        radius: clamp(num(raw.radius, 50), 4, size),
        state: states.includes(raw.state as VolcanoState) ? (raw.state as VolcanoState) : 'dormant',
        pressure: clamp(num(raw.pressure, 0.2), 0, 4),
        name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : 'Unnamed Peak',
        eruptionLeft: raw.eruptionLeft === undefined ? undefined : clamp(num(raw.eruptionLeft, 0), 0, 4000),
      });
    }
  }

  /** A tree blown down by the wind: the timber is still there to be taken. */
  fellByWind(node: ResourceNode): void {
    const def = RESOURCES[node.kind];
    if (def.category === 'tree') {
      this.dropPile('log', Math.max(1, Math.round(node.growth * 3)), node.x, node.z);
    }
    this.removeNode(node);
  }

  /** Collapses a steep slope downhill. */
  landslide(x: number, z: number, radius: number): void {
    this.editor.sculpt(x, z, radius, -this.rng.range(1.5, 4), 'dome', 'landslide');
    this.markTerrainChanged();
    // Anything growing on the slope goes with it.
    const doomed: ResourceNode[] = [];
    this.nodeGrid.forEachNear(x, z, radius, (n) => doomed.push(n));
    for (const n of doomed) if (this.rng.chance(0.6)) this.removeNode(n);
    this.nav.markCostDirty();
  }

  /** Fire consumed a plant or tree. */
  burnNode(node: ResourceNode): void {
    const def = RESOURCES[node.kind];
    // A burnt tree leaves charcoal-grade wood behind, not a full harvest.
    if (def.category === 'tree' && this.rng.chance(0.4)) {
      this.dropPile('log', 1, node.x, node.z);
    }
    this.removeNode(node);
  }

  /** Marks ground as burnt so the scar is visible afterwards. */
  scorchGround(x: number, z: number, radius: number): void {
    const t = this.terrain;
    const ts = t.tileSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        if (Math.hypot(dx, dz) * ts > radius) continue;
        const i = t.index(tx, tz);
        // Burnt ground is poor ground, and recovers slowly.
        t.data.fertility[i] = clamp01(t.data.fertility[i] * 0.45);
        t.setOverlay(tx, tz, OVERLAY.Burnt);
      }
    }
  }

  /** Sends a settler running away from something frightening. */
  startleNpc(npc: Npc, fromX: number, fromZ: number): void {
    const dx = npc.x - fromX;
    const dz = npc.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    const flee = 18 + this.rng.range(0, 12);
    npc.setTask('flee', {
      x: clamp(npc.x + (dx / len) * flee, 4, this.terrain.worldSize - 4),
      z: clamp(npc.z + (dz / len) * flee, 4, this.terrain.worldSize - 4),
    });
    npc.needs.comfort = Math.max(0, npc.needs.comfort - 12);
  }

  onFloodStarted(x: number, z: number, radius: number): void {
    void radius;
    this.log.add(this.time, 'disaster', 'event.flood', undefined, { notable: true, x, z });
  }

  onFloodEnded(): void {
    this.log.add(this.time, 'disaster', 'event.floodOver');
  }

  /** Ash has settled on an area. Reported once, not once per tile. */
  onAshfall(x: number, z: number): void {
    if (this.time.totalHours - this.lastAshReport < 6) return;
    this.lastAshReport = this.time.totalHours;
    this.log.add(this.time, 'disaster', 'event.ashfall', undefined, { x, z });
  }

  /** Lights a fire, used by lightning, eruptions and god powers. */
  ignite(x: number, z: number, intensity = 0.7): void {
    this.disasters.ignite(this, x, z, intensity);
  }

  // =======================================================================
  // God powers that need world knowledge
  // =======================================================================

  /** Dries the soil out across the whole map. */
  applyDrought(): void {
    const f = this.terrain.data.fertility;
    for (let i = 0; i < f.length; i++) f[i] = clamp01(f[i] * 0.7);
    for (const b of this.buildings) {
      for (const plot of b.fields) plot.watered = Math.min(plot.watered, 0.1);
    }
    this.log.add(this.time, 'weather', 'ev.droughtBegins', undefined, { notable: true });
  }

  /** Raises a cone of rock and marks it as a volcano. */
  raiseVolcano(x: number, z: number, radius: number, strength: number): void {
    this.markTerrainChanged();
    const height = 25 + strength * 90;
    this.editor.sculpt(x, z, radius, height, 'cone', 'volcano');
    // A crater at the summit.
    this.editor.sculpt(x, z, radius * 0.2, -height * 0.16, 'crater', 'volcano crater');
    // Nothing survives being under a new mountain.
    const doomed: ResourceNode[] = [];
    this.nodeGrid.forEachNear(x, z, radius, (n) => doomed.push(n));
    for (const n of doomed) this.removeNode(n);
    this.volcanoes.push({
      id: this.nextId(),
      x,
      z,
      radius,
      state: 'dormant',
      pressure: 0.2,
      name: this.namer.featureName('volcano', `${Math.round(x)},${Math.round(z)}`),
    });
    this.nav.markCostDirty();
  }

  /** Opens a spring: a small pool that feeds the ground around it. */
  createSpring(x: number, z: number, radius: number, strength: number): void {
    // Dig a basin so the water has somewhere to sit, then fill it. Water that
    // sits above its own banks would run off, which is why the ground is cut
    // first rather than the level simply being raised.
    this.editor.sculpt(x, z, radius, -(1 + strength * 3), 'dome', 'spring basin');
    this.editor.flood(x, z, radius * 0.9, 0.6 + strength * 1.5);
    // Damp ground around a spring.
    const t = this.terrain;
    const ts = t.tileSize;
    const r = Math.ceil((radius * 2) / ts);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!t.inBounds(cx + dx, cz + dz)) continue;
        const d = Math.hypot(dx, dz) * ts;
        if (d > radius * 2) continue;
        const i = t.index(cx + dx, cz + dz);
        t.data.moisture[i] = clamp01(t.data.moisture[i] + 0.3 * (1 - d / (radius * 2)));
      }
    }
    this.nav.markCostDirty();
  }

  enrichSoil(x: number, z: number, radius: number, strength: number): void {
    const t = this.terrain;
    const ts = t.tileSize;
    const r = Math.ceil(radius / ts);
    const cx = t.tileX(x);
    const cz = t.tileZ(z);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!t.inBounds(tx, tz)) continue;
        const d = Math.hypot(dx, dz) * ts;
        if (d > radius) continue;
        const i = t.index(tx, tz);
        t.data.fertility[i] = clamp01(t.data.fertility[i] + strength * 0.5 * (1 - d / radius));
        t.clearOverlay(tx, tz, OVERLAY.Burnt);
      }
    }
  }

  /** A group of settlers arrives at a point. */
  sendSettlers(x: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const px = clamp(x + Math.cos(a) * 3, 4, this.terrain.worldSize - 4);
      const pz = clamp(z + Math.sin(a) * 3, 4, this.terrain.worldSize - 4);
      this.spawnNpc(px, pz, 'settler');
    }
    this.log.add(this.time, 'people', 'ev.settlersArrive', { count }, { notable: true, x, z });
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serializeNpcs(): SavedNpc[] {
    return this.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      age: n.age,
      profession: n.profession,
      x: n.x,
      z: n.z,
      yaw: n.yaw,
      homeId: n.homeId,
      workplaceId: n.workplaceId,
      needs: { ...n.needs },
      skills: { ...n.skillXp } as Record<string, number>,
      inventory: n.inventory.serialize(),
      money: n.money,
      seed: n.seed,
      taskState: n.task,
      memories: n.memories,
      relationships: [...n.relationships.entries()].map(([id, value]) => ({ id, value })),
      scheduleOffset: n.scheduleOffset,
    }));
  }

  deserializeNpcs(rows: SavedNpc[]): void {
    this.npcs.length = 0;
    this.npcById.clear();
    this.npcGrid.clear();
    for (const r of rows) {
      const npc = new Npc(r.id, r.name, r.seed);
      npc.age = r.age;
      npc.profession = r.profession as ProfessionId;
      npc.x = r.x;
      npc.z = r.z;
      npc.y = this.terrain.heightAt(r.x, r.z);
      npc.yaw = r.yaw;
      npc.homeId = r.homeId;
      npc.workplaceId = r.workplaceId;
      Object.assign(npc.needs, r.needs);
      npc.skillXp = { ...(r.skills as Record<string, number>) };
      const inv = Inventory.deserialize(r.inventory, npc.inventory.weightLimit);
      for (let i = 0; i < npc.inventory.slots.length && i < inv.slots.length; i++) {
        npc.inventory.slots[i] = inv.slots[i];
      }
      npc.money = r.money;
      npc.memories = r.memories ?? [];
      for (const rel of r.relationships ?? []) npc.relationships.set(rel.id, rel.value);
      npc.scheduleOffset = r.scheduleOffset;
      this.npcs.push(npc);
      this.npcById.set(npc.id, npc);
      this.npcGrid.insert(npc.x, npc.z, npc);
    }
  }

  serializeBuildings(): SavedBuilding[] {
    return this.buildings.map((b) => ({
      id: b.id,
      defId: b.defId,
      tx: b.tx,
      tz: b.tz,
      rotation: b.rotation,
      stageIndex: b.stageIndex,
      stageWork: b.stageWork,
      complete: b.complete,
      condition: b.condition,
      inventory: b.inventory.serialize(),
      delivered: Object.fromEntries(
        b.siteStore.summary().map((s) => [s.item, s.count]),
      ) as Record<string, number>,
      workerIds: b.workerIds,
      residentIds: b.residentIds,
      startedDay: b.startedDay,
      completedDay: b.completedDay,
      builtBy: b.builtBy,
      productionProgress: b.productionProgress,
      activeRecipe: b.activeRecipe,
      paused: b.paused,
      priority: b.priority,
      repairNeeded: b.repairNeeded,
      repairWork: b.repairWork,
      repairBill: b.repairBill as Record<string, number>,
      repairMaterialsConsumed: b.repairMaterialsConsumed,
      fields: b.fields.map((f) => ({
        tx: f.tx,
        tz: f.tz,
        crop: f.crop ?? '',
        growth: f.growth,
        watered: f.watered,
        planted: f.planted,
      })),
    }));
  }

  deserializeBuildings(rows: SavedBuilding[]): void {
    this.buildings.length = 0;
    this.buildingById.clear();
    this.buildingAtTile.clear();
    for (const r of rows) {
      if (!BUILDINGS[r.defId as BuildingId]) continue;
      const b = new Building(r.id, r.defId as BuildingId, r.tx, r.tz, r.rotation);
      b.stageIndex = r.stageIndex;
      b.stageWork = r.stageWork;
      b.complete = r.complete;
      b.condition = r.condition ?? 1;
      b.workerIds = r.workerIds ?? [];
      b.residentIds = r.residentIds ?? [];
      b.startedDay = r.startedDay;
      b.completedDay = r.completedDay;
      b.builtBy = r.builtBy ?? [];
      b.productionProgress = r.productionProgress ?? 0;
      b.activeRecipe = (r.activeRecipe as RecipeId) ?? null;
      b.paused = r.paused ?? false;
      b.priority = r.priority ?? 1;

      // A repair in progress picks up where it left off, bill and all. The
      // bill is filtered against the real item table, because a save file is
      // data from outside the program.
      b.repairNeeded = r.repairNeeded === true;
      b.repairWork = typeof r.repairWork === 'number' && r.repairWork >= 0 ? r.repairWork : 0;
      b.repairMaterialsConsumed = r.repairMaterialsConsumed === true;
      b.repairBill = {};
      for (const [item, amount] of Object.entries(r.repairBill ?? {})) {
        if (!ITEMS[item as ItemId]) continue;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) continue;
        b.repairBill[item as ItemId] = Math.min(9999, Math.round(amount));
      }
      if (b.repairNeeded && Object.keys(b.repairBill).length === 0 && !b.repairMaterialsConsumed) {
        // An old save knew the building was damaged but not what it would
        // cost; work that out now rather than repairing it for free.
        b.computeRepairBill();
      }

      const inv = Inventory.deserialize(r.inventory);
      for (let i = 0; i < b.inventory.slots.length && i < inv.slots.length; i++) {
        b.inventory.slots[i] = inv.slots[i];
      }
      for (const [item, count] of Object.entries(r.delivered ?? {})) {
        b.siteStore.add(item as ItemId, count as number);
      }
      // Materials for a stage in progress were already consumed.
      b.stageMaterialsConsumed = b.stageWork > 0;

      b.fields = (r.fields ?? []).map((f) => ({
        tx: f.tx,
        tz: f.tz,
        crop: (f.crop || null) as FarmPlot['crop'],
        growth: f.growth,
        watered: f.watered,
        planted: f.planted,
        reservedBy: 0,
      }));

      const c = b.centre(this.terrain.tileSize);
      b.worldX = c.x;
      b.worldZ = c.z;
      b.groundY = this.terrain.heightAt(c.x, c.z);

      this.buildings.push(b);
      this.buildingById.set(b.id, b);
      for (let z = b.tz; z < b.tz + b.footprintDepth; z++) {
        for (let x = b.tx; x < b.tx + b.footprintWidth; x++) {
          this.buildingAtTile.set(this.terrain.index(x, z), b.id);
          if (b.complete && b.def.style !== 'road' && b.def.style !== 'field' &&
              b.def.style !== 'stockpile' && b.def.style !== 'bridge' &&
              b.def.style !== 'fence' && b.def.style !== 'lamp') {
            this.nav.setBlocked(x, z, true);
          }
        }
      }
      if (b.def.gathers === 'ore') {
        this.mineOre.set(b.id, oreItemsFor(this.nearestVein(b.worldX, b.worldZ, 30)));
      }
    }
    this.nav.markCostDirty();
  }

  serializeJobs(): SavedJob[] {
    return this.jobs.serialize() as SavedJob[];
  }

  deserializeJobs(rows: SavedJob[]): void {
    this.jobs.restore(rows);
  }

  serializeWildlife(): { id: number; species: string; x: number; z: number; age: number }[] {
    return this.wildlife.map((a) => ({ id: a.id, species: a.species, x: a.x, z: a.z, age: a.age }));
  }

  deserializeWildlife(rows: { id: number; species: string; x: number; z: number; age: number }[]): void {
    this.wildlife.length = 0;
    this.wildlifeById.clear();
    for (const r of rows) {
      if (!ANIMALS[r.species as AnimalSpecies]) continue;
      const a = createAnimal(r.id, r.species as AnimalSpecies, r.x, r.z, this.rng);
      a.age = r.age;
      a.y = this.terrain.heightAt(r.x, r.z);
      this.wildlife.push(a);
      this.wildlifeById.set(a.id, a);
    }
  }

  /** Rebuilds derived state after loading. */
  afterLoad(): void {
    this.piles.length = 0;
    this.pileById.clear();
    this.pileGrid.clear();
    this.recomputeSettlement();
    this.jobs.refresh(this.jobContext());
  }

  get regrowingCount(): number {
    return this.regrowing.length;
  }

  rebuildRegrowQueue(): void {
    this.regrowing = this.nodes.filter((n) => n.depleted && n.regrowIn > 0);
  }
}

function oreItemsFor(vein: OreVein | null): ItemId[] {
  if (!vein) return ['iron_ore', 'coal'];
  switch (vein.kind) {
    case 'iron':
      return ['iron_ore', 'iron_ore', 'coal'];
    case 'copper':
      return ['copper_ore', 'copper_ore', 'coal'];
    case 'coal':
      return ['coal', 'coal', 'iron_ore'];
    default:
      return ['iron_ore', 'coal'];
  }
}
