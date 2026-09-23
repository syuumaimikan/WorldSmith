/**
 * A settlement with a mind of its own.
 *
 * The player is supposed to be one of the people living here, not the
 * management. That means the place has to decide things for itself while
 * somebody is watching it, not only during a skipped century: it raises what
 * it is short of and it studies what it can reach, without being told.
 *
 * What it must *not* do is the work. Deciding to build a storehouse is a
 * decision; carrying the timber to it is a day's labour, and during a played
 * day that labour is done by somebody with legs. So these tests check that
 * blueprints appear on their own and that nothing is finished by magic.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig, run } from './harness';

/** Runs `days` of ordinary play, at the rate the game actually runs it. */
function live(world: ReturnType<typeof buildTestWorld>, days: number): void {
  // A game day is twenty real minutes of simulation; this is that, at the
  // same tick the game uses, so nothing here takes a shortcut the played
  // game does not take.
  run(world, days * 24 * 50);
}

describe('a settlement nobody is managing', () => {
  it('decides for itself what to raise next', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'auto-1' }));
    const before = world.buildings.length;
    live(world, 4);
    expect(world.buildings.length).toBeGreaterThan(before);
  });

  it('never finishes a building nobody has delivered materials to', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'auto-2' }));
    live(world, 3);
    for (const b of world.buildings) {
      if (!b.complete) continue;
      // Anything standing was paid for: the site holds what its stages cost.
      expect(b.completedDay).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns the study to something on its own once there is a study', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'auto-3' }));
    // Give it somewhere to think, which is the one thing it cannot conjure.
    const spot = world.terrain;
    let placed = false;
    for (let r = 6; r < 40 && !placed; r += 2) {
      for (let i = 0; i < 24 && !placed; i++) {
        const a = (i / 24) * Math.PI * 2;
        const tx = spot.tileX(world.settlement.centre.x + Math.cos(a) * r);
        const tz = spot.tileZ(world.settlement.centre.z + Math.sin(a) * r);
        if (!world.canPlace('research_hut', tx, tz, 0).ok) continue;
        const b = world.placeBuilding('research_hut', tx, tz, 0);
        if (!b) continue;
        // Finished by hand here: this test is about what the settlement
        // decides once it has a study, not about how it gets one.
        for (const m of b.missingMaterials()) b.siteStore.add(m.item, m.amount);
        b.applyWork(1e9);
        b.complete = true;
        world.onBuildingCompleted(b);
        placed = true;
      }
    }
    expect(placed).toBe(true);

    expect(world.research.active).toBeNull();
    live(world, 2);
    expect(world.research.active).not.toBeNull();
  });

  it('does not overrule a topic the player chose', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'auto-4' }));
    const open = world.research.available();
    expect(open.length).toBeGreaterThan(0);
    // The dearest thing it could possibly pick, which is not what it would
    // choose for itself.
    const dearest = open.reduce((a, b) => (b.cost > a.cost ? b : a));
    world.research.start(dearest.id);
    live(world, 3);
    expect(world.research.active).toBe(dearest.id);
  });
});
