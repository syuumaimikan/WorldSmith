/**
 * A body rather than a bar.
 *
 * What is defended here is that nothing in this world has hit points. Damage
 * lands on a particular part, wounds turn if they are left, going without
 * wastes rather than wounds, and the three ways out are a ruined head or
 * chest, sepsis, and having nothing left.
 */

import { describe, expect, it } from 'vitest';
import { Body } from '../sim/Body';
import { Rng } from '../core/rng';
import { buildTestWorld, makeTestConfig } from './harness';
import { DAYS_PER_YEAR } from '../sim/Time';

const rng = new Rng('body');

describe('a body', () => {
  it('has no health to subtract from', () => {
    const world = buildTestWorld();
    const npc = world.npcs[0];
    expect((npc.needs as unknown as Record<string, unknown>).health).toBeUndefined();
    // The one number there is is read off the body, not stored on it.
    expect(npc.condition).toBeGreaterThan(0);
    const before = npc.condition;
    npc.body.hurtPart('leftLeg', 'break', 0.8);
    expect(npc.condition).toBeLessThan(before);
  });

  it('keeps a broken leg out of the legs and off everything else', () => {
    const b = new Body();
    b.hurtPart('leftLeg', 'break', 0.9);
    expect(b.mobility).toBeLessThan(0.6);
    // Arms are fine. A broken leg is not a general debuff.
    expect(b.dexterity).toBeGreaterThan(0.95);
    expect(b.failure()).toBeNull();
  });

  it('deepens a wound rather than collecting forty of them', () => {
    const b = new Body();
    for (let i = 0; i < 20; i++) b.hurtPart('torso', 'cut', 0.05);
    expect(b.injuries.length).toBe(1);
    expect(b.injuries[0].severity).toBeGreaterThan(0.05);
  });

  it('mends a cut that is looked after and loses one that is not', () => {
    const tended = new Body();
    const left = new Body();
    tended.hurtPart('rightArm', 'cut', 0.6);
    left.hurtPart('rightArm', 'cut', 0.6);
    tended.injuries[0].treated = true;

    for (let d = 0; d < 40; d++) {
      tended.advance(1, 1, 0.8, rng);
      left.advance(1, 0.2, 0, rng);
    }
    expect(tended.injuries.length).toBe(0);
    expect(left.injuries.length).toBeGreaterThan(0);
    expect(left.injuries[0].infection).toBeGreaterThan(tended.injuries.length);
  });

  it('is killed by the chest, by sepsis, or by having nothing left', () => {
    const crushed = new Body();
    crushed.hurtPart('torso', 'bruise', 1);
    expect(crushed.failure()).toBe('wound');

    const septic = new Body();
    septic.hurtPart('leftArm', 'bite', 0.7);
    septic.injuries[0].infection = 1;
    expect(septic.failure()).toBe('infection');

    const starved = new Body();
    starved.starve(1);
    expect(starved.failure()).toBe('wasting');

    // And a broken arm, however bad, is not one of them.
    const maimed = new Body();
    maimed.hurtPart('rightArm', 'break', 1);
    expect(maimed.failure()).toBeNull();
  });

  it('comes back from going without once there is food again', () => {
    const b = new Body();
    b.starve(0.7);
    for (let d = 0; d < 30; d++) b.advance(1, 1, 0.3, rng);
    expect(b.wasting).toBeLessThan(0.1);
  });
});

describe('a settlement that cannot feed itself', () => {
  it('loses people to going without rather than to a bar reaching zero', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'famine' }));
    // Strip the country bare, so there is genuinely nothing to eat.
    for (const n of [...world.nodes]) world.removeNode(n);
    for (const p of [...world.piles]) world.removePile(p);
    for (const a of [...world.wildlife]) world.removeAnimal(a);

    const before = world.npcs.length;
    for (let i = 0; i < DAYS_PER_YEAR * 2; i++) world.skipDay();
    expect(world.npcs.length).toBeLessThan(before);
    const died = world.log.all().filter((e) => e.key === 'ev.diedOfHunger');
    expect(died.length).toBeGreaterThan(0);
  });
});
