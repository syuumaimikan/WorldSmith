/**
 * Ground that gives way, and only where it can.
 *
 * The claim is that this is not a disaster with a location rolled for it. The
 * rock decides where it is possible at all -- limestone dissolves and granite
 * does not -- the rain decides when, and the hole takes what was standing on
 * it.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import { readGeology, Rock } from '../world/Geology';
import { generateTerrain } from '../world/TerrainGen';

describe('sinkholes', () => {
  it('only happen in ground that can dissolve', () => {
    const config = makeTestConfig({ seedText: 'karst' });
    const { terrain, waterHeight } = generateTerrain(config, () => undefined);
    const geology = readGeology(config, terrain, waterHeight);
    let possible = 0;
    for (let i = 0; i < geology.karst.length; i++) {
      if (geology.karst[i] < 0.25) continue;
      possible++;
      expect(geology.rock[i]).toBe(Rock.Limestone);
    }
    // Worth checking that this world has any such ground at all, or the test
    // above is vacuously true.
    expect(possible).toBeGreaterThan(0);
  });

  it('takes the ground down with what was on it', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'swallet' }));
    const c = world.settlement.centre;
    const before = world.terrain.heightAt(c.x, c.z);
    const nodesBefore = world.nodes.length;

    // Reach past the weather and make the collapse happen here, now: what is
    // under test is what a collapse does, not how long the rain takes.
    const karst = world.karst as unknown as {
      collapse: (w: typeof world, x: number, z: number, k: number) => void;
    };
    karst.collapse(world, c.x, c.z, 0.9);

    expect(world.terrain.heightAt(c.x, c.z)).toBeLessThan(before);
    expect(world.nodes.length).toBeLessThan(nodesBefore);
    expect(world.log.all().some((e) => e.key === 'event.sinkhole')).toBe(true);
  });

  it('can open a way underground, and the new cave is a real landmark', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'delve' }));
    const before = world.pois.length;
    const c = world.settlement.centre;
    const poi = world.openCave(c.x + 30, c.z + 30);
    expect(world.pois.length).toBe(before + 1);
    expect(poi.kind).toBe('cave');
    expect(poi.name.length).toBeGreaterThan(0);
    expect(poi.lore.startsWith('poi.lore.')).toBe(true);
  });

  it('hurts the people who were standing on it, in particular places', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'swallow' }));
    const npc = world.npcs[0];
    expect(npc.body.injuries.length).toBe(0);
    const karst = world.karst as unknown as {
      collapse: (w: typeof world, x: number, z: number, k: number) => void;
    };
    karst.collapse(world, npc.x, npc.z, 0.9);
    expect(npc.body.injuries.length).toBeGreaterThan(0);
    expect(npc.body.injuries.some((i) => i.kind === 'break')).toBe(true);
  });
});
