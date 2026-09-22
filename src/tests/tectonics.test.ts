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

  it('puts the water where the ocean floor is', () => {
    // Which plates are oceanic is decided before the land is raised, and the
    // land is raised from it -- so this is not a definition being restated,
    // it is the generator having honoured it. Individual plates can still go
    // against the grain, because a continent is not the same thing as a plate
    // and real ones carry islands and drowned shelves; what cannot happen is
    // the ocean floor coming out drier than the continents.
    const world = buildTestWorld();
    const t = world.terrain;
    const wetness = new Map<number, { sub: number; total: number }>();
    for (let i = 0; i < world.tectonics.plateOf.length; i++) {
      const id = world.tectonics.plateOf[i];
      let e = wetness.get(id);
      if (!e) wetness.set(id, (e = { sub: 0, total: 0 }));
      e.total++;
      if (t.waterHeight[i] > t.data.height[i]) e.sub++;
    }

    const wet: number[] = [];
    const dry: number[] = [];
    for (const p of world.tectonics.plates) {
      const e = wetness.get(p.id);
      if (!e || e.total < 200) continue;
      (p.oceanic ? wet : dry).push(e.sub / e.total);
    }
    expect(wet.length).toBeGreaterThan(0);
    expect(dry.length).toBeGreaterThan(0);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(wet)).toBeGreaterThan(mean(dry) + 0.12);
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
    const t = world.terrain;
    const at = (f: { x: number; z: number }): number =>
      t.data.height[t.index(t.tileX(f.x), t.tileZ(f.z))];

    // Measured over every fault of each kind rather than over one of them.
    // A single segment near a triple junction is pulled both ways at once and
    // can legitimately go either way; what the rock is doing as a whole
    // cannot.
    const conv = tec.faults.filter((f) => f.kind === 'convergent' && f.closingRate > 10);
    const div = tec.faults.filter((f) => f.kind === 'divergent' && f.closingRate > 10);
    expect(conv.length + div.length).toBeGreaterThan(0);
    const before = [...conv, ...div].map(at);

    // An age, not a lifetime: four centuries of drift is unmistakable.
    runRock(world, 60 * 400);

    const after = [...conv, ...div].map(at);
    const mean = (xs: number[]): number =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    if (conv.length) {
      expect(mean(after.slice(0, conv.length))).toBeGreaterThan(mean(before.slice(0, conv.length)));
    }
    if (div.length) {
      expect(mean(after.slice(conv.length))).toBeLessThan(mean(before.slice(conv.length)));
    }
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
