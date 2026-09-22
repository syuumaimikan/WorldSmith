/**
 * The player character's physical state and locomotion.
 *
 * Deliberately a small, hand-written controller rather than a rigid-body
 * physics engine: the world is a heightfield with circular and box obstacles,
 * and a purpose-built controller gives better ground-following and slope
 * behaviour at a fraction of the cost — which matters because hundreds of NPCs
 * use the same collision routine.
 */

import { Body } from './Body';
import { Vector3 } from 'three';
import { Terrain } from '../world/Terrain';
import { Inventory } from './Inventory';
import { clamp, clamp01, damp, TAU } from '../core/math';
import { ItemId } from '../data/items';

export const PLAYER_RADIUS = 0.38;
export const WALK_SPEED = 3.3;
export const RUN_SPEED = 6.2;
const GRAVITY = -24;
const JUMP_SPEED = 6.4;
const MAX_WALK_SLOPE = 0.92; // radians
const SWIM_DEPTH = 1.25;

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export type ObstacleQuery = (x: number, z: number, radius: number, out: Obstacle[]) => void;

export interface PlayerStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  warmth: number;
}

export class Player {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  grounded = true;
  swimming = false;
  wading = false;
  /** Horizontal speed this frame, for animation. */
  speed = 0;

  readonly inventory = new Inventory(24, 90);
  /** Quick-access bar referencing inventory slot indices. */
  readonly quickSlots: (ItemId | null)[] = [null, null, null, null, null, null];
  /**
   * Which inventory slot is actually in their hand, or -1 for empty hands.
   *
   * Carrying something and holding something are different. A pack with an axe
   * in it does not fell a tree; an axe in your hand does, and so the tool that
   * speeds work is the one that is out, not the best one anywhere on your
   * person.
   */
  equippedSlot = -1;

  /** What they are holding, if anything. */
  equipped(): ItemId | null {
    const slot = this.inventory.slots[this.equippedSlot];
    return slot ? slot.item : null;
  }

  /**
   * The same body every settler has. The player is not a special case: they
   * break limbs, their wounds turn, and going without wastes them.
   */
  readonly body = new Body();

  /**
   * What the bar at the top left is drawing, 0..100. Read off the body; there
   * is nothing here to damage directly.
   */
  get condition(): number {
    return Math.round(this.body.condition * (0.55 + clamp01(this.stats.hunger / 100) * 0.45));
  }

  stats: PlayerStats = {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    warmth: 100,
  };

  /** Set while the player is performing a timed action such as chopping. */
  busyAction: 'chop' | 'mine' | 'build' | 'farm' | 'forage' | null = null;
  busyTargetId = 0;

  private obstacles: Obstacle[] = [];
  private moveDir = new Vector3();
  private tmp = new Vector3();

  constructor(x = 0, z = 0) {
    this.position.set(x, 0, z);
  }

  placeOnGround(terrain: Terrain): void {
    this.position.y = terrain.heightAt(this.position.x, this.position.z);
    this.velocity.set(0, 0, 0);
  }

  /**
   * @param wishDir desired horizontal direction in world space (need not be normalised)
   * @param run whether the run modifier is held
   */
  update(
    dt: number,
    wishDir: Vector3,
    run: boolean,
    jump: boolean,
    terrain: Terrain,
    queryObstacles: ObstacleQuery,
  ): void {
    const waterSurface = terrain.waterHeight[
      terrain.index(terrain.tileX(this.position.x), terrain.tileZ(this.position.z))
    ];
    const groundY = terrain.heightAt(this.position.x, this.position.z);
    const depth = waterSurface > groundY ? waterSurface - groundY : 0;
    this.swimming = depth > SWIM_DEPTH;
    this.wading = depth > 0.25 && !this.swimming;

    const wishLen = Math.hypot(wishDir.x, wishDir.z);
    let targetSpeed = 0;
    if (wishLen > 0.001) {
      this.moveDir.set(wishDir.x / wishLen, 0, wishDir.z / wishLen);
      const canRun = run && this.stats.stamina > 1 && !this.swimming;
      targetSpeed = canRun ? RUN_SPEED : WALK_SPEED;
      if (this.swimming) targetSpeed = 1.9;
      else if (this.wading) targetSpeed *= 0.62;

      // Uphill is slower; downhill a little faster.
      const ahead = 0.9;
      const hAhead = terrain.heightAt(
        this.position.x + this.moveDir.x * ahead,
        this.position.z + this.moveDir.z * ahead,
      );
      const grade = (hAhead - groundY) / ahead;
      targetSpeed *= clamp(1 - grade * 0.65, 0.35, 1.22);

      if (this.busyAction) targetSpeed = 0;
      this.yaw = approachAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), 14, dt);
    }

    // Stamina.
    if (run && wishLen > 0.001 && !this.swimming && this.grounded) {
      this.stats.stamina = Math.max(0, this.stats.stamina - dt * 11);
    } else {
      this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + dt * 14);
    }

    // Horizontal velocity approaches the target with ground-dependent grip.
    const accel = this.grounded ? 18 : 5;
    const vx = this.moveDir.x * targetSpeed * (wishLen > 0.001 ? 1 : 0);
    const vz = this.moveDir.z * targetSpeed * (wishLen > 0.001 ? 1 : 0);
    this.velocity.x = damp(this.velocity.x, vx, accel, dt);
    this.velocity.z = damp(this.velocity.z, vz, accel, dt);

    // Vertical.
    if (this.swimming) {
      const target = waterSurface - 0.55;
      this.velocity.y = damp(this.velocity.y, (target - this.position.y) * 3.2, 8, dt);
    } else {
      if (jump && this.grounded && !this.busyAction) {
        this.velocity.y = JUMP_SPEED;
        this.grounded = false;
      }
      this.velocity.y += GRAVITY * dt;
    }

    // Integrate horizontally, then resolve collisions, then settle onto ground.
    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;

    // Refuse to climb anything steeper than the walk limit.
    if (!this.swimming) {
      const nextGround = terrain.heightAt(nx, nz);
      const rise = nextGround - groundY;
      const runDist = Math.hypot(nx - this.position.x, nz - this.position.z);
      if (runDist > 0.0001 && Math.atan2(rise, runDist) > MAX_WALK_SLOPE) {
        nx = this.position.x;
        nz = this.position.z;
        this.velocity.x *= 0.2;
        this.velocity.z *= 0.2;
      }
    }

    // World bounds.
    const margin = PLAYER_RADIUS + 1;
    nx = clamp(nx, margin, terrain.worldSize - margin);
    nz = clamp(nz, margin, terrain.worldSize - margin);

    // Obstacle push-out.
    this.obstacles.length = 0;
    queryObstacles(nx, nz, PLAYER_RADIUS + 3, this.obstacles);
    for (const o of this.obstacles) {
      const dx = nx - o.x;
      const dz = nz - o.z;
      const minDist = o.radius + PLAYER_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (minDist - d) / d;
      nx += dx * push;
      nz += dz * push;
    }

    this.position.x = nx;
    this.position.z = nz;
    this.position.y += this.velocity.y * dt;

    const newGround = terrain.heightAt(this.position.x, this.position.z);
    if (!this.swimming) {
      if (this.position.y <= newGround) {
        this.position.y = newGround;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.grounded = true;
      } else if (this.position.y - newGround < 0.06 && this.velocity.y <= 0) {
        this.position.y = newGround;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      this.position.y = Math.max(this.position.y, newGround);
      this.grounded = false;
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // Walking wears a path into the ground over time.
    if (this.grounded && this.speed > 0.5) {
      terrain.addTraffic(this.position.x, this.position.z, dt * 3.5);
    }
  }

  /** Eye/chest position used as the camera focus. */
  focusPoint(out: Vector3): Vector3 {
    return out.set(this.position.x, this.position.y + 1.15, this.position.z);
  }

  facing(out: Vector3): Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Point in front of the player where tools are applied. */
  interactionPoint(out: Vector3, distance = 1.4): Vector3 {
    this.facing(this.tmp);
    return out.set(
      this.position.x + this.tmp.x * distance,
      this.position.y + 0.6,
      this.position.z + this.tmp.z * distance,
    );
  }

  carriedWeightFraction(): number {
    return clamp01(this.inventory.totalWeight() / this.inventory.weightLimit);
  }

  serialize(): Record<string, unknown> {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      stats: this.stats,
      inventory: this.inventory.serialize(),
      quickSlots: this.quickSlots,
    };
  }
}

function approachAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return current + d * (1 - Math.exp(-lambda * dt));
}
