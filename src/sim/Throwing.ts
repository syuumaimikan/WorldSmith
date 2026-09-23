/**
 * Things in the air because somebody threw them.
 *
 * A thrown stone is not an effect and not an animation: it is the item
 * itself, out of the pack, on a ballistic arc, and it is still that item when
 * it lands. So it can be picked up again, it can hit somebody on the way, and
 * a rock hurts more than a loaf of bread because a rock is heavier and
 * harder -- the same weight the inventory already carries decides it.
 *
 * Flight runs on the wall clock rather than the world clock, for the same
 * reason a meteor does: an arc that takes a second and a half is something a
 * person watches, and scaling it by the speed control would make it vanish
 * between two frames.
 */

import { ItemId, ITEMS } from '../data/items';

/** Gravity, in metres per second squared. Real, because it looks right. */
const G = 9.81;

/** Below this the thing has stopped and becomes a pile. */
const REST_SPEED = 0.6;

export interface ThrownItem {
  id: number;
  item: ItemId;
  count: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Radians of tumble so far, purely for the look of it. */
  spin: number;
  /** Who threw it, so it cannot hit them in the first instant. */
  thrownBy: number;
  /** Seconds it has been in the air, so a throw cannot hit its thrower. */
  age: number;
  /** Set when it has hit something and should stop being simulated. */
  done: boolean;
}

/**
 * How fast a person can throw a given thing.
 *
 * A cricket ball leaves the hand at about 30 m/s and a brick at maybe 12.
 * Weight is what separates them, and past about twenty kilos you are not
 * throwing it at all, you are dropping it forward.
 */
export function throwSpeed(item: ItemId): number {
  const w = Math.max(0.2, ITEMS[item].weight);
  return Math.max(4.5, 20 / Math.pow(w, 0.42));
}

/**
 * What it does to whatever it lands on.
 *
 * Kinetic energy, scaled to the severities the body model uses. A pebble
 * bruises; a hurled anvil, if you could throw one, would break something.
 */
export function throwImpact(item: ItemId, speed: number): number {
  const mass = Math.max(0.1, ITEMS[item].weight);
  const joules = 0.5 * mass * speed * speed;
  // Hardness matters as much as energy: a sack of grain at the same speed
  // does not do what a rock does.
  const hard = ITEMS[item].category === 'food' ? 0.25 : 1;
  return Math.min(0.55, (joules / 260) * hard);
}

/**
 * Advances one thrown thing by `dt` wall-clock seconds.
 *
 * Returns the ground height sampler's verdict: `null` while it is still
 * flying, or the point where it came to rest.
 */
export function stepThrown(
  t: ThrownItem,
  dt: number,
  groundAt: (x: number, z: number) => number,
  drag = 0.06,
): { x: number; y: number; z: number } | null {
  t.age += dt;
  // Air resistance, as a single coefficient. Not a wind tunnel; enough that a
  // feather-light thing does not sail forever.
  const damp = Math.max(0, 1 - drag * dt);
  t.vx *= damp;
  t.vz *= damp;
  t.vy = t.vy * damp - G * dt;
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  t.z += t.vz * dt;
  t.spin += dt * 9;

  const ground = groundAt(t.x, t.z);
  if (t.y > ground) return null;

  const speed = Math.hypot(t.vx, t.vy, t.vz);
  if (speed < REST_SPEED) {
    t.y = ground;
    return { x: t.x, y: ground, z: t.z };
  }

  // One bounce, losing most of its energy, because things that hit the
  // ground at an angle skip rather than stop dead.
  t.y = ground;
  t.vy = Math.abs(t.vy) * 0.26;
  t.vx *= 0.42;
  t.vz *= 0.42;
  if (Math.hypot(t.vx, t.vy, t.vz) < REST_SPEED) return { x: t.x, y: ground, z: t.z };
  return null;
}
