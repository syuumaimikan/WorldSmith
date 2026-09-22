/**
 * Tornadoes and hurricanes.
 *
 * Neither is scheduled. A tornado needs a cell that is already storming with
 * enough instability and enough turning in the wind; a hurricane needs a wide
 * patch of water warm enough to feed it. Both then travel under the wind they
 * were born in, tear at whatever they cross, and die when the conditions that
 * made them run out — a hurricane over land is starved of the warm water it
 * lives on and falls apart within a day.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01, smoothstep, TAU } from '../core/math';
import { windResistance } from './Disasters';
import type { World } from './World';

export type StormKind = 'tornado' | 'hurricane';

export interface Storm {
  id: number;
  kind: StormKind;
  name: string;
  x: number;
  z: number;
  /** Direction of travel, radians. */
  heading: number;
  /** Metres per game hour. */
  speed: number;
  /** Damaging radius, metres. */
  radius: number;
  /** 0..1 */
  intensity: number;
  /** Game hours left before it can no longer sustain itself. */
  life: number;
  /** Rotation of the funnel or eye wall, for the renderer. */
  spin: number;
  /** Set once, so the chronicle does not repeat itself. */
  announced: boolean;
}

/** Conditions must hold for this long before a tornado drops. */
const TORNADO_WATCH_HOURS = 1.2;

export class StormSystem {
  readonly storms: Storm[] = [];
  private rng: Rng;
  private nextId = 1;
  /** How long each cell has met tornado conditions, in game hours. */
  private watch: Float32Array | null = null;
  private hurricaneCooldown = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x570f);
  }

  get tornadoCount(): number {
    return this.storms.reduce((n, s) => n + (s.kind === 'tornado' ? 1 : 0), 0);
  }

  get hurricaneCount(): number {
    return this.storms.reduce((n, s) => n + (s.kind === 'hurricane' ? 1 : 0), 0);
  }

  update(world: World, hours: number): void {
    if (hours <= 0) return;
    const climate = world.climate;
    if (!this.watch) this.watch = new Float32Array(climate.cells * climate.cells);

    this.hurricaneCooldown = Math.max(0, this.hurricaneCooldown - hours);
    this.checkForTornado(world, hours);
    this.checkForHurricane(world, hours);

    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i];
      this.advance(world, s, hours);
      if (s.life <= 0 || s.intensity < 0.08) {
        world.log.add(
          world.time,
          'disaster',
          s.kind === 'tornado' ? 'ev.tornadoEnds' : 'ev.hurricaneEnds',
          { name: s.name },
          { x: s.x, z: s.z },
        );
        this.storms.splice(i, 1);
      }
    }
  }

  // =======================================================================
  // Formation
  // =======================================================================

  private checkForTornado(world: World, hours: number): void {
    const climate = world.climate;
    const watch = this.watch!;
    const n = climate.cells * climate.cells;
    if (this.tornadoCount >= 2) return;

    for (let i = 0; i < n; i++) {
      const precip = climate.precipitation[i];
      const wind = Math.hypot(climate.windU[i], climate.windV[i]);
      // Shear: how differently the neighbouring air is moving.
      const cx = i % climate.cells;
      const cz = Math.floor(i / climate.cells);
      const shear = this.shearAt(world, cx, cz);
      const ready = precip > 5 && wind > 9 && shear > 4.5 && climate.temperature[i] > 12;

      if (!ready) {
        watch[i] = Math.max(0, watch[i] - hours * 2);
        continue;
      }
      watch[i] += hours;
      if (watch[i] < TORNADO_WATCH_HOURS) continue;
      if (!this.rng.chance(clamp01(hours * 0.35))) continue;

      watch[i] = 0;
      this.spawnTornado(world, cx, cz, clamp01((shear - 4.5) / 8 + 0.3));
      return;
    }
  }

  private shearAt(world: World, cx: number, cz: number): number {
    const c = world.climate;
    const at = (x: number, z: number): [number, number] => {
      const i = clamp(z, 0, c.cells - 1) * c.cells + clamp(x, 0, c.cells - 1);
      return [c.windU[i], c.windV[i]];
    };
    const [ax, az] = at(cx - 1, cz);
    const [bx, bz] = at(cx + 1, cz);
    const [dx, dz] = at(cx, cz - 1);
    const [ex, ez] = at(cx, cz + 1);
    return Math.hypot(bx - ax, bz - az) + Math.hypot(ex - dx, ez - dz);
  }

  private spawnTornado(world: World, cx: number, cz: number, intensity: number): void {
    const c = world.climate;
    const i = cz * c.cells + cx;
    const x = (cx + this.rng.next()) * c.cellSize;
    const z = (cz + this.rng.next()) * c.cellSize;
    // Sizes and speeds are fractions of the map, as the fronts are. The
    // playable world stands in for a region, so a storm measured in literal
    // metres per hour would cross it and be gone before anyone looked up.
    const size = world.terrain.worldSize;
    const storm: Storm = {
      id: this.nextId++,
      kind: 'tornado',
      name: world.namer.placeName(Math.floor(x), Math.floor(z)),
      x,
      z,
      heading: Math.atan2(c.windV[i], c.windU[i]),
      speed: size * this.rng.range(0.05, 0.14),
      radius: size * (0.012 + intensity * 0.03),
      intensity: clamp(intensity, 0.25, 1),
      life: this.rng.range(0.6, 3.5),
      spin: 0,
      announced: true,
    };
    this.storms.push(storm);
    world.log.add(world.time, 'disaster', 'ev.tornado', { name: storm.name }, {
      notable: true,
      x,
      z,
    });
  }

  private checkForHurricane(world: World, hours: number): void {
    if (this.hurricaneCount >= 1 || this.hurricaneCooldown > 0) return;
    const c = world.climate;
    const n = c.cells * c.cells;

    // A hurricane needs a broad patch of very warm sea, not a single cell.
    for (let cz = 2; cz < c.cells - 2; cz++) {
      for (let cx = 2; cx < c.cells - 2; cx++) {
        const i = cz * c.cells + cx;
        if (c.temperature[i] < 26) continue;
        let warmWater = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const j = (cz + dz) * c.cells + (cx + dx);
            if (j < 0 || j >= n) continue;
            if (c.temperature[j] > 25 && c.waterFraction[j] > 0.7) warmWater++;
          }
        }
        if (warmWater < 17) continue;
        if (!this.rng.chance(clamp01(hours * 0.004))) continue;
        this.spawnHurricane(world, cx, cz);
        this.hurricaneCooldown = this.rng.range(900, 2600);
        return;
      }
    }
  }

  private spawnHurricane(world: World, cx: number, cz: number): void {
    const c = world.climate;
    const i = cz * c.cells + cx;
    const x = (cx + 0.5) * c.cellSize;
    const z = (cz + 0.5) * c.cellSize;
    const storm: Storm = {
      id: this.nextId++,
      kind: 'hurricane',
      name: world.namer.personName(`storm${this.nextId}`),
      x,
      z,
      heading: Math.atan2(c.windV[i], c.windU[i]) + this.rng.range(-0.4, 0.4),
      speed: world.terrain.worldSize * this.rng.range(0.03, 0.07),
      radius: world.terrain.worldSize * this.rng.range(0.12, 0.24),
      intensity: this.rng.range(0.45, 0.8),
      life: this.rng.range(60, 220),
      spin: 0,
      announced: true,
    };
    this.storms.push(storm);
    world.log.add(world.time, 'disaster', 'ev.hurricane', { name: storm.name }, {
      notable: true,
      x,
      z,
    });
  }

  // =======================================================================
  // Life and damage
  // =======================================================================

  private advance(world: World, s: Storm, hours: number): void {
    const c = world.climate;
    const i = c.cellIndex(s.x, s.z);
    s.life -= hours;
    s.spin = (s.spin + hours * (s.kind === 'tornado' ? 60 : 9)) % TAU;

    // Steered by the wind it sits in, but with its own momentum.
    const steer = Math.atan2(c.windV[i], c.windU[i]);
    let delta = steer - s.heading;
    while (delta > Math.PI) delta -= TAU;
    while (delta < -Math.PI) delta += TAU;
    s.heading += delta * clamp01(hours * (s.kind === 'tornado' ? 1.2 : 0.35));

    const travel = s.speed * hours;
    s.x += Math.cos(s.heading) * travel;
    s.z += Math.sin(s.heading) * travel;

    const size = world.terrain.worldSize;
    if (s.x < -size * 0.2 || s.x > size * 1.2 || s.z < -size * 0.2 || s.z > size * 1.2) {
      s.life = 0;
      return;
    }

    const overWater = c.waterFraction[i] > 0.55;
    if (s.kind === 'hurricane') {
      // Warm water is the fuel. Over land it starves.
      if (overWater && c.temperature[i] > 25) {
        s.intensity = Math.min(1, s.intensity + hours * 0.004);
      } else {
        s.intensity -= hours * (overWater ? 0.006 : 0.035);
      }
      // It drags a vast amount of water with it.
      this.soak(world, s, hours);
    } else {
      // A tornado over water becomes a waterspout and loses its grip.
      s.intensity -= hours * (overWater ? 0.35 : 0.12);
    }

    this.damage(world, s, hours);
  }

  /** A hurricane pumps its own rain into the cells it passes over. */
  private soak(world: World, s: Storm, hours: number): void {
    const c = world.climate;
    const reach = Math.ceil(s.radius / c.cellSize);
    const ccx = c.cellX(s.x);
    const ccz = c.cellZ(s.z);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx >= c.cells || cz >= c.cells) continue;
        const d = Math.hypot(dx, dz) * c.cellSize;
        if (d > s.radius) continue;
        const w = (1 - smoothstep(0, s.radius, d)) * s.intensity;
        const j = cz * c.cells + cx;
        c.humidity[j] += w * hours * 1.6;
        c.precipitation[j] = Math.max(c.precipitation[j], w * 18);
        const ang = Math.atan2(cz - ccz, cx - ccx) + Math.PI * 0.5;
        const gust = w * 30;
        c.windU[j] = c.windU[j] * 0.4 + Math.cos(ang) * gust * 0.6;
        c.windV[j] = c.windV[j] * 0.4 + Math.sin(ang) * gust * 0.6;
      }
    }
  }

  /** What the storm does to the things it crosses. */
  private damage(world: World, s: Storm, hours: number): void {
    const force = s.intensity * hours;
    if (force <= 0) return;

    // Buildings: a tornado is concentrated and brutal, a hurricane is wide
    // and grinding. Both are resisted by what the building is made of.
    for (const b of [...world.buildings]) {
      const d = Math.hypot(b.worldX - s.x, b.worldZ - s.z);
      if (d > s.radius) continue;
      const w = 1 - smoothstep(0, s.radius, d);
      const raw = s.kind === 'tornado' ? force * w * 2.6 : force * w * 0.32;
      const resisted = raw * (1 - windResistance(b) * 0.8);
      if (resisted > 0.004) world.damageBuilding(b, resisted);
    }

    // Trees come down. A hurricane flattens a swathe of forest.
    const felled: number[] = [];
    const treeChance = s.kind === 'tornado' ? force * 6 : force * 0.5;
    world.nodeGrid.forEachNear(s.x, s.z, s.radius, (node) => {
      const d = Math.hypot(node.x - s.x, node.z - s.z);
      if (d > s.radius) return;
      const w = 1 - smoothstep(0, s.radius, d);
      if (this.rng.chance(clamp01(treeChance * w))) felled.push(node.id);
    });
    for (const id of felled) {
      const node = world.nodeById.get(id);
      if (node) world.fellByWind(node);
    }

    // People run for cover, and can be hurt if they are caught in the open.
    for (const npc of world.npcs) {
      const d = Math.hypot(npc.x - s.x, npc.z - s.z);
      if (d > s.radius * 1.6) continue;
      world.startleNpc(npc, s.x, s.z);
      if (d < s.radius * 0.5 && !world.isSheltered(npc)) {
        const harm = (s.kind === 'tornado' ? 22 : 4) * force;
        npc.needs.health = clamp(npc.needs.health - harm, 0, 100);
      }
    }
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return { storms: this.storms.map((s) => ({ ...s })) };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data || !Array.isArray(data.storms)) return;
    this.storms.length = 0;
    for (const raw of data.storms as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.kind !== 'tornado' && raw.kind !== 'hurricane') continue;
      const num = (k: string, fallback: number): number =>
        typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : fallback;
      this.storms.push({
        id: this.nextId++,
        kind: raw.kind,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : 'Storm',
        x: num('x', 0),
        z: num('z', 0),
        heading: num('heading', 0),
        speed: num('speed', 500),
        radius: clamp(num('radius', 60), 5, 20000),
        intensity: clamp01(num('intensity', 0.5)),
        life: clamp(num('life', 10), 0, 5000),
        spin: num('spin', 0),
        announced: true,
      });
    }
  }
}
