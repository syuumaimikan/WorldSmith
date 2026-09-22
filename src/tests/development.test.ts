/**
 * A settlement getting on with it while nobody is watching.
 *
 * The line held here is that a skipped century is a century that happened.
 * What gets built is what the place is short of, paid for out of the same
 * stores with the same bill of materials, worked by the hands that are
 * actually there, off nodes that are actually depleted for it. Nothing is
 * conjured: a settlement with nobody in it builds nothing, and one that
 * cannot find the timber stops.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import { OVERLAY } from '../world/Terrain';
import { DAYS_PER_YEAR } from '../sim/Time';

function skipYears(world: World, years: number): void {
  const days = Math.round(years * DAYS_PER_YEAR);
  for (let i = 0; i < days; i++) world.skipDay();
}

function tilled(world: World): number {
  let n = 0;
  const o = world.terrain.overlay;
  for (let i = 0; i < o.length; i++) if (o[i] & (OVERLAY.Field | OVERLAY.Tilled)) n++;
  return n;
}

describe('a settlement left to itself', () => {
  it('raises roofs over the people who have none', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'build' }));
    expect(world.settlement.housingCapacity).toBe(0);
    skipYears(world, 3);
    expect(world.buildings.length).toBeGreaterThan(0);
    expect(world.settlement.housingCapacity).toBeGreaterThan(0);
  });

  it('fells its own timber, out of the trees that are actually there', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'timber' }));
    const before = world.treesFelled;
    skipYears(world, 2);
    // Trees came down, and what came off them is somewhere in the settlement.
    expect(world.treesFelled).toBeGreaterThan(before);

    let logs = 0;
    for (const p of world.piles) if (p.item === 'log') logs += p.count;
    for (const b of world.buildings) {
      for (const slot of b.inventory.slots) if (slot?.item === 'log') logs += slot.count;
      for (const slot of b.siteStore.slots) if (slot?.item === 'log') logs += slot.count;
    }
    expect(logs).toBeGreaterThan(0);
  });

  it('builds nothing at all when there is nobody left to build it', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'empty' }));
    for (const npc of [...world.npcs]) world.removeNpc(npc);
    const before = world.buildings.length;
    skipYears(world, 20);
    expect(world.buildings.length).toBe(before);
  });

  it('turns ground over once it has a field to work', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'plough' }));
    world.research.unlocked.add('agriculture');
    const before = tilled(world);
    // Give it a field outright; the point here is that ground gets broken.
    const c = world.settlement.centre;
    const t = world.terrain;
    let placed = false;
    for (let r = 4; r < 30 && !placed; r += 2) {
      for (let a = 0; a < 16 && !placed; a++) {
        const x = t.tileX(c.x + Math.cos((a / 16) * 6.283) * r);
        const z = t.tileZ(c.z + Math.sin((a / 16) * 6.283) * r);
        const b = world.placeBuilding('farm_field', x, z, 0);
        if (b) {
          b.complete = true;
          placed = true;
        }
      }
    }
    if (!placed) return;

    skipYears(world, 4);
    expect(tilled(world)).toBeGreaterThan(before);
  });

  it('does not build out of materials it has not got', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'barren' }));
    // Nothing to fell, nothing to quarry, nothing in the baskets.
    for (const n of [...world.nodes]) world.removeNode(n);
    for (const p of [...world.piles]) world.removePile(p);

    skipYears(world, 5);
    // A site may be staked out, but nothing needing materials gets finished.
    const finished = world.buildings.filter(
      (b) => b.complete && Object.keys(b.def.totalMaterials).length > 0,
    );
    expect(finished).toEqual([]);
  });

  it('keeps every number in a sane range over a century', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'longhaul' }));
    skipYears(world, 100);

    expect(world.time.snapshot().year).toBeGreaterThan(95);
    for (const b of world.buildings) {
      expect(Number.isFinite(b.condition)).toBe(true);
      expect(b.condition).toBeGreaterThanOrEqual(0);
      expect(b.condition).toBeLessThanOrEqual(1);
    }
    for (const n of world.nodes) {
      expect(n.amount).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(n.amount)).toBe(true);
    }
    expect(world.piles.length).toBeLessThan(4000);
  });
});
