/**
 * Polities.
 *
 * The line held here is that a nation's numbers mean something: population is
 * bounded by the land it holds, taxes come out of real production, unrest is
 * what you get for governing badly, and a regime falls when unrest has outrun
 * the belief that it has any right to rule — never on a timer.
 */

import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_HOUR } from '../sim/Time';
import { buildTestWorld, makeTestConfig } from './harness';
import type { World } from '../sim/World';
import { GOVERNMENTS, LAWS, Nation } from '../sim/Nations';

/**
 * Runs `days` of politics and nothing else.
 *
 * Diplomacy is part of politics: a civil war is fought through the same war
 * machinery as any other, so leaving it out would mean risings that start and
 * never finish.
 */
function runPolitics(world: World, days: number): void {
  for (let d = 0; d < days; d++) {
    world.time.advance(24 * SECONDS_PER_GAME_HOUR);
    world.nations.update(world, 24);
    world.diplomacy.update(world, 24);
  }
}

describe('the map of the world', () => {
  it('gives the player a nation and the world some neighbours', () => {
    const world = buildTestWorld();
    const mine = world.nations.playerNation;
    expect(mine).not.toBeNull();
    expect(mine!.name).toBe(world.config.name);
    expect(world.nations.nations.length).toBeGreaterThan(2);
  });

  it('settles other peoples on ground worth settling', () => {
    const world = buildTestWorld();
    const t = world.terrain;
    for (const n of world.nations.nations) {
      if (n.isPlayer) continue;
      const i = t.index(t.tileX(n.x), t.tileZ(n.z));
      expect(t.waterHeight[i]).toBeLessThanOrEqual(t.data.height[i]);
      expect(t.data.slope[i]).toBeLessThan(0.3);
    }
  });

  it('keeps them apart from each other', () => {
    const world = buildTestWorld();
    const all = world.nations.nations;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
        expect(d).toBeGreaterThan(world.terrain.worldSize * 0.15);
      }
    }
  });

  it('never claims open water', () => {
    // A claimed cell has to have some land in it. Not all of it -- a cell on a
    // ragged coast is half headland and half sea, and somebody owns the
    // headland -- but a cell that is nothing but water belongs to nobody.
    const world = buildTestWorld();
    const n = world.nations;
    const t = world.terrain;
    for (let i = 0; i < n.claims.length; i++) {
      if (n.claims[i] === 0) continue;
      const cx = i % n.cells;
      const cz = Math.floor(i / n.cells);
      let anyLand = false;
      for (let oz = 0.1; oz < 1 && !anyLand; oz += 0.2) {
        for (let ox = 0.1; ox < 1; ox += 0.2) {
          const ti = t.index(
            t.tileX((cx + ox) * n.cellSize),
            t.tileZ((cz + oz) * n.cellSize),
          );
          if (t.waterHeight[ti] <= t.data.height[ti]) {
            anyLand = true;
            break;
          }
        }
      }
      expect(anyLand, `cell ${cx},${cz} is open water`).toBe(true);
    }
  });

  it('gives every claimed cell to exactly one nation', () => {
    const world = buildTestWorld();
    const n = world.nations;
    const ids = new Set(n.nations.map((x) => x.id));
    const counted = new Map<number, number>();
    for (let i = 0; i < n.claims.length; i++) {
      const owner = n.claims[i];
      if (owner === 0) continue;
      expect(ids.has(owner)).toBe(true);
      counted.set(owner, (counted.get(owner) ?? 0) + 1);
    }
    for (const nation of n.nations) {
      expect(nation.territory).toBe(counted.get(nation.id) ?? 0);
    }
  });
});

describe('a nation over time', () => {
  it('grows into the land it holds and then stops', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    runPolitics(world, 60 * 40);
    const settled = n.population;
    runPolitics(world, 60 * 40);
    // Forty more years must not double it again: it is at what the land bears.
    expect(n.population).toBeLessThan(settled * 1.8);
    expect(n.population).toBeGreaterThan(1);
  });

  it('does not grow without bound over two centuries', () => {
    const world = buildTestWorld();
    runPolitics(world, 60 * 200);
    for (const n of world.nations.nations) {
      if (n.isPlayer) continue;
      // A nation of a hundred thousand on a map this size is a broken number.
      expect(n.population).toBeLessThan(40000);
      expect(Number.isFinite(n.population)).toBe(true);
    }
  });

  it('changes its rulers as they grow old', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    const first = n.leader.name;
    runPolitics(world, 60 * 90);
    expect(n.leader.name).not.toBe(first);
    expect(n.leader.age).toBeLessThan(100);
  });

  it('adjusts what it takes in tax rather than holding one rate for ever', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    const rates = new Set<string>();
    for (let i = 0; i < 40; i++) {
      runPolitics(world, 60);
      rates.add(n.taxRate.toFixed(2));
    }
    expect(rates.size).toBeGreaterThan(2);
    expect(n.taxRate).toBeGreaterThan(0);
    expect(n.taxRate).toBeLessThanOrEqual(0.6);
  });

  it('keeps every number in a sane range, however long it runs', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'longhaul' }));
    runPolitics(world, 60 * 150);
    for (const n of world.nations.nations) {
      for (const field of ['stability', 'unrest', 'legitimacy'] as const) {
        expect(n[field], field).toBeGreaterThanOrEqual(0);
        expect(n[field], field).toBeLessThanOrEqual(1);
      }
      expect(n.territory).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(n.treasury)).toBe(true);
      expect(n.army).toBeGreaterThanOrEqual(0);
    }
  });

  it('cannot believe in itself more than its way of ruling allows', () => {
    const world = buildTestWorld();
    runPolitics(world, 60 * 120);
    for (const n of world.nations.nations) {
      const ceiling = Math.min(1, GOVERNMENTS[n.government].baseLegitimacy + 0.2);
      expect(n.legitimacy).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });
});

describe('governing badly', () => {
  /** Puts a nation in the state a government gets itself into. */
  function embitter(n: Nation): void {
    n.taxRate = 0.55;
    n.leader.cruelty = 0.95;
    n.leader.competence = 0.05;
    n.unrest = 0.95;
    n.legitimacy = 0.2;
    n.stability = 0.05;
    n.army = 0;
    n.lastRegimeChangeDay = -99999;
  }

  it('taxing people into the ground raises unrest', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    n.unrest = 0.1;
    n.taxRate = 0.55;
    n.leader.cruelty = 0.95; // so the ruler will not ease off
    n.leader.competence = 0.05;
    runPolitics(world, 200);
    expect(n.unrest).toBeGreaterThan(0.1);
  });

  it('a hated, defenceless government is overthrown', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    const government = n.government;
    embitter(n);

    let changed = false;
    for (let i = 0; i < 400 && !changed; i++) {
      runPolitics(world, 10);
      embitter(n); // it keeps governing badly
      changed = n.regimeChanges > 0;
    }
    expect(changed).toBe(true);
    expect(n.regimeChanges).toBe(1);
    // What replaces it follows from what it was, and it is not the same thing.
    expect(n.government).not.toBe(government);
    expect(world.log.all().some((e) => e.key === 'ev.revolution')).toBe(true);
  });

  it('a new regime is not overthrown again the following month', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    embitter(n);
    for (let i = 0; i < 400; i++) {
      runPolitics(world, 10);
      // Stop the moment it falls, so the honeymoon clock the code just set is
      // not clobbered by another round of embittering.
      if (n.regimeChanges > 0) break;
      embitter(n);
    }
    expect(n.regimeChanges).toBe(1);

    // The new regime's clock starts when it takes power.
    expect(world.time.totalDays - n.lastRegimeChangeDay).toBeLessThan(20);

    const after = world.time.totalDays;
    // Keep governing just as badly, but do not touch the honeymoon clock.
    for (let i = 0; i < 40; i++) {
      runPolitics(world, 10);
      n.unrest = 0.95;
      n.stability = 0.05;
      n.legitimacy = 0.2;
    }
    expect(world.time.totalDays - after).toBeLessThan(900);
    expect(n.regimeChanges).toBe(1);
  });

  it('an army and a decisive ruler put a lesser rising down instead', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    n.government = 'monarchy';

    // A rising that has just crossed the threshold, against a decisive throne
    // with an army several times the ordinary levy behind it. An evenly matched
    // quarrel becomes a civil war instead, and a nation where all but everyone
    // wants the government gone is swept away; both are tested elsewhere.
    const grumbling = (): void => {
      n.legitimacy = 0.55;
      n.unrest = 0.5;
      n.stability = 0.2;
      n.leader.competence = 1;
      n.population = 900;
      n.army = 900 * 0.06 * 2.5;
      n.lastRegimeChangeDay = -99999;
    };

    grumbling();
    for (let i = 0; i < 600; i++) {
      runPolitics(world, 10);
      if (world.log.all().some((e) => e.key === 'ev.uprising')) break;
      grumbling();
    }

    expect(world.log.all().some((e) => e.key === 'ev.uprising')).toBe(true);
    expect(world.log.all().some((e) => e.key === 'ev.uprisingCrushed')).toBe(true);
    expect(n.regimeChanges).toBe(0);
  });

  it('a polity reduced to nothing disperses rather than lingering at zero', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    const before = world.nations.nations.length;
    // Reduced to a handful of people on one patch of ground.
    n.population = 4;
    for (let i = 0; i < world.nations.claims.length; i++) {
      if (world.nations.claims[i] === n.id) world.nations.claims[i] = 0;
    }
    n.territory = 1;
    runPolitics(world, 5);
    expect(world.nations.nations.length).toBeLessThan(before);
    expect(world.log.all().some((e) => e.key === 'ev.nationDissolved')).toBe(true);
  });
});

describe('laws', () => {
  it('cost what they say they cost and do what they say they do', () => {
    for (const law of Object.values(LAWS)) {
      expect(law.upkeep).toBeGreaterThanOrEqual(0);
      expect(law.income).toBeGreaterThan(0);
      expect(law.growth).toBeGreaterThan(0);
      expect(law.levy).toBeGreaterThan(0);
    }
  });

  it('a calming law genuinely calms, over the same span', () => {
    const measure = (withLaw: boolean): number => {
      const world = buildTestWorld(makeTestConfig({ seedText: 'lawtest' }));
      const n = world.nations.nations.find((x) => !x.isPlayer)!;
      // Badly governed, but not so badly that unrest is pinned at its
      // ceiling in both runs and the law has nowhere to show.
      n.unrest = 0.2;
      n.taxRate = 0.3;
      n.leader.cruelty = 0.9; // stop the ruler easing the tax instead
      n.leader.competence = 0.3;
      if (withLaw) n.laws.add('landReform');
      runPolitics(world, 400);
      return n.unrest;
    };
    expect(measure(true)).toBeLessThan(measure(false));
  });
});

describe('the record', () => {
  it('survives a save with its rulers and borders intact', () => {
    const world = buildTestWorld();
    runPolitics(world, 60 * 20);
    const before = world.nations.nations.map(
      (n) => `${n.name}:${n.government}:${n.leader.name}:${n.territory}`,
    );
    const claims = Array.from(world.nations.claims);

    const other = buildTestWorld();
    other.nations.restore(structuredClone(world.nations.serialize()));
    expect(
      other.nations.nations.map((n) => `${n.name}:${n.government}:${n.leader.name}:${n.territory}`),
    ).toEqual(before);
    expect(Array.from(other.nations.claims)).toEqual(claims);
  });

  it('refuses nonsense from a save file', () => {
    const world = buildTestWorld();
    world.nations.restore({
      nations: [
        {
          id: 3,
          name: 'x'.repeat(500),
          government: 'space empire',
          isPlayer: false,
          x: 1e9,
          z: -1e9,
          population: -50,
          territory: 1e9,
          stability: 9,
          unrest: -4,
          legitimacy: 12,
          taxRate: 40,
          treasury: Infinity,
          army: -3,
          laws: ['mind control', 'tolerance'],
          leader: { name: 42, age: 9000, competence: 5, cameBy: 'alien mandate' },
        },
      ],
      claims: [1, 2, 3],
    });
    const n = world.nations.nations[0];
    expect(n.name.length).toBeLessThanOrEqual(80);
    expect(n.government).toBe('chiefdom');
    expect(n.x).toBeLessThanOrEqual(world.terrain.worldSize);
    expect(n.population).toBeGreaterThanOrEqual(0);
    expect(n.stability).toBeLessThanOrEqual(1);
    expect(n.unrest).toBeGreaterThanOrEqual(0);
    expect(n.taxRate).toBeLessThanOrEqual(0.6);
    expect(Number.isFinite(n.treasury)).toBe(true);
    expect(n.army).toBeGreaterThanOrEqual(0);
    expect([...n.laws]).toEqual(['tolerance']);
    expect(typeof n.leader.name).toBe('string');
    expect(n.leader.age).toBeLessThanOrEqual(140);
    expect(n.leader.cameBy).toBe('founding');
    // A claims array of the wrong length is ignored rather than half-applied.
    expect(world.nations.claims.length).toBe(world.nations.cells ** 2);
  });
});

describe('civil war', () => {
  /** A government that has lost its people but not yet its army. */
  function contested(n: Nation): void {
    n.taxRate = 0.55;
    n.leader.cruelty = 0.95;
    n.leader.competence = 1;
    n.unrest = 0.95;
    // High enough that the government is still worth fighting for, low enough
    // that the rising has crossed the threshold: an evenly matched quarrel.
    n.legitimacy = 0.7;
    n.stability = 0.05;
    n.population = 800;
    n.army = 800 * 0.06;
    n.lastRegimeChangeDay = -99999;
  }

  it('splits the country in two when the sides are evenly matched', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    contested(n);

    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runPolitics(world, 5);
      if (!n.inCivilWar) contested(n);
    }
    expect(n.inCivilWar).toBe(true);

    // The faction is a polity of its own, fighting the country it came from.
    const rebels = world.nations.nations.find((x) => x.rebelAgainst === n.id);
    expect(rebels).toBeDefined();
    expect(rebels!.population).toBeGreaterThan(0);
    expect(rebels!.army).toBeGreaterThan(0);
    expect(world.diplomacy.atWar(rebels!.id, n.id)).not.toBeNull();
    expect(world.log.all().some((e) => e.key === 'ev.civilWar')).toBe(true);
  });

  it('takes some of the government’s own soldiers with it', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    contested(n);
    n.legitimacy = 0.1; // almost nobody believes in it
    const before = n.army;

    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runPolitics(world, 5);
      if (!n.inCivilWar) {
        contested(n);
        n.legitimacy = 0.1;
      }
    }
    expect(n.inCivilWar).toBe(true);
    expect(n.army).toBeLessThan(before);
  });

  it('ends with one country again, and no faction left over', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    contested(n);
    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runPolitics(world, 5);
      if (!n.inCivilWar) contested(n);
    }
    expect(n.inCivilWar).toBe(true);
    // Follow this particular faction. The country may well fight itself again
    // later, so the flag alone is not what is being claimed here.
    const rebels = world.nations.nations.find((x) => x.rebelAgainst === n.id)!;
    const government = n.government;

    let settled = false;
    for (let i = 0; i < 600 && !settled; i++) {
      runPolitics(world, 5);
      settled = !world.nations.nations.some((x) => x.id === rebels.id);
    }

    expect(settled).toBe(true);
    expect(world.diplomacy.wars.some((w) => w.attacker === rebels.id)).toBe(false);
    // Won or lost, it is settled, and the country is one country again.
    const won = world.log.all().some((e) => e.key === 'ev.civilWarWon');
    const lost = world.log.all().some((e) => e.key === 'ev.civilWarLost');
    expect(won || lost).toBe(true);
    if (won) expect(n.government).not.toBe(government);
  });

  it('leaves no faction stranded if the war stops some other way', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    contested(n);
    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runPolitics(world, 5);
      if (!n.inCivilWar) contested(n);
    }
    const rebels = world.nations.nations.find((x) => x.rebelAgainst === n.id)!;

    // Tear the war out from under them, as a conquest of the parent would.
    const war = world.diplomacy.atWar(rebels.id, n.id)!;
    world.diplomacy.wars.splice(world.diplomacy.wars.indexOf(war), 1);

    runPolitics(world, 5);
    expect(world.nations.nations.some((x) => x.id === rebels.id)).toBe(false);
    expect(n.inCivilWar).toBe(false);
  });

  it('a faction is never invaded by a foreign power as though it were a country', () => {
    const world = buildTestWorld();
    const n = world.nations.nations.find((x) => !x.isPlayer)!;
    contested(n);
    for (let i = 0; i < 500 && !n.inCivilWar; i++) {
      runPolitics(world, 5);
      if (!n.inCivilWar) contested(n);
    }
    const rebels = world.nations.nations.find((x) => x.rebelAgainst === n.id)!;
    for (let i = 0; i < 60; i++) runPolitics(world, 5);

    for (const w of world.diplomacy.wars) {
      if (w.attacker !== rebels.id && w.defender !== rebels.id) continue;
      // The only war a faction is in is its own.
      expect(w.goal).toBe('independence');
    }
  });
});
