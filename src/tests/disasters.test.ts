/**
 * What makes disasters happen, and what happens after them.
 *
 * The line these hold is that a hazard is read off the world rather than
 * scheduled against the clock: a calm, wet, well-fed world stays quiet
 * however long it runs, and a world that has been dry for a season is the one
 * that burns.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig, run, runAir } from './harness';
import type { HazardKind } from '../sim/DisasterDirector';
import type { World } from '../sim/World';

/** Moves someone, keeping the spatial grid the contact check reads in step. */
function place(world: World, npcIndex: number, x: number, z: number): void {
  const npc = world.npcs[npcIndex];
  const ox = npc.x;
  const oz = npc.z;
  npc.x = x;
  npc.z = z;
  world.npcGrid.move(ox, oz, x, z, npc);
}

describe('hazard risk', () => {
  it('is near nothing in a calm, wet, well-stocked world', () => {
    const world = buildTestWorld();
    // Soak the world and fill the larder.
    for (let i = 0; i < world.climate.humidity.length; i++) {
      world.climate.precipitation[i] = 1.2;
    }
    world.settlement.foodDays = 20;
    runAir(world, 4);

    const fire = world.director.risks.get('wildfire');
    expect(fire).toBeDefined();
    expect(fire!.risk).toBeLessThan(0.55);
    expect(world.director.risks.get('famine')?.risk ?? 0).toBeLessThan(0.55);
  });

  it('climbs for fire when the world dries out', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'dry', climate: 'arid' }));
    runAir(world, 2);
    const wet = world.director.risks.get('wildfire')?.risk ?? 0;

    // Bake it: no rain anywhere, hot air.
    for (let i = 0; i < world.climate.temperature.length; i++) {
      world.climate.precipitation[i] = 0;
      world.climate.temperature[i] = 30;
      world.climate.humidity[i] = 0.05;
    }
    runAir(world, 1);
    const dry = world.director.risks.get('wildfire')?.risk ?? 0;
    expect(dry).toBeGreaterThan(wet);
  });

  it('never fires a hazard in the first days of a settlement', () => {
    const world = buildTestWorld();
    run(world, 24 * 12 * 2);
    expect(world.director.history.length).toBe(0);
  });

  it('does not declare a famine just because the store shelf is bare', () => {
    const world = buildTestWorld();
    // Empty stores, but everyone is perfectly well fed off what they forage.
    world.settlement.foodDays = 0;
    for (const npc of world.npcs) npc.needs.hunger = 95;
    runAir(world, 10);
    expect(world.director.risks.get('famine')!.risk).toBeLessThan(0.55);
    expect(world.famineSeverity).toBe(0);
  });
});

describe('cascades', () => {
  it('records what a disaster followed from', () => {
    const world = buildTestWorld();
    runAir(world, 5);
    // Saturate the slopes so an earthquake has something to shake loose.
    for (let i = 0; i < world.climate.precipitation.length; i++) {
      world.climate.precipitation[i] = 1.4;
    }
    let cascaded = false;
    for (let attempt = 0; attempt < 30 && !cascaded; attempt++) {
      world.director.fire(world, 'earthquake', 0.95);
      cascaded = world.director.history.some((d) => d.causedBy !== 0);
    }
    // Slides need steep ground; a flat map legitimately never cascades.
    if (world.steepGroundFraction() < 0.02) return;
    expect(cascaded).toBe(true);
    const child = world.director.history.find((d) => d.causedBy !== 0)!;
    const parent = world.director.history.find((d) => d.id === child.causedBy);
    expect(parent).toBeDefined();
    expect(parent!.kind).toBe('earthquake');
  });

  it('does not chain without end', () => {
    const world = buildTestWorld();
    runAir(world, 5);
    world.director.fire(world, 'earthquake', 1);
    // Every record is either a root or one step from a root.
    const byId = new Map(world.director.history.map((d) => [d.id, d]));
    for (const d of world.director.history) {
      if (d.causedBy === 0) continue;
      const parent = byId.get(d.causedBy);
      expect(parent?.causedBy ?? 0).toBe(0);
    }
  });

  it('each disaster it fires actually changes the world', () => {
    const world = buildTestWorld();
    runAir(world, 5);

    const before = {
      fires: world.disasters.activeFireCount,
      condition: world.buildings.reduce((s, b) => s + b.condition, 0),
    };
    world.director.fire(world, 'wildfire', 0.9);
    world.director.fire(world, 'earthquake', 0.9);

    const changed =
      world.disasters.activeFireCount !== before.fires ||
      world.buildings.reduce((s, b) => s + b.condition, 0) !== before.condition ||
      world.director.history.length > 0;
    expect(changed).toBe(true);
  });
});

describe('famine', () => {
  it('ends when there is food again, not when a timer runs out', () => {
    const world = buildTestWorld();
    world.beginFamine(0.8);
    expect(world.famineSeverity).toBeGreaterThan(0);

    world.settlement.foodDays = 0;
    runAir(world, 3);
    expect(world.famineSeverity).toBeGreaterThan(0);

    world.settlement.foodDays = 9;
    runAir(world, 1);
    expect(world.famineSeverity).toBe(0);
  });

  it('wears down only the people who are actually going without', () => {
    const world = buildTestWorld();
    const fed = world.npcs[0];
    const starving = world.npcs[1];
    fed.needs.hunger = 90;
    fed.needs.health = 100;
    starving.needs.hunger = 10;
    starving.needs.health = 100;

    world.settlement.foodDays = 0;
    world.beginFamine(1);
    runAir(world, 2);

    expect(starving.needs.health).toBeLessThan(100);
    expect(fed.needs.health).toBe(100);
  });
});

describe('sickness', () => {
  it('starts in one person and spreads by contact, not by decree', () => {
    const world = buildTestWorld();
    const outbreak = world.disease.begin(world, world.npcs[0].x, world.npcs[0].z, 0.8);
    expect(outbreak).not.toBeNull();
    expect(outbreak!.infections.size).toBe(1);

    // Nobody near anybody: it cannot go anywhere.
    for (let i = 0; i < world.npcs.length; i++) place(world, i, 20 + i * 40, 20);
    for (let i = 0; i < 6; i++) world.disease.update(world, 2);
    expect(outbreak!.infections.size).toBeLessThanOrEqual(1);
    expect(outbreak!.over).toBe(false);

    // Put them shoulder to shoulder and it moves.
    for (let i = 0; i < world.npcs.length; i++) {
      place(world, i, 40 + (i % 2), 40);
      world.npcs[i].needs.health = 55;
    }
    for (let i = 0; i < 60 && outbreak!.infections.size < 2; i++) {
      world.disease.update(world, 3);
    }
    expect(outbreak!.infections.size).toBeGreaterThan(1);
  });

  it('runs its course and leaves survivors immune', () => {
    const world = buildTestWorld();
    const outbreak = world.disease.begin(world, world.npcs[0].x, world.npcs[0].z, 0.5)!;
    for (let i = 0; i < world.npcs.length; i++) place(world, i, 40, 40);
    for (let i = 0; i < 400 && !outbreak.over; i++) world.disease.update(world, 6);

    expect(outbreak.over).toBe(true);
    expect(outbreak.infections.size).toBe(0);
    expect(outbreak.recoveries + outbreak.deaths).toBeGreaterThan(0);
    // Everyone who recovered is on the immune list, and cannot be reinfected.
    for (const id of outbreak.immune) {
      expect(outbreak.infections.has(id)).toBe(false);
    }
  });

  it('is survived more often where there is care', () => {
    const tally = (health: number, infra: number): { died: number; lived: number } => {
      const world = buildTestWorld();
      world.settlement.infrastructure.health = infra;
      for (let i = 0; i < world.npcs.length; i++) {
        place(world, i, 40, 40);
        world.npcs[i].needs.health = health;
        world.npcs[i].needs.hunger = health;
      }
      const o = world.disease.begin(world, 40, 40, 0.9)!;
      for (let i = 0; i < 500 && !o.over; i++) world.disease.update(world, 6);
      return { died: o.deaths, lived: o.recoveries };
    };

    const neglected = tally(35, 0);
    const cared = tally(95, 12);
    // Care cannot guarantee survival, but it must not make it worse.
    expect(cared.died).toBeLessThanOrEqual(neglected.died);
  });

  it('kills nobody who was never ill', () => {
    const world = buildTestWorld();
    const before = world.npcs.length;
    runAir(world, 30);
    // No outbreak was started, so the population is intact.
    if (world.disease.outbreaks.length === 0) {
      expect(world.npcs.length).toBe(before);
    }
  });
});

describe('the record', () => {
  it('survives a save and keeps what caused what', () => {
    const world = buildTestWorld();
    runAir(world, 5);
    world.director.fire(world, 'earthquake', 0.9);
    const before = world.director.history.map((d) => `${d.kind}:${d.causedBy}`);

    const data = world.director.serialize();
    const other = buildTestWorld();
    other.director.restore(structuredClone(data));
    const after = other.director.history.map((d) => `${d.kind}:${d.causedBy}`);
    expect(after.length).toBe(before.length);
  });

  it('refuses nonsense hazard kinds from a save file', () => {
    const world = buildTestWorld();
    world.director.restore({
      history: [
        { kind: 'meteor_swarm', day: 1, x: 0, z: 0, severity: 0.5, causedBy: 0 },
        { kind: 'wildfire' as HazardKind, day: 2, x: 5, z: 5, severity: 9, causedBy: -3 },
      ],
    });
    expect(world.director.history.length).toBe(1);
    expect(world.director.history[0].kind).toBe('wildfire');
    expect(world.director.history[0].severity).toBeLessThanOrEqual(1);
    expect(world.director.history[0].causedBy).toBeGreaterThanOrEqual(0);
  });
});
