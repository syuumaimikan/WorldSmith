/**
 * Polities: who claims what, who rules, and how long they last.
 *
 * The player's settlement is simulated person by person. The rest of the world
 * is not — there are other peoples out there, and they are run at the scale
 * they matter at: a population, a territory, a treasury, a leader and the
 * pressures acting on all four. That is a deliberate choice, not a shortcut.
 * Simulating every farmer in a distant kingdom would cost a great deal and
 * change nothing the player can see.
 *
 * What is not abstracted is consequence. Taxes come out of real production and
 * go into a real treasury that real things are paid for from. Unrest is what
 * you get when people are taxed, hungry and ignored, and when it outruns the
 * legitimacy of whoever is in charge, the regime does not survive it. Nothing
 * here is on a timer.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import { Terrain } from '../world/Terrain';
import { Biome } from '../world/types';
import type { Namer } from './Naming';
import type { World } from './World';

export type Government =
  | 'chiefdom'
  | 'monarchy'
  | 'republic'
  | 'theocracy'
  | 'oligarchy'
  | 'confederation';

/** How the next ruler is chosen, which is most of what a government is. */
const SUCCESSION: Record<Government, 'heir' | 'election' | 'council' | 'ordination'> = {
  chiefdom: 'council',
  monarchy: 'heir',
  republic: 'election',
  theocracy: 'ordination',
  oligarchy: 'council',
  confederation: 'election',
};

/** What each way of governing is good and bad at. */
interface GovernmentTraits {
  /** How readily people accept its right to rule, before anything else. */
  baseLegitimacy: number;
  /** How much of what is produced it can actually collect. */
  taxReach: number;
  /** How much unrest it suppresses, and how much resentment that breeds. */
  repression: number;
  /** How fast it can act — high means decisive, and brittle. */
  decisiveness: number;
}

export const GOVERNMENTS: Record<Government, GovernmentTraits> = {
  chiefdom: { baseLegitimacy: 0.55, taxReach: 0.3, repression: 0.2, decisiveness: 0.7 },
  monarchy: { baseLegitimacy: 0.7, taxReach: 0.6, repression: 0.45, decisiveness: 0.8 },
  republic: { baseLegitimacy: 0.75, taxReach: 0.7, repression: 0.15, decisiveness: 0.4 },
  theocracy: { baseLegitimacy: 0.8, taxReach: 0.55, repression: 0.5, decisiveness: 0.6 },
  oligarchy: { baseLegitimacy: 0.45, taxReach: 0.75, repression: 0.4, decisiveness: 0.6 },
  confederation: { baseLegitimacy: 0.6, taxReach: 0.35, repression: 0.1, decisiveness: 0.3 },
};

export type LawId =
  | 'conscription'
  | 'grainReserve'
  | 'landReform'
  | 'tolerance'
  | 'tollRoads'
  | 'guildCharter';

export interface LawDef {
  id: LawId;
  /** Treasury cost per year of holding it, as a share of income. */
  upkeep: number;
  /** What it does to unrest each year. Negative calms. */
  unrest: number;
  /** Multiplier on what the treasury takes in. */
  income: number;
  /** Multiplier on how fast the population grows. */
  growth: number;
  /** Multiplier on how many soldiers can be raised. */
  levy: number;
}

export const LAWS: Record<LawId, LawDef> = {
  conscription: { id: 'conscription', upkeep: 0.05, unrest: 0.06, income: 1, growth: 0.94, levy: 1.8 },
  grainReserve: { id: 'grainReserve', upkeep: 0.12, unrest: -0.07, income: 0.95, growth: 1.05, levy: 1 },
  landReform: { id: 'landReform', upkeep: 0.08, unrest: -0.1, income: 0.9, growth: 1.1, levy: 1 },
  tolerance: { id: 'tolerance', upkeep: 0, unrest: -0.05, income: 1.04, growth: 1.02, levy: 1 },
  tollRoads: { id: 'tollRoads', upkeep: 0.02, unrest: 0.04, income: 1.18, growth: 0.98, levy: 1 },
  guildCharter: { id: 'guildCharter', upkeep: 0.04, unrest: -0.02, income: 1.12, growth: 1, levy: 0.95 },
};

export interface Leader {
  name: string;
  /** Day they came to power. */
  since: number;
  age: number;
  /** 0..1 each. They shape what the nation does, not just how it reads. */
  competence: number;
  ambition: number;
  cruelty: number;
  piety: number;
  /** How they came to power, for the chronicle. */
  cameBy: 'inheritance' | 'election' | 'ordination' | 'council' | 'founding' | 'force';
}

export interface Nation {
  id: number;
  name: string;
  government: Government;
  leader: Leader;
  /** True for the polity the player's settlement belongs to. */
  isPlayer: boolean;
  /** Capital, in world metres. */
  x: number;
  z: number;
  foundedDay: number;

  population: number;
  /** Claimed cells; the count is kept alongside so it is not recounted. */
  territory: number;

  /** 0..1. Below about a fifth, the nation cannot hold itself together. */
  stability: number;
  /** 0..1. What people will do about how they are governed. */
  unrest: number;
  /** 0..1. Whether this regime is felt to have the right to rule. */
  legitimacy: number;
  /** Share of production taken, 0..0.6. */
  taxRate: number;
  treasury: number;
  /** Fighting strength currently under arms. */
  army: number;

  laws: Set<LawId>;
  /**
   * The polity this one broke away from, if it is a rebel faction rather than
   * a country. A faction that wins becomes the government it was fighting.
   */
  rebelAgainst: number;
  /** How many times this polity has been overthrown. */
  regimeChanges: number;
  /** Day the last overthrow happened, so a new regime gets time to settle. */
  lastRegimeChangeDay: number;
  /** Set while a rebellion is actually being fought. */
  inCivilWar: boolean;
}

/** Cells across the map for territorial claims. Coarser than terrain, finer than plates. */
const CLAIM_CELLS = 48;

/** More than this and the map is a patchwork nobody can read or care about. */
const MAX_NATIONS = 9;

/** People a cell of average land will feed. */
const PEOPLE_PER_CELL = 26;

/**
 * Game days a new regime is given before it can be overthrown in turn. Even a
 * hated government gets a few years: people who have just risen do not rise
 * again next month.
 */
const HONEYMOON_DAYS = 900;

/** Game hours between nation updates. Polities move at the pace of seasons. */
const STEP_HOURS = 24;

export class NationSystem {
  readonly nations: Nation[] = [];
  /** Which nation claims each cell, or 0 for unclaimed. */
  readonly claims: Uint8Array;
  readonly cells = CLAIM_CELLS;
  readonly cellSize: number;

  private rng: Rng;
  private terrain: Terrain;
  private namer: Namer;
  private nextId = 1;
  private pending = 0;
  /** How far the player's settlement currently reaches, in metres. */
  private playerReach = 70;

  constructor(terrain: Terrain, seed: number, namer: Namer) {
    this.terrain = terrain;
    this.namer = namer;
    this.rng = new Rng(seed ^ 0x4e01);
    this.cellSize = terrain.worldSize / CLAIM_CELLS;
    this.claims = new Uint8Array(CLAIM_CELLS * CLAIM_CELLS);
  }

  // =======================================================================
  // Founding
  // =======================================================================

  /** The player's people become a polity in their own right. */
  foundPlayerNation(world: World): Nation {
    const centre = world.settlement.centre;
    const nation = this.makeNation(
      world.config.name,
      centre.x,
      centre.z,
      'chiefdom',
      world.time.totalDays,
      true,
    );
    nation.population = world.npcs.length;
    this.nations.push(nation);

    // The settlers are physically standing here. In an old world somebody may
    // already call this ground theirs, and the settlers put their tents up on
    // it regardless -- which is a thing the people who held it will notice.
    const displaced = this.claimAround(nation, 2, true);
    for (const [id, cells] of displaced) {
      const loser = this.byId(id);
      if (!loser) continue;
      world.diplomacy.relation(nation.id, loser.id).opinion -= 6 + cells * 3;
      world.log.add(world.time, 'settlement', 'ev.settledOnClaim', { nation: loser.name }, {
        notable: true,
        x: centre.x,
        z: centre.z,
      });
    }
    return nation;
  }

  /**
   * A new people comes into being.
   *
   * Empty habitable land does not stay empty for four hundred years. When
   * there is room on the map and nobody standing on it, somebody eventually
   * is: a band that drifted out of a crowded neighbour, a valley that stopped
   * answering to anyone. Without this a long world only ever loses countries,
   * and a thousand years of it ends in one survivor by arithmetic.
   */
  private considerNewPeoples(world: World, days: number): void {
    if (this.nations.length >= MAX_NATIONS) return;

    // How much of the map is land nobody claims.
    let free = 0;
    let land = 0;
    for (let i = 0; i < this.claims.length; i++) {
      const cx = i % CLAIM_CELLS;
      const cz = Math.floor(i / CLAIM_CELLS);
      if (!this.landCell(cx, cz)) continue;
      land++;
      if (this.claims[i] === 0) free++;
    }
    if (land === 0) return;
    const openness = free / land;
    if (openness < 0.25) return;

    // Rare: about once a century when half the map is still open.
    if (!this.rng.chance(clamp01(days * 0.00006 * (openness - 0.2) * 4))) return;

    const t = this.terrain;
    const minGap = t.worldSize * 0.18;
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = this.rng.range(t.worldSize * 0.05, t.worldSize * 0.95);
      const z = this.rng.range(t.worldSize * 0.05, t.worldSize * 0.95);
      if (!this.habitable(x, z)) continue;
      const cell = this.cellIndexAt(x, z);
      if (cell < 0 || this.claims[cell] !== 0) continue;
      if (this.nations.some((n) => Math.hypot(n.x - x, n.z - z) < minGap)) continue;

      const nation = this.makeNation(
        this.namer.nationName(`${this.nextId}:${Math.round(world.time.totalDays)}`),
        x,
        z,
        this.rng.pick<Government>(['chiefdom', 'chiefdom', 'monarchy', 'confederation']),
        world.time.totalDays,
        false,
      );
      nation.population = this.rng.int(30, 90);
      nation.treasury = nation.population * this.rng.range(0.2, 0.8);
      this.nations.push(nation);
      this.claimAround(nation, 2);
      world.log.add(world.time, 'settlement', 'ev.nationFounded', { name: nation.name }, {
        notable: true,
        x,
        z,
      });
      return;
    }
  }

  /**
   * Places the other peoples of the world.
   *
   * They go where a people would actually settle — fertile, level, watered
   * ground, well away from each other and from the player — rather than at
   * random points, because a kingdom in the middle of a glacier is a kingdom
   * nobody believes in.
   */
  seedForeignNations(world: World, count: number): void {
    const t = this.terrain;
    const minGap = t.worldSize * 0.22;
    const taken: { x: number; z: number }[] = [
      { x: world.settlement.centre.x, z: world.settlement.centre.z },
    ];

    let attempts = 0;
    while (this.nations.filter((n) => !n.isPlayer).length < count && attempts++ < 900) {
      const x = this.rng.range(t.worldSize * 0.05, t.worldSize * 0.95);
      const z = this.rng.range(t.worldSize * 0.05, t.worldSize * 0.95);
      if (!this.habitable(x, z)) continue;
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) continue;

      const government = this.rng.pick<Government>([
        'chiefdom',
        'monarchy',
        'monarchy',
        'republic',
        'theocracy',
        'oligarchy',
        'confederation',
      ]);
      const nation = this.makeNation(
        this.namer.nationName(this.nextId),
        x,
        z,
        government,
        0,
        false,
      );
      // An older world has older neighbours, already grown.
      nation.population = this.rng.int(40, 400);
      nation.treasury = nation.population * this.rng.range(0.4, 2.2);
      this.nations.push(nation);
      this.claimAround(nation, 2 + Math.floor(nation.population / 120));
      taken.push({ x, z });
    }
  }

  private habitable(x: number, z: number): boolean {
    const t = this.terrain;
    const i = t.index(t.tileX(x), t.tileZ(z));
    if (t.waterHeight[i] > t.data.height[i]) return false;
    const biome = t.data.biome[i] as Biome;
    if (biome === Biome.Ocean || biome === Biome.Lake || biome === Biome.Alpine) return false;
    if (t.data.slope[i] > 0.28) return false;
    return t.data.fertility[i] > 0.28;
  }

  private makeNation(
    name: string,
    x: number,
    z: number,
    government: Government,
    day: number,
    isPlayer: boolean,
  ): Nation {
    const traits = GOVERNMENTS[government];
    return {
      id: this.nextId++,
      name,
      government,
      leader: this.makeLeader(day, 'founding'),
      isPlayer,
      x,
      z,
      foundedDay: day,
      population: 1,
      territory: 0,
      stability: 0.7,
      unrest: 0.08,
      legitimacy: traits.baseLegitimacy,
      taxRate: isPlayer ? 0.05 : this.rng.range(0.08, 0.3),
      treasury: 0,
      army: 0,
      laws: new Set<LawId>(),
      rebelAgainst: 0,
      regimeChanges: 0,
      lastRegimeChangeDay: day,
      inCivilWar: false,
    };
  }

  private makeLeader(day: number, cameBy: Leader['cameBy']): Leader {
    return {
      name: this.namer.personName(`leader${this.nextId}:${day}:${this.rng.int(0, 1e6)}`),
      since: day,
      age: this.rng.int(24, 58),
      competence: clamp01(this.rng.stat(0.5, 0.2, 0, 1)),
      ambition: clamp01(this.rng.stat(0.5, 0.25, 0, 1)),
      cruelty: clamp01(this.rng.stat(0.4, 0.25, 0, 1)),
      piety: clamp01(this.rng.stat(0.5, 0.25, 0, 1)),
      cameBy,
    };
  }

  // =======================================================================
  // Territory
  // =======================================================================

  cellIndexAt(x: number, z: number): number {
    const cx = clamp(Math.floor(x / this.cellSize), 0, CLAIM_CELLS - 1);
    const cz = clamp(Math.floor(z / this.cellSize), 0, CLAIM_CELLS - 1);
    return cz * CLAIM_CELLS + cx;
  }

  nationAt(x: number, z: number): Nation | null {
    const id = this.claims[this.cellIndexAt(x, z)];
    return id === 0 ? null : (this.nations.find((n) => n.id === id) ?? null);
  }

  /** Claims out to a radius in cells, skipping water and other people's land. */
  /**
   * Claims the cells around a capital. With `take`, ground somebody else holds
   * is taken as well; the return value says who lost how much of it.
   */
  private claimAround(
    nation: Nation,
    radiusCells: number,
    take = false,
  ): Map<number, number> {
    const lost = new Map<number, number>();
    const cx = clamp(Math.floor(nation.x / this.cellSize), 0, CLAIM_CELLS - 1);
    const cz = clamp(Math.floor(nation.z / this.cellSize), 0, CLAIM_CELLS - 1);
    for (let dz = -radiusCells; dz <= radiusCells; dz++) {
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        if (Math.hypot(dx, dz) > radiusCells) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= CLAIM_CELLS || z >= CLAIM_CELLS) continue;
        const i = z * CLAIM_CELLS + x;
        if (!this.landCell(x, z)) continue;

        const held = this.claims[i];
        if (held !== 0) {
          if (!take) continue;
          const owner = this.byId(held);
          if (owner) {
            owner.territory = Math.max(0, owner.territory - 1);
            lost.set(held, (lost.get(held) ?? 0) + 1);
          }
        }
        this.claims[i] = nation.id;
        nation.territory++;
      }
    }
    return lost;
  }

  /**
   * Nobody claims open water; a border stops at the shore.
   *
   * A cell counts as land if any of it is land, rather than if the exact
   * point at its centre happens to be dry. On a ragged coast -- which is to
   * say, on a coast -- a cell can be half a headland and still have sea at
   * the middle of it, and reading only the centre left seaside peoples
   * holding no ground at all.
   */
  private landCell(cx: number, cz: number): boolean {
    const t = this.terrain;
    for (const [ox, oz] of [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ]) {
      const wx = (cx + ox) * this.cellSize;
      const wz = (cz + oz) * this.cellSize;
      const i = t.index(t.tileX(wx), t.tileZ(wz));
      if (t.waterHeight[i] <= t.data.height[i]) return true;
    }
    return false;
  }

  /**
   * Borders creep. A nation with more people than its land supports pushes
   * outward; one that is falling apart lets the edges go.
   */
  private adjustBorders(world: World, nation: Nation, days: number): void {
    // A faction in the field claims nothing. It is fighting for the country
    // it is already standing in.
    if (nation.rebelAgainst !== 0) return;
    if (nation.isPlayer) {
      // A settlement claims the ground it has spread over. Borders follow the
      // buildings, not an abstract appetite for land.
      this.claimAround(nation, Math.max(2, Math.round(this.playerReach / this.cellSize)));
      return;
    }
    const crowded = nation.population > this.carryingCapacity(world, nation) * 0.8;
    // Land is only lost by a state that is genuinely coming apart, and even
    // then slowly: borders move at the pace of a generation, not a season.
    // Land is only given up when there is more of it than there are people to
    // hold it. A failing state falls back on its core; it does not abandon the
    // fields it is living off, which would only make the failure worse.
    const overExtended = nation.territory > nation.population / PEOPLE_PER_CELL + 1;
    const failing =
      nation.stability < 0.18 &&
      overExtended &&
      nation.territory > 1 &&
      this.rng.chance(0.01 * days);

    if (failing) {
      // Give up the cell furthest from the capital: the edges go first.
      let worst = -1;
      let worstD = -1;
      for (let i = 0; i < this.claims.length; i++) {
        if (this.claims[i] !== nation.id) continue;
        const cx = i % CLAIM_CELLS;
        const cz = Math.floor(i / CLAIM_CELLS);
        const d = Math.hypot(
          (cx + 0.5) * this.cellSize - nation.x,
          (cz + 0.5) * this.cellSize - nation.z,
        );
        if (d > worstD) {
          worstD = d;
          worst = i;
        }
      }
      if (worst >= 0) {
        this.claims[worst] = 0;
        nation.territory--;
      }
      return;
    }

    if (!crowded || nation.stability < 0.35) return;
    if (!this.rng.chance(0.08 * days)) return;
    // Take one unclaimed cell adjacent to something already held.
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] !== nation.id) continue;
      const cx = i % CLAIM_CELLS;
      const cz = Math.floor(i / CLAIM_CELLS);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CLAIM_CELLS || nz >= CLAIM_CELLS) continue;
        const j = nz * CLAIM_CELLS + nx;
        if (this.claims[j] !== 0) continue;
        if (!this.landCell(nx, nz)) continue;
        this.claims[j] = nation.id;
        nation.territory++;
        return;
      }
    }
  }

  // =======================================================================
  // The year turning
  // =======================================================================

  update(world: World, hours: number): void {
    if (this.nations.length === 0) return;
    this.pending += hours;
    if (this.pending < STEP_HOURS) return;
    const days = this.pending / 24;
    this.pending = 0;

    for (const nation of [...this.nations]) {
      this.updateNation(world, nation, days);
    }
    this.considerNewPeoples(world, days);
  }

  private updateNation(world: World, nation: Nation, days: number): void {
    const traits = GOVERNMENTS[nation.government];

    // --- who is in charge -------------------------------------------------
    nation.leader.age += days / 60;
    if (nation.leader.age > 62 && this.rng.chance(clamp01((nation.leader.age - 62) * 0.004 * days))) {
      this.succeed(world, nation, 'death');
    }

    // --- people -----------------------------------------------------------
    const lawGrowth = this.lawProduct(nation, 'growth');
    if (nation.isPlayer) {
      // The player's population is the people actually standing in the world.
      nation.population = world.npcs.length;
      this.playerReach = world.settlement.radius;
    } else {
      // Logistic: growth slows as the land fills and reverses once it is
      // overfull. Without the reversal a nation grows for ever on land that
      // cannot feed it, which is the commonest way a simulation like this
      // stops meaning anything.
      const room = this.carryingCapacity(world, nation);
      const crowding = nation.population / room;
      let rate = 0.0065 * (1 - crowding) * lawGrowth;
      // Unrest holds growth back, but it must not hold a decline back: a land
      // that cannot feed its people does not feed them better for being angry.
      if (rate > 0) rate *= 1 - nation.unrest * 0.6;
      nation.population = Math.max(1, nation.population * (1 + rate * days));
    }

    // --- governing --------------------------------------------------------
    if (!nation.isPlayer) this.decideTaxes(nation, days);

    // --- money ------------------------------------------------------------
    const production = this.productionOf(world, nation);
    const collected =
      production * nation.taxRate * traits.taxReach * this.lawProduct(nation, 'income');
    let upkeep = 0;
    for (const id of nation.laws) upkeep += LAWS[id].upkeep;
    // A state spends: on its officials, its roads, its temples and its own
    // comfort. What it can actually hold is a few years of its own income, and
    // the rest goes back out into the world it was taken from.
    const income = collected - collected * upkeep - nation.army * 0.02;
    const hoardCap = Math.max(50, collected * 600);
    nation.treasury += income * days;
    if (nation.treasury > hoardCap) {
      nation.treasury -= (nation.treasury - hoardCap) * clamp01(days * 0.02);
    }
    if (nation.treasury < 0) {
      // A nation that cannot pay its soldiers does not keep them.
      nation.army = Math.max(0, nation.army - nation.army * 0.08 * days);
      nation.treasury = Math.max(nation.treasury, -nation.population * 0.5);
    }

    // --- how people feel about it ----------------------------------------
    let unrestDelta = 0;
    // Tax beyond what people think fair is the commonest cause of trouble.
    unrestDelta += Math.max(0, nation.taxRate - 0.12) * 0.9;
    // Hunger is the other.
    if (nation.isPlayer) {
      const hungry = world.npcs.filter((n) => n.needs.hunger < 35).length;
      unrestDelta += (world.npcs.length > 0 ? hungry / world.npcs.length : 0) * 0.5;
      if (world.famineSeverity > 0) unrestDelta += world.famineSeverity * 0.4;
    } else {
      // Judged against the same carrying capacity that governs growth. Two
      // different ideas of how full the land is would leave a nation at once
      // exactly at capacity and permanently overcrowded.
      const room = this.carryingCapacity(world, nation);
      unrestDelta += clamp01(nation.population / room - 0.9) * 0.4;
    }
    for (const id of nation.laws) unrestDelta += LAWS[id].unrest;
    // A capable, generous ruler is worth a great deal; a cruel one is not.
    unrestDelta -= nation.leader.competence * 0.12;
    unrestDelta += nation.leader.cruelty * 0.08;
    // Repression buys quiet now and legitimacy later.
    const suppressed = Math.min(unrestDelta, traits.repression * 0.12);
    if (suppressed > 0) {
      unrestDelta -= suppressed;
      nation.legitimacy = clamp01(nation.legitimacy - suppressed * 0.4 * days * 0.02);
    }
    // Prosperity and peace wear unrest down on their own.
    unrestDelta -= 0.05;

    nation.unrest = clamp01(nation.unrest + unrestDelta * days * 0.02);

    // Legitimacy is a judgement on how people are governed, not on the state
    // of the ledger: a small, poor, contented place is perfectly legitimate.
    // A government can only ever command the belief its form of rule supports.
    // A chiefdom that has gone well for fifty years is still a chiefdom, and
    // is questioned in a way an anointed throne is not. Letting legitimacy
    // climb to certainty would make every settled nation unoverthrowable.
    const floor = traits.baseLegitimacy * 0.45;
    const ceiling = Math.min(1, traits.baseLegitimacy + 0.2);
    const doingWell = nation.unrest < 0.3;
    const drift = doingWell ? 0.0016 * (0.4 + nation.leader.competence) : -0.0012;
    nation.legitimacy = clamp(nation.legitimacy + drift * days, floor, ceiling);

    // --- whether it holds together ---------------------------------------
    const target = clamp01(
      0.25 +
        nation.legitimacy * 0.5 -
        nation.unrest * 0.85 +
        (nation.treasury > 0 ? 0.12 : -0.15) -
        (nation.inCivilWar ? 0.3 : 0),
    );
    nation.stability += (target - nation.stability) * clamp01(days * 0.08);

    // --- the army ---------------------------------------------------------
    const levyCap = nation.population * 0.06 * this.lawProduct(nation, 'levy');
    if (nation.army < levyCap && nation.treasury > nation.army * 0.5) {
      nation.army = Math.min(levyCap, nation.army + Math.max(0.2, levyCap * 0.05) * days);
    }

    // A faction whose war has stopped — because it was settled elsewhere, or
    // because the government it was fighting no longer exists — has nothing
    // left to be. Without this it would linger as a country that is not one.
    if (nation.rebelAgainst !== 0) {
      const parent = this.byId(nation.rebelAgainst);
      if (!parent || !world.diplomacy.atWar(nation.id, parent.id)) {
        this.settleCivilWar(world, nation, false);
        return;
      }
    }

    this.adjustBorders(world, nation, days);

    // A polity reduced to a handful of people on one patch of ground is not a
    // polity any more. Rather than leave it twitching at zero for ever, it
    // disperses, and its land goes back to being nobody's.
    if (!nation.isPlayer && nation.rebelAgainst === 0 && nation.population < 40 && nation.territory <= 2) {
      this.dissolve(world, nation);
    }

    // --- and whether the regime survives ----------------------------------
    // No timer: a government falls when unrest has genuinely outrun the belief
    // that it has any right to rule.
    const sinceChange = world.time.totalDays - nation.lastRegimeChangeDay;
    if (
      sinceChange > HONEYMOON_DAYS &&
      // Not an absolute level of anger, but anger measured against how much
      // right to rule this government is held to have.
      nation.unrest > nation.legitimacy * 0.85 &&
      nation.stability < 0.3
    ) {
      // Even at its worst this is a small chance per day: a rising is the work
      // of years of grievance, and most years of grievance pass without one.
      if (this.rng.chance(clamp01((nation.unrest - nation.legitimacy * 0.85) * 0.02 * days))) {
        this.revolt(world, nation);
      }
    }
  }

  /**
   * How many people this nation's land will support. Measured against the
   * actual fertility of what it holds, so a kingdom of marsh and mountain is
   * poorer than one of the same size on good bottom land.
   */
  /**
   * How many people this nation's land will feed. What a people know how to do
   * with land is most of the answer: the same valley that supports a thousand
   * with stone tools supports nearly twice that once they can work iron.
   */
  private carryingCapacity(world: World, nation: Nation): number {
    let quality = 0;
    const t = this.terrain;
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] !== nation.id) continue;
      const cx = i % CLAIM_CELLS;
      const cz = Math.floor(i / CLAIM_CELLS);
      const ti = t.index(
        t.tileX((cx + 0.5) * this.cellSize),
        t.tileZ((cz + 0.5) * this.cellSize),
      );
      quality += 0.35 + t.data.fertility[ti];
    }
    return Math.max(24, quality * PEOPLE_PER_CELL * world.technology.eraOf(world, nation).carrying);
  }

  /**
   * What a government does about the state it is in.
   *
   * A ruler facing a resentful people and a full treasury lowers the levy; one
   * facing an empty treasury raises it and takes the consequences. An ambitious
   * ruler taxes harder to pay for an army. Without this a nation simply holds
   * whatever rate it was founded with until the day it is overthrown, which is
   * not how any government has ever behaved.
   */
  private decideTaxes(nation: Nation, days: number): void {
    const leader = nation.leader;
    let target = nation.taxRate;

    if (nation.treasury < 0) {
      // Nothing concentrates a government's mind like being unable to pay.
      target += 0.05;
    } else if (nation.unrest > 0.4) {
      // Buy peace, by as much as the ruler is capable of seeing the need.
      target -= 0.03 * (0.3 + leader.competence);
    } else if (nation.unrest < 0.15 && leader.ambition > 0.55) {
      // Quiet people and an ambitious ruler: there is an army to pay for.
      target += 0.015 * leader.ambition;
    }

    // A cruel ruler will push people further before easing off.
    const ceiling = 0.18 + leader.cruelty * 0.3;
    target = clamp(target, 0.01, ceiling);
    // Rates move at the pace of a decree, not a slider.
    nation.taxRate += (target - nation.taxRate) * clamp01(days * 0.03);
  }

  /**
   * Hands land from one nation to another at the point where they meet.
   *
   * A peace treaty does not teleport a province across the map: what changes
   * hands is the ground the winner's army was standing on, which is the
   * border cells nearest to them.
   */
  transferBorderland(from: Nation, to: Nation, cells: number): number {
    const candidates: { index: number; distance: number }[] = [];
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] !== from.id) continue;
      const cx = i % CLAIM_CELLS;
      const cz = Math.floor(i / CLAIM_CELLS);
      const wx = (cx + 0.5) * this.cellSize;
      const wz = (cz + 0.5) * this.cellSize;
      candidates.push({ index: i, distance: Math.hypot(wx - to.x, wz - to.z) });
    }
    // Nearest to the taker first, and never the capital itself.
    candidates.sort((a, b) => a.distance - b.distance);
    const capital = this.cellIndexAt(from.x, from.z);

    let moved = 0;
    for (const c of candidates) {
      if (moved >= cells) break;
      if (c.index === capital) continue;
      if (from.territory <= 1) break;
      this.claims[c.index] = to.id;
      from.territory--;
      to.territory++;
      moved++;
    }
    return moved;
  }

  /** The people scatter, and what they held reverts to no one. */
  private dissolve(world: World, nation: Nation): void {
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] === nation.id) this.claims[i] = 0;
    }
    const at = this.nations.indexOf(nation);
    if (at >= 0) this.nations.splice(at, 1);
    world.log.add(world.time, 'settlement', 'ev.nationDissolved', { name: nation.name }, {
      notable: true,
      x: nation.x,
      z: nation.z,
    });
  }

  /** What a nation's land and people produce in a day, in abstract units. */
  private productionOf(world: World, nation: Nation): number {
    if (nation.isPlayer) {
      // Real goods, really made: whatever the workshops turned out.
      return world.economy.dailyOutput(world.research.effects.trade);
    }
    // Elsewhere, what the land and the people it supports would yield, for
    // whatever they presently know how to do with either.
    const land = nation.territory;
    const era = world.technology.eraOf(world, nation);
    return (nation.population * 0.08 + land * 0.35) * era.production;
  }

  private lawProduct(nation: Nation, field: 'income' | 'growth' | 'levy'): number {
    let v = 1;
    for (const id of nation.laws) v *= LAWS[id][field];
    return v;
  }

  // =======================================================================
  // Regime change
  // =======================================================================

  /** The ruler is gone and somebody has to follow them. */
  succeed(world: World, nation: Nation, reason: 'death' | 'deposed' | 'abdication'): void {
    const previous = nation.leader;
    const method = SUCCESSION[nation.government];
    const cameBy: Leader['cameBy'] =
      reason === 'deposed'
        ? 'force'
        : method === 'heir'
          ? 'inheritance'
          : method === 'election'
            ? 'election'
            : method === 'ordination'
              ? 'ordination'
              : 'council';

    nation.leader = this.makeLeader(world.time.totalDays, cameBy);

    // An inherited throne is a gamble; an elected one tends to pick ability.
    if (cameBy === 'election' || cameBy === 'council') {
      nation.leader.competence = clamp01(nation.leader.competence * 0.6 + 0.4);
    }
    if (cameBy === 'inheritance') {
      nation.leader.competence = clamp01(this.rng.stat(0.45, 0.28, 0, 1));
    }

    // A contested succession costs legitimacy; an orderly one does not.
    if (reason === 'deposed') {
      nation.legitimacy = clamp01(nation.legitimacy * 0.5);
      nation.regimeChanges++;
      nation.lastRegimeChangeDay = world.time.totalDays;
    } else {
      nation.legitimacy = clamp01(nation.legitimacy * 0.88 + 0.06);
    }

    world.log.add(
      world.time,
      'settlement',
      reason === 'deposed' ? 'ev.leaderDeposed' : 'ev.leaderSucceeds',
      { nation: nation.name, name: nation.leader.name, previous: previous.name },
      { notable: true, x: nation.x, z: nation.z },
    );
  }

  /**
   * What happens when a people will no longer be governed this way.
   *
   * The outcome is not drawn from a hat. A decisive government with an army
   * puts it down and pays for that in legitimacy; a weak one is swept away and
   * what replaces it depends on who did the sweeping.
   */
  private revolt(world: World, nation: Nation): void {
    const traits = GOVERNMENTS[nation.government];
    // What matters is not how many soldiers there are but how many there are
    // for the number of people rising: an army of eighty is decisive in a town
    // and irrelevant in a kingdom.
    // An ordinary levy is about a sixteenth of the people; an army several
    // times that size is decisive, and must be allowed to be, or no rising
    // could ever simply be put down.
    const levied = nation.army / Math.max(1, nation.population * 0.06);
    const regimeStrength =
      Math.min(2.2, levied) * 0.55 + traits.decisiveness * 0.35 + nation.leader.competence * 0.25;
    const rebelStrength = nation.unrest * 1.1 + (1 - nation.legitimacy) * 0.7;

    world.log.add(world.time, 'settlement', 'ev.uprising', { nation: nation.name }, {
      notable: true,
      x: nation.x,
      z: nation.z,
    });

    // When the two sides are within reach of each other, it is not settled by
    // comparing them. It is settled by fighting, which takes years and which
    // either side can lose.
    const ratio = regimeStrength / Math.max(0.01, rebelStrength);
    if (ratio > 0.7 && ratio < 1.45 && !nation.inCivilWar) {
      this.startCivilWar(world, nation);
      return;
    }

    if (regimeStrength > rebelStrength) {
      // Put down. Quiet now, resented for a long time.
      nation.unrest = clamp01(nation.unrest * 0.4);
      nation.legitimacy = clamp01(nation.legitimacy - 0.18);
      nation.army = Math.max(0, nation.army * 0.85);
      nation.population = Math.max(1, nation.population * 0.97);
      nation.lastRegimeChangeDay = world.time.totalDays;
      world.log.add(world.time, 'settlement', 'ev.uprisingCrushed', { nation: nation.name }, {
        notable: true,
        x: nation.x,
        z: nation.z,
      });
      return;
    }

    // The regime falls. What replaces it depends on what it was.
    const before = nation.government;
    nation.government = this.successorGovernment(nation);
    nation.unrest = clamp01(nation.unrest * 0.35);
    nation.legitimacy = GOVERNMENTS[nation.government].baseLegitimacy * 0.8;
    nation.taxRate = clamp(nation.taxRate * 0.6, 0.02, 0.6);
    nation.population = Math.max(1, nation.population * 0.94);
    nation.army = Math.max(0, nation.army * 0.6);
    // succeed() records the change itself; counting it here as well would
    // double every revolution in the history books.
    this.succeed(world, nation, 'deposed');

    world.log.add(
      world.time,
      'settlement',
      'ev.revolution',
      { nation: nation.name, from: `gov.${before}`, to: `gov.${nation.government}` },
      { notable: true, x: nation.x, z: nation.z },
    );
  }

  /**
   * The country splits in two and fights itself.
   *
   * The rebels become a polity of their own with no land and an army raised
   * from the people who rose: they are not a special case in the war system
   * but an ordinary participant in it, so the fighting, the marching, the
   * supply and the exhaustion all work exactly as they do between countries.
   */
  private startCivilWar(world: World, nation: Nation): void {
    const rebels = this.makeNation(
      this.namer.nationName(`rebels${nation.id}:${world.time.totalDays}`),
      nation.x,
      nation.z,
      this.successorGovernment(nation),
      world.time.totalDays,
      false,
    );
    rebels.rebelAgainst = nation.id;
    // Those who rose are a share of the people, and they are angry. A rising
    // is not a levy: a far greater share of those who join it fight, because
    // fighting is the whole reason they joined.
    rebels.population = Math.max(10, nation.population * nation.unrest * 0.4);
    rebels.army = rebels.population * 0.3;

    // And some of the government's own soldiers go over. How many depends on
    // how little right to rule the government is felt to have, which is why a
    // regime nobody believes in cannot rely on its army to save it.
    const defecting = nation.army * clamp01(1 - nation.legitimacy) * 0.5;
    nation.army = Math.max(0, nation.army - defecting);
    rebels.army += defecting;
    rebels.unrest = 0.1;
    rebels.legitimacy = 1 - nation.legitimacy;
    rebels.stability = 0.5;
    rebels.treasury = 0;
    this.nations.push(rebels);

    nation.inCivilWar = true;
    // The state loses the people who left it.
    nation.population = Math.max(1, nation.population - rebels.population);

    world.diplomacy.declareWar(world, rebels, nation, 'independence');
    world.log.add(world.time, 'settlement', 'ev.civilWar', {
      nation: nation.name,
      faction: rebels.name,
    }, { notable: true, x: nation.x, z: nation.z });
  }

  /**
   * A civil war has ended. Either the rebels are the government now, or they
   * are nothing, and either way the country is one country again.
   */
  settleCivilWar(world: World, rebels: Nation, rebelsWon: boolean): void {
    const state = this.byId(rebels.rebelAgainst);
    if (state) {
      state.inCivilWar = false;
      // Whoever won, the country has just fought itself. It gets the same
      // breathing space a revolution gets before it can happen again.
      state.lastRegimeChangeDay = world.time.totalDays;
      // The people come back either way; they have nowhere else to be.
      state.population += rebels.population;

      if (rebelsWon) {
        state.government = rebels.government;
        state.legitimacy = GOVERNMENTS[state.government].baseLegitimacy * 0.85;
        state.unrest = clamp01(state.unrest * 0.3);
        state.taxRate = clamp(state.taxRate * 0.6, 0.02, 0.6);
        state.army += rebels.army;
        this.succeed(world, state, 'deposed');
        world.log.add(world.time, 'settlement', 'ev.civilWarWon', {
          nation: state.name,
          faction: rebels.name,
        }, { notable: true, x: state.x, z: state.z });
      } else {
        state.unrest = clamp01(state.unrest * 0.25);
        state.legitimacy = clamp01(state.legitimacy - 0.1);
        world.log.add(world.time, 'settlement', 'ev.civilWarLost', {
          nation: state.name,
          faction: rebels.name,
        }, { notable: true, x: state.x, z: state.z });
      }
    }

    // The faction itself ceases to exist either way.
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] === rebels.id) this.claims[i] = state ? state.id : 0;
    }
    const at = this.nations.indexOf(rebels);
    if (at >= 0) this.nations.splice(at, 1);
  }

  /** Who ends up in charge follows from who was in charge before. */
  private successorGovernment(nation: Nation): Government {
    switch (nation.government) {
      case 'monarchy':
        // A toppled crown gives way to whoever organised the toppling.
        return this.rng.chance(0.55) ? 'republic' : 'oligarchy';
      case 'theocracy':
        return this.rng.chance(0.5) ? 'monarchy' : 'republic';
      case 'oligarchy':
        return this.rng.chance(0.6) ? 'republic' : 'monarchy';
      case 'republic':
        // A republic that fails usually fails into one strong man.
        return this.rng.chance(0.65) ? 'monarchy' : 'oligarchy';
      case 'confederation':
        return 'republic';
      default:
        return this.rng.chance(0.5) ? 'monarchy' : 'republic';
    }
  }

  // =======================================================================
  // Readouts
  // =======================================================================

  get playerNation(): Nation | null {
    return this.nations.find((n) => n.isPlayer) ?? null;
  }

  byId(id: number): Nation | null {
    return this.nations.find((n) => n.id === id) ?? null;
  }

  /** Nations whose land touches this one's. Neighbours are who you deal with. */
  neighboursOf(nation: Nation): Nation[] {
    const found = new Set<number>();
    for (let i = 0; i < this.claims.length; i++) {
      if (this.claims[i] !== nation.id) continue;
      const cx = i % CLAIM_CELLS;
      const cz = Math.floor(i / CLAIM_CELLS);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CLAIM_CELLS || nz >= CLAIM_CELLS) continue;
        const other = this.claims[nz * CLAIM_CELLS + nx];
        if (other !== 0 && other !== nation.id) found.add(other);
      }
    }
    return [...found].map((id) => this.byId(id)).filter((n): n is Nation => n !== null);
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return {
      claims: Array.from(this.claims),
      nations: this.nations.map((n) => ({
        ...n,
        laws: [...n.laws],
        leader: { ...n.leader },
      })),
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    this.nations.length = 0;

    if (Array.isArray(data.nations)) {
      const governments = Object.keys(GOVERNMENTS) as Government[];
      const lawIds = Object.keys(LAWS) as LawId[];
      for (const raw of data.nations as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        const num = (v: unknown, fallback: number): number =>
          typeof v === 'number' && Number.isFinite(v) ? v : fallback;
        const government = governments.includes(raw.government as Government)
          ? (raw.government as Government)
          : 'chiefdom';
        const rawLeader = (raw.leader ?? {}) as Record<string, unknown>;
        const cameBy = rawLeader.cameBy;
        this.nations.push({
          id: Math.max(1, Math.round(num(raw.id, this.nextId))),
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Unnamed',
          government,
          isPlayer: raw.isPlayer === true,
          x: clamp(num(raw.x, 0), 0, this.terrain.worldSize),
          z: clamp(num(raw.z, 0), 0, this.terrain.worldSize),
          foundedDay: Math.max(0, num(raw.foundedDay, 0)),
          population: clamp(num(raw.population, 1), 0, 1e7),
          territory: clamp(num(raw.territory, 0), 0, CLAIM_CELLS * CLAIM_CELLS),
          stability: clamp01(num(raw.stability, 0.6)),
          unrest: clamp01(num(raw.unrest, 0.1)),
          legitimacy: clamp01(num(raw.legitimacy, 0.6)),
          taxRate: clamp(num(raw.taxRate, 0.1), 0, 0.6),
          treasury: clamp(num(raw.treasury, 0), -1e7, 1e9),
          army: clamp(num(raw.army, 0), 0, 1e6),
          rebelAgainst: Math.max(0, Math.round(num(raw.rebelAgainst, 0))),
          laws: new Set(
            (Array.isArray(raw.laws) ? raw.laws : []).filter((l: unknown): l is LawId =>
              lawIds.includes(l as LawId),
            ),
          ),
          regimeChanges: Math.max(0, Math.round(num(raw.regimeChanges, 0))),
          lastRegimeChangeDay: Math.max(0, num(raw.lastRegimeChangeDay, 0)),
          inCivilWar: raw.inCivilWar === true,
          leader: {
            name: typeof rawLeader.name === 'string' ? rawLeader.name.slice(0, 64) : 'Unknown',
            since: Math.max(0, num(rawLeader.since, 0)),
            age: clamp(num(rawLeader.age, 40), 0, 140),
            competence: clamp01(num(rawLeader.competence, 0.5)),
            ambition: clamp01(num(rawLeader.ambition, 0.5)),
            cruelty: clamp01(num(rawLeader.cruelty, 0.4)),
            piety: clamp01(num(rawLeader.piety, 0.5)),
            cameBy:
              cameBy === 'inheritance' ||
              cameBy === 'election' ||
              cameBy === 'ordination' ||
              cameBy === 'council' ||
              cameBy === 'founding' ||
              cameBy === 'force'
                ? cameBy
                : 'founding',
          },
        });
      }
      for (const n of this.nations) this.nextId = Math.max(this.nextId, n.id + 1);
    }

    if (Array.isArray(data.claims) && data.claims.length === this.claims.length) {
      const valid = new Set(this.nations.map((n) => n.id));
      for (let i = 0; i < this.claims.length; i++) {
        const v = data.claims[i];
        this.claims[i] = typeof v === 'number' && valid.has(v) ? v : 0;
      }
    }
  }
}
