/**
 * Saving and loading.
 *
 * A save is data from outside the program, so everything here is about two
 * things: that a world survives the round trip intact, and that a malformed
 * or hostile file is rejected or clamped rather than trusted.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, run, runAir } from './harness';
import { deserializeWorld, serializeWorld } from '../persistence/serialize';
import { migrate, SAVE_VERSION, validate, SaveData } from '../persistence/schema';

type AnySave = SaveData & Record<string, unknown>;

function roundTrip(world: ReturnType<typeof buildTestWorld>): ReturnType<typeof buildTestWorld> {
  // Structured clone is exactly what IndexedDB does to a save on the way
  // through, typed arrays and all, so that is what the trip has to survive.
  const cloned = structuredClone(serializeWorld(world, 'test')) as AnySave;
  const migrated = migrate(cloned);
  expect(validate(migrated)).toBeNull();
  return deserializeWorld(migrated);
}

describe('save and load', () => {
  it('brings the atmosphere back exactly as it was', () => {
    const world = buildTestWorld();
    runAir(world, 20);
    const before = world.climate;
    const loaded = roundTrip(world);
    const after = loaded.climate;

    expect(after.meanTemperature()).toBeCloseTo(before.meanTemperature(), 4);
    expect(after.snowCover()).toBeCloseTo(before.snowCover(), 4);
    expect(after.fronts.length).toBe(before.fronts.length);
    for (let i = 0; i < before.temperature.length; i++) {
      expect(after.temperature[i]).toBeCloseTo(before.temperature[i], 3);
      expect(after.humidity[i]).toBeCloseTo(before.humidity[i], 3);
      expect(after.snowpack[i]).toBeCloseTo(before.snowpack[i], 3);
    }
  });

  it('keeps the climate record and the long-term trend', () => {
    const world = buildTestWorld();
    runAir(world, 130);
    world.climate.addAerosol(2.5);
    const loaded = roundTrip(world);
    expect(loaded.climate.history.length).toBe(world.climate.history.length);
    expect(loaded.climate.aerosolCooling).toBeCloseTo(world.climate.aerosolCooling, 4);
    expect(loaded.climate.trend).toBeCloseTo(world.climate.trend, 4);
  });

  it('keeps fires, floods and volcanoes burning across a save', () => {
    const world = buildTestWorld();
    const tree = world.nodes.find((n) => n.kind === 'oak' || n.kind === 'pine');
    world.disasters.ignite(world, tree!.x, tree!.z, 0.8);
    world.raiseVolcano(world.player.position.x + 80, world.player.position.z + 80, 50, 0.7);
    const fires = world.disasters.activeFireCount;
    expect(fires).toBeGreaterThan(0);

    const loaded = roundTrip(world);
    expect(loaded.disasters.activeFireCount).toBe(fires);
    expect(loaded.volcanoes.length).toBe(1);
    expect(loaded.volcanoes[0].name).toBe(world.volcanoes[0].name);
  });

  it('remembers who the player was driving', () => {
    const world = buildTestWorld();
    const npc = world.npcs[0];
    world.possessed = npc.id;
    const loaded = roundTrip(world);
    expect(loaded.possessed).toBe(npc.id);
  });

  it('carries an old save forward instead of rejecting it', () => {
    const world = buildTestWorld();
    run(world, 30);
    const data = structuredClone(serializeWorld(world, 'old')) as AnySave;
    // Pretend it came from before the atmosphere existed.
    data.version = 4;
    const loose = data as Record<string, unknown>;
    delete loose.climate;
    delete loose.storms;
    delete loose.disasters;
    delete loose.volcanoes;

    const migrated = migrate(data);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(validate(migrated)).toBeNull();
    const loaded = deserializeWorld(migrated);
    // It starts the new systems fresh rather than failing to load.
    expect(loaded.volcanoes.length).toBe(0);
    expect(loaded.climate.meanTemperature()).toBeGreaterThan(-60);
    expect(loaded.climate.meanTemperature()).toBeLessThan(80);
  });
});

describe('a save file is untrusted input', () => {
  it('refuses a save claiming a future version', () => {
    const world = buildTestWorld();
    const data = serializeWorld(world, 'x');
    data.version = SAVE_VERSION + 5;
    expect(validate(data)).not.toBeNull();
  });

  it('ignores climate arrays of the wrong length instead of resizing itself', () => {
    const world = buildTestWorld();
    const before = world.climate.temperature[0];
    world.climate.restore({ temperature: [1, 2, 3] });
    expect(world.climate.temperature.length).toBe(world.climate.cells * world.climate.cells);
    expect(world.climate.temperature[0]).toBe(before);
  });

  it('drops non-numeric and infinite values rather than poisoning the grid', () => {
    const world = buildTestWorld();
    const n = world.climate.temperature.length;
    const junk = new Array(n).fill(0);
    junk[0] = 'hot';
    junk[1] = Infinity;
    junk[2] = NaN;
    junk[3] = 12.5;
    const before0 = world.climate.temperature[0];
    world.climate.restore({ temperature: junk });
    expect(world.climate.temperature[0]).toBe(before0);
    expect(Number.isFinite(world.climate.temperature[1])).toBe(true);
    expect(Number.isNaN(world.climate.temperature[2])).toBe(false);
    expect(world.climate.temperature[3]).toBeCloseTo(12.5, 5);
  });

  it('clamps a volcano that claims to be the size of the world', () => {
    const world = buildTestWorld();
    world.restoreVolcanoes([
      {
        id: 1,
        x: 1e9,
        z: -1e9,
        radius: 1e9,
        state: 'melting' as unknown as string,
        pressure: 1e6,
        name: 'x'.repeat(5000),
      },
    ]);
    const v = world.volcanoes[0];
    expect(v.x).toBeLessThanOrEqual(world.terrain.worldSize);
    expect(v.z).toBeGreaterThanOrEqual(0);
    expect(v.radius).toBeLessThanOrEqual(world.terrain.worldSize);
    expect(v.pressure).toBeLessThanOrEqual(4);
    expect(v.state).toBe('dormant');
    expect(v.name.length).toBeLessThanOrEqual(64);
  });

  it('refuses a storm with a nonsense kind and clamps an enormous one', () => {
    const world = buildTestWorld();
    world.storms.restore({
      storms: [
        { kind: 'kaiju', x: 10, z: 10, radius: 50, intensity: 0.5, life: 5 },
        { kind: 'tornado', x: 10, z: 10, radius: 1e9, intensity: 40, life: 1e9, name: 42 },
      ],
    });
    expect(world.storms.storms.length).toBe(1);
    const s = world.storms.storms[0];
    expect(s.kind).toBe('tornado');
    expect(s.radius).toBeLessThanOrEqual(20000);
    expect(s.intensity).toBeLessThanOrEqual(1);
    expect(typeof s.name).toBe('string');
  });
});
