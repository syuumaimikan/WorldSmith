/**
 * How nations deal with each other, and what happens when dealing fails.
 *
 * Nobody declares war because a timer expired. A war needs a reason — a
 * border pressed up against a crowded neighbour, a rival claim, a leader whose
 * ambition outruns their judgement — and it needs a government that thinks it
 * can win. Both of those are read off the world as it is.
 *
 * Once it starts, an army is not a number that fights another number. It is a
 * body of people who have to march somewhere, who get weaker the further they
 * are from home, who fight where they meet and who have to sit outside a city
 * for a long time to take it. Wars end when one side has had enough of it,
 * which is what war exhaustion measures, and the peace that follows takes
 * something real from the loser.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import type { World } from './World';
import type { Nation } from './Nations';

export type Treaty = 'none' | 'nonAggression' | 'trade' | 'alliance';

export interface Relation {
  /** -100 hatred, +100 devotion. */
  opinion: number;
  treaty: Treaty;
  /** Game days left on a truce that forbids war. */
  truceDays: number;
  /** How many wars these two have fought. Memory is long. */
  wars: number;
}

export type WarGoal = 'border' | 'conquest' | 'tribute' | 'independence';

export interface War {
  id: number;
  attacker: number;
  defender: number;
  goal: WarGoal;
  startedDay: number;
  /** 0..1 each: how sick of it each side is. */
  attackerExhaustion: number;
  defenderExhaustion: number;
  /** -1 the defender is winning, +1 the attacker is. */
  warScore: number;
  battles: number;
}

export type ArmyStance = 'marching' | 'besieging' | 'defending' | 'returning';

export interface Army {
  id: number;
  nation: number;
  x: number;
  z: number;
  /** Fighting strength, in people. */
  strength: number;
  /**
   * 0..1. Falls the further an army is from its own land and rises when it is
   * on home ground. An unsupplied army melts away without a shot being fired.
   */
  supply: number;
  stance: ArmyStance;
  /** Where it is going, in world metres. */
  targetX: number;
  targetZ: number;
  /** Nation whose capital it is besieging, or 0. */
  besieging: number;
  /** Days spent in front of the walls. */
  siegeDays: number;
}

/** Game hours between diplomatic and military updates. */
const STEP_HOURS = 24;

/** Metres an army covers in a day. */
const MARCH_SPEED = 26;

/** Distance at which two hostile armies must fight. */
const ENGAGE_RANGE = 22;

export class DiplomacySystem {
  readonly wars: War[] = [];
  readonly armies: Army[] = [];
  /** Relations by "lowId:highId". */
  private relations = new Map<string, Relation>();

  private rng: Rng;
  private nextWarId = 1;
  private nextArmyId = 1;
  private pending = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xd1b0);
  }

  // =======================================================================
  // Relations
  // =======================================================================

  private key(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  relation(a: number, b: number): Relation {
    const k = this.key(a, b);
    let r = this.relations.get(k);
    if (!r) {
      r = { opinion: 0, treaty: 'none', truceDays: 0, wars: 0 };
      this.relations.set(k, r);
    }
    return r;
  }

  atWar(a: number, b: number): War | null {
    return (
      this.wars.find(
        (w) =>
          (w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a),
      ) ?? null
    );
  }

  warsOf(nationId: number): War[] {
    return this.wars.filter((w) => w.attacker === nationId || w.defender === nationId);
  }

  armiesOf(nationId: number): Army[] {
    return this.armies.filter((a) => a.nation === nationId);
  }

  // =======================================================================
  // The daily turn
  // =======================================================================

  update(world: World, hours: number): void {
    this.pending += hours;
    if (this.pending < STEP_HOURS) return;
    const days = this.pending / 24;
    this.pending = 0;

    const nations = world.nations.nations;
    if (nations.length < 2) return;

    this.driftOpinions(world, nations, days);
    this.considerWars(world, nations, days);
    this.moveArmies(world, days);
    this.resolveEngagements(world, days);
    this.considerPeace(world, days);
  }

  /**
   * What neighbours come to think of each other.
   *
   * Sharing a border is the single biggest factor, and it cuts both ways: it
   * is how trade happens and it is what there is to argue about. A crowded
   * neighbour is a frightening one.
   */
  private driftOpinions(world: World, nations: Nation[], days: number): void {
    for (let i = 0; i < nations.length; i++) {
      for (let j = i + 1; j < nations.length; j++) {
        const a = nations[i];
        const b = nations[j];
        const r = this.relation(a.id, b.id);

        if (r.truceDays > 0) r.truceDays = Math.max(0, r.truceDays - days);
        if (this.atWar(a.id, b.id)) {
          r.opinion = clamp(r.opinion - 1.2 * days, -100, 100);
          continue;
        }

        let drift = 0;
        // Time heals. Opinions return toward indifference on their own.
        drift += (0 - r.opinion) * 0.004;
        // Neighbours who are not fighting are trading, whether or not anyone
        // has signed anything. Without this nothing could ever warm enough to
        // sign a treaty, and nothing but treaties could warm it — which would
        // leave every nation in the world a permanent stranger to every other.
        if (r.truceDays <= 0) drift += 0.07;
        if (r.treaty === 'trade') drift += 0.12;
        if (r.treaty === 'alliance') drift += 0.2;
        if (r.treaty === 'nonAggression') drift += 0.05;
        // Two peoples governed the same way understand each other better.
        if (a.government === b.government) drift += 0.04;
        // A neighbour who has been at war with you before is not forgotten.
        drift -= r.wars * 0.03;
        // An ambitious neighbour with an army is watched uneasily.
        const threat = (n: Nation): number => n.leader.ambition * clamp01(n.army / 120);
        drift -= (threat(a) + threat(b)) * 0.06;

        r.opinion = clamp(r.opinion + drift * days, -100, 100);

        // Treaties follow from how people already feel, not the other way.
        this.considerTreaty(world, a, b, r, days);
      }
    }
  }

  private considerTreaty(world: World, a: Nation, b: Nation, r: Relation, days: number): void {
    if (this.atWar(a.id, b.id)) return;
    const chance = clamp01(0.01 * days);
    if (!this.rng.chance(chance)) return;

    // Trade needs the two to be close enough to actually carry goods between.
    const reachable = this.withinReach(world, a).some((n) => n.id === b.id);

    if (r.treaty === 'none' && r.opinion > 14 && reachable) {
      r.treaty = 'trade';
      this.announce(world, a, b, 'ev.treatyTrade');
    } else if (r.treaty === 'trade' && r.opinion > 32) {
      r.treaty = 'nonAggression';
      this.announce(world, a, b, 'ev.treatyNonAggression');
    } else if (r.treaty === 'nonAggression' && r.opinion > 48) {
      r.treaty = 'alliance';
      this.announce(world, a, b, 'ev.treatyAlliance');
    } else if (r.treaty !== 'none' && r.opinion < -10) {
      r.treaty = 'none';
      this.announce(world, a, b, 'ev.treatyBroken');
    }
  }

  private announce(world: World, a: Nation, b: Nation, key: string): void {
    world.log.add(world.time, 'settlement', key, { a: a.name, b: b.name }, {
      notable: true,
      x: a.x,
      z: a.z,
    });
  }

  // =======================================================================
  // Going to war
  // =======================================================================

  private considerWars(world: World, nations: Nation[], days: number): void {
    for (const attacker of nations) {
      if (attacker.isPlayer) continue; // the player is not marched about by the AI
      if (attacker.inCivilWar) continue;
      if (this.warsOf(attacker.id).length > 0) continue;
      if (attacker.stability < 0.4) continue; // a shaky state cannot afford one

      for (const defender of this.withinReach(world, attacker)) {
        const r = this.relation(attacker.id, defender.id);
        if (r.truceDays > 0) continue;
        if (r.treaty === 'alliance' || r.treaty === 'nonAggression') continue;
        if (this.atWar(attacker.id, defender.id)) continue;

        // Nobody musters an army and marches it across the world for a hamlet.
        // A neighbour has to be worth the trouble before it is worth a war.
        if (defender.population < 25 && defender.treasury < 200) continue;
        // And a faction fighting its own government is somebody else's war.
        if (defender.rebelAgainst !== 0 || attacker.rebelAgainst !== 0) continue;

        const reason = this.casusBelli(attacker, defender, r);
        if (!reason) continue;

        // A government goes to war when it thinks it will win, and thinks so
        // more readily the more ambitious and less careful its ruler is.
        const balance = this.strengthOf(attacker) / Math.max(1, this.strengthOf(defender));
        const confidence =
          balance * (0.6 + attacker.leader.ambition * 0.8) * (1.4 - attacker.leader.competence * 0.4);
        if (confidence < 1.4) continue;

        const appetite = clamp01((confidence - 1.4) * 0.012 * days);
        if (!this.rng.chance(appetite)) continue;

        this.declareWar(world, attacker, defender, reason);
        break;
      }
    }
  }

  /**
   * Everyone an army could actually be marched to.
   *
   * Sharing a border is not the only way two peoples come into conflict — a
   * campaign a few weeks' march away is perfectly possible, and on a map with
   * unclaimed land between every pair of nations, requiring a shared border
   * would mean no nation ever fought anyone.
   */
  private withinReach(world: World, nation: Nation): Nation[] {
    const limit = world.terrain.worldSize * 0.4;
    return world.nations.nations.filter(
      (other) =>
        other.id !== nation.id && Math.hypot(other.x - nation.x, other.z - nation.z) <= limit,
    );
  }

  /** Whether there is anything to go to war about. */
  private casusBelli(
    attacker: Nation,
    defender: Nation,
    r: Relation,
  ): WarGoal | null {
    // Most wars are not started by hatred. They are started because somebody
    // needs something their neighbour has and thinks they can take it, and
    // hatred is what they arrive at afterwards. So opinion shapes how readily
    // a reason is found rather than being the reason itself.
    const friendly = r.opinion > 45;

    if (r.opinion < -35) return 'conquest';

    // A crowded nation looks at its neighbour's emptier land.
    const crowdedness = (n: Nation): number => n.population / Math.max(1, n.territory * 26);
    if (!friendly && crowdedness(attacker) > crowdedness(defender) * 1.2) return 'border';

    // A rich neighbour with a thin army invites a demand for tribute.
    if (!friendly && defender.treasury > attacker.treasury * 1.5 && defender.army < attacker.army * 0.7) {
      return 'tribute';
    }

    // And an ambitious ruler with a strong army does not need much of a reason.
    if (
      !friendly &&
      attacker.leader.ambition > 0.65 &&
      attacker.army > defender.army * 1.6 &&
      r.opinion < 25
    ) {
      return 'border';
    }
    return null;
  }

  /** What a nation can actually bring to a fight. */
  private strengthOf(nation: Nation): number {
    return nation.army * (0.7 + nation.leader.competence * 0.6) * (0.5 + nation.stability * 0.5);
  }

  declareWar(world: World, attacker: Nation, defender: Nation, goal: WarGoal): War {
    const war: War = {
      id: this.nextWarId++,
      attacker: attacker.id,
      defender: defender.id,
      goal,
      startedDay: world.time.totalDays,
      attackerExhaustion: 0,
      defenderExhaustion: 0,
      warScore: 0,
      battles: 0,
    };
    this.wars.push(war);

    const r = this.relation(attacker.id, defender.id);
    r.wars++;
    r.treaty = 'none';
    r.opinion = clamp(r.opinion - 40, -100, 100);

    // Both sides call up what they can.
    this.raiseArmy(attacker, defender.x, defender.z, 'marching');
    this.raiseArmy(defender, defender.x, defender.z, 'defending');

    world.log.add(
      world.time,
      'settlement',
      'ev.warDeclared',
      { attacker: attacker.name, defender: defender.name, goal: `wargoal.${goal}` },
      { notable: true, x: defender.x, z: defender.z },
    );
    return war;
  }

  /** Puts a field army into the world, taken out of the nation's levy. */
  private raiseArmy(
    nation: Nation,
    targetX: number,
    targetZ: number,
    stance: ArmyStance,
  ): Army | null {
    const strength = Math.floor(nation.army * 0.7);
    if (strength < 4) return null;
    nation.army -= strength;
    const army: Army = {
      id: this.nextArmyId++,
      nation: nation.id,
      x: nation.x,
      z: nation.z,
      strength,
      supply: 1,
      stance,
      targetX,
      targetZ,
      besieging: 0,
      siegeDays: 0,
    };
    this.armies.push(army);
    return army;
  }

  // =======================================================================
  // Marching
  // =======================================================================

  private moveArmies(world: World, days: number): void {
    for (let i = this.armies.length - 1; i >= 0; i--) {
      const army = this.armies[i];
      const nation = world.nations.byId(army.nation);
      if (!nation || army.strength <= 0) {
        this.disband(i);
        continue;
      }

      // Supply: an army on its own land is fed; one abroad lives off what it
      // can take, and that runs out.
      const here = world.nations.nationAt(army.x, army.z);
      // Rebels are at home: they are fighting in the country they live in, and
      // the countryside feeds them as readily as it feeds the government.
      const friendly =
        here?.id === army.nation || (here !== null && here.id === nation.rebelAgainst);
      army.supply = clamp01(army.supply + (friendly ? 0.08 : -0.045) * days);
      if (army.supply < 0.35) {
        // Hunger and desertion do what battles have not.
        const lost = army.strength * (0.35 - army.supply) * 0.5 * days;
        army.strength = Math.max(0, army.strength - lost);
      }

      if (army.stance === 'besieging') {
        this.pressSiege(world, army, days);
        continue;
      }
      if (army.stance === 'defending') continue;

      const dx = army.targetX - army.x;
      const dz = army.targetZ - army.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 6) {
        if (army.stance === 'returning') {
          // Home again: the men go back to their fields.
          nation.army += army.strength;
          this.disband(i);
          continue;
        }
        // Arrived at the enemy capital.
        const target = world.nations.nationAt(army.x, army.z);
        if (target && target.id !== army.nation && this.atWar(army.nation, target.id)) {
          army.stance = 'besieging';
          army.besieging = target.id;
          army.siegeDays = 0;
          world.log.add(world.time, 'settlement', 'ev.siegeBegins', {
            attacker: nation.name,
            defender: target.name,
          }, { notable: true, x: army.x, z: army.z });
        } else {
          army.stance = 'returning';
          army.targetX = nation.x;
          army.targetZ = nation.z;
        }
        continue;
      }

      const step = Math.min(dist, MARCH_SPEED * days * (0.5 + army.supply * 0.5));
      army.x += (dx / dist) * step;
      army.z += (dz / dist) * step;
    }
  }

  /** The army leaves the field, whether it went home or simply ceased to be. */
  private disband(index: number): void {
    this.armies.splice(index, 1);
  }

  /**
   * A siege is a matter of sitting there. Walls hold for a long time, and the
   * besieger is the one running out of food, which is why most sieges are
   * lifted rather than won.
   */
  private pressSiege(world: World, army: Army, days: number): void {
    const target = world.nations.byId(army.besieging);
    const attacker = world.nations.byId(army.nation);
    const war = target ? this.atWar(army.nation, target.id) : null;
    if (!target || !attacker || !war) {
      army.stance = 'returning';
      army.targetX = attacker?.x ?? army.x;
      army.targetZ = attacker?.z ?? army.z;
      return;
    }

    army.siegeDays += days;

    // If the place under siege is the one the player lives in, the siege is
    // not an abstraction. The army is standing on real ground, and it takes
    // and breaks real things.
    if (target.isPlayer) this.raidSettlement(world, army, days);
    // The city is squeezed: its people suffer and its ruler is blamed.
    target.unrest = clamp01(target.unrest + 0.004 * days);
    target.stability = clamp01(target.stability - 0.003 * days);
    war.warScore = clamp(war.warScore + 0.004 * days, -1, 1);
    war.defenderExhaustion = clamp01(war.defenderExhaustion + 0.006 * days);
    war.attackerExhaustion = clamp01(war.attackerExhaustion + 0.003 * days);

    // The garrison sallies out now and then.
    if (target.army > 4 && this.rng.chance(0.02 * days)) {
      const sally = target.army * 0.3;
      target.army -= sally;
      const losses = Math.min(army.strength, sally * this.rng.range(0.6, 1.4));
      army.strength -= losses;
      world.log.add(world.time, 'settlement', 'ev.sally', { defender: target.name }, {
        x: army.x,
        z: army.z,
      });
    }

    // Walls fall when the besieger has both the strength and the patience.
    const walls = 40 + target.population * 0.05;
    const pressure = army.strength * army.supply * army.siegeDays;
    if (pressure > walls * 18) {
      this.sack(world, army, target, war);
      return;
    }

    // Or the siege is given up.
    if (army.supply < 0.25 || army.strength < walls * 0.2) {
      army.stance = 'returning';
      army.besieging = 0;
      army.targetX = attacker.x;
      army.targetZ = attacker.z;
      world.log.add(world.time, 'settlement', 'ev.siegeLifted', { defender: target.name }, {
        notable: true,
        x: army.x,
        z: army.z,
      });
    }
  }

  /**
   * What an army outside the walls actually does to the settlement.
   *
   * It burns what it can reach, carries off what is stored, and terrifies
   * everyone. This is the whole point of the nation layer touching the
   * settlement layer: a war the player only reads about in a panel is not a
   * war that happened to them.
   */
  private raidSettlement(world: World, army: Army, days: number): void {
    const centre = world.settlement.centre;
    const reach = world.settlement.radius;
    const pressure = clamp01((army.strength / 60) * army.supply) * days;
    if (pressure <= 0) return;

    // Buildings on the edge are burned or broken first.
    for (const b of [...world.buildings]) {
      if (!b.complete) continue;
      const d = Math.hypot(b.worldX - centre.x, b.worldZ - centre.z);
      if (d > reach) continue;
      if (!this.rng.chance(clamp01(pressure * 0.06))) continue;
      world.damageBuilding(b, this.rng.range(0.1, 0.4));
      if (this.rng.chance(0.25)) world.ignite(b.worldX, b.worldZ, 0.6);
    }

    // Stores are emptied into the baggage train.
    for (const b of world.buildings) {
      if (!b.complete || b.inventory.isEmpty()) continue;
      if (Math.hypot(b.worldX - centre.x, b.worldZ - centre.z) > reach) continue;
      if (!this.rng.chance(clamp01(pressure * 0.12))) continue;
      const entry = b.inventory.summary()[0];
      if (!entry) continue;
      b.inventory.remove(entry.item, Math.ceil(entry.count * this.rng.range(0.2, 0.6)));
    }

    // And nobody sleeps.
    for (const npc of world.npcs) {
      if (Math.hypot(npc.x - army.x, npc.z - army.z) > reach) continue;
      if (!this.rng.chance(clamp01(pressure * 0.3))) continue;
      world.startleNpc(npc, army.x, army.z);
    }
  }

  private sack(world: World, army: Army, target: Nation, war: War): void {
    const attacker = world.nations.byId(army.nation)!;
    const taken = Math.min(target.treasury, target.treasury * 0.6);
    target.treasury -= taken;
    attacker.treasury += taken;
    target.population = Math.max(1, target.population * 0.88);
    target.unrest = clamp01(target.unrest + 0.25);
    target.legitimacy = clamp01(target.legitimacy - 0.2);
    war.warScore = clamp(war.warScore + 0.5, -1, 1);
    war.defenderExhaustion = clamp01(war.defenderExhaustion + 0.35);
    army.strength *= 0.9;
    army.stance = 'returning';
    army.besieging = 0;
    army.targetX = attacker.x;
    army.targetZ = attacker.z;

    world.log.add(world.time, 'settlement', 'ev.citySacked', {
      attacker: attacker.name,
      defender: target.name,
    }, { notable: true, x: target.x, z: target.z });
  }

  // =======================================================================
  // Battles
  // =======================================================================

  private resolveEngagements(world: World, days: number): void {
    for (let i = 0; i < this.armies.length; i++) {
      for (let j = i + 1; j < this.armies.length; j++) {
        const a = this.armies[i];
        const b = this.armies[j];
        if (a.nation === b.nation) continue;
        const war = this.atWar(a.nation, b.nation);
        if (!war) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > ENGAGE_RANGE) continue;
        this.fight(world, war, a, b, days);
      }
    }
  }

  /**
   * Two armies meet.
   *
   * Strength matters most, then supply, then whether the ground favours the
   * defender. Losses fall on both sides in proportion to how the fight went,
   * so even a won battle costs, which is what makes war exhausting.
   */
  private fight(world: World, war: War, a: Army, b: Army, days: number): void {
    const t = world.terrain;
    const power = (army: Army): number => {
      const nation = world.nations.byId(army.nation);
      const command = nation ? 0.7 + nation.leader.competence * 0.6 : 1;
      // High ground is worth having.
      const height = t.heightAt(army.x, army.z);
      return army.strength * (0.4 + army.supply * 0.6) * command * (1 + height * 0.004);
    };

    const pa = power(a);
    const pb = power(b);
    const total = pa + pb;
    if (total <= 0) return;

    // The loser loses more, but nobody walks away whole.
    const intensity = Math.min(1, days * 0.5);
    const aShare = pa / total;
    const aLoss = a.strength * (1 - aShare) * 0.5 * intensity;
    const bLoss = b.strength * aShare * 0.5 * intensity;
    a.strength = Math.max(0, a.strength - aLoss);
    b.strength = Math.max(0, b.strength - bLoss);

    const attackerIsA = war.attacker === a.nation;
    const swing = (aShare - 0.5) * 1.1 * intensity;
    war.warScore = clamp(war.warScore + (attackerIsA ? swing : -swing), -1, 1);
    war.attackerExhaustion = clamp01(war.attackerExhaustion + 0.03 * intensity);
    war.defenderExhaustion = clamp01(war.defenderExhaustion + 0.03 * intensity);
    war.battles++;

    if (war.battles % 3 === 1) {
      const winner = world.nations.byId(aShare > 0.5 ? a.nation : b.nation);
      world.log.add(world.time, 'settlement', 'ev.battle', { name: winner?.name ?? '?' }, {
        notable: true,
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
      });
    }
  }

  // =======================================================================
  // Peace
  // =======================================================================

  private considerPeace(world: World, days: number): void {
    for (let i = this.wars.length - 1; i >= 0; i--) {
      const war = this.wars[i];
      const attacker = world.nations.byId(war.attacker);
      const defender = world.nations.byId(war.defender);
      if (!attacker || !defender) {
        this.wars.splice(i, 1);
        continue;
      }

      // Both sides tire of it simply for its going on.
      war.attackerExhaustion = clamp01(war.attackerExhaustion + 0.002 * days);
      war.defenderExhaustion = clamp01(war.defenderExhaustion + 0.002 * days);

      // Having an army still in the field when the other side has none is the
      // plainest form of winning there is, and it tells in the terms.
      const attackerArmies = this.armiesOf(attacker.id).length;
      const defenderArmies = this.armiesOf(defender.id).length;
      if (attackerArmies > 0 && defenderArmies === 0) {
        war.warScore = clamp(war.warScore + 0.02 * days, -1, 1);
      } else if (defenderArmies > 0 && attackerArmies === 0) {
        war.warScore = clamp(war.warScore - 0.02 * days, -1, 1);
      }

      // A war wears on the people fighting it whether or not they are winning.
      attacker.unrest = clamp01(attacker.unrest + war.attackerExhaustion * 0.002 * days);
      defender.unrest = clamp01(defender.unrest + war.defenderExhaustion * 0.002 * days);

      const attackerDone = war.attackerExhaustion > 0.7 || attackerArmies === 0;
      const defenderDone = war.defenderExhaustion > 0.7 || defenderArmies === 0;
      const decided = Math.abs(war.warScore) > 0.75;

      if (!attackerDone && !defenderDone && !decided) continue;
      if (!this.rng.chance(clamp01(0.25 * days))) continue;

      this.makePeace(world, war, attacker, defender);
      this.wars.splice(i, 1);
    }
  }

  private makePeace(world: World, war: War, attacker: Nation, defender: Nation): void {
    // A war of independence does not end in a treaty. One side is the
    // government afterwards and the other does not exist.
    if (war.goal === 'independence' && attacker.rebelAgainst === defender.id) {
      world.nations.settleCivilWar(world, attacker, war.warScore > 0);
      return;
    }

    const r = this.relation(attacker.id, defender.id);
    r.truceDays = 600;
    r.opinion = clamp(r.opinion + 12, -100, 100);

    const score = war.warScore;
    let key = 'ev.peaceWhite';

    if (score > 0.35) {
      // The attacker got what it came for.
      if (war.goal === 'tribute' || war.goal === 'conquest') {
        const tribute = Math.max(0, defender.treasury * 0.4);
        defender.treasury -= tribute;
        attacker.treasury += tribute;
      }
      if (war.goal === 'border' || war.goal === 'conquest') {
        world.nations.transferBorderland(defender, attacker, Math.ceil(defender.territory * 0.2));
      }
      defender.legitimacy = clamp01(defender.legitimacy - 0.12);
      key = 'ev.peaceVictory';
    } else if (score < -0.35) {
      // The defender threw them back, and the attacker's government pays.
      attacker.legitimacy = clamp01(attacker.legitimacy - 0.18);
      attacker.unrest = clamp01(attacker.unrest + 0.15);
      key = 'ev.peaceDefeat';
    }

    // Everyone still in the field goes home.
    for (const army of this.armies) {
      if (army.nation !== attacker.id && army.nation !== defender.id) continue;
      const own = world.nations.byId(army.nation);
      army.stance = 'returning';
      army.besieging = 0;
      army.targetX = own?.x ?? army.x;
      army.targetZ = own?.z ?? army.z;
    }

    world.log.add(
      world.time,
      'settlement',
      key,
      { attacker: attacker.name, defender: defender.name },
      { notable: true, x: defender.x, z: defender.z },
    );
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return {
      wars: this.wars.map((w) => ({ ...w })),
      armies: this.armies.map((a) => ({ ...a })),
      relations: [...this.relations.entries()].map(([k, r]) => ({ k, ...r })),
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    this.wars.length = 0;
    this.armies.length = 0;
    this.relations.clear();

    const num = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    const goals: WarGoal[] = ['border', 'conquest', 'tribute', 'independence'];
    if (Array.isArray(data.wars)) {
      for (const raw of data.wars as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        if (!goals.includes(raw.goal as WarGoal)) continue;
        this.wars.push({
          id: this.nextWarId++,
          attacker: Math.round(num(raw.attacker, 0)),
          defender: Math.round(num(raw.defender, 0)),
          goal: raw.goal as WarGoal,
          startedDay: Math.max(0, num(raw.startedDay, 0)),
          attackerExhaustion: clamp01(num(raw.attackerExhaustion, 0)),
          defenderExhaustion: clamp01(num(raw.defenderExhaustion, 0)),
          warScore: clamp(num(raw.warScore, 0), -1, 1),
          battles: Math.max(0, Math.round(num(raw.battles, 0))),
        });
      }
    }

    const stances: ArmyStance[] = ['marching', 'besieging', 'defending', 'returning'];
    if (Array.isArray(data.armies)) {
      for (const raw of data.armies as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        this.armies.push({
          id: this.nextArmyId++,
          nation: Math.round(num(raw.nation, 0)),
          x: num(raw.x, 0),
          z: num(raw.z, 0),
          strength: clamp(num(raw.strength, 0), 0, 1e6),
          supply: clamp01(num(raw.supply, 1)),
          stance: stances.includes(raw.stance as ArmyStance)
            ? (raw.stance as ArmyStance)
            : 'returning',
          targetX: num(raw.targetX, 0),
          targetZ: num(raw.targetZ, 0),
          besieging: Math.max(0, Math.round(num(raw.besieging, 0))),
          siegeDays: Math.max(0, num(raw.siegeDays, 0)),
        });
      }
    }

    const treaties: Treaty[] = ['none', 'nonAggression', 'trade', 'alliance'];
    if (Array.isArray(data.relations)) {
      for (const raw of data.relations as Record<string, unknown>[]) {
        if (!raw || typeof raw.k !== 'string') continue;
        if (!/^\d+:\d+$/.test(raw.k)) continue;
        this.relations.set(raw.k, {
          opinion: clamp(num(raw.opinion, 0), -100, 100),
          treaty: treaties.includes(raw.treaty as Treaty) ? (raw.treaty as Treaty) : 'none',
          truceDays: Math.max(0, num(raw.truceDays, 0)),
          wars: Math.max(0, Math.round(num(raw.wars, 0))),
        });
      }
    }
  }
}
