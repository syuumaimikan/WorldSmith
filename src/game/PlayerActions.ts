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
import { ITEMS, ItemId } from '../data/items';
import { t } from '../i18n';
import { buildingName, itemName, resourceName, professionName } from '../i18n/names';
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
  kind: 'none' | 'gathered' | 'picked_up' | 'stored' | 'selected' | 'talked' | 'full';
  message?: string;
  /** Position for particle effects. */
  x?: number;
  y?: number;
  z?: number;
  effect?: 'woodchips' | 'stonedust' | 'dust';
}

/** Player work rate. Comparable to a skilled settler, but not better. */
const PLAYER_WORK_RATE = 4.4;

/**
 * Applies tool work to a node. Called every frame while the tool key is held.
 */
export function applyToolWork(world: World, node: ResourceNode, dt: number): ActionResult {
  const def = RESOURCES[node.kind];
  const p = world.player;

  const toolFor = def.skill === 'chop' ? 'axe' : def.skill === 'mine' ? 'pickaxe' : null;
  const hasTool = toolFor ? p.inventory.has(toolFor) : false;
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
      lines.push(t('talk.hauling', { goods: npc.carryingSummary() }));
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
