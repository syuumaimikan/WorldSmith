/**
 * A mod's behaviour, while the world is running.
 *
 * Triggers and effects, both drawn from closed lists. A mod says "on the
 * turn of each season, with one chance in four, put three of these plants
 * within forty metres" and this is the thing that does it -- through the same
 * public methods the game uses on itself, so a mod cannot reach anywhere the
 * game would not go.
 *
 * Counters are the one piece of state a mod gets. They are numbers, they
 * belong to the world, and they are saved with it, which is enough to build a
 * quest, a tally, a season's harvest or a reputation out of.
 */

import type { World } from '../sim/World';
import type { ModEffect, ModManifest, ModSystem } from './types';
import { ModRegistry, mods } from './ModRegistry';
import { ITEMS as ITEMS_REF, type ItemId } from '../data/items';
import { RESOURCES as RESOURCES_REF, type ResourceKind } from '../world/resources';
import { ANIMALS as ANIMALS_REF, type AnimalSpecies } from '../sim/Wildlife';
import type { WeatherKind } from '../render/Sky';
import type { SeasonName } from '../sim/Time';

/** What a mod can remember. One flat map of numbers, saved with the world. */
export class ModCounters {
  private values = new Map<string, number>();

  get(key: string): number {
    return this.values.get(key) ?? 0;
  }

  set(key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.values.set(key, Math.max(-1e12, Math.min(1e12, value)));
  }

  add(key: string, amount: number): void {
    this.set(key, this.get(key) + amount);
  }

  serialize(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  restore(data: Record<string, unknown> | undefined): void {
    this.values.clear();
    if (!data || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data)) {
      if (typeof k !== 'string' || k.length > 120) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      this.values.set(k, Math.max(-1e12, Math.min(1e12, v)));
    }
  }
}

export type ModEvent =
  | { kind: 'day' }
  | { kind: 'year' }
  | { kind: 'season'; season: SeasonName }
  | { kind: 'weather'; weather: string }
  | { kind: 'harvest'; block: string }
  | { kind: 'craft'; recipe: string }
  | { kind: 'disaster'; disaster: string };

/** Whether a system's trigger matches what just happened. */
function matches(system: ModSystem, event: ModEvent): boolean {
  const w = system.when;
  switch (w.on) {
    case 'day':
      return event.kind === 'day';
    case 'year':
      return event.kind === 'year';
    case 'season':
      return event.kind === 'season' && (!w.season || w.season === event.season);
    case 'weather':
      return event.kind === 'weather' && (!w.kind || w.kind === event.weather);
    case 'harvest':
      return event.kind === 'harvest' && (!w.block || endsWithId(event.block, w.block));
    case 'craft':
      return event.kind === 'craft' && (!w.recipe || endsWithId(event.recipe, w.recipe));
    case 'disaster':
      return event.kind === 'disaster' && (!w.kind || w.kind === event.disaster);
    default:
      return false;
  }
}

/** A mod writes its own short ids; the game holds namespaced ones. */
function endsWithId(qualified: string, written: string): boolean {
  return qualified === written || qualified.endsWith('__' + written);
}

/**
 * Runs the enabled mods' systems for one thing that happened.
 *
 * Called from the places in the simulation that already exist. Nothing here
 * is on a frame timer: a mod is woken by an event or not at all.
 */
export function fireModEvent(world: World, event: ModEvent): void {
  for (const mod of mods.mods) {
    if (!mod.enabled) continue;
    for (const system of mod.manifest.systems ?? []) {
      if (!matches(system, event)) continue;
      if (system.requires) {
        const key = mod.manifest.id + '.' + system.requires.counter;
        if (world.modCounters.get(key) < system.requires.atLeast) continue;
      }
      if (system.chance !== undefined && !world.rng.chance(system.chance)) continue;
      runEffects(world, mod.manifest, system.then);
    }
  }
}

/** Carries out a list of effects. Also used by a mod panel's buttons. */
export function runEffects(world: World, manifest: ModManifest, effects: ModEffect[]): void {
  const q = (id: string): string => ModRegistry.qualify(manifest.id, id);
  const p = world.player.position;

  for (const effect of effects) {
    switch (effect.do) {
      case 'log':
        world.log.add(world.time, 'settlement', manifest.id + '.' + effect.key, undefined, {
          notable: effect.notable === true,
          x: p.x,
          z: p.z,
        });
        break;

      case 'give': {
        const id = q(effect.item);
        const item = (id in ITEMS_REF ? id : effect.item) as ItemId;
        if (!(item in ITEMS_REF)) break;
        world.player.inventory.add(item, effect.amount);
        break;
      }

      case 'spawnBlock': {
        const kind = q(effect.block) as ResourceKind;
        if (!(kind in RESOURCES_REF)) break;
        for (let i = 0; i < effect.count; i++) {
          const a = world.rng.range(0, Math.PI * 2);
          const r = world.rng.range(2, effect.radius);
          world.spawnNode(kind, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        }
        break;
      }

      case 'spawnCreature': {
        const species = q(effect.creature) as AnimalSpecies;
        if (!(species in ANIMALS_REF)) break;
        for (let i = 0; i < effect.count; i++) {
          const a = world.rng.range(0, Math.PI * 2);
          const r = world.rng.range(3, effect.radius);
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          if (!world.terrain.inWorld(x, z)) continue;
          if (world.terrain.waterDepthAt(x, z) > 0.6) continue;
          world.addAnimal(species, x, z);
        }
        break;
      }

      case 'weather':
        world.weather.force(effect.kind as WeatherKind, effect.hours);
        break;

      case 'setCounter':
        world.modCounters.set(manifest.id + '.' + effect.counter, effect.value);
        break;

      case 'addCounter':
        world.modCounters.add(manifest.id + '.' + effect.counter, effect.amount);
        break;

      default:
        break;
    }
  }
}

