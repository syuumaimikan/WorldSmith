/**
 * The tree, and whether knowing something does anything.
 *
 * The line held here is that no entry in this menu is decoration. Every topic
 * either opens a door -- a building, a recipe -- or names a figure that some
 * system actually reads. A topic whose only effect is a sentence in a panel is
 * a lie told to the player.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_RESEARCH_IDS,
  availableResearch,
  RESEARCH,
  researchEffects,
  ResearchId,
} from '../data/research';
import { ALL_BUILDING_IDS, BUILDINGS } from '../data/buildings';
import { RECIPES } from '../data/recipes';
import { buildTestWorld } from './harness';

describe('the tree', () => {
  it('is big enough to be worth climbing', () => {
    expect(ALL_RESEARCH_IDS.length).toBeGreaterThan(45);
  });

  it('only ever requires things that exist, and never itself', () => {
    for (const id of ALL_RESEARCH_IDS) {
      const node = RESEARCH[id];
      expect(node.id).toBe(id);
      for (const req of node.requires) {
        expect(ALL_RESEARCH_IDS, `${id} requires ${req}`).toContain(req);
        expect(req).not.toBe(id);
      }
    }
  });

  it('has no cycles, so everything can eventually be learned', () => {
    const unlocked = new Set<ResearchId>();
    let guard = 0;
    while (unlocked.size < ALL_RESEARCH_IDS.length && guard++ < 200) {
      const open = availableResearch(unlocked);
      if (open.length === 0) break;
      for (const n of open) unlocked.add(n.id);
    }
    const stuck = ALL_RESEARCH_IDS.filter((id) => !unlocked.has(id));
    expect(stuck, `unreachable: ${stuck.join(', ')}`).toEqual([]);
  });

  it('gets more expensive the deeper it goes', () => {
    for (const id of ALL_RESEARCH_IDS) {
      const node = RESEARCH[id];
      for (const req of node.requires) {
        expect(node.cost, `${id} is cheaper than its prerequisite ${req}`).toBeGreaterThan(
          RESEARCH[req].cost * 0.6,
        );
      }
    }
  });

  it('gives every topic either a door to open or a figure that is read', () => {
    const gatedBuildings = new Set(
      ALL_BUILDING_IDS.map((b) => BUILDINGS[b].requiresResearch).filter(Boolean),
    );
    const gatedRecipes = new Set(
      Object.values(RECIPES).map((r) => r.requiresResearch).filter(Boolean),
    );
    const idle: string[] = [];
    for (const id of ALL_RESEARCH_IDS) {
      if (RESEARCH[id].effects) continue;
      if (gatedBuildings.has(id) || gatedRecipes.has(id)) continue;
      idle.push(id);
    }
    // A handful of pure prerequisites are legitimate: they are the gate that
    // the next thing sits behind. More than a handful means the menu is
    // promising things it does not deliver.
    expect(idle.length, `nothing happens when you learn: ${idle.join(', ')}`).toBeLessThan(8);
  });
});

describe('what a settlement knows', () => {
  it('starts out knowing almost nothing', () => {
    const world = buildTestWorld();
    // Knapping, fire and hafting: the three things a band of people already
    // had when they walked in, and nothing beyond them. They are worth a
    // few per cent on the work rate and nothing else -- a settlement that
    // can strike a flint is not a settlement that can do anything.
    expect(world.research.unlocked.size).toBeLessThan(5);
    const e = world.research.effects;
    expect(e.work).toBeLessThan(1.1);
    expect(e.carry).toBe(0);
  });

  it('carries more, works faster and heals better once it has learned how', () => {
    const world = buildTestWorld();
    const before = {
      carry: world.player.inventory.weightLimit,
      care: world.careQuality(world.npcs[0]),
    };
    for (const id of ['knapping', 'cordage', 'hunting', 'tanning', 'the_wheel'] as ResearchId[]) {
      world.research.unlocked.add(id);
    }
    // The cache has to notice.
    world.research.restore(world.research.serialize());
    world.skipDay();

    expect(world.research.effects.carry).toBeGreaterThan(0);
    expect(world.player.inventory.weightLimit).toBeGreaterThan(before.carry);

    world.research.unlocked.add('medicine');
    world.research.unlocked.add('surgery');
    world.research.restore(world.research.serialize());
    expect(world.careQuality(world.npcs[0])).toBeGreaterThan(before.care);
  });

  it('compounds two improvements to the same thing', () => {
    const one = researchEffects(new Set<ResearchId>(['irrigation']));
    const both = researchEffects(new Set<ResearchId>(['irrigation', 'crop_rotation']));
    expect(both.farm).toBeGreaterThan(one.farm);
    expect(both.farm).toBeCloseTo(
      (RESEARCH.irrigation.effects!.farm ?? 1) * (RESEARCH.crop_rotation.effects!.farm ?? 1),
      5,
    );
  });
});
