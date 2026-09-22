/**
 * God Mode.
 *
 * A second way to play, not a debug menu. The camera leaves the player's body
 * and can climb from head height to a view of the whole continent; powers
 * reshape the world; and any settler can be taken over and played directly.
 *
 * Every power routes through the simulation rather than editing results. An
 * earthquake shakes the ground and lets the damage model decide what falls
 * down; rain goes through the weather system and reaches farming, fire and
 * movement on its own.
 */

import { Vector3 } from 'three';
import type { World } from '../sim/World';
import type { Npc } from '../sim/Npc';
import { clamp } from '../core/math';
import { RESOURCES, ResourceKind } from '../world/resources';
import { Biome } from '../world/types';
import { speciesForBiome } from '../sim/Wildlife';
import type { WeatherKind } from '../sim/Weather';

export type GodCategory = 'weather' | 'geology' | 'water' | 'life' | 'civilization' | 'disaster';

export type GodPowerId =
  | 'rain'
  | 'storm'
  | 'snow'
  | 'clear'
  | 'drought'
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'earthquake'
  | 'volcano'
  | 'spring'
  | 'flood'
  | 'drain'
  | 'forest'
  | 'clearVegetation'
  | 'wildlife'
  | 'fertility'
  | 'settlers'
  | 'wildfire'
  | 'meteor';

export interface GodPowerDef {
  id: GodPowerId;
  category: GodCategory;
  /** Global powers (weather) apply without a target point. */
  global: boolean;
  minRadius: number;
  maxRadius: number;
  defaultRadius: number;
  /** Whether the strength slider is meaningful for this power. */
  hasStrength: boolean;
  defaultStrength: number;
  /** Powers that reshape terrain can be undone. */
  undoable: boolean;
  /** Held down to paint continuously rather than applied on click. */
  continuous: boolean;
}

function p(
  id: GodPowerId,
  category: GodCategory,
  opts: Partial<GodPowerDef> = {},
): GodPowerDef {
  return {
    id,
    category,
    global: false,
    minRadius: 6,
    maxRadius: 120,
    defaultRadius: 30,
    hasStrength: true,
    defaultStrength: 0.5,
    undoable: false,
    continuous: false,
    ...opts,
  };
}

export const GOD_POWERS: GodPowerDef[] = [
  p('rain', 'weather', { global: true, hasStrength: false }),
  p('storm', 'weather', { global: true, hasStrength: false }),
  p('snow', 'weather', { global: true, hasStrength: false }),
  p('clear', 'weather', { global: true, hasStrength: false }),
  p('drought', 'weather', { global: true, hasStrength: false }),

  p('raise', 'geology', { defaultRadius: 24, undoable: true, continuous: true, defaultStrength: 0.35 }),
  p('lower', 'geology', { defaultRadius: 24, undoable: true, continuous: true, defaultStrength: 0.35 }),
  p('smooth', 'geology', { defaultRadius: 24, undoable: true, continuous: true, defaultStrength: 0.5 }),
  p('volcano', 'geology', { defaultRadius: 55, maxRadius: 180, undoable: true, defaultStrength: 0.7 }),
  p('earthquake', 'disaster', { defaultRadius: 90, maxRadius: 300, defaultStrength: 0.6 }),

  p('spring', 'water', { defaultRadius: 12, maxRadius: 40, undoable: true, defaultStrength: 0.4 }),
  p('flood', 'water', { defaultRadius: 45, maxRadius: 160, defaultStrength: 0.5 }),
  p('drain', 'water', { defaultRadius: 45, maxRadius: 160, undoable: true, hasStrength: false }),

  p('forest', 'life', { defaultRadius: 35, continuous: true, defaultStrength: 0.5 }),
  p('clearVegetation', 'life', { defaultRadius: 25, continuous: true, hasStrength: false }),
  p('wildlife', 'life', { defaultRadius: 20, hasStrength: false }),
  p('fertility', 'life', { defaultRadius: 30, continuous: true, defaultStrength: 0.5 }),

  p('settlers', 'civilization', { defaultRadius: 10, maxRadius: 30, defaultStrength: 0.3 }),

  p('wildfire', 'disaster', { defaultRadius: 20, maxRadius: 80, defaultStrength: 0.7 }),
  p('meteor', 'disaster', { defaultRadius: 40, maxRadius: 140, defaultStrength: 0.6 }),
];

export const GOD_POWER_BY_ID: Record<GodPowerId, GodPowerDef> = Object.fromEntries(
  GOD_POWERS.map((d) => [d.id, d]),
) as Record<GodPowerId, GodPowerDef>;

export type GodLayer = 'borders' | 'trade' | 'population' | 'resources' | 'constellations';

export class GodMode {
  active = false;
  selectedPower: GodPowerId | null = null;
  radius = 30;
  strength = 0.5;
  /** Npc currently being played directly, or 0. */
  possessed = 0;
  readonly layers = new Set<GodLayer>();

  /** Where the cursor is pointing in the world, for the brush preview. */
  readonly cursor = new Vector3();
  cursorValid = false;

  private world: World;
  /** Simulated seconds until a continuous power may fire again. */
  private paintCooldown = 0;

  constructor(world: World) {
    this.world = world;
  }

  selectPower(id: GodPowerId | null): void {
    this.selectedPower = id;
    if (!id) return;
    const def = GOD_POWER_BY_ID[id];
    this.radius = def.defaultRadius;
    this.strength = def.defaultStrength;
  }

  get currentPower(): GodPowerDef | null {
    return this.selectedPower ? GOD_POWER_BY_ID[this.selectedPower] : null;
  }

  tick(dt: number): void {
    if (this.paintCooldown > 0) this.paintCooldown -= dt;
  }

  /** True when a held mouse button should apply the power again. */
  canPaint(): boolean {
    return this.paintCooldown <= 0;
  }

  /**
   * Applies the selected power. Returns the power that fired so the UI can
   * report it, or null when nothing happened.
   */
  apply(x: number, z: number): GodPowerId | null {
    const def = this.currentPower;
    if (!def) return null;
    if (def.continuous) {
      if (this.paintCooldown > 0) return null;
      this.paintCooldown = 0.12;
    }

    const w = this.world;
    const r = this.radius;
    const s = this.strength;

    switch (def.id) {
      // ------------------------------------------------------------ weather
      case 'rain':
        w.weather.force('rain', 10);
        break;
      case 'storm':
        w.weather.force('storm', 5);
        break;
      case 'snow':
        w.weather.force('snow', 12);
        break;
      case 'clear':
        w.weather.force('clear', 18);
        break;
      case 'drought':
        w.weather.force('clear', 96);
        w.applyDrought();
        break;

      // ------------------------------------------------------------ geology
      case 'raise':
        w.editor.sculpt(x, z, r, s * 4, 'dome', 'raise');
        w.nav.markCostDirty();
        break;
      case 'lower':
        w.editor.sculpt(x, z, r, -s * 4, 'dome', 'lower');
        w.nav.markCostDirty();
        break;
      case 'smooth':
        w.editor.sculpt(x, z, r, s, 'flatten', 'level');
        w.nav.markCostDirty();
        break;
      case 'volcano':
        w.raiseVolcano(x, z, r, s);
        break;
      case 'earthquake':
        w.disasters.earthquake(w, x, z, s, r);
        break;

      // -------------------------------------------------------------- water
      case 'spring':
        w.createSpring(x, z, r, s);
        break;
      case 'flood':
        w.disasters.flood(w, x, z, r, 1 + s * 4, 120 + s * 300);
        break;
      case 'drain':
        w.editor.drain(x, z, r);
        break;

      // --------------------------------------------------------------- life
      case 'forest':
        this.growForest(x, z, r, s);
        break;
      case 'clearVegetation':
        this.clearVegetation(x, z, r);
        break;
      case 'wildlife':
        this.spawnWildlife(x, z, r);
        break;
      case 'fertility':
        w.enrichSoil(x, z, r, s);
        break;

      // ------------------------------------------------------- civilization
      case 'settlers':
        w.sendSettlers(x, z, Math.max(1, Math.round(1 + s * 6)));
        break;

      // ----------------------------------------------------------- disaster
      case 'wildfire': {
        const count = Math.max(1, Math.round(1 + s * 4));
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const rr = r * 0.4 * Math.random();
          w.ignite(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.6 + s * 0.4);
        }
        break;
      }
      case 'meteor':
        w.disasters.meteor(w, x, z, s);
        break;
    }

    return def.id;
  }

  private growForest(x: number, z: number, radius: number, strength: number): void {
    const w = this.world;
    const attempts = Math.round(6 + strength * 40);
    for (let i = 0; i < attempts; i++) {
      const a = w.rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(w.rng.next()) * radius;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const biome = w.terrain.biomeAt(px, pz);
      const kind = treeForBiome(biome);
      if (!kind) continue;
      const node = w.plantSapling(kind, px, pz);
      // A god-grown forest arrives mature rather than as a field of twigs.
      if (node) node.growth = 0.55 + w.rng.next() * 0.45;
    }
  }

  private clearVegetation(x: number, z: number, radius: number): void {
    const w = this.world;
    const doomed: number[] = [];
    w.nodeGrid.forEachNear(x, z, radius, (n) => {
      if (Math.hypot(n.x - x, n.z - z) <= radius) doomed.push(n.id);
    });
    for (const id of doomed) {
      const n = w.nodeById.get(id);
      if (n) w.removeNode(n);
    }
  }

  private spawnWildlife(x: number, z: number, radius: number): void {
    const w = this.world;
    const biome = w.terrain.biomeAt(x, z);
    const options = speciesForBiome(biome);
    if (options.length === 0) return;
    const species = w.rng.pick(options);
    const herd = w.rng.int(3, 6);
    for (let i = 0; i < herd; i++) {
      const a = w.rng.range(0, Math.PI * 2);
      const rr = w.rng.next() * radius;
      const px = clamp(x + Math.cos(a) * rr, 4, w.terrain.worldSize - 4);
      const pz = clamp(z + Math.sin(a) * rr, 4, w.terrain.worldSize - 4);
      if (w.terrain.waterDepthAt(px, pz) > 0.4) continue;
      w.addAnimal(species, px, pz);
    }
  }

  // ------------------------------------------------------------ possession

  /**
   * Takes over a settler. Their AI stops, but their body, pack, job, home and
   * relationships are all still theirs — anything done while possessed is done
   * by that person and stays on their record.
   */
  possess(npc: Npc): void {
    this.possessed = npc.id;
    this.world.possessed = npc.id;
    npc.clearTask();
    npc.remember(this.world.time.totalDays, 'memory.possessed');
  }

  release(): void {
    const npc = this.world.npcById.get(this.possessed);
    if (npc) {
      npc.clearTask();
      npc.activity = 'idle';
    }
    this.possessed = 0;
    this.world.possessed = 0;
  }

  get possessedNpc(): Npc | null {
    return this.possessed ? (this.world.npcById.get(this.possessed) ?? null) : null;
  }

  toggleLayer(layer: GodLayer): void {
    if (this.layers.has(layer)) this.layers.delete(layer);
    else this.layers.add(layer);
  }
}

function treeForBiome(biome: Biome): ResourceKind | null {
  switch (biome) {
    case Biome.Taiga:
    case Biome.Mountain:
      return 'pine';
    case Biome.TemperateForest:
    case Biome.Grassland:
      return 'oak';
    case Biome.DenseForest:
      return 'oak';
    case Biome.Wetland:
      return 'birch';
    case Biome.Beach:
    case Biome.Savanna:
      return 'palm';
    case Biome.Desert:
      return 'cactus';
    default:
      return null;
  }
}

export { RESOURCES };
export type { WeatherKind };
