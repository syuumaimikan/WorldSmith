/**
 * Goods lying on the ground.
 *
 * When a logger fells a tree the logs land where the tree stood; they do not
 * teleport into a warehouse. Piles are real objects that must be picked up and
 * carried, which is what makes the supply chain visible in the world rather
 * than only in a spreadsheet.
 */

import { ItemId } from '../data/items';

export interface ItemPile {
  id: number;
  item: ItemId;
  count: number;
  x: number;
  z: number;
  y: number;
  /** NPC id that has claimed this pile, or 0. */
  reservedBy: number;
  /** Game day the pile was dropped, used for spoilage. */
  droppedDay: number;
  /** Small visual variation so stacks are not identical. */
  rot: number;
}

export function createPile(
  id: number,
  item: ItemId,
  count: number,
  x: number,
  y: number,
  z: number,
  day: number,
  rot: number,
): ItemPile {
  return { id, item, count, x, z, y, reservedBy: 0, droppedDay: day, rot };
}
