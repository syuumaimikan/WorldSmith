/**
 * Sickness.
 *
 * An outbreak is not a status effect applied to a settlement. One person
 * catches something, and it passes from them to whoever they stand near, at a
 * rate that depends on how crowded the place is, how well fed and rested
 * people are, and whether there is clean water and a clinic. Most people
 * recover and are then immune; some do not. A disease burns itself out when it
 * runs out of people who can still catch it, which is why a big settlement
 * loses more people to the same illness than a small one.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import type { World } from './World';
import type { Npc } from './Npc';

export type DiseaseStage = 'incubating' | 'ill' | 'recovering';

export interface Infection {
  npcId: number;
  stage: DiseaseStage;
  /** Game hours left in the current stage. */
  hoursLeft: number;
  /** 0..1 how hard this person has it. */
  severity: number;
}

export interface Outbreak {
  id: number;
  name: string;
  /** Day it was first noticed. */
  startedDay: number;
  /** 0..1 base transmissibility. */
  contagion: number;
  /** 0..1 chance a severe case kills without care. */
  lethality: number;
  infections: Map<number, Infection>;
  /** Everyone who has had it and lived. */
  immune: Set<number>;
  deaths: number;
  recoveries: number;
  /** Set once it has no live cases left. */
  over: boolean;
}

/** How close two people must be for it to pass between them, in metres. */
const CONTACT_RANGE = 3.2;

export class DiseaseSystem {
  readonly outbreaks: Outbreak[] = [];
  private rng: Rng;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xd15e);
  }

  get activeCases(): number {
    let n = 0;
    for (const o of this.outbreaks) if (!o.over) n += o.infections.size;
    return n;
  }

  get liveOutbreak(): Outbreak | null {
    return this.outbreaks.find((o) => !o.over) ?? null;
  }

  /** Starts an outbreak in one person. It spreads from there or it does not. */
  begin(world: World, x: number, z: number, severity: number): Outbreak | null {
    if (this.liveOutbreak) return null;
    const patient = nearestHealthy(world, x, z, null);
    if (!patient) return null;

    const outbreak: Outbreak = {
      id: this.nextId++,
      name: world.namer.featureName('region', `plague${this.nextId}`),
      startedDay: world.time.totalDays,
      contagion: 0.25 + severity * 0.5,
      lethality: 0.05 + severity * 0.25,
      infections: new Map(),
      immune: new Set(),
      deaths: 0,
      recoveries: 0,
      over: false,
    };
    this.infect(outbreak, patient, severity);
    this.outbreaks.push(outbreak);

    world.log.add(world.time, 'disaster', 'ev.outbreak', { name: outbreak.name }, {
      notable: true,
      x: patient.x,
      z: patient.z,
    });
    return outbreak;
  }

  update(world: World, hours: number): void {
    if (hours <= 0) return;
    for (const o of this.outbreaks) {
      if (o.over) continue;
      this.advance(world, o, hours);
      this.spread(world, o, hours);
      if (o.infections.size === 0) {
        o.over = true;
        world.log.add(
          world.time,
          'settlement',
          'ev.outbreakEnds',
          { name: o.name, deaths: o.deaths, recovered: o.recoveries },
          { notable: true },
        );
      }
    }
    // Keep the record, drop the machinery.
    while (this.outbreaks.length > 24) this.outbreaks.shift();
  }

  /** Whether this person is currently ill enough that it shows. */
  isIll(npcId: number): boolean {
    for (const o of this.outbreaks) {
      const inf = o.infections.get(npcId);
      if (inf && inf.stage === 'ill') return true;
    }
    return false;
  }

  private infect(outbreak: Outbreak, npc: Npc, severity: number): void {
    if (outbreak.infections.has(npc.id) || outbreak.immune.has(npc.id)) return;
    outbreak.infections.set(npc.id, {
      npcId: npc.id,
      stage: 'incubating',
      hoursLeft: this.rng.range(12, 48),
      // Someone already weak takes it harder.
      severity: clamp01(severity * (1.4 - npc.condition / 140)),
    });
  }

  /** Moves each case through its course, and settles who lives. */
  private advance(world: World, o: Outbreak, hours: number): void {
    for (const inf of [...o.infections.values()]) {
      const npc = world.npcById.get(inf.npcId);
      if (!npc) {
        o.infections.delete(inf.npcId);
        continue;
      }

      inf.hoursLeft -= hours;
      if (inf.stage === 'ill') {
        // Being ill costs health, and being hungry or cold makes it worse.
        const strain = inf.severity * (npc.needs.hunger < 40 ? 1.7 : 1);
        // Illness presses on the body rather than draining a number. It is
        // what the sickness is doing right now, so it eases when the fever
        // breaks instead of leaving a permanent dent.
        npc.body.sickness = clamp01(Math.max(npc.body.sickness, strain * 0.75));
        npc.needs.comfort = clamp(npc.needs.comfort - hours * 1.2, 0, 100);
      }
      if (inf.hoursLeft > 0) continue;

      if (inf.stage === 'incubating') {
        inf.stage = 'ill';
        inf.hoursLeft = this.rng.range(40, 130);
        continue;
      }

      if (inf.stage === 'ill') {
        // Care matters: a clinic and a full belly are most of survival.
        const care = world.careQuality(npc);
        const odds = o.lethality * inf.severity * (1 - care * 0.7);
        if (npc.condition < 12 || this.rng.chance(odds)) {
          o.deaths++;
          o.infections.delete(inf.npcId);
          world.killNpc(npc, 'ev.diedOfIllness', { name: npc.name, illness: o.name });
          continue;
        }
        inf.stage = 'recovering';
        inf.hoursLeft = this.rng.range(24, 72);
        continue;
      }

      // Recovered, and now immune to this one.
      o.infections.delete(inf.npcId);
      o.immune.add(inf.npcId);
      o.recoveries++;
      npc.body.sickness = 0;
    }
  }

  /** Passes it to whoever has been standing close to someone infectious. */
  private spread(world: World, o: Outbreak, hours: number): void {
    const carriers: Npc[] = [];
    for (const inf of o.infections.values()) {
      if (inf.stage === 'recovering') continue;
      const npc = world.npcById.get(inf.npcId);
      if (npc) carriers.push(npc);
    }
    if (carriers.length === 0) return;

    // Clean water and a healer slow it down for everyone.
    const sanitation = world.sanitationQuality();
    const rate = o.contagion * (1 - sanitation * 0.55);

    for (const carrier of carriers) {
      world.npcGrid.forEachNear(carrier.x, carrier.z, CONTACT_RANGE, (other) => {
        if (other.id === carrier.id) return;
        if (o.infections.has(other.id) || o.immune.has(other.id)) return;
        if (Math.hypot(other.x - carrier.x, other.z - carrier.z) > CONTACT_RANGE) return;
        // Someone run down catches it more easily.
        const frailty = 1 + clamp01((70 - other.condition) / 70) * 0.8;
        if (!this.rng.chance(clamp01(rate * frailty * hours * 0.35))) return;
        this.infect(o, other, o.contagion);
      });
    }
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return {
      outbreaks: this.outbreaks.map((o) => ({
        id: o.id,
        name: o.name,
        startedDay: o.startedDay,
        contagion: o.contagion,
        lethality: o.lethality,
        deaths: o.deaths,
        recoveries: o.recoveries,
        over: o.over,
        immune: [...o.immune],
        infections: [...o.infections.values()].map((i) => ({ ...i })),
      })),
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    this.outbreaks.length = 0;
    if (!data || !Array.isArray(data.outbreaks)) return;
    const stages: DiseaseStage[] = ['incubating', 'ill', 'recovering'];
    for (const raw of data.outbreaks as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      const infections = new Map<number, Infection>();
      if (Array.isArray(raw.infections)) {
        for (const ri of raw.infections as Record<string, unknown>[]) {
          if (!ri || typeof ri.npcId !== 'number') continue;
          infections.set(ri.npcId, {
            npcId: ri.npcId,
            stage: stages.includes(ri.stage as DiseaseStage)
              ? (ri.stage as DiseaseStage)
              : 'incubating',
            hoursLeft: clamp(num(ri.hoursLeft, 24), 0, 5000),
            severity: clamp01(num(ri.severity, 0.4)),
          });
        }
      }
      this.outbreaks.push({
        id: this.nextId++,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : 'Sickness',
        startedDay: Math.max(0, num(raw.startedDay, 0)),
        contagion: clamp01(num(raw.contagion, 0.3)),
        lethality: clamp01(num(raw.lethality, 0.1)),
        infections,
        immune: new Set(
          (Array.isArray(raw.immune) ? raw.immune : []).filter(
            (v: unknown): v is number => typeof v === 'number',
          ),
        ),
        deaths: Math.max(0, num(raw.deaths, 0)),
        recoveries: Math.max(0, num(raw.recoveries, 0)),
        over: raw.over === true,
      });
    }
  }
}

function nearestHealthy(world: World, x: number, z: number, exclude: number | null): Npc | null {
  let best: Npc | null = null;
  let bestD = Infinity;
  for (const npc of world.npcs) {
    if (exclude !== null && npc.id === exclude) continue;
    const d = Math.hypot(npc.x - x, npc.z - z);
    if (d < bestD) {
      bestD = d;
      best = npc;
    }
  }
  return best;
}
