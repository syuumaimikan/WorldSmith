/**
 * A settlement getting on with it while nobody is watching.
 *
 * During a time skip nobody walks anywhere, but a century in which a
 * settlement neither clears a field nor raises a roof is not a century that
 * happened — it is a century of the place being paused, which is the thing a
 * skip is supposed not to be.
 *
 * Nothing here invents progress. What gets built is what the settlement is
 * short of, judged by the same readouts the played game shows the player:
 * nobody has a bed, so build somewhere to sleep; there is nothing put by, so
 * build a store; the ground is not turned, so turn some. What it costs is the
 * same bill of materials the building carries, paid out of the same stores,
 * and the work is done at the rate the people who are left can actually work
 * at. A settlement with no hands and no timber builds nothing, exactly as it
 * would if every plank were carried by somebody.
 */

import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import { BuildingId, buildingDef } from '../data/buildings';
import { ItemId, ITEMS, isFood } from '../data/items';
import { ResourceNode, RESOURCES } from '../world/resources';
import { OVERLAY } from '../world/Terrain';
import { WORKING_AGE } from './Generations';
import type { Building } from './Building';
import type { World } from './World';

/**
 * What a settlement reaches for, in the order it reaches for it. Each entry
 * says what shortage it answers; the first unmet one is what gets started.
 */
interface Need {
  id: BuildingId;
  /** How badly this is wanted, 0 when it is not wanted at all. */
  want: (world: World) => number;
}

const NEEDS: Need[] = [
  {
    // Somewhere to sleep comes before anything else.
    id: 'tent',
    want: (w) => clamp01((w.npcs.length - w.settlement.housingCapacity) / 4),
  },
  {
    id: 'cottage',
    want: (w) =>
      w.research.isUnlocked('timber_framing')
        ? clamp01((w.npcs.length - w.settlement.housingCapacity) / 6)
        : 0,
  },
  {
    // Then somewhere to put what has been gathered.
    id: 'stockpile',
    want: (w) => (countOf(w, 'stockpile') < 1 + w.npcs.length / 14 ? 0.8 : 0),
  },
  {
    // Then the things that turn what is gathered into what is eaten.
    id: 'farm_field',
    want: (w) =>
      w.research.isUnlocked('agriculture') && tilledTiles(w) < w.npcs.length * 22 ? 0.9 : 0,
  },
  {
    id: 'lumber_camp',
    want: (w) => (countOf(w, 'lumber_camp') < 1 + w.npcs.length / 18 ? 0.6 : 0),
  },
  {
    id: 'granary',
    want: (w) => (countOf(w, 'granary') < 1 + w.npcs.length / 24 ? 0.55 : 0),
  },
  {
    // Somewhere for somebody to work things out. Nothing is learned without
    // one, during a skip or otherwise.
    id: 'research_hut',
    want: (w) => (w.npcs.length > 8 && countOf(w, 'research_hut') < 1 ? 0.7 : 0),
  },
];

function countOf(world: World, id: BuildingId): number {
  let n = 0;
  for (const b of world.buildings) if (b.defId === id && !b.demolishing) n++;
  return n;
}

/** Items that are worth eating, for deciding what to go and fetch. */
const FOOD_ITEMS = new Set<ItemId>(
  (Object.keys(ITEMS) as ItemId[]).filter((id) => isFood(id)),
);

function tilledTiles(world: World): number {
  let n = 0;
  const o = world.terrain.overlay;
  for (let i = 0; i < o.length; i++) if (o[i] & (OVERLAY.Field | OVERLAY.Tilled)) n++;
  return n;
}

export class Development {
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xdeb0);
  }

  /**
   * One skipped day of a settlement improving itself.
   *
   * @param days how many days this call stands for.
   */
  update(world: World, days: number): void {
    const hands = this.labour(world);
    if (hands <= 0) return;

    this.gather(world, hands, days);
    this.study(world, days);
    this.keepTheRoofsOn(world, hands, days);
    this.pushOnWithBuilding(world, hands, days);
    this.startSomethingIfIdle(world);
    this.breakGround(world, hands, days);
    this.abandonHopelessSites(world);
  }

  /** Hands available for work, weighted by how much work each is good for. */
  private labour(world: World): number {
    let hands = 0;
    for (const npc of world.npcs) {
      if (npc.age < WORKING_AGE) continue;
      if (npc.condition < 25) continue;
      // The same frailty and health that slow a person down in a played day.
      hands += (0.55 + clamp01(npc.condition / 100) * 0.45) * (1 - npc.frailty * 0.45);
    }
    return hands;
  }

  /**
   * Felling and quarrying, without anybody walking to the tree.
   *
   * The same nodes are worked and the same nodes are depleted, through the
   * same call the played game uses, so a settlement that has cleared the
   * woodland around it runs out of timber and has to wait for it to grow
   * back. What comes out goes into the stores, or on the ground when there
   * are no stores, which is where it would end up anyway.
   */
  private gather(world: World, hands: number, days: number): void {
    const s = world.settlement;
    // A day of hands is a day of hands. This is the same work figure the
    // building sites are given, spent on getting materials instead.
    // A little over one thing fetched per pair of hands per day, which is
    // about what a person gets done between everything else a day contains.
    // What a pair of hands fetches in a day. A forager working ground they
    // know brings back rather more than one basket, and setting this too low
    // is what left a band of six in a wood full of berries, nuts, mushrooms
    // and game living hand to mouth for ever and never building anything.
    let units = hands * 0.95 * days;
    if (units <= 0) return;

    const reach = s.radius + 80;
    const nearby: ResourceNode[] = [];
    world.nodeGrid.forEachNear(s.centre.x, s.centre.z, reach, (n) => {
      if (n.depleted || n.amount <= 0) return;
      nearby.push(n);
    });
    if (nearby.length === 0) return;

    const feeds = (n: ResourceNode): boolean =>
      RESOURCES[n.kind].yields.some((y) => FOOD_ITEMS.has(y.item));
    const near2 = (n: ResourceNode): number =>
      (n.x - s.centre.x) ** 2 + (n.z - s.centre.z) ** 2;
    nearby.sort((a, b) => near2(a) - near2(b));

    // How the day's hands get split. A settlement with nothing put by spends
    // nearly all of them on food; one with a week in the baskets spends
    // hardly any. It is never all of them, because a settlement that only
    // ever eats never builds anything and never stops only ever eating.
    const share = clamp01(1 - world.settlement.foodDays / 5) * 0.75 + 0.1;
    let forFood = units * share;
    let forGoods = units - forFood;

    const work = (wantFood: boolean, budget: number): number => {
      let left = budget;
      for (const node of nearby) {
        if (left <= 0) break;
        if (node.depleted || node.amount <= 0) continue;
        if (feeds(node) !== wantFood) continue;
        const def = RESOURCES[node.kind];
        // Nothing is stripped bare in one visit; a settlement works its way
        // round its own country.
        const take = Math.min(left, node.amount, 3);
        left -= take;
        const got = world.harvestNode(node, take * def.workPerUnit);
        for (const item of got.items) this.store(world, item.item, item.amount);
      }
      return left;
    };

    // Whatever one side cannot spend, the other does: hands are not wasted
    // because the bushes near the camp have already been picked.
    forGoods += work(true, forFood);
    forFood = work(false, forGoods);
    work(true, forFood);
  }

  /**
   * Working things out.
   *
   * Only where there is somewhere to do it and somebody to do it in, which is
   * the same rule the played game keeps: nothing here accrues for existing. A
   * settlement that never builds a study never learns anything, during a
   * skipped century as much as during a played afternoon.
   */
  private study(world: World, days: number): void {
    let scholars = 0;
    for (const b of world.buildings) {
      if (!b.complete || b.defId !== 'research_hut') continue;
      scholars += Math.min(b.def.workSlots, b.workerIds.length || b.def.workSlots);
    }
    if (scholars <= 0) return;
    if (!world.research.active) {
      // Whatever is open and cheapest: a settlement without a player steering
      // it works on the next thing it can, not on the thing it most wants.
      const open = world.research.available();
      if (open.length === 0) return;
      const next = open.reduce((a, b) => (b.cost < a.cost ? b : a));
      world.research.start(next.id);
    }
    world.research.contribute(scholars * 2.2 * days * world.research.effects.study);
  }

  /**
   * Patching up what the weather and the years have knocked about.
   *
   * A building nobody mends falls down eventually, and over a skipped century
   * that means a settlement of empty ground. The bill is the building's own
   * repair bill, paid out of the same stores.
   */
  private keepTheRoofsOn(world: World, hands: number, days: number): void {
    const hurt = world.buildings.filter((b) => b.complete && b.condition < 0.85);
    if (hurt.length === 0) return;
    const perBuilding = (hands * 0.18 * days) / hurt.length;
    for (const b of hurt) {
      // Nothing is mended out of nothing. The bill has to be on site, and if
      // the settlement cannot find it the building keeps falling down.
      let short = false;
      for (const [item, amount] of Object.entries(b.repairBill) as [ItemId, number][]) {
        const have = b.siteStore.count(item);
        if (have >= amount) continue;
        this.take(world, item, amount - have, b);
        if (b.siteStore.count(item) < amount) short = true;
      }
      if (short) continue;
      for (const [item, amount] of Object.entries(b.repairBill) as [ItemId, number][]) {
        b.siteStore.remove(item, amount);
      }
      b.condition = Math.min(1, b.condition + perBuilding);
    }
  }

  /** Moves goods out of the settlement's stores and piles onto a site. */
  private take(world: World, item: ItemId, amount: number, site: Building): void {
    let left = amount;
    for (const store of world.buildings) {
      if (left <= 0) break;
      if (store === site || !store.complete) continue;
      const have = store.inventory.count(item);
      if (have <= 0) continue;
      const take = Math.min(have, Math.ceil(left));
      store.inventory.remove(item, take);
      site.siteStore.add(item, take);
      left -= take;
    }
    for (let i = world.piles.length - 1; i >= 0 && left > 0; i--) {
      const pile = world.piles[i];
      if (pile.item !== item) continue;
      const take = Math.min(pile.count, Math.ceil(left));
      pile.count -= take;
      site.siteStore.add(item, take);
      left -= take;
      if (pile.count <= 0) world.removePile(pile);
    }
  }

  /** Puts goods wherever the settlement keeps goods. */
  private store(world: World, item: ItemId, amount: number): void {
    let left = amount;
    for (const b of world.buildings) {
      if (left <= 0) break;
      if (!b.complete || b.inventory.slots.length === 0) continue;
      const room = b.inventory.spaceFor(item);
      if (room <= 0) continue;
      const put = Math.min(room, left);
      b.inventory.add(item, put);
      left -= put;
    }
    if (left > 0) {
      const c = world.settlement.centre;
      world.dropPile(item, left, c.x + this.rng.range(-6, 6), c.z + this.rng.range(-6, 6));
    }
  }

  /**
   * A site nobody can supply is not a plan, it is a hole in the ground that
   * blocks every other plan. After long enough waiting, it is given up.
   */
  private abandonHopelessSites(world: World): void {
    for (const b of [...world.buildings]) {
      if (b.complete || b.demolishing) continue;
      const waiting = world.time.totalDays - b.startedDay;
      if (waiting < 900) continue;
      if (b.readyForWork()) continue;
      world.cancelBuilding(b);
    }
  }

  /**
   * Work on whatever is already standing half-built.
   *
   * A site only takes work when the materials for its current stage are
   * actually on it, which is the same rule the played game enforces — so a
   * skipped settlement that has run out of timber stops building, rather than
   * finishing the house out of nothing.
   */
  private pushOnWithBuilding(world: World, hands: number, days: number): void {
    const sites = world.buildings.filter((b) => !b.complete && !b.demolishing && !b.paused);
    if (sites.length === 0) return;

    // Spread the day's work over the sites, nearest thing to what a crew does.
    const perSite = (hands * 5.5 * days) / sites.length;
    for (const site of sites) {
      this.deliverMaterials(world, site);
      // The same rule the played game enforces: a stage is not worked until
      // what it is made of is standing on the site. A settlement out of
      // timber stops building rather than finishing the house out of nothing.
      if (!site.readyForWork()) continue;
      site.consumeStageMaterials();
      site.applyWork(perSite);
    }
  }

  /**
   * Moves what a site is short of out of the settlement's stores and onto it.
   * Nothing is created: if the stores do not have it, the site does not get it.
   */
  private deliverMaterials(world: World, site: Building): void {
    // Stores first, then whatever is lying about on the ground: a settlement
    // picks up its own dropped logs, which is what it would do anyway.
    for (const { item, amount } of site.missingMaterials()) {
      this.take(world, item, amount, site);
    }
  }

  /** If nothing is being built, start the thing the place is shortest of. */
  private startSomethingIfIdle(world: World): void {
    const building = world.buildings.some((b) => !b.complete && !b.demolishing);
    if (building) return;

    let best: Need | null = null;
    let bestWant = 0.15;
    for (const need of NEEDS) {
      const want = need.want(world);
      if (want > bestWant) {
        bestWant = want;
        best = need;
      }
    }
    if (!best) return;

    const spot = this.findSpot(world, best.id);
    if (!spot) return;
    world.placeBuilding(best.id, spot.tx, spot.tz, spot.rotation);
  }

  /** Somewhere near the settlement the thing will actually fit. */
  private findSpot(
    world: World,
    id: BuildingId,
  ): { tx: number; tz: number; rotation: number } | null {
    const t = world.terrain;
    const c = world.settlement.centre;
    const def = buildingDef(id);
    const reach = Math.max(28, world.settlement.radius + 18);

    for (let attempt = 0; attempt < 90; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(6, reach);
      const tx = t.tileX(c.x + Math.cos(a) * r) - Math.floor(def.width / 2);
      const tz = t.tileZ(c.z + Math.sin(a) * r) - Math.floor(def.depth / 2);
      const rotation = this.rng.int(0, 3);
      if (world.canPlace(id, tx, tz, rotation).ok) return { tx, tz, rotation };
    }
    return null;
  }

  /**
   * Turning ground over.
   *
   * Only where a farm plot exists to work it and only on ground that would
   * grow anything, so a settlement does not till the side of a mountain.
   */
  private breakGround(world: World, hands: number, days: number): void {
    if (!world.research.isUnlocked('agriculture')) return;
    const plots = world.buildings.filter((b) => b.defId === 'farm_field' && b.complete);
    if (plots.length === 0) return;

    const t = world.terrain;
    // A day of hands turns over a few square metres, and no more.
    let left = Math.floor(hands * 0.6 * days);
    for (let attempt = 0; attempt < left * 8 && left > 0; attempt++) {
      const plot = this.rng.pick(plots);
      const tx = t.tileX(plot.worldX) + this.rng.int(-6, 6);
      const tz = t.tileZ(plot.worldZ) + this.rng.int(-6, 6);
      if (tx < 1 || tz < 1 || tx >= t.gridSize - 1 || tz >= t.gridSize - 1) continue;
      const i = t.index(tx, tz);
      if (t.overlay[i] & (OVERLAY.Field | OVERLAY.Tilled | OVERLAY.Floor | OVERLAY.Road)) continue;
      if (t.waterHeight[i] > t.data.height[i]) continue;
      if (t.data.slope[i] > 0.22) continue;
      if (t.data.fertility[i] < 0.3) continue;
      t.setOverlay(tx, tz, OVERLAY.Tilled);
      left--;
    }
  }
}
