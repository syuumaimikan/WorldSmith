/**
 * What comes out of the sky, and what the sea does afterwards.
 *
 * The line held here is that neither of these simply happens. A meteor is an
 * object that crosses the sky for several seconds before it lands, and a
 * tsunami is a wave that takes time to arrive and only exists when there was
 * sea floor to displace.
 */

import { describe, expect, it } from 'vitest';
import { buildTestWorld, makeTestConfig, TICK } from './harness';
import { Biome } from '../world/types';

function run(world: ReturnType<typeof buildTestWorld>, seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) world.simulate(TICK);
}

describe('a meteor', () => {
  it('crosses the sky before it lands', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'skyfall' }));
    const c = world.settlement.centre;
    const body = world.disasters.callDownMeteor(world, c.x, c.z, 0.5);

    // It starts a long way off and a long way up.
    expect(body.y).toBeGreaterThan(world.terrain.heightAt(c.x, c.z) + 300);
    expect(Math.hypot(body.x - c.x, body.z - c.z)).toBeGreaterThan(200);
    expect(world.disasters.falling.length).toBe(1);

    const before = world.terrain.heightAt(c.x, c.z);
    const startY = body.y;
    const startAway = Math.hypot(body.x - c.x, body.z - c.z);

    // Part way through it is closer, and still in the air.
    run(world, 2);
    expect(world.disasters.falling.length).toBe(1);
    const mid = world.disasters.falling[0];
    expect(mid.y).toBeLessThan(startY);
    expect(Math.hypot(mid.x - c.x, mid.z - c.z)).toBeLessThan(startAway);
    expect(world.terrain.heightAt(c.x, c.z)).toBe(before);

    // And then it arrives, and there is a hole where it landed.
    run(world, 14);
    expect(world.disasters.falling.length).toBe(0);
    expect(world.terrain.heightAt(c.x, c.z)).toBeLessThan(before);
  });
});

describe('a tsunami', () => {
  function seaTile(world: ReturnType<typeof buildTestWorld>): { x: number; z: number } | null {
    const t = world.terrain;
    for (let i = 0; i < t.data.height.length; i += 7) {
      if (t.data.biome[i] !== Biome.Ocean) continue;
      if (t.data.height[i] > -6) continue;
      const tx = i % t.gridSize;
      const tz = (i / t.gridSize) | 0;
      // Somewhere with land within reach, or there is nothing to flood.
      for (let d = 4; d < 40; d += 4) {
        if (!t.inBounds(tx + d, tz)) break;
        if (t.data.height[t.index(tx + d, tz)] > 1) {
          return { x: t.worldXOf(tx), z: t.worldZOf(tz) };
        }
      }
    }
    return null;
  }

  it('takes time to arrive, and only follows a shock at sea', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'wave' }));
    const sea = seaTile(world);
    expect(sea).not.toBeNull();

    world.disasters.maybeTsunami(world, sea!.x, sea!.z, 0.9);
    expect(world.disasters.waves.length).toBe(1);
    expect(world.disasters.waves[0].arriveIn).toBeGreaterThan(20);

    // Nothing has happened yet.
    const floodedBefore = world.disasters.floodedTileCount;
    run(world, 5);
    expect(world.disasters.floodedTileCount).toBe(floodedBefore);

    run(world, 400);
    expect(world.disasters.waves.length).toBe(0);
  });

  it('does not follow a shock in the middle of a continent', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'inland' }));
    const t = world.terrain;
    const N = t.gridSize;

    // The point on this world furthest from any real sea. A shock there has
    // no ocean under it to move.
    const dist = new Int32Array(N * N).fill(-1);
    const queue = new Int32Array(N * N);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < N * N; i++) {
      if (t.data.height[i] <= -3 && t.waterHeight[i] > t.data.height[i]) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    let furthest = -1;
    while (head < tail) {
      const i = queue[head++];
      if (t.data.height[i] > 0 && (furthest < 0 || dist[i] > dist[furthest])) furthest = i;
      const x = i % N;
      const z = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const nz = z + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
    expect(furthest).toBeGreaterThanOrEqual(0);
    // Only meaningful if this world actually has a deep interior.
    if (dist[furthest] * t.tileSize <= 280) return;

    world.disasters.maybeTsunami(
      world,
      t.worldXOf(furthest % N),
      t.worldZOf((furthest / N) | 0),
      1,
    );
    expect(world.disasters.waves.length).toBe(0);
  });

  it('is not raised by every tremor', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'wave' }));
    const sea = seaTile(world);
    expect(sea).not.toBeNull();
    world.disasters.maybeTsunami(world, sea!.x, sea!.z, 0.2);
    expect(world.disasters.waves.length).toBe(0);
  });
});
