/**
 * A settler.
 *
 * This file is deliberately data-only: needs, skills, relationships, current
 * task. All decision making lives in systems/NpcAI.ts so that the state a
 * person carries stays easy to read, serialise and inspect in the UI.
 */

import { Body } from './Body';
import { ItemId } from '../data/items';
import { ProfessionId, SkillId, ALL_SKILLS, levelFromXp, skillMultiplier } from '../data/professions';
import { Inventory } from './Inventory';
import { PathPoint } from './Navigation';
import { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';

export type NpcActivity =
  | 'idle'
  | 'walking'
  | 'hauling'
  | 'building'
  | 'chopping'
  | 'mining'
  | 'foraging'
  | 'farming'
  | 'planting'
  | 'crafting'
  | 'researching'
  | 'fishing'
  | 'hunting'
  | 'eating'
  | 'sleeping'
  | 'socialising'
  | 'resting'
  | 'demolishing';

export const ACTIVITY_LABELS: Record<NpcActivity, string> = {
  idle: 'Idle',
  walking: 'Walking',
  hauling: 'Hauling',
  building: 'Building',
  chopping: 'Felling timber',
  mining: 'Mining',
  foraging: 'Foraging',
  farming: 'Working the fields',
  planting: 'Planting',
  crafting: 'Crafting',
  researching: 'Studying',
  fishing: 'Fishing',
  hunting: 'Hunting',
  eating: 'Eating',
  sleeping: 'Sleeping',
  socialising: 'Talking',
  resting: 'Resting',
  demolishing: 'Demolishing',
};

export type TaskType =
  | 'none'
  | 'haul'
  | 'build'
  | 'repair'
  | 'demolish'
  | 'gather'
  | 'produce'
  | 'farm'
  | 'research'
  | 'eat'
  | 'sleep'
  | 'socialise'
  | 'wander'
  | 'flee'
  | 'deliver_carried';

export interface NpcTask {
  type: TaskType;
  /** Job board id, when this task came from the board. */
  jobId: number;
  /** Target entity: building, node, pile or person depending on task. */
  targetId: number;
  /** Sub-phase within multi-leg tasks (fetch then deliver). */
  phase: number;
  /** Destination in world space. */
  x: number;
  z: number;
  /** Accumulated work at the destination. */
  work: number;
  /** Ticks spent trying, so hopeless tasks get abandoned. */
  attempts: number;
  /** Extra payload, e.g. farm plot index. */
  index: number;
  /**
   * True for filler activities — wandering, chatting, opportunistic foraging.
   * A settler on an interruptible task periodically looks up to see whether
   * real work has appeared. Without this, six people who all wandered off to
   * pick berries will never notice that a building site is waiting for them.
   */
  interruptible: boolean;
}

export function emptyTask(): NpcTask {
  return {
    type: 'none', jobId: 0, targetId: 0, phase: 0, x: 0, z: 0,
    work: 0, attempts: 0, index: -1, interruptible: false,
  };
}

export interface NpcNeeds {
  /** 100 = full, 0 = starving. */
  hunger: number;
  /** 100 = rested, 0 = exhausted. */
  rest: number;
  social: number;
  comfort: number;
  /**
   * Deliberately absent: there is no health here any more. A person's state
   * is their body -- see `Npc.condition`, which reads it rather than storing
   * a number things can subtract from.
   */
  /** 0..100 general contentment, derived from the others. */
  mood: number;
}

export interface NpcMemory {
  day: number;
  text: string;
}

export const NPC_WALK_SPEED = 2.5;
export const NPC_CARRY_CAPACITY = 12;

export class Npc {
  readonly id: number;
  name: string;
  /** Years lived. A real number: people have birthdays on ordinary days. */
  age: number;
  /**
   * The age this person's body starts giving way around, drawn once when they
   * are born and theirs alone. Two people born the same spring do not die the
   * same year, and a settlement where everyone lasts exactly seventy empties
   * and fills in lurches.
   */
  lifespan: number;
  /** 0..1, how far the years have taken them. Slows work and dims health. */
  frailty = 0;
  /** Day they were born, or a negative number for the first settlers. */
  bornDay = -1;
  readonly seed: number;
  readonly rng: Rng;
  profession: ProfessionId = 'settler';

  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  speed = 0;

  homeId = 0;
  workplaceId = 0;

  readonly inventory = new Inventory(4, 70);
  /** The one tool this person carries, if any. */
  tool: ItemId | null = null;

  needs: NpcNeeds = { hunger: 82, rest: 88, social: 70, comfort: 60, mood: 70 };

  /**
   * Limbs, wounds, infection and what going without has done. Nothing writes
   * a health figure; things break specific parts of this, and what that adds
   * up to is read back out of it.
   */
  readonly body = new Body();

  /**
   * How badly off they are, 0..100. A readout of the body and of how hungry,
   * rested and old they are -- not a pool, and nothing assigns to it.
   */
  get condition(): number {
    const bodily = this.body.condition;
    const hungry = clamp01(this.needs.hunger / 100);
    const worn = 1 - this.frailty * 0.35;
    return Math.round(clamp(bodily * (0.55 + hungry * 0.45) * worn, 0, 100));
  }
  skillXp: Partial<Record<SkillId, number>> = {};

  path: PathPoint[] | null = null;
  pathIndex = 0;
  /** Ticks since the last path request, to rate-limit repathing. */
  repathCooldown = 0;
  /** Where the current path was headed, to detect when it is stale. */
  pathTargetX = 0;
  pathTargetZ = 0;
  stuckTimer = 0;

  task: NpcTask = emptyTask();
  /** Ticks until this settler next considers dropping a filler task. */
  reconsiderIn = 0;
  activity: NpcActivity = 'idle';
  /** Set when the character should play a work animation. */
  workAnim = false;

  money = 12;
  memories: NpcMemory[] = [];
  relationships = new Map<number, number>();
  /** Personal variation in when this person starts and ends their day. */
  scheduleOffset = 0;
  /** Hours the person has worked today, for fatigue. */
  hoursWorkedToday = 0;
  lastDayProcessed = -1;

  constructor(id: number, name: string, seed: number) {
    this.id = id;
    this.name = name;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.age = this.rng.int(17, 58);
    // Somebody who has already reached fifty-four evidently has a span of at
    // least fifty-four. Drawing the two independently would hand a share of
    // every settlement people who were born already past their time.
    this.lifespan = Math.max(
      this.age + this.rng.range(2, 34),
      this.rng.stat(68, 13, 34, 97),
    );
    this.scheduleOffset = this.rng.range(-1.1, 1.4);
    for (const s of ALL_SKILLS) this.skillXp[s] = 0;
  }

  skill(id: SkillId): number {
    return levelFromXp(this.skillXp[id] ?? 0);
  }

  /**
   * Work-rate multiplier for a skill, including tool and condition effects.
   *
   * @param known what the settlement has worked out, which is a multiplier on
   *   everything anybody does with their hands. Left out where the caller has
   *   no settlement to hand.
   */
  workRate(id: SkillId, toolBonus = 1, known = 1): number {
    const base = skillMultiplier(this.skill(id));
    const fatigue = 0.62 + clamp01(this.needs.rest / 100) * 0.38;
    const health = 0.55 + clamp01(this.condition / 100) * 0.45;
    const hands = 0.45 + this.body.dexterity * 0.55;
    // The old are slower. Not useless -- an old hand knows the work -- but
    // slower, and it is their own years that decide it rather than a number
    // that applies to everyone at sixty.
    const years = 1 - this.frailty * 0.45;
    return base * toolBonus * fatigue * health * hands * years * known;
  }

  addXp(id: SkillId, amount: number): void {
    this.skillXp[id] = (this.skillXp[id] ?? 0) + amount;
  }

  remember(day: number, text: string): void {
    this.memories.push({ day, text });
    if (this.memories.length > 14) this.memories.shift();
  }

  adjustRelationship(otherId: number, delta: number): void {
    const cur = this.relationships.get(otherId) ?? 0;
    this.relationships.set(otherId, Math.max(-100, Math.min(100, cur + delta)));
  }

  /** What this person is carrying, as data. The i18n layer makes it a phrase. */
  carrying(): { item: ItemId; count: number }[] {
    return this.inventory.summary().map((st) => ({ item: st.item, count: st.count }));
  }

  isCarrying(): boolean {
    return !this.inventory.isEmpty();
  }

  clearPath(): void {
    this.path = null;
    this.pathIndex = 0;
  }

  setTask(type: TaskType, opts: Partial<NpcTask> = {}): void {
    this.task = { ...emptyTask(), type, ...opts };
    this.clearPath();
  }

  clearTask(): void {
    this.task = emptyTask();
    this.clearPath();
    this.workAnim = false;
  }

  /** 0..1 overall wellbeing, used by the settlement mood readout. */
  updateMood(): void {
    const n = this.needs;
    const raw =
      n.hunger * 0.32 + n.rest * 0.24 + n.social * 0.14 + n.comfort * 0.16 + this.condition * 0.14;
    this.needs.mood = raw;
  }

  moodLabel(): string {
    const m = this.needs.mood;
    if (m > 82) return 'Content';
    if (m > 66) return 'Fine';
    if (m > 48) return 'Tired';
    if (m > 30) return 'Unhappy';
    return 'Miserable';
  }

  /** Personal wake and sleep hours, varied per individual. */
  get wakeHour(): number {
    return 6 + this.scheduleOffset;
  }

  get sleepHour(): number {
    return 21.5 + this.scheduleOffset;
  }
}
