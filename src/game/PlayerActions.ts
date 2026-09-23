/**
 * What the player character can physically do in the world.
 *
 * The player works by the same rules as everyone else: chopping a tree takes
 * the same work units a logger would spend, and the logs it yields have to be
 * carried somewhere. The only advantage the player has is being able to decide
 * what to do next.
 */

import { World } from '../sim/World';
import { RESOURCES, ResourceNode } from '../world/resources';
import { ItemPile } from '../sim/ItemPile';
import { Building } from '../sim/Building';
import { Npc } from '../sim/Npc';
import { ITEMS, ItemId, nutritionOf } from '../data/items';
import { t } from '../i18n';
import { buildingName, itemName, resourceName, professionName, carryingSummary } from '../i18n/names';
import { buildingStatus } from '../i18n/status';

export type TargetKind = 'node' | 'pile' | 'building' | 'npc' | 'none';

export interface InteractTarget {
  kind: TargetKind;
  id: number;
  label: string;
  /** Verb shown in the interaction prompt. */
  verb: string;
  detail: string;
  distance: number;
  /** 0..1 when the target has ongoing work. */
  progress: number;
  node?: ResourceNode;
  pile?: ItemPile;
  building?: Building;
  npc?: Npc;
}

const REACH = 2.6;

const NONE: InteractTarget = {
  kind: 'none',
  id: 0,
  label: '',
  verb: '',
  detail: '',
  distance: Infinity,
  progress: 0,
};

/** Finds the most sensible thing in front of the player to interact with. */
export function findTarget(world: World): InteractTarget {
  const p = world.player;
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  // Slightly ahead of the player, so you interact with what you are facing.
  const ax = p.position.x + fx * 0.8;
  const az = p.position.z + fz * 0.8;

  let best: InteractTarget = NONE;
  let bestScore = Infinity;

  const consider = (t: InteractTarget, x: number, z: number): void => {
    const dx = x - p.position.x;
    const dz = z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > REACH) return;
    // Prefer things in front of the player over things behind.
    const facing = (dx * fx + dz * fz) / (dist || 1);
    const score = dist - facing * 0.8;
    if (score < bestScore) {
      bestScore = score;
      best = { ...t, distance: dist };
    }
  };

  world.pileGrid.forEachNear(ax, az, REACH, (pile) => {
    consider(
      {
        kind: 'pile',
        id: pile.id,
        label: `${pile.count} ${itemName(pile.item)}`,
        verb: t('prompt.pickUp'),
        detail: '',
        distance: 0,
        progress: 0,
        pile,
      },
      pile.x,
      pile.z,
    );
  });

  world.nodeGrid.forEachNear(ax, az, REACH + 1, (node) => {
    if (node.depleted) return;
    const def = RESOURCES[node.kind];
    const verb =
      def.skill === 'chop'
        ? t('prompt.chop')
        : def.skill === 'mine'
          ? t('prompt.mine')
          : t('prompt.gather');
    consider(
      {
        kind: 'node',
        id: node.id,
        label: resourceName(node.kind),
        verb,
        detail: `${node.amount}/${node.maxAmount}`,
        distance: 0,
        progress: node.work / def.workPerUnit,
        node,
      },
      node.x,
      node.z,
    );
  });

  for (const b of world.buildings) {
    const dx = b.worldX - p.position.x;
    const dz = b.worldZ - p.position.z;
    const half = Math.max(b.footprintWidth, b.footprintDepth) * world.terrain.tileSize * 0.5;
    if (Math.hypot(dx, dz) > half + REACH) continue;
    const verb = !b.complete
      ? t('prompt.inspectSite')
      : b.isStorage
        ? t('prompt.storeGoods')
        : t('prompt.inspect');
    consider(
      {
        kind: 'building',
        id: b.id,
        label: buildingName(b.defId),
        verb,
        detail: buildingStatus(b),
        distance: 0,
        progress: b.progress,
        building: b,
      },
      b.worldX + (dx === 0 ? 0 : (dx / Math.hypot(dx, dz)) * -half),
      b.worldZ + (dz === 0 ? 0 : (dz / Math.hypot(dx, dz)) * -half),
    );
  }

  world.npcGrid.forEachNear(ax, az, REACH, (npc) => {
    consider(
      {
        kind: 'npc',
        id: npc.id,
        label: npc.name,
        verb: t('prompt.talk'),
        detail: professionName(npc.profession),
        distance: 0,
        progress: 0,
        npc,
      },
      npc.x,
      npc.z,
    );
  });

  return best;
}

export interface ActionResult {
  kind:
    | 'none'
    | 'gathered'
    | 'picked_up'
    | 'stored'
    | 'selected'
    | 'talked'
    | 'full'
    | 'used'
    | 'placed'
    | 'thrown';
  message?: string;
  /** Position for particle effects. */
  x?: number;
  y?: number;
  z?: number;
  effect?: 'woodchips' | 'stonedust' | 'dust';
}

/** How much of a meal is water. A third, roughly, for ordinary food. */
const WATER_IN_FOOD = 0.3;

/** How far you can reach water to drink from it, in metres. */
export const DRINK_REACH = 2.2;

/** Player work rate. Comparable to a skilled settler, but not better. */
const PLAYER_WORK_RATE = 4.4;

/**
 * Applies tool work to a node. Called every frame while the tool key is held.
 */
export function applyToolWork(world: World, node: ResourceNode, dt: number): ActionResult {
  const def = RESOURCES[node.kind];
  const p = world.player;

    // A tool in the pack is not a tool in the hand. What is actually out
    // decides how fast the work goes, and a tool for the wrong job is no
    // better than none.
  const toolFor = def.skill === 'chop' ? 'axe' : def.skill === 'mine' ? 'pickaxe' : null;
  const held = p.equipped();
  const hasTool = toolFor !== null && held === toolFor;
  const multiplier = hasTool ? 1.5 : def.skill === 'forage' ? 1 : 0.55;

  p.busyAction = def.skill === 'chop' ? 'chop' : def.skill === 'mine' ? 'mine' : 'farm';
  p.busyTargetId = node.id;

  const result = world.harvestNode(node, PLAYER_WORK_RATE * multiplier * dt);

  if (result.items.length === 0) {
    return {
      kind: 'none',
      x: node.x,
      y: node.y + 0.8,
      z: node.z,
      effect: def.skill === 'chop' ? 'woodchips' : def.skill === 'mine' ? 'stonedust' : 'dust',
    };
  }

  let overflow = false;
  for (const y of result.items) {
    const added = p.inventory.add(y.item, y.amount);
    if (added < y.amount) {
      world.dropPile(y.item, y.amount - added, node.x, node.z);
      overflow = true;
    }
  }

  if (result.nodeDepleted) {
    p.busyAction = null;
    p.busyTargetId = 0;
  }

  return {
    kind: overflow ? 'full' : 'gathered',
    message: overflow ? t('inv.packFullDropped') : undefined,
    x: node.x,
    y: node.y + 0.8,
    z: node.z,
    effect: def.skill === 'chop' ? 'woodchips' : def.skill === 'mine' ? 'stonedust' : 'dust',
  };
}

/** Single-press interaction with whatever the player is facing. */
export function interact(world: World, target: InteractTarget): ActionResult {
  const p = world.player;

  switch (target.kind) {
    case 'pile': {
      const pile = target.pile!;
      const take = Math.min(pile.count, p.inventory.spaceFor(pile.item));
      if (take <= 0) {
        return { kind: 'full', message: t('inv.full') };
      }
      p.inventory.add(pile.item, take);
      pile.count -= take;
      if (pile.count <= 0) world.removePile(pile);
      world.advanceTutorial(2);
      return {
        kind: 'picked_up',
        message: t('inv.pickedUp', { count: take, item: itemName(pile.item) }),
        x: pile.x,
        y: pile.y + 0.3,
        z: pile.z,
      };
    }

    case 'building': {
      const b = target.building!;
      world.selection = { kind: 'building', id: b.id };
      if (!b.complete) {
        // Hand over anything the site is waiting for.
        const missing = b.missingMaterials();
        let delivered = 0;
        for (const m of missing) {
          const have = p.inventory.count(m.item);
          if (have <= 0) continue;
          const moved = p.inventory.transferTo(b.siteStore, m.item, Math.min(have, m.amount));
          delivered += moved;
        }
        if (delivered > 0) {
          world.onGoodsDelivered(b, missing[0].item, delivered);
          return {
            kind: 'stored',
            message: t('inv.delivered', { count: delivered, building: buildingName(b.defId) }),
            x: b.worldX,
            y: b.groundY + 1,
            z: b.worldZ,
          };
        }
        return { kind: 'selected' };
      }

      if ((b.def.storageSlots ?? 0) > 0) {
        let moved = 0;
        for (const stack of [...p.inventory.summary()]) {
          if (ITEMS[stack.item].category === 'tool') continue;
          moved += p.inventory.transferTo(b.inventory, stack.item, stack.count);
        }
        if (moved > 0) {
          world.advanceTutorial(3);
          return {
            kind: 'stored',
            message: t('inv.stored', { count: moved }),
            x: b.worldX,
            y: b.groundY + 1,
            z: b.worldZ,
          };
        }
      }
      return { kind: 'selected' };
    }

    case 'npc': {
      const npc = target.npc!;
      world.selection = { kind: 'npc', id: npc.id };
      npc.adjustRelationship(0, 1);
      return { kind: 'talked', message: greeting(npc, world) };
    }

    case 'node': {
      world.selection = { kind: 'node', id: target.id };
      return { kind: 'selected' };
    }

    default:
      return { kind: 'none' };
  }
}

/** Rule-based dialogue. Deliberately not dependent on any external service. */
export function greeting(npc: Npc, world: World): string {
  const lines: string[] = [];
  const hour = world.time.snapshot().hour;
  lines.push(t(hour < 11 ? 'talk.morning' : hour < 18 ? 'talk.afternoon' : 'talk.evening'));

  if (npc.needs.hunger < 35) lines.push(t('talk.hungry'));
  else if (npc.needs.rest < 30) lines.push(t('talk.tired'));
  else if (npc.needs.mood > 80) lines.push(t('talk.content'));

  switch (npc.activity) {
    case 'hauling':
      lines.push(t('talk.hauling', { goods: carryingSummary(npc.carrying()) }));
      break;
    case 'building': {
      const site = world.buildingById.get(npc.task.targetId);
      if (site) {
        lines.push(t('talk.building', { name: buildingName(site.defId), status: buildingStatus(site) }));
      }
      break;
    }
    case 'chopping':
      lines.push(t('talk.chopping'));
      break;
    case 'mining':
      lines.push(t('talk.mining'));
      break;
    case 'farming':
    case 'planting':
      lines.push(t('talk.farming'));
      break;
    case 'idle':
      lines.push(t('talk.idle'));
      break;
    default:
      break;
  }

  if (world.settlement.foodDays < 3) lines.push(t('talk.foodShort'));
  if (world.settlement.homeless > 0 && !npc.homeId) lines.push(t('talk.homeless'));

  return lines.join(' ');
}

/** The item the player has selected on the quick bar, if any. */
export function activeQuickItem(world: World, slot: number): ItemId | null {
  return world.player.quickSlots[slot] ?? null;
}

// ---------------------------------------------------------------- the hands

/**
 * Takes an inventory slot into the hand.
 *
 * Picking the slot that is already held puts it away again, which is how
 * every game that has ever had a hotbar behaves and how people expect it to.
 */
export function equipSlot(world: World, index: number): ActionResult {
  const p = world.player;
  if (index < 0 || index >= p.inventory.slots.length) return { kind: 'none' };
  if (!p.inventory.slots[index]) {
    p.equippedSlot = -1;
    return { kind: 'none' };
  }
  p.equippedSlot = p.equippedSlot === index ? -1 : index;
  const item = p.equipped();
  return {
    kind: 'none',
    message: item ? t('act.nowHolding', { item: itemName(item) }) : t('act.handsFree'),
  };
}

/** Moves one stack to another slot, or trades the two over. */
export function swapSlots(world: World, from: number, to: number): void {
  const inv = world.player.inventory;
  if (from === to) return;
  if (from < 0 || to < 0 || from >= inv.slots.length || to >= inv.slots.length) return;
  const held = world.player.equippedSlot;
  const tmp = inv.slots[from];
  inv.slots[from] = inv.slots[to];
  inv.slots[to] = tmp;
  // The hand follows the thing it was holding, not the hole it left.
  if (held === from) world.player.equippedSlot = to;
  else if (held === to) world.player.equippedSlot = from;
}

/**
 * Does whatever the held thing is for.
 *
 * Food is eaten, herbs are used on whatever is wrong with you, and a tool
 * does its work by being held rather than by being pressed -- so using one
 * here does nothing, and says so.
 */
export function useEquipped(world: World): ActionResult {
  const p = world.player;
  const item = p.equipped();
  if (!item) return { kind: 'none', message: t('act.nothingHeld') };
  const def = ITEMS[item];

  if (def.category === 'food') {
    const before = p.stats.hunger;
    p.stats.hunger = Math.min(100, p.stats.hunger + nutritionOf(item));
    // Most food is partly water. Bread is not, which is why eating dry in a
    // desert is a bad idea and why fruit is worth more there than its
    // calories say.
    p.stats.thirst = Math.min(100, p.stats.thirst + WATER_IN_FOOD * nutritionOf(item));
    p.inventory.remove(item, 1);
    if (p.inventory.count(item) === 0) p.equippedSlot = -1;
    return {
      kind: 'used',
      message: t('act.ate', { item: itemName(item), gained: Math.round(p.stats.hunger - before) }),
      x: p.position.x,
      y: p.position.y + 1.2,
      z: p.position.z,
    };
  }

  if (item === 'herbs') {
    // Not a potion. A poultice does a little, once, for what is actually
    // hurting -- and it is gone afterwards.
    const worst = p.body.worstInjury();
    if (!worst) return { kind: 'none', message: t('act.nothingToTreat') };
    p.inventory.remove('herbs', 1);
    if (p.inventory.count('herbs') === 0) p.equippedSlot = -1;
    worst.severity = Math.max(0, worst.severity - 0.28);
    worst.treated = true;
    return {
      kind: 'used',
      message: t('act.treated', { part: t(`body.${worst.part}`) }),
      x: p.position.x,
      y: p.position.y + 1.2,
      z: p.position.z,
    };
  }

  if (def.category === 'tool') return { kind: 'none', message: t('act.toolIsHeld') };
  return { kind: 'none', message: t('act.cannotUse', { item: itemName(item) }) };
}

/**
 * Puts one of the held thing down where the player is looking.
 *
 * It becomes a real pile on the ground, which is the same object a logger
 * leaves at the treeline -- so it can be picked up again, hauled by somebody
 * else, and spoils if it is food.
 */
export function placeEquipped(world: World, x: number, z: number): ActionResult {
  const p = world.player;
  const item = p.equipped();
  if (!item) return { kind: 'none', message: t('act.nothingHeld') };
  if (world.terrain.waterDepthAt(x, z) > 0.4) {
    return { kind: 'none', message: t('act.cannotPlaceThere') };
  }
  if (p.inventory.remove(item, 1) <= 0) return { kind: 'none' };
  world.dropPile(item, 1, x, z);
  if (p.inventory.count(item) === 0) p.equippedSlot = -1;
  return {
    kind: 'placed',
    message: t('act.placed', { item: itemName(item) }),
    x,
    y: world.terrain.heightAt(x, z) + 0.3,
    z,
    effect: 'dust',
  };
}

// --------------------------------------------------------------- throwing

/** How far from a storehouse you can still reach into it. */
export const STORE_REACH = 4.5;

/**
 * Throws one of the held thing where the player is looking.
 *
 * It leaves the hand at a speed the item's own weight decides, follows a real
 * arc, and is the same item when it lands -- so a thrown stone can be picked
 * up again, and a thrown stone that hits somebody hurts them and is
 * remembered by them.
 */
export function throwEquipped(world: World, pitch: number): ActionResult {
  const p = world.player;
  const item = p.equipped();
  if (!item) return { kind: 'none', message: t('act.nothingHeld') };
  if (ITEMS[item].weight > 30) {
    return { kind: 'none', message: t('act.tooHeavyToThrow', { item: itemName(item) }) };
  }
  if (p.inventory.remove(item, 1) <= 0) return { kind: 'none' };
  if (p.inventory.count(item) === 0) p.equippedSlot = -1;

  // From the hand, not from the feet, and a little in front so it does not
  // start inside the character.
  const from = {
    x: p.position.x + Math.sin(p.yaw) * 0.5,
    y: p.position.y + 1.45,
    z: p.position.z + Math.cos(p.yaw) * 0.5,
  };
  world.throwItem(item, 1, from, p.yaw, pitch, 0);
  return {
    kind: 'thrown',
    message: t('act.threw', { item: itemName(item) }),
    x: from.x,
    y: from.y,
    z: from.z,
  };
}

// --------------------------------------------------------------- storehouses

/**
 * The storehouse the player is standing at, if any.
 *
 * Reaching into a store you are nowhere near would be exactly the teleporting
 * logistics this game refuses everywhere else, so the panel that shows the
 * contents is only usable while you are actually at the door.
 */
export function storeInReach(world: World): Building | null {
  const p = world.player;
  let best: Building | null = null;
  let bestD = STORE_REACH;
  for (const b of world.buildings) {
    if (!b.complete) continue;
    if ((b.def.storageSlots ?? 0) <= 0) continue;
    const d = Math.hypot(b.worldX - p.position.x, b.worldZ - p.position.z);
    if (d >= bestD) continue;
    bestD = d;
    best = b;
  }
  return best;
}

/** Takes goods out of a store and into the pack. */
export function takeFromStore(
  world: World,
  building: Building,
  item: ItemId,
  count: number,
): ActionResult {
  const p = world.player;
  if (Math.hypot(building.worldX - p.position.x, building.worldZ - p.position.z) > STORE_REACH) {
    return { kind: 'none', message: t('act.tooFarFromStore') };
  }
  const want = Math.min(count, building.inventory.count(item), p.inventory.spaceFor(item));
  if (want <= 0) return { kind: 'full', message: t('inv.full') };
  const moved = building.inventory.transferTo(p.inventory, item, want);
  if (moved <= 0) return { kind: 'none' };
  return {
    kind: 'picked_up',
    message: t('inv.tookOut', { count: moved, item: itemName(item) }),
  };
}

/** Puts goods from the pack into a store. */
export function putIntoStore(
  world: World,
  building: Building,
  item: ItemId,
  count: number,
): ActionResult {
  const p = world.player;
  if (Math.hypot(building.worldX - p.position.x, building.worldZ - p.position.z) > STORE_REACH) {
    return { kind: 'none', message: t('act.tooFarFromStore') };
  }
  const moved = p.inventory.transferTo(building.inventory, item, count);
  if (moved <= 0) return { kind: 'full', message: t('prod.idleReason.storeFull') };
  if (p.inventory.count(item) === 0 && p.equipped() === item) p.equippedSlot = -1;
  return { kind: 'stored', message: t('inv.stored', { count: moved }) };
}

// --------------------------------------------------------------- drinking

/**
 * Whether there is something to drink within arm's reach.
 *
 * Fresh water only. The sea is the largest body of water in the world and
 * none of it is any use, which is a fact people have died of, so drinking
 * from it is simply not offered.
 */
export function waterInReach(world: World): { x: number; z: number; fresh: boolean } | null {
  const p = world.player;
  const t = world.terrain;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = p.position.x + Math.cos(a) * DRINK_REACH;
    const z = p.position.z + Math.sin(a) * DRINK_REACH;
    if (t.waterDepthAt(x, z) < 0.12) continue;
    // Above sea level it is rain, a river or a lake; at or below it, it is
    // the sea, and the sea is not a drink.
    const fresh = t.heightAt(x, z) > 0.4;
    return { x, z, fresh };
  }
  return null;
}

/** Drinks from whatever is in reach. */
export function drinkFromWorld(world: World): ActionResult {
  const p = world.player;
  const found = waterInReach(world);
  if (!found) return { kind: 'none', message: t('act.noWaterHere') };
  if (!found.fresh) return { kind: 'none', message: t('act.saltWater') };
  if (p.stats.thirst > 97) return { kind: 'none', message: t('act.notThirsty') };
  const gained = p.drink(1);
  return {
    kind: 'used',
    message: t('act.drank', { gained: Math.round(gained) }),
    x: found.x,
    y: world.terrain.heightAt(found.x, found.z),
    z: found.z,
    effect: 'dust',
  };
}
