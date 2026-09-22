/**
 * Slot-based inventory shared by the player, NPCs, stockpiles and buildings.
 *
 * Slots (rather than a bare item->count map) matter because hauling is a
 * physical act in this game: a porter's capacity is finite, a warehouse fills
 * up, and a full store is a real logistics problem the player has to solve.
 */

import { ItemId, ITEMS } from '../data/items';

export interface Stack {
  item: ItemId;
  count: number;
}

export interface SerializedInventory {
  slots: (Stack | null)[];
  capacity: number;
}

export class Inventory {
  readonly slots: (Stack | null)[];
  /** Optional cap on total weight; Infinity means slots are the only limit. */
  weightLimit: number;
  /** Items this store will accept; null means anything. */
  filter: Set<ItemId> | null = null;

  constructor(capacity: number, weightLimit = Infinity) {
    this.slots = new Array(capacity).fill(null);
    this.weightLimit = weightLimit;
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** Total units of one item across all slots. */
  count(item: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  totalCount(): number {
    let n = 0;
    for (const s of this.slots) if (s) n += s.count;
    return n;
  }

  totalWeight(): number {
    let w = 0;
    for (const s of this.slots) if (s) w += s.count * ITEMS[s.item].weight;
    return w;
  }

  isEmpty(): boolean {
    for (const s of this.slots) if (s && s.count > 0) return false;
    return true;
  }

  usedSlots(): number {
    let n = 0;
    for (const s of this.slots) if (s) n++;
    return n;
  }

  get fullness(): number {
    return this.capacity === 0 ? 1 : this.usedSlots() / this.capacity;
  }

  accepts(item: ItemId): boolean {
    return this.filter === null || this.filter.has(item);
  }

  /** How many units of `item` could still be added right now. */
  spaceFor(item: ItemId): number {
    if (!this.accepts(item)) return 0;
    const def = ITEMS[item];
    let space = 0;
    for (const s of this.slots) {
      if (s === null) space += def.stackSize;
      else if (s.item === item) space += def.stackSize - s.count;
    }
    if (this.weightLimit !== Infinity) {
      const byWeight = Math.floor((this.weightLimit - this.totalWeight()) / def.weight);
      space = Math.min(space, Math.max(0, byWeight));
    }
    return space;
  }

  /** Adds up to `count`; returns how many were actually stored. */
  add(item: ItemId, count: number): number {
    if (count <= 0) return 0;
    let remaining = Math.min(count, this.spaceFor(item));
    const added = remaining;
    const stackSize = ITEMS[item].stackSize;

    // Top up partial stacks before opening a new slot.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === item && s.count < stackSize) {
        const take = Math.min(remaining, stackSize - s.count);
        s.count += take;
        remaining -= take;
      }
    }
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (this.slots[i] === null) {
        const take = Math.min(remaining, stackSize);
        this.slots[i] = { item, count: take };
        remaining -= take;
      }
    }
    return added - remaining;
  }

  /** Removes up to `count`; returns how many were actually removed. */
  remove(item: ItemId, count: number): number {
    if (count <= 0) return 0;
    let remaining = count;
    // Drain smallest stacks first so the store consolidates over time.
    const indices: number[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.item === item) indices.push(i);
    }
    indices.sort((a, b) => (this.slots[a] as Stack).count - (this.slots[b] as Stack).count);
    for (const i of indices) {
      if (remaining <= 0) break;
      const s = this.slots[i] as Stack;
      const take = Math.min(remaining, s.count);
      s.count -= take;
      remaining -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    return count - remaining;
  }

  has(item: ItemId, count = 1): boolean {
    return this.count(item) >= count;
  }

  /** Moves items between stores, limited by what the source has and the destination can take. */
  transferTo(other: Inventory, item: ItemId, count: number): number {
    const available = Math.min(count, this.count(item));
    const space = other.spaceFor(item);
    const moved = Math.min(available, space);
    if (moved <= 0) return 0;
    this.remove(item, moved);
    other.add(item, moved);
    return moved;
  }

  /** Swaps two slots; used by inventory drag and drop. */
  swap(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= this.slots.length || b >= this.slots.length) return;
    const tmp = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = tmp;
  }

  /** Merges slot `from` into slot `to` when they hold the same item. */
  mergeSlots(from: number, to: number): boolean {
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a || !b || a.item !== b.item) return false;
    const stackSize = ITEMS[a.item].stackSize;
    const take = Math.min(a.count, stackSize - b.count);
    if (take <= 0) return false;
    b.count += take;
    a.count -= take;
    if (a.count <= 0) this.slots[from] = null;
    return true;
  }

  /** Every distinct item with its total, sorted by category then name. */
  summary(): Stack[] {
    const totals = new Map<ItemId, number>();
    for (const s of this.slots) {
      if (!s) continue;
      totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
    }
    return [...totals.entries()]
      .map(([item, count]) => ({ item, count }))
      .sort((a, b) => {
        const ca = ITEMS[a.item].category;
        const cb = ITEMS[b.item].category;
        if (ca !== cb) return ca.localeCompare(cb);
        return ITEMS[a.item].name.localeCompare(ITEMS[b.item].name);
      });
  }

  clear(): void {
    this.slots.fill(null);
  }

  /** Finds the first item matching a predicate, best for "what food is here". */
  findFirst(predicate: (item: ItemId) => boolean): ItemId | null {
    for (const s of this.slots) if (s && s.count > 0 && predicate(s.item)) return s.item;
    return null;
  }

  serialize(): SerializedInventory {
    return {
      capacity: this.capacity,
      slots: this.slots.map((s) => (s ? { item: s.item, count: s.count } : null)),
    };
  }

  static deserialize(data: SerializedInventory, weightLimit = Infinity): Inventory {
    const inv = new Inventory(data.capacity, weightLimit);
    for (let i = 0; i < Math.min(data.slots.length, inv.slots.length); i++) {
      const s = data.slots[i];
      inv.slots[i] = s && ITEMS[s.item] ? { item: s.item, count: s.count } : null;
    }
    return inv;
  }
}
