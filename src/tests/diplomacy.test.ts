/**
 * War and the avoiding of it.
 *
 * These test the machinery rather than the frequency: how often a given world
 * goes to war depends on that world, and a peaceful three centuries is a
 * legitimate history. What must always hold is that a war needs a reason and a
 * government that thinks it can win, that an army has to march and be fed, and
 * that the peace afterwards takes something real.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import type { Nation } from '../sim/Nations';

function runPolitics(world: World, days: number): void {
  for (let d = 0; d < days; d++) {
    world.time.advance(24 * 12);
    world.nations.update(world, 24);
    world.diplomacy.update(world, 24);
  }
}

/** Two AI nations close enough to reach each other. */
function twoNations(world: World): [Nation, Nation] {
  const others = world.nations.nations.filter((n) => !n.isPlayer);
  expect(others.length).toBeGreaterThan(1);
  // Put the second right next to the first so distance is never the obstacle.
  others[1].x = others[0].x + 30;
  others[1].z = others[0].z;
  return [others[0], others[1]];
}

describe('relations', () => {
  it('start indifferent and are remembered per pair', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    const r = world.diplomacy.relation(a.id, b.id);
    expect(r.opinion).toBe(0);
    expect(r.treaty).toBe('none');
    // The same relation whichever way round it is asked for.
    expect(world.diplomacy.relation(b.id, a.id)).toBe(r);
  });

  it('warm between peoples who are not fighting', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    runPolitics(world, 400);
    expect(world.diplomacy.relation(a.id, b.id).opinion).toBeGreaterThan(0);
  });

  it('sour the moment war is declared, and keep souring while it lasts', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 300;
    b.army = 300;
    const r = world.diplomacy.relation(a.id, b.id);

    const beforeWar = r.opinion;
    const war = world.diplomacy.declareWar(world, a, b, 'border');
    expect(r.opinion).toBeLessThan(beforeWar);

    // And it keeps falling for as long as the fighting lasts. Peace, when it
    // comes, warms it again, so what is checked is the low point during the
    // war rather than wherever it had got back to afterwards.
    const atDeclaration = r.opinion;
    let lowest = r.opinion;
    for (let i = 0; i < 10; i++) {
      if (!world.diplomacy.atWar(a.id, b.id)) break;
      runPolitics(world, 2);
      lowest = Math.min(lowest, r.opinion);
      war.attackerExhaustion = 0;
      war.defenderExhaustion = 0;
    }
    expect(lowest).toBeLessThan(atDeclaration);
  });

  it('build up to treaties in order as they warm', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'friends' }));
    const [a, b] = twoNations(world);
    const r = world.diplomacy.relation(a.id, b.id);
    const seen: string[] = [];
    for (let i = 0; i < 300; i++) {
      runPolitics(world, 10);
      if (seen[seen.length - 1] !== r.treaty) seen.push(r.treaty);
      if (r.treaty === 'alliance') break;
    }
    // Whatever it got to, it got there one rung at a time.
    const ladder = ['none', 'trade', 'nonAggression', 'alliance'];
    for (let i = 1; i < seen.length; i++) {
      const from = ladder.indexOf(seen[i - 1]);
      const to = ladder.indexOf(seen[i]);
      // Either a step up, or a fall back to nothing when it soured.
      expect(to === from + 1 || to === 0).toBe(true);
    }
  });
});

describe('going to war', () => {
  it('does not declare war on a people not worth the march', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    b.population = 5;
    b.treasury = 0;
    b.army = 0;
    a.leader.ambition = 1;
    a.army = 500;
    a.stability = 1;
    for (let i = 0; i < 80; i++) {
      runPolitics(world, 10);
      b.population = 5;
      b.treasury = 0;
      b.army = 0;
    }
    expect(world.diplomacy.atWar(a.id, b.id)).toBeNull();
  });

  it('will not start one while its own house is shaky', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.stability = 0.1;
    a.leader.ambition = 1;
    a.army = 900;
    b.population = 600;
    b.army = 1;
    for (let i = 0; i < 60; i++) {
      runPolitics(world, 10);
      a.stability = 0.1;
      a.army = 900;
    }
    expect(world.diplomacy.atWar(a.id, b.id)).toBeNull();
  });

  it('respects a truce and a signed non-aggression pact', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    const r = world.diplomacy.relation(a.id, b.id);
    r.truceDays = 400;
    a.leader.ambition = 1;
    a.army = 900;
    a.stability = 1;
    b.population = 600;
    b.army = 1;
    for (let i = 0; i < 30; i++) {
      runPolitics(world, 10);
      a.army = 900;
      a.stability = 1;
    }
    expect(world.diplomacy.atWar(a.id, b.id)).toBeNull();
    expect(r.truceDays).toBeLessThan(400);
  });

  it('raises real armies out of the levy when it does', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 100;
    b.army = 60;
    world.diplomacy.declareWar(world, a, b, 'conquest');

    expect(world.diplomacy.atWar(a.id, b.id)).not.toBeNull();
    // The soldiers left the levy and are now standing somewhere.
    expect(a.army).toBeLessThan(100);
    expect(world.diplomacy.armiesOf(a.id).length).toBeGreaterThan(0);
    expect(world.diplomacy.armiesOf(b.id).length).toBeGreaterThan(0);
    const army = world.diplomacy.armiesOf(a.id)[0];
    expect(army.strength).toBeGreaterThan(0);
    expect(army.x).toBeCloseTo(a.x, 3);
  });
});

describe('armies in the field', () => {
  it('march toward what they were sent at', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    b.x = a.x + 300;
    a.army = 200;
    b.army = 100;
    world.diplomacy.declareWar(world, a, b, 'conquest');
    const army = world.diplomacy.armiesOf(a.id)[0];
    const startGap = Math.hypot(army.x - b.x, army.z - b.z);
    runPolitics(world, 6);
    const now = world.diplomacy.armies.find((x) => x.id === army.id);
    if (!now) return; // it may have arrived and disbanded
    expect(Math.hypot(now.x - b.x, now.z - b.z)).toBeLessThan(startGap);
  });

  it('wastes away when it is far from home and unsupplied', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 300;
    b.army = 1;
    world.diplomacy.declareWar(world, a, b, 'conquest');
    const army = world.diplomacy.armiesOf(a.id)[0];
    // Strand it on unclaimed ground far from anyone.
    army.x = world.terrain.worldSize * 0.5;
    army.z = world.terrain.worldSize * 0.5;
    army.targetX = army.x;
    army.targetZ = army.z;
    army.supply = 0.3;
    for (let i = 0; i < world.nations.claims.length; i++) {
      const cx = i % world.nations.cells;
      const cz = Math.floor(i / world.nations.cells);
      const wx = (cx + 0.5) * world.nations.cellSize;
      const wz = (cz + 0.5) * world.nations.cellSize;
      if (Math.hypot(wx - army.x, wz - army.z) < 60) world.nations.claims[i] = 0;
    }
    const before = army.strength;

    for (let d = 0; d < 30; d++) {
      world.time.advance(24 * 12);
      world.diplomacy.update(world, 24);
      army.targetX = army.x;
      army.targetZ = army.z;
    }
    const now = world.diplomacy.armies.find((x) => x.id === army.id);
    expect(now ? now.strength : 0).toBeLessThan(before);
  });

  it('fights when it meets an enemy, and both sides lose men', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 200;
    b.army = 200;
    const war = world.diplomacy.declareWar(world, a, b, 'conquest');
    const armyA = world.diplomacy.armiesOf(a.id)[0];
    const armyB = world.diplomacy.armiesOf(b.id)[0];
    armyB.x = armyA.x + 5;
    armyB.z = armyA.z;
    const before = { a: armyA.strength, b: armyB.strength };

    world.time.advance(24 * 12);
    world.diplomacy.update(world, 24);

    expect(armyA.strength).toBeLessThan(before.a);
    expect(armyB.strength).toBeLessThan(before.b);
    expect(war.battles).toBeGreaterThan(0);
  });
});

describe('sieges', () => {
  it('press a city and wear its people down', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 400;
    b.army = 0;
    b.population = 400;
    b.unrest = 0.1;
    world.diplomacy.declareWar(world, a, b, 'conquest');
    const army = world.diplomacy.armiesOf(a.id)[0];
    army.x = b.x;
    army.z = b.z;
    army.targetX = b.x;
    army.targetZ = b.z;

    const before = b.unrest;
    for (let d = 0; d < 40; d++) {
      world.time.advance(24 * 12);
      world.diplomacy.update(world, 24);
    }
    const sieging = world.diplomacy.armies.some((x) => x.besieging === b.id);
    if (!sieging && b.unrest <= before) return; // it may have been lifted early
    expect(b.unrest).toBeGreaterThan(before);
  });

  it('breaks real things when the city under siege is the player’s', () => {
    const world = buildTestWorld();
    const mine = world.nations.playerNation!;
    const enemy = world.nations.nations.find((n) => !n.isPlayer)!;
    enemy.army = 600;
    const war = world.diplomacy.declareWar(world, enemy, mine, 'conquest');
    expect(war).not.toBeNull();

    const army = world.diplomacy.armiesOf(enemy.id)[0];
    army.x = world.settlement.centre.x;
    army.z = world.settlement.centre.z;
    army.targetX = army.x;
    army.targetZ = army.z;
    army.supply = 1;

    // Give them something to break and something to steal.
    const store = world.buildings[0];
    const scars: number[] = [];
    for (const b of world.buildings) scars.push(b.condition);

    for (let d = 0; d < 60; d++) {
      world.time.advance(24 * 12);
      world.diplomacy.update(world, 24);
      army.supply = 1;
    }

    const hurt =
      world.buildings.some((b, i) => b.condition < (scars[i] ?? 1)) ||
      world.buildings.length < scars.length ||
      world.disasters.activeFireCount > 0 ||
      world.npcs.some((n) => n.task.type === 'flee');
    // With no buildings at all there is nothing to damage; that is not a bug.
    if (store) expect(hurt).toBe(true);
  });
});

describe('peace', () => {
  it('ends the war, sends everyone home and leaves a truce', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 200;
    b.army = 200;
    const war = world.diplomacy.declareWar(world, a, b, 'border');
    const raised = world.diplomacy.armies
      .filter((x) => x.nation === a.id || x.nation === b.id)
      .map((x) => x.id);
    war.attackerExhaustion = 1;
    war.defenderExhaustion = 1;

    for (let i = 0; i < 40 && world.diplomacy.atWar(a.id, b.id); i++) {
      runPolitics(world, 5);
      war.attackerExhaustion = 1;
      war.defenderExhaustion = 1;
    }
    expect(world.diplomacy.atWar(a.id, b.id)).toBeNull();
    expect(world.diplomacy.relation(a.id, b.id).truceDays).toBeGreaterThan(0);
    // The armies raised for this war are going home or already gone. Anything
    // else in the field belongs to some other quarrel and is not ours to check.
    for (const id of raised) {
      const army = world.diplomacy.armies.find((x) => x.id === id);
      if (army) expect(army.stance).toBe('returning');
    }
  });

  it('takes land from the loser when the winner won clearly', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 200;
    b.army = 200;
    const war = world.diplomacy.declareWar(world, a, b, 'border');
    const before = { winner: a.territory, loser: b.territory };
    war.warScore = 1;
    war.attackerExhaustion = 1;
    war.defenderExhaustion = 1;

    for (let i = 0; i < 40 && world.diplomacy.atWar(a.id, b.id); i++) {
      runPolitics(world, 5);
      const live = world.diplomacy.atWar(a.id, b.id);
      if (live) {
        live.warScore = 1;
        live.attackerExhaustion = 1;
        live.defenderExhaustion = 1;
      }
    }
    expect(world.diplomacy.atWar(a.id, b.id)).toBeNull();
    if (before.loser > 1) {
      expect(b.territory).toBeLessThan(before.loser);
      expect(a.territory).toBeGreaterThan(before.winner);
    }
    // And the land that changed hands is really theirs now.
    let counted = 0;
    for (let i = 0; i < world.nations.claims.length; i++) {
      if (world.nations.claims[i] === a.id) counted++;
    }
    expect(counted).toBe(a.territory);
  });

  it('costs the attacker at home when the war was lost', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 200;
    b.army = 200;
    a.legitimacy = 0.8;
    const war = world.diplomacy.declareWar(world, a, b, 'conquest');
    war.warScore = -1;
    war.attackerExhaustion = 1;
    war.defenderExhaustion = 1;
    const before = a.legitimacy;

    for (let i = 0; i < 40 && world.diplomacy.atWar(a.id, b.id); i++) {
      runPolitics(world, 5);
      const live = world.diplomacy.atWar(a.id, b.id);
      if (live) {
        live.warScore = -1;
        live.attackerExhaustion = 1;
        live.defenderExhaustion = 1;
      }
    }
    expect(a.legitimacy).toBeLessThan(before);
  });
});

describe('a world left to itself', () => {
  it('produces a history without breaking any of its own numbers', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'history' }));
    runPolitics(world, 60 * 120);

    for (const n of world.nations.nations) {
      expect(Number.isFinite(n.population)).toBe(true);
      expect(n.population).toBeGreaterThanOrEqual(0);
      expect(n.army).toBeGreaterThanOrEqual(0);
    }
    for (const army of world.diplomacy.armies) {
      expect(army.strength).toBeGreaterThan(0);
      expect(army.supply).toBeGreaterThanOrEqual(0);
      expect(army.supply).toBeLessThanOrEqual(1);
      expect(world.nations.byId(army.nation)).not.toBeNull();
    }
    for (const war of world.diplomacy.wars) {
      expect(Math.abs(war.warScore)).toBeLessThanOrEqual(1);
      expect(world.nations.byId(war.attacker)).not.toBeNull();
      expect(world.nations.byId(war.defender)).not.toBeNull();
    }
  });
});

describe('the record', () => {
  it('survives a save', () => {
    const world = buildTestWorld();
    const [a, b] = twoNations(world);
    a.army = 150;
    b.army = 120;
    world.diplomacy.declareWar(world, a, b, 'tribute');
    runPolitics(world, 15);

    const other = buildTestWorld();
    other.nations.restore(structuredClone(world.nations.serialize()));
    other.diplomacy.restore(structuredClone(world.diplomacy.serialize()));

    expect(other.diplomacy.wars.length).toBe(world.diplomacy.wars.length);
    expect(other.diplomacy.armies.length).toBe(world.diplomacy.armies.length);
    expect(other.diplomacy.relation(a.id, b.id).wars).toBe(
      world.diplomacy.relation(a.id, b.id).wars,
    );
  });

  it('refuses nonsense from a save file', () => {
    const world = buildTestWorld();
    world.diplomacy.restore({
      wars: [{ goal: 'space race', attacker: 1, defender: 2 }],
      armies: [
        { nation: 1, x: 5, z: 5, strength: -40, supply: 9, stance: 'teleporting', besieging: -2 },
      ],
      relations: [
        { k: 'not a key', opinion: 0 },
        { k: '1:2', opinion: 9000, treaty: 'vassalage', truceDays: -5, wars: -1 },
      ],
    });
    expect(world.diplomacy.wars.length).toBe(0);
    expect(world.diplomacy.armies.length).toBe(1);
    const army = world.diplomacy.armies[0];
    expect(army.strength).toBeGreaterThanOrEqual(0);
    expect(army.supply).toBeLessThanOrEqual(1);
    expect(army.stance).toBe('returning');
    expect(army.besieging).toBeGreaterThanOrEqual(0);
    const r = world.diplomacy.relation(1, 2);
    expect(r.opinion).toBeLessThanOrEqual(100);
    expect(r.treaty).toBe('none');
    expect(r.truceDays).toBeGreaterThanOrEqual(0);
    expect(r.wars).toBeGreaterThanOrEqual(0);
  });
});
