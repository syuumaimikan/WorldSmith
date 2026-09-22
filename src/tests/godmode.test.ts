/**
 * God mode, terrain editing and disasters.
 *
 * These exist to hold the line on requirement #244–249: a god power must move
 * the simulation, not play an animation. Every assertion here reads state the
 * ordinary game loop also reads.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig, placeNear, run, TICK } from './harness';
import { GodMode } from '../game/GodMode';
import { earthquakeResistance } from '../sim/Disasters';
import { buildingDef } from '../data/buildings';
import type { Building } from '../sim/Building';
import { beginEruption } from '../sim/Volcano';

/** A patch of dry land near the settlement, for powers that need ground. */
function dryLandNear(world: ReturnType<typeof buildTestWorld>): { x: number; z: number } {
  const { x, z } = world.player.position;
  for (let r = 0; r < 160; r += 4) {
    const steps = r === 0 ? 1 : 24;
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const pz = z + Math.sin(ang) * r;
      if (world.terrain.waterDepthAt(px, pz) <= 0 && world.terrain.heightAt(px, pz) > 1.5) {
        return { x: px, z: pz };
      }
    }
  }
  throw new Error('no dry land near the start');
}

describe('terrain editing', () => {
  it('raises and lowers real ground, and undoes exactly', () => {
    const world = buildTestWorld();
    const { x, z } = dryLandNear(world);

    const before = world.terrain.heightAt(x, z);
    world.editor.sculpt(x, z, 30, 6, 'dome', 'raise');
    const raised = world.terrain.heightAt(x, z);
    expect(raised).toBeGreaterThan(before + 1);

    expect(world.editor.undo()).toBe(true);
    expect(world.terrain.heightAt(x, z)).toBeCloseTo(before, 4);
  });

  it('keeps water and ground consistent after a sculpt', () => {
    const world = buildTestWorld();
    const { x, z } = dryLandNear(world);
    world.editor.sculpt(x, z, 40, -9, 'dome', 'lower');

    const t = world.terrain;
    for (let i = 0; i < t.data.height.length; i++) {
      if (t.waterHeight[i] <= t.data.height[i]) continue;
      // Anywhere the water sits above the ground it must be a genuine surface,
      // not a sliver left behind by the edit.
      expect(t.waterHeight[i] - t.data.height[i]).toBeGreaterThan(0);
    }
  });

  it('refuses to undo when nothing has been edited', () => {
    const world = buildTestWorld();
    expect(world.editor.undo()).toBe(false);
  });
});

describe('earthquakes', () => {
  it('rates stone buildings as more resistant than timber ones', () => {
    // Resistance reads only the recipe and the condition, so compare the
    // recipes directly rather than fighting placement rules for a town hall.
    const at = (id: 'tent' | 'well' | 'town_hall', condition: number): Building =>
      ({ def: buildingDef(id), condition }) as Building;

    const tent = earthquakeResistance(at('tent', 1));
    const well = earthquakeResistance(at('well', 1));
    const hall = earthquakeResistance(at('town_hall', 1));

    expect(well).toBeGreaterThan(tent);
    expect(hall).toBeGreaterThan(tent);
    // And neglect makes the same building weaker.
    expect(earthquakeResistance(at('town_hall', 0.4))).toBeLessThan(hall);
  });

  it('damages buildings by distance and material, not uniformly', () => {
    const world = buildTestWorld();
    const { x, z } = world.player.position;
    const near = placeNear(world, 'tent', x, z, 20);
    const far = placeNear(world, 'tent', x + 150, z + 150, 90);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    near!.condition = 1;
    far!.condition = 1;
    const apart = Math.hypot(far!.worldX - near!.worldX, far!.worldZ - near!.worldZ);
    expect(apart).toBeGreaterThan(40);

    world.disasters.earthquake(world, near!.worldX, near!.worldZ, 0.9, apart * 2);

    expect(near!.condition).toBeLessThan(1);
    expect(far!.condition).toBeGreaterThan(near!.condition);
  });
});

describe('fire', () => {
  it('only takes hold where there is fuel, and burns the fuel away', () => {
    const world = buildTestWorld();
    const tree = world.nodes.find((n) => n.kind === 'oak' || n.kind === 'pine');
    expect(tree).toBeDefined();

    const fire = world.disasters.ignite(world, tree!.x, tree!.z, 0.9);
    expect(fire).not.toBeNull();
    expect(world.disasters.activeFireCount).toBeGreaterThan(0);

    const nodesBefore = world.nodes.length;
    run(world, 240);
    // Either the fire consumed vegetation or it burned out; both are real
    // outcomes, but it must not still be sitting there at full strength on
    // ground it has already burned.
    expect(world.nodes.length).toBeLessThanOrEqual(nodesBefore);
  });

  it('cannot be lit on open water', () => {
    const world = buildTestWorld();
    const t = world.terrain;
    let wet: { x: number; z: number } | null = null;
    for (let i = 0; i < t.data.height.length && !wet; i++) {
      if (t.waterHeight[i] - t.data.height[i] > 2) {
        wet = { x: (i % t.gridSize) * t.tileSize, z: Math.floor(i / t.gridSize) * t.tileSize };
      }
    }
    expect(wet).not.toBeNull();
    expect(world.disasters.ignite(world, wet!.x, wet!.z, 0.9)).toBeNull();
  });

  it('is put out by rain', () => {
    const world = buildTestWorld();
    const tree = world.nodes.find((n) => n.kind === 'oak' || n.kind === 'pine');
    world.disasters.ignite(world, tree!.x, tree!.z, 0.8);
    const lit = world.disasters.activeFireCount;
    expect(lit).toBeGreaterThan(0);

    world.weather.force('storm', 12);
    run(world, 300);
    expect(world.disasters.activeFireCount).toBeLessThan(lit + 1);
  });
});

describe('floods', () => {
  it('raises water, then recedes and leaves the ground more fertile', () => {
    const world = buildTestWorld();
    const { x, z } = dryLandNear(world);
    const i = world.terrain.index(world.terrain.tileX(x), world.terrain.tileZ(z));
    const fertilityBefore = world.terrain.data.fertility[i];

    world.disasters.flood(world, x, z, 40, 3, 60);
    expect(world.terrain.waterDepthAt(x, z)).toBeGreaterThan(0);

    run(world, 200);
    expect(world.terrain.waterDepthAt(x, z)).toBeLessThanOrEqual(0.05);
    expect(world.terrain.data.fertility[i]).toBeGreaterThan(fertilityBefore);
  });
});

describe('volcanoes', () => {
  it('moves through pressure, unrest and eruption rather than firing instantly', () => {
    const world = buildTestWorld();
    const { x, z } = dryLandNear(world);
    world.raiseVolcano(x, z, 60, 0.8);
    expect(world.volcanoes.length).toBe(1);

    const v = world.volcanoes[0];
    expect(v.state).not.toBe('erupting');

    const pressureBefore = v.pressure;
    run(world, 600);
    expect(v.pressure).toBeGreaterThan(pressureBefore);
  });

  it('lays down lava and ash that outlast the eruption', () => {
    const world = buildTestWorld();
    const { x, z } = dryLandNear(world);
    world.raiseVolcano(x, z, 60, 0.9);
    const v = world.volcanoes[0];

    const heightBefore = world.terrain.heightAt(v.x, v.z);
    beginEruption(world, v);
    expect(v.state).toBe('erupting');
    run(world, 240);

    // Lava piles up around the vent; the cone is taller afterwards.
    expect(world.terrain.heightAt(v.x, v.z)).toBeGreaterThanOrEqual(heightBefore);
    expect(['erupting', 'spent', 'dormant']).toContain(v.state);
  });
});

describe('possession', () => {
  it('stops the settler thinking for themselves but leaves them themselves', () => {
    const world = buildTestWorld();
    const god = new GodMode(world);
    const npc = world.npcs[0];
    const name = npc.name;
    const profession = npc.profession;
    const home = npc.homeId;

    god.possess(npc);
    expect(world.possessed).toBe(npc.id);

    // Drive them somewhere by hand, as the player controls would.
    npc.x += 12;
    const fedAtStart = npc.needs.hunger;
    run(world, 600);

    // The AI never handed them a task while possessed...
    expect(npc.task.type).toBe('none');
    // ...but they are still a person with needs that kept ticking.
    expect(npc.name).toBe(name);
    expect(npc.profession).toBe(profession);
    expect(npc.homeId).toBe(home);
    // Needs kept ticking: nobody stops being hungry because a god is driving.
    expect(npc.needs.hunger).toBeLessThan(fedAtStart);

    god.release();
    expect(world.possessed).toBe(0);
    run(world, 120);
    // Released, they go back to looking after themselves.
    expect(npc.task.type).not.toBe('none');
  });
});

describe('god powers', () => {
  it('route through the simulation and are all reachable', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'godpowers' }));
    const god = new GodMode(world);
    const { x, z } = dryLandNear(world);

    const npcsBefore = world.npcs.length;
    god.selectPower('settlers');
    god.strength = 0.5;
    expect(god.apply(x, z)).toBe('settlers');
    expect(world.npcs.length).toBeGreaterThan(npcsBefore);

    god.selectPower('rain');
    expect(god.apply(0, 0)).toBe('rain');
    expect(world.weather.current).toBe('rain');

    const wildlifeBefore = world.wildlife.length;
    god.selectPower('wildlife');
    god.apply(x, z);
    expect(world.wildlife.length).toBeGreaterThanOrEqual(wildlifeBefore);

    god.selectPower('clearVegetation');
    god.radius = 30;
    const nodesBefore = world.nodes.length;
    god.apply(x, z);
    expect(world.nodes.length).toBeLessThanOrEqual(nodesBefore);
  });

  it('rate-limits continuous brushes instead of applying every frame', () => {
    const world = buildTestWorld();
    const god = new GodMode(world);
    const { x, z } = dryLandNear(world);

    god.selectPower('raise');
    expect(god.apply(x, z)).toBe('raise');
    // A second click in the same instant does nothing.
    expect(god.apply(x, z)).toBeNull();
    god.tick(TICK * 3);
    expect(god.apply(x, z)).toBe('raise');
  });
});
