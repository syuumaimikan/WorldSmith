/**
 * Ground that gives way.
 *
 * Rain is very slightly acidic and limestone dissolves in it. Water finds a
 * crack, widens it into a passage, the passage into a chamber, and one day
 * the roof of that chamber is thinner than the field on top of it and the
 * field is not there any more. That is the whole mechanism, and it is why
 * sinkholes happen in karst country and nowhere else: granite does not
 * dissolve, so granite country does not fall in.
 *
 * So this is not a random disaster with a location rolled for it. The rock
 * decides where it can happen at all, the weather decides when, and what the
 * hole takes with it is whatever was standing on the ground that went.
 */

import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import { readGeology } from '../world/Geology';
import { Body } from './Body';
import type { ResourceNode } from '../world/resources';
import type { World } from './World';

/** Game days between checks. Slow: this is a geological process. */
const CHECK_DAYS = 4;

/** How many places are looked at per check. */
const SAMPLES = 90;

export class KarstSystem {
  private rng: Rng;
  /**
   * How cavernous each tile is, 0..1.
   *
   * Derived rather than stored: it comes out of the seed and the finished
   * heightmap, so a save does not have to carry a megabyte of it and an old
   * save gets it for free. Computed once, on the first check, because that is
   * a whole-map pass and there is no hurry -- nothing can fall in on the first
   * afternoon.
   */
  private field: Float32Array | null = null;
  private due = 0;

  /** Days of dissolution banked per tile, as a sparse map. */
  private ripeness = new Map<number, number>();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x51c0);
  }

  /** How ready the ground at a tile is to go, 0..1. Used by the map overlay. */
  karstAt(world: World, tx: number, tz: number): number {
    const f = this.fieldFor(world);
    const i = world.terrain.index(tx, tz);
    return f[i] ?? 0;
  }

  update(world: World, days: number): void {
    this.due += days;
    if (this.due < CHECK_DAYS) return;
    const elapsed = this.due;
    this.due = 0;

    const field = this.fieldFor(world);
    const t = world.terrain;
    const N = t.gridSize;

    for (let s = 0; s < SAMPLES; s++) {
      const tx = this.rng.int(3, N - 4);
      const tz = this.rng.int(3, N - 4);
      const i = tz * N + tx;
      const karst = field[i];
      if (karst < 0.25) continue;
      if (t.waterHeight[i] > t.data.height[i]) continue;
      // A steep hillside sheds its water; it does not stand on it long
      // enough to dissolve anything.
      if (t.data.slope[i] > 0.3) continue;

      // How much water has actually been through here lately. Dissolution is
      // the water, not the rock: the same limestone under a desert keeps its
      // roof for ever.
      const wet = clamp01(world.climate.rainfallMeanAt(t.worldXOf(tx), t.worldZOf(tz)));
      const ripe = (this.ripeness.get(i) ?? 0) + karst * wet * elapsed;
      this.ripeness.set(i, ripe);

      // It goes when the void under it is bigger than the roof can span, and
      // the years it took to get there are the years in `ripe`.
      if (ripe < 260) continue;
      if (!this.rng.chance(clamp01((ripe - 260) / 900))) continue;

      this.ripeness.delete(i);
      this.collapse(world, t.worldXOf(tx), t.worldZOf(tz), karst);
    }
  }

  /** The ground opens. */
  private collapse(world: World, x: number, z: number, karst: number): void {
    const radius = 4 + karst * this.rng.range(4, 14);
    const depth = 3 + karst * this.rng.range(3, 11);
    const t = world.terrain;

    world.markTerrainChanged();
    world.editor.sculpt(x, z, radius, depth, 'crater', 'sinkhole');

    // Everything that was standing on the ground that went.
    let swallowed = 0;
    const doomed: ResourceNode[] = [];
    world.nodeGrid.forEachNear(x, z, radius, (n) => doomed.push(n));
    for (const n of doomed) {
      world.removeNode(n);
      swallowed++;
    }

    let lost = 0;
    for (const b of [...world.buildings]) {
      const d = Math.hypot(b.worldX - x, b.worldZ - z);
      if (d > radius) continue;
      // There is nothing under it any more. It does not get damaged; it goes.
      if (world.damageBuilding(b, 6)) lost++;
    }

    for (const npc of world.npcs) {
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d > radius) continue;
      // A fall, onto rock, in the dark.
      npc.body.hurtPart(Body.randomPart(this.rng), 'break', 0.3 + karst * 0.4);
      npc.body.hurtPart('torso', 'bruise', 0.2 + karst * 0.3);
      world.startleNpc(npc, x, z);
    }

    // A hole that goes down far enough is a way in.
    if (depth > 7 && this.rng.chance(0.45)) {
      world.openCave(x, z);
    }

    world.log.add(
      world.time,
      'disaster',
      'event.sinkhole',
      { swallowed, destroyed: lost, span: Math.round(radius * 2) },
      { notable: true, x, z },
    );
    void t;
  }

  private fieldFor(world: World): Float32Array {
    if (!this.field) {
      this.field = readGeology(world.config, world.terrain.data, world.terrain.waterHeight).karst;
    }
    return this.field;
  }
}
