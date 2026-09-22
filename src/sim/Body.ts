/**
 * A body, rather than a pool of hit points.
 *
 * Nothing in this world has "health" that arrows and hunger and plague all
 * subtract from the same bar. A person has limbs that get broken, wounds that
 * get infected, a gut that goes empty and a chest that gets cold, and each of
 * those does its own kind of damage on its own timescale. That is the whole
 * point of the model:
 *
 *   - a broken leg does not kill you, it stops you walking, and it heals over
 *     weeks;
 *   - a cut on the arm is nothing until it turns, and then it is everything;
 *   - starving does not wound you, it wastes you, and it is reversible right
 *     up until it is not;
 *   - what actually kills is a ruined head or chest, sepsis, or running out.
 *
 * `condition` exists only so the HUD has one number to draw and so that code
 * which just wants to know "how badly off is this person" can ask. Nothing
 * writes to it, because there is nothing there to write to.
 */

import { clamp01 } from '../core/math';
import { Rng } from '../core/rng';

export type BodyPart = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export const BODY_PARTS: BodyPart[] = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

export type InjuryKind = 'bruise' | 'cut' | 'break' | 'burn' | 'frostbite' | 'bite';

export interface Injury {
  part: BodyPart;
  kind: InjuryKind;
  /** 0..1. At 1 the part is destroyed. */
  severity: number;
  /** 0..1. A wound that turns is what kills people this side of medicine. */
  infection: number;
  /** Dressed wounds heal faster and turn far less often. */
  treated: boolean;
  /** Days since it was taken. */
  age: number;
}

/** How much losing this part matters. */
const VITAL: Record<BodyPart, number> = {
  head: 1,
  torso: 1,
  leftArm: 0.35,
  rightArm: 0.35,
  leftLeg: 0.4,
  rightLeg: 0.4,
};

/** How fast each kind of hurt mends, per day, before anything else. */
const HEAL_RATE: Record<InjuryKind, number> = {
  bruise: 0.14,
  cut: 0.07,
  burn: 0.045,
  bite: 0.06,
  frostbite: 0.05,
  break: 0.022,
};

/** How readily each kind goes bad if it is left alone. */
const TURN_RATE: Record<InjuryKind, number> = {
  bruise: 0,
  cut: 0.05,
  burn: 0.045,
  bite: 0.075,
  frostbite: 0.03,
  break: 0.015,
};

export interface SerializedBody {
  injuries: Injury[];
  wasting: number;
  sickness: number;
}

export class Body {
  readonly injuries: Injury[] = [];

  /**
   * How far the body has been eaten into by going without. Hunger and cold
   * both feed it, it comes back down when there is food and a roof, and at 1
   * the person has nothing left.
   */
  wasting = 0;

  /**
   * How hard whatever illness they have is pressing, 0..1. Set by the disease
   * system, which owns what the illness actually is; the body only knows that
   * something is wearing it down.
   */
  sickness = 0;

  // ----------------------------------------------------------------- state

  /**
   * One number for the HUD, 0..100. Derived, never assigned: this is a
   * readout of the body, not a store of anything.
   */
  get condition(): number {
    let harm = this.wasting * 0.8 + this.sickness * 0.55;
    for (const inj of this.injuries) {
      harm += inj.severity * VITAL[inj.part] * 0.55 + inj.infection * 0.7;
    }
    return Math.round(clamp01(1 - harm) * 100);
  }

  /** How well they can get about, 0..1. Legs, and how weak they are. */
  get mobility(): number {
    let legs = 1;
    for (const inj of this.injuries) {
      if (inj.part !== 'leftLeg' && inj.part !== 'rightLeg') continue;
      legs -= inj.severity * 0.5;
    }
    return clamp01(legs) * clamp01(1 - this.wasting * 0.6 - this.sickness * 0.4);
  }

  /** How well they can work with their hands, 0..1. */
  get dexterity(): number {
    let arms = 1;
    for (const inj of this.injuries) {
      if (inj.part !== 'leftArm' && inj.part !== 'rightArm') continue;
      arms -= inj.severity * 0.5;
    }
    return clamp01(arms) * clamp01(1 - this.wasting * 0.5 - this.sickness * 0.5);
  }

  /** Whether anything is actually wrong. */
  get hurt(): boolean {
    return this.injuries.length > 0 || this.wasting > 0.05 || this.sickness > 0.05;
  }

  /** The injury most worth dealing with, by how bad and how infected. */
  worstInjury(): Injury | null {
    let best: Injury | null = null;
    let bestScore = 0;
    for (const inj of this.injuries) {
      const score = inj.severity * VITAL[inj.part] + inj.infection * 1.5;
      if (score <= bestScore) continue;
      bestScore = score;
      best = inj;
    }
    return best;
  }

  /** Total damage to one part, 0..1. */
  damageTo(part: BodyPart): number {
    let total = 0;
    for (const inj of this.injuries) if (inj.part === part) total += inj.severity;
    return clamp01(total);
  }

  // ---------------------------------------------------------------- damage

  /**
   * Takes a hurt somewhere.
   *
   * Repeated damage of the same kind to the same place deepens the wound that
   * is already there rather than stacking a second one on top of it, which is
   * what stops a long fight leaving somebody with forty separate cuts.
   */
  hurtPart(part: BodyPart, kind: InjuryKind, severity: number): Injury {
    const existing = this.injuries.find((i) => i.part === part && i.kind === kind);
    if (existing) {
      existing.severity = clamp01(existing.severity + severity * 0.7);
      existing.treated = false;
      return existing;
    }
    const injury: Injury = {
      part,
      kind,
      severity: clamp01(severity),
      infection: 0,
      treated: false,
      age: 0,
    };
    this.injuries.push(injury);
    return injury;
  }

  /** Somewhere for a blow to land, weighted the way a body presents itself. */
  static randomPart(rng: Rng): BodyPart {
    const roll = rng.next();
    if (roll < 0.1) return 'head';
    if (roll < 0.45) return 'torso';
    if (roll < 0.6) return 'leftArm';
    if (roll < 0.75) return 'rightArm';
    if (roll < 0.875) return 'leftLeg';
    return 'rightLeg';
  }

  // --------------------------------------------------------------- healing

  /**
   * A stretch of time passing over the body.
   *
   * @param days how long.
   * @param fed 0..1, how well they are eating. Bodies mend on food.
   * @param care 0..1, what the settlement can do for them -- a clinic, a
   *   healer, somebody who knows what a poultice is.
   */
  advance(days: number, fed: number, care: number, rng: Rng): void {
    for (let i = this.injuries.length - 1; i >= 0; i--) {
      const inj = this.injuries[i];
      inj.age += days;

      // Infection first: a wound that is turning is not mending.
      const turning = TURN_RATE[inj.kind] * inj.severity * (inj.treated ? 0.18 : 1);
      const fighting = 0.05 + fed * 0.09 + care * 0.22 + (inj.treated ? 0.06 : 0);
      inj.infection = clamp01(inj.infection + (turning - fighting * inj.infection) * days);
      // A clean wound does not spontaneously turn a fortnight later.
      if (inj.infection < 0.02 && inj.age > 14) inj.infection = 0;

      if (inj.infection > 0.25) continue;

      const rate = HEAL_RATE[inj.kind] * (0.4 + fed * 0.6) * (1 + care * 0.7);
      inj.severity = Math.max(0, inj.severity - rate * days);
      if (inj.severity <= 0.02 && inj.infection <= 0.02) this.injuries.splice(i, 1);
    }

    // Wasting comes back if there is food, but slowly: you do not eat one
    // good meal and undo a winter.
    if (fed > 0.55) this.wasting = Math.max(0, this.wasting - 0.035 * days * fed);

    // And sickness fades on its own if the disease system has stopped
    // pressing, so a body that has beaten something off does not stay marked.
    this.sickness = Math.max(0, this.sickness - 0.06 * days);
    void rng;
  }

  /** Going without, for a while. */
  starve(amount: number): void {
    this.wasting = clamp01(this.wasting + amount);
  }

  // ----------------------------------------------------------------- death

  /**
   * Why this body has stopped, or null if it has not.
   *
   * Three ways out, and none of them is a bar reaching zero: the head or the
   * chest is ruined, a wound has turned and taken them, or there was nothing
   * left to live on.
   */
  failure(): 'wound' | 'infection' | 'wasting' | null {
    if (this.damageTo('head') >= 1 || this.damageTo('torso') >= 1) return 'wound';
    for (const inj of this.injuries) if (inj.infection >= 1) return 'infection';
    if (this.wasting >= 1) return 'wasting';
    return null;
  }

  // ----------------------------------------------------------- persistence

  serialize(): SerializedBody {
    return {
      injuries: this.injuries.map((i) => ({ ...i })),
      wasting: this.wasting,
      sickness: this.sickness,
    };
  }

  /**
   * Restores a body from a save. Everything is clamped on the way in, because
   * a save file is untrusted input and a NaN in here would quietly make
   * somebody immortal.
   */
  restore(data: Partial<SerializedBody> | undefined): void {
    this.injuries.length = 0;
    this.wasting = safe(data?.wasting);
    this.sickness = safe(data?.sickness);
    for (const raw of data?.injuries ?? []) {
      if (!raw || !BODY_PARTS.includes(raw.part)) continue;
      if (!(raw.kind in HEAL_RATE)) continue;
      this.injuries.push({
        part: raw.part,
        kind: raw.kind,
        severity: safe(raw.severity),
        infection: safe(raw.infection),
        treated: raw.treated === true,
        age: Math.max(0, Math.min(100000, Number(raw.age) || 0)),
      });
    }
  }
}

function safe(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return clamp01(n);
}
