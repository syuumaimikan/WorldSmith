/**
 * The plates.
 *
 * The thing worth defending here is that an earthquake is a release of
 * something that was accumulating. A fault that has just gone is safe; a
 * fault that has been quiet for a long time is not. Nothing is scheduled.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig, runRock } from './harness';

describe('plates', () => {
  it('cover the whole map and divide it between them', () => {
    const world = buildTestWorld();
    const tec = world.tectonics;
    expect(tec.plates.length).toBeGreaterThan(2);

    const seen = new Set<number>();
    for (let i = 0; i < tec.plateOf.length; i++) seen.add(tec.plateOf[i]);
    // Every tile belongs to a plate, and more than one plate is in play.
    expect(seen.size).toBeGreaterThan(1);
    for (const id of seen) expect(tec.plates[id]).toBeDefined();
  });

  it('knows which of them are ocean floor', () => {
    const world = buildTestWorld();
    // Oceanic is read off how much water sits on the plate, not rolled.
    for (const p of world.tectonics.plates) {
      const t = world.terrain;
      let submerged = 0;
      let total = 0;
      for (let i = 0; i < world.tectonics.plateOf.length; i += 3) {
        if (world.tectonics.plateOf[i] !== p.id) continue;
        total++;
        if (t.waterHeight[i] > t.data.height[i]) submerged++;
      }
      if (total < 20) continue;
      const wet = submerged / total;
      expect(p.oceanic).toBe(wet > 0.6);
    }
  });

  it('meet along faults classified by how they are moving', () => {
    const world = buildTestWorld();
    const faults = world.tectonics.faults;
    expect(faults.length).toBeGreaterThan(0);
    for (const f of faults) {
      expect(['convergent', 'divergent', 'transform']).toContain(f.kind);
      expect(f.plateA).not.toBe(f.plateB);
      expect(f.closingRate).toBeGreaterThanOrEqual(0);
      expect(f.strength).toBeGreaterThan(0);
    }
  });

  it('is the same world for the same seed', () => {
    const a = buildTestWorld(makeTestConfig({ seedText: 'plates' }));
    const b = buildTestWorld(makeTestConfig({ seedText: 'plates' }));
    expect(a.tectonics.faults.length).toBe(b.tectonics.faults.length);
    expect(a.tectonics.plates.map((p) => p.name)).toEqual(b.tectonics.plates.map((p) => p.name));
  });
});

describe('strain', () => {
  it('accumulates on a loaded fault and is released by the rupture', () => {
    const world = buildTestWorld();
    const loaded = [...world.tectonics.faults].sort((a, b) => b.closingRate - a.closingRate)[0];
    expect(loaded).toBeDefined();
    loaded.stress = 0;
    const start = loaded.stress;

    runRock(world, 120);
    // It either built up, or it built up and went; both mean it was loading.
    const wentOff = loaded.lastRupture >= 0;
    expect(wentOff || loaded.stress > start).toBe(true);
  });

  it('a fault that has just gone is the safest one there is', () => {
    const world = buildTestWorld();
    const f = world.tectonics.faults[0];
    f.stress = 9;
    f.strength = 0.5;
    runRock(world, 2);
    expect(f.lastRupture).toBeGreaterThanOrEqual(0);
    expect(f.stress).toBeLessThan(0.2);
  });

  it('unloads the rock either side of a rupture, not just the point', () => {
    const world = buildTestWorld();
    const tec = world.tectonics;
    const centre = tec.faults[0];
    // Find a genuine neighbour along the same boundary.
    const neighbour = tec.faults.find(
      (o) => o !== centre && Math.hypot(o.x - centre.x, o.z - centre.z) < world.terrain.worldSize * 0.05,
    );
    if (!neighbour) return; // a one-segment boundary has no neighbours

    neighbour.stress = 0.5;
    centre.stress = 9;
    centre.strength = 0.5;
    runRock(world, 2);
    expect(neighbour.stress).toBeLessThan(0.5);
  });

  it('produces earthquakes without anyone asking for one', () => {
    const world = buildTestWorld();
    let quakes = 0;
    const real = world.disasters.earthquake.bind(world.disasters);
    world.disasters.earthquake = (w, x, z, mag, r): void => {
      quakes++;
      expect(mag).toBeGreaterThan(0);
      expect(mag).toBeLessThanOrEqual(1);
      real(w, x, z, mag, r);
    };
    runRock(world, 60 * 8);
    expect(quakes).toBeGreaterThan(0);
    // But not so many that the ground is never still.
    expect(quakes).toBeLessThan(60);
  });

  it('reports strain under the settlement rather than the worst anywhere', () => {
    const world = buildTestWorld();
    const c = world.settlement.centre;
    const local = world.tectonics.stressAt(c.x, c.z);
    expect(local).toBeGreaterThanOrEqual(0);
    expect(local).toBeLessThanOrEqual(1);
    // Far outside the map there is no fault to be near.
    expect(world.tectonics.stressAt(-9000, -9000)).toBe(0);
  });
});

describe('mountain building', () => {
  it('lifts colliding ground and drops rifting ground over an age', () => {
    const world = buildTestWorld();
    const tec = world.tectonics;
    const conv = tec.faults.find((f) => f.kind === 'convergent' && f.closingRate > 10);
    const div = tec.faults.find((f) => f.kind === 'divergent' && f.closingRate > 10);
    const t = world.terrain;
    const at = (f: { x: number; z: number }): number =>
      t.data.height[t.index(t.tileX(f.x), t.tileZ(f.z))];

    const before = { conv: conv ? at(conv) : 0, div: div ? at(div) : 0 };
    // An age, not a lifetime: four centuries of drift is unmistakable.
    runRock(world, 60 * 400);

    if (conv) expect(at(conv)).toBeGreaterThan(before.conv);
    if (div) expect(at(div)).toBeLessThan(before.div);
  });
});

describe('the record of the rock', () => {
  it('survives a save', () => {
    const world = buildTestWorld();
    runRock(world, 40);
    const before = world.tectonics.faults.map((f) => f.stress.toFixed(5));

    const other = buildTestWorld();
    other.tectonics.restore(structuredClone(world.tectonics.serialize()));
    const after = other.tectonics.faults.map((f) => f.stress.toFixed(5));
    expect(after).toEqual(before);
  });

  it('clamps nonsense strain from a save file', () => {
    const world = buildTestWorld();
    world.tectonics.restore({
      faults: [{ stress: 1e9, strength: -4, lastRupture: 'yesterday' }],
    });
    const f = world.tectonics.faults[0];
    expect(f.stress).toBeLessThanOrEqual(6);
    expect(f.strength).toBeGreaterThan(0);
    expect(typeof f.lastRupture).toBe('number');
  });
});
