/**
 * Animal behaviour.
 *
 * Simple but genuine: herbivores graze and bolt when something gets too close,
 * predators stalk them, birds circle. Animals are simulated at a lower rate the
 * further they are from the player, because a deer in a forest nobody is
 * looking at does not need sixty decisions a second.
 */

import type { World } from '../World';
import { Animal, ANIMALS } from '../Wildlife';
import { clamp, damp } from '../../core/math';
import { mulberry32 } from '../../core/rng';

const NEAR_RANGE = 130;
const FAR_RANGE = 340;

export function updateAnimals(world: World, dt: number): void {
  const px = world.player.position.x;
  const pz = world.player.position.z;

  for (let i = world.wildlife.length - 1; i >= 0; i--) {
    const a = world.wildlife[i];
    if (a.dead) {
      world.removeAnimal(a);
      continue;
    }

    const d2 = (a.x - px) ** 2 + (a.z - pz) ** 2;

    // Simulation level of detail: distant animals think less often.
    if (d2 > FAR_RANGE * FAR_RANGE) {
      a.stateTimer -= dt;
      if (a.stateTimer <= 0) {
        // Coarse drift so distant populations still move around the map.
        const rnd = mulberry32(a.rngSeed + Math.floor(world.time.totalHours));
        a.x = clamp(a.x + (rnd() - 0.5) * 24, 3, world.terrain.worldSize - 3);
        a.z = clamp(a.z + (rnd() - 0.5) * 24, 3, world.terrain.worldSize - 3);
        a.y = world.terrain.heightAt(a.x, a.z);
        a.stateTimer = 20 + rnd() * 30;
      }
      continue;
    }

    const stride = d2 > NEAR_RANGE * NEAR_RANGE ? 2 : 1;
    updateOne(world, a, dt * stride, px, pz);
  }
}

function updateOne(world: World, a: Animal, dt: number, px: number, pz: number): void {
  const def = ANIMALS[a.species];
  const rnd = mulberry32(a.rngSeed + Math.floor(world.time.totalHours * 4));

  a.stateTimer -= dt;

  // --- Threat response ---------------------------------------------------
  let threatX = 0;
  let threatZ = 0;
  let threatened = false;

  const playerDist = Math.hypot(a.x - px, a.z - pz);
  if (playerDist < def.awareness) {
    threatX = a.x - px;
    threatZ = a.z - pz;
    threatened = true;
  }

  if (!threatened && def.diet !== 'predator') {
    const hunter = world.nearestNpcTo(a.x, a.z, def.awareness * 0.7);
    if (hunter) {
      threatX = a.x - hunter.x;
      threatZ = a.z - hunter.z;
      threatened = true;
    }
  }

  if (threatened) {
    a.state = 'flee';
    a.stateTimer = 2.4;
    const len = Math.hypot(threatX, threatZ) || 1;
    a.targetX = clamp(a.x + (threatX / len) * 22, 3, world.terrain.worldSize - 3);
    a.targetZ = clamp(a.z + (threatZ / len) * 22, 3, world.terrain.worldSize - 3);
  }

  // --- Predators pick a target ------------------------------------------
  if (def.diet === 'predator' && a.state !== 'flee') {
    if (a.stateTimer <= 0 || a.state !== 'hunt') {
      const prey = findPrey(world, a);
      if (prey) {
        a.state = 'hunt';
        a.targetX = prey.x;
        a.targetZ = prey.z;
        a.stateTimer = 3;
      }
    }
  }

  // --- Idle behaviour ----------------------------------------------------
  if (a.stateTimer <= 0 && a.state !== 'flee') {
    const roll = rnd();
    if (roll < 0.42) {
      a.state = 'graze';
      a.stateTimer = 3 + rnd() * 7;
    } else if (roll < 0.86) {
      a.state = 'wander';
      a.stateTimer = 3 + rnd() * 6;
      const ang = rnd() * Math.PI * 2;
      const r = 6 + rnd() * 16;
      a.targetX = clamp(a.x + Math.cos(ang) * r, 3, world.terrain.worldSize - 3);
      a.targetZ = clamp(a.z + Math.sin(ang) * r, 3, world.terrain.worldSize - 3);
    } else {
      a.state = 'idle';
      a.stateTimer = 2 + rnd() * 5;
    }
  }

  // --- Movement ----------------------------------------------------------
  let wanted = 0;
  if (a.state === 'flee') wanted = def.fleeSpeed;
  else if (a.state === 'hunt') wanted = def.speed * 1.7;
  else if (a.state === 'wander') wanted = def.speed;
  else wanted = 0;

  a.speed = damp(a.speed, wanted, 5, dt);

  if (a.speed > 0.05) {
    const dx = a.targetX - a.x;
    const dz = a.targetZ - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) {
      const step = Math.min(d, a.speed * dt);
      let nx = a.x + (dx / d) * step;
      let nz = a.z + (dz / d) * step;

      // Land animals keep out of deep water and off cliffs.
      if (a.species !== 'bird') {
        if (world.terrain.waterDepthAt(nx, nz) > 0.5 || world.terrain.slopeAt(nx, nz) > 0.9) {
          nx = a.x;
          nz = a.z;
          a.stateTimer = 0;
        }
      }
      a.x = clamp(nx, 3, world.terrain.worldSize - 3);
      a.z = clamp(nz, 3, world.terrain.worldSize - 3);
      a.yaw = Math.atan2(dx, dz);
    } else if (a.state !== 'flee') {
      a.stateTimer = 0;
    }
  }

  a.y = world.terrain.heightAt(a.x, a.z);
  if (a.species === 'bird') {
    // Birds circle at altitude, dipping toward the ground occasionally.
    a.altitude = damp(a.altitude, a.state === 'graze' ? 0.4 : 9 + Math.sin(world.time.totalHours + a.id) * 4, 1.4, dt);
  }
}

function findPrey(world: World, predator: Animal): Animal | null {
  const def = ANIMALS[predator.species];
  let best: Animal | null = null;
  let bestD = def.awareness * def.awareness;
  for (const other of world.wildlife) {
    if (other.id === predator.id || other.dead) continue;
    if (ANIMALS[other.species].diet !== 'herbivore') continue;
    const d2 = (other.x - predator.x) ** 2 + (other.z - predator.z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = other;
    }
  }
  return best;
}
