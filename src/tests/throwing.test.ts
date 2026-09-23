/**
 * Throwing.
 *
 * The thing in the air has to be the item itself -- so it lands as something
 * you can pick up again, and what it does on the way is decided by what it is
 * rather than by a damage number somebody chose.
 */

import { describe, expect, it } from 'vitest';
import { stepThrown, throwImpact, throwSpeed, ThrownItem } from '../sim/Throwing';
import { buildTestWorld, makeTestConfig } from './harness';
import { throwEquipped } from '../game/PlayerActions';

function body(item: 'stone' | 'bread', vy: number): ThrownItem {
  return {
    id: 1,
    item,
    count: 1,
    x: 0,
    y: 10,
    z: 0,
    vx: throwSpeed(item),
    vy,
    vz: 0,
    spin: 0,
    thrownBy: 0,
    age: 0,
    done: false,
  };
}

describe('a thrown thing', () => {
  it('leaves the hand slower the heavier it is', () => {
    expect(throwSpeed('bread')).toBeGreaterThan(throwSpeed('stone'));
  });

  it('follows an arc and comes to rest on the ground', () => {
    const t = body('stone', 4);
    const ground = (): number => 0;
    let rest: { x: number; y: number; z: number } | null = null;
    let peak = t.y;
    for (let i = 0; i < 2000 && !rest; i++) {
      rest = stepThrown(t, 1 / 60, ground);
      peak = Math.max(peak, t.y);
    }
    expect(peak).toBeGreaterThan(10);
    expect(rest).not.toBeNull();
    // It went somewhere. A throw that lands at your feet is not a throw.
    expect(rest!.x).toBeGreaterThan(4);
  });

  it('hurts according to what it is, not to a damage number', () => {
    const fast = throwSpeed('stone');
    expect(throwImpact('stone', fast)).toBeGreaterThan(throwImpact('bread', fast));
    // And nothing a person can throw is instantly crippling.
    expect(throwImpact('stone', fast)).toBeLessThanOrEqual(0.55);
  });
});

describe('throwing from the hand', () => {
  it('takes the item out of the pack and puts it in the air', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'throw-1' }));
    const p = world.player;
    p.inventory.add('stone', 3);
    p.equippedSlot = p.inventory.slots.findIndex((s) => s?.item === 'stone');

    const before = p.inventory.count('stone');
    const r = throwEquipped(world, 0.3);
    expect(r.kind).toBe('thrown');
    expect(p.inventory.count('stone')).toBe(before - 1);
    expect(world.thrown.length).toBe(1);

    // And it becomes a real stone on the ground where it lands, not a
    // message. It may merge into a heap that was already lying there, so
    // count the stone rather than the heaps.
    const onGround = (): number =>
      world.piles.reduce((n, pile) => n + (pile.item === 'stone' ? pile.count : 0), 0);
    const before2 = onGround();
    for (let i = 0; i < 900 && world.thrown.length > 0; i++) world.simulate(1 / 15);
    expect(world.thrown.length).toBe(0);
    expect(onGround()).toBe(before2 + 1);
  });
});
