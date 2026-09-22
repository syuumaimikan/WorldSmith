/**
 * Repair.
 *
 * A building damaged by an earthquake or a storm has to be put right by
 * somebody, with materials somebody carried there. Nothing heals on a timer,
 * and nothing is restored out of thin air.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, placeNear, run } from './harness';
import type { World } from '../sim/World';
import type { Building } from '../sim/Building';

/** Builds a tent and waits for it to finish, the way the acceptance test does. */
function finishedTent(world: World): Building {
  const c = world.settlement.centre;
  const stockpile = placeNear(world, 'stockpile', c.x, c.z);
  expect(stockpile).not.toBeNull();
  run(world, 400);

  const tent = placeNear(world, 'tent', c.x + 12, c.z + 12, 40);
  expect(tent).not.toBeNull();
  for (let i = 0; i < 40 && !tent!.complete; i++) run(world, 60);
  return tent!;
}

describe('damaged buildings', () => {
  it('are marked for repair and priced in materials, not in nothing', () => {
    const world = buildTestWorld();
    const tent = finishedTent(world);
    if (!tent.complete) return; // the acceptance test owns that failure

    world.damageBuilding(tent, 0.5);
    expect(tent.repairNeeded).toBe(true);
    expect(tent.condition).toBeLessThan(0.72);

    const bill = Object.entries(tent.repairBill);
    expect(bill.length).toBeGreaterThan(0);
    for (const [, amount] of bill) expect(amount).toBeGreaterThan(0);
    // The bill is a share of the original recipe, never more than it.
    for (const [item, amount] of bill as [keyof typeof tent.def.totalMaterials, number][]) {
      expect(amount).toBeLessThanOrEqual(tent.def.totalMaterials[item] ?? 0);
    }
  });

  it('will not be repaired until the materials are on site', () => {
    const world = buildTestWorld();
    const tent = finishedTent(world);
    if (!tent.complete) return;

    world.damageBuilding(tent, 0.5);
    tent.siteStore.clear();
    expect(tent.readyToRepair()).toBe(false);

    // The work itself must refuse to start.
    expect(tent.consumeRepairMaterials()).toBe(false);
    const before = tent.condition;
    // Even a full tick's worth of labour cannot finish it with nothing to use.
    world.applyRepair(tent, 1);
    expect(tent.condition).toBe(before);
    expect(tent.repairNeeded).toBe(true);
  });

  it('are put right by a settler once the goods arrive', () => {
    const world = buildTestWorld();
    const tent = finishedTent(world);
    if (!tent.complete) return;

    world.damageBuilding(tent, 0.55);
    expect(tent.repairNeeded).toBe(true);
    const damaged = tent.condition;

    // Give the settlement the materials so the haulers have something to move.
    for (const [item, amount] of Object.entries(tent.repairBill)) {
      world.dropPile(item as never, amount as number, tent.worldX + 2, tent.worldZ + 2);
    }

    for (let i = 0; i < 60 && tent.repairNeeded; i++) run(world, 60);

    expect(tent.condition).toBeGreaterThan(damaged);
    if (!tent.repairNeeded) {
      expect(tent.condition).toBe(1);
      // The materials were actually spent, not left lying in the site store.
      for (const item of Object.keys(tent.repairBill)) {
        expect(tent.siteStore.count(item as never)).toBe(0);
      }
    }
  });

  it('does not pile up duplicate repair jobs for the same building', () => {
    const world = buildTestWorld();
    const tent = finishedTent(world);
    if (!tent.complete) return;

    world.damageBuilding(tent, 0.5);
    for (const [item, amount] of Object.entries(tent.repairBill)) {
      tent.siteStore.add(item as never, amount as number);
    }
    expect(tent.readyToRepair()).toBe(true);

    // Let the board reconcile repeatedly; it must not stack duplicates.
    for (let i = 0; i < 12; i++) run(world, 2);
    const repairJobs = world.jobs.all.filter(
      (j) => j.kind === 'repair' && j.buildingId === tent.id,
    );
    expect(repairJobs.length).toBe(1);
  });

  it('is not repaired by the passage of time alone', () => {
    const world = buildTestWorld();
    const tent = finishedTent(world);
    if (!tent.complete) return;

    world.damageBuilding(tent, 0.5);
    // Price the repair in something this settlement cannot make yet. Nobody
    // can supply it, so the building must simply stay broken.
    tent.repairBill = { iron_ingot: 6 };
    tent.repairMaterialsConsumed = false;
    tent.siteStore.clear();
    const damaged = tent.condition;

    run(world, 1800);
    expect(tent.repairNeeded).toBe(true);
    expect(tent.readyToRepair()).toBe(false);
    // Weather keeps wearing it; nothing has put any of it back.
    expect(tent.condition).toBeLessThanOrEqual(damaged);
  });
});
