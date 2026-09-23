/**
 * Putting a mod's content into the game.
 *
 * The game's items, resources, recipes and creatures live in plain records
 * that everything else reads at runtime. A mod's content goes into those same
 * records, under an id namespaced by the mod, and from that moment it is not
 * special: a porter will haul a modded ore, a cook will use a modded
 * ingredient, a modded creature is hunted by the same wolves and shows up in
 * the same census. There is no separate path for modded things, which is the
 * only way a mod system stays honest as the game grows.
 *
 * Applying is done once, before a world is built, because the content tables
 * are what world generation reads. Disabling a mod therefore takes effect on
 * the next world rather than instantly -- the alternative is a save whose
 * terrain contains a plant that no longer has a definition.
 */

import { ITEMS, ItemId, ItemDef } from '../data/items';
import { RECIPES, Recipe, RecipeId } from '../data/recipes';
import { BUILDINGS } from '../data/buildings';
import { RESOURCES, ResourceDef, ResourceKind, BIOME_FLORA, PRIMEVAL_FLORA } from '../world/resources';
import { ANIMALS, AnimalDef, AnimalSpecies } from '../sim/Wildlife';
import { Biome } from '../world/types';
import type { InstalledMod, ModManifest } from './types';
import { readManifest } from './validate';
import { MOD_LOOKS } from '../render/geometry/flora';

/** Everything a mod added, so it can be taken out again. */
interface Applied {
  items: string[];
  blocks: string[];
  creatures: string[];
  recipes: string[];
}

const BIOME_BY_NAME: Record<string, Biome> = {
  ocean: Biome.Ocean,
  lake: Biome.Lake,
  beach: Biome.Beach,
  grassland: Biome.Grassland,
  temperate_forest: Biome.TemperateForest,
  dense_forest: Biome.DenseForest,
  taiga: Biome.Taiga,
  tundra: Biome.Tundra,
  desert: Biome.Desert,
  savanna: Biome.Savanna,
  wetland: Biome.Wetland,
  mountain: Biome.Mountain,
  alpine: Biome.Alpine,
  river: Biome.River,
};

export class ModRegistry {
  readonly mods: InstalledMod[] = [];
  private applied = new Map<string, Applied>();
  /** Text the mods supplied, keyed by language then by namespaced key. */
  readonly strings = new Map<string, Map<string, string>>();

  /** Ids the game shipped with, so a mod cannot quietly replace one. */
  private readonly builtinItems = new Set(Object.keys(ITEMS));
  private readonly builtinBlocks = new Set(Object.keys(RESOURCES));
  private readonly builtinCreatures = new Set(Object.keys(ANIMALS));
  private readonly builtinRecipes = new Set(Object.keys(RECIPES));

  /** How a mod's own id becomes an id in the game's tables. */
  static qualify(modId: string, id: string): string {
    return modId + '__' + id;
  }

  install(raw: unknown, source: 'bundled' | 'file'): InstalledMod | null {
    const mod = readManifest(raw, source);
    if (!mod) return null;
    const existing = this.mods.findIndex((m) => m.manifest.id === mod.manifest.id);
    if (existing >= 0) {
      this.remove(this.mods[existing].manifest.id);
      this.mods[existing] = mod;
    } else {
      this.mods.push(mod);
    }
    return mod;
  }

  setEnabled(modId: string, enabled: boolean): void {
    const mod = this.mods.find((m) => m.manifest.id === modId);
    if (!mod) return;
    mod.enabled = enabled;
    if (enabled) this.apply(mod);
    else this.unapply(modId);
  }

  remove(modId: string): void {
    this.unapply(modId);
    const i = this.mods.findIndex((m) => m.manifest.id === modId);
    if (i >= 0) this.mods.splice(i, 1);
  }

  /** Puts every enabled mod's content into the game's tables. */
  applyAll(): void {
    for (const mod of this.mods) {
      if (mod.enabled) this.apply(mod);
    }
  }

  private apply(mod: InstalledMod): void {
    if (this.applied.has(mod.manifest.id)) return;
    const m = mod.manifest;
    const done: Applied = { items: [], blocks: [], creatures: [], recipes: [] };
    const q = (id: string): string => ModRegistry.qualify(m.id, id);

    for (const [lang, table] of Object.entries(m.strings ?? {})) {
      let bucket = this.strings.get(lang);
      if (!bucket) {
        bucket = new Map();
        this.strings.set(lang, bucket);
      }
      for (const [k, v] of Object.entries(table)) bucket.set(m.id + '.' + k, v);
    }

    // ------------------------------------------------------------- items
    for (const item of m.items ?? []) {
      const id = q(item.id);
      if (this.builtinItems.has(id)) {
        mod.problems.push('item ' + id + ' would replace one the game shipped with');
        continue;
      }
      const def: ItemDef = {
        id: id as ItemId,
        name: item.name,
        category: item.category,
        stackSize: item.stackSize,
        weight: item.weight,
        value: item.value,
        color: item.color,
        description: item.description ?? '',
        nutrition: item.nutrition,
        toolTier: item.toolTier,
        toolFor: item.toolFor,
      };
      (ITEMS as Record<string, ItemDef>)[id] = def;
      done.items.push(id);
    }

    // ------------------------------------------------------------ blocks
    for (const block of m.blocks ?? []) {
      const id = q(block.id);
      if (this.builtinBlocks.has(id)) {
        mod.problems.push('block ' + id + ' would replace one the game shipped with');
        continue;
      }
      const yields = block.yields
        .map((y) => ({ item: this.resolveItem(m, y.item), amount: y.amount }))
        .filter((y): y is { item: ItemId; amount: number } => y.item !== null);
      if (yields.length === 0) {
        mod.problems.push('block ' + id + ' yields nothing that exists');
        continue;
      }
      const def: ResourceDef = {
        kind: id as ResourceKind,
        name: block.name,
        category: block.category,
        skill: block.skill,
        yields,
        workPerUnit: block.workPerUnit,
        units: block.units,
        regrowDays: block.regrowDays,
        radius: block.radius,
        blocks: block.blocks,
        spreads: block.spreads,
      };
      (RESOURCES as Record<string, ResourceDef>)[id] = def;
      if (block.look) MOD_LOOKS.set(id, block.look);
      done.blocks.push(id);

      // Where it grows. A block with no biomes listed simply never appears on
      // its own, which is a legitimate thing for a mod to want.
      for (const [biomeName, weight] of Object.entries(block.biomes ?? {})) {
        const biome = BIOME_BY_NAME[biomeName];
        if (biome === undefined || weight <= 0) continue;
        for (const table of [BIOME_FLORA, PRIMEVAL_FLORA]) {
          const flora = table[biome];
          if (!flora) continue;
          flora.entries.push({ kind: id as ResourceKind, weight });
        }
      }
    }

    // --------------------------------------------------------- creatures
    for (const creature of m.creatures ?? []) {
      const id = q(creature.id);
      if (this.builtinCreatures.has(id)) {
        mod.problems.push('creature ' + id + ' would replace one the game shipped with');
        continue;
      }
      const biomes = creature.biomes
        .map((b) => BIOME_BY_NAME[b])
        .filter((b): b is Biome => b !== undefined);
      const def: AnimalDef = {
        species: id as AnimalSpecies,
        name: creature.name,
        build: creature.build,
        life: creature.life,
        diet: creature.diet,
        speed: creature.speed,
        fleeSpeed: creature.fleeSpeed,
        awareness: creature.awareness,
        yields: creature.yields
          .map((y) => ({ item: this.resolveItem(m, y.item), amount: y.amount }))
          .filter((y): y is { item: ItemId; amount: number } => y.item !== null),
        biomes,
        colour: creature.color,
        bellyColour: creature.bellyColor,
        size: creature.size,
        herdSize: creature.herdSize,
        density: creature.density,
        lifespan: creature.lifespan,
      };
      (ANIMALS as Record<string, AnimalDef>)[id] = def;
      done.creatures.push(id);
    }

    // ----------------------------------------------------------- recipes
    for (const recipe of m.recipes ?? []) {
      const id = q(recipe.id);
      if (this.builtinRecipes.has(id)) {
        mod.problems.push('recipe ' + id + ' would replace one the game shipped with');
        continue;
      }
      const building = (BUILDINGS as Record<string, { recipes?: RecipeId[] }>)[recipe.building];
      if (!building) {
        mod.problems.push('recipe ' + id + ': no building called ' + recipe.building);
        continue;
      }
      const inputs = recipe.inputs
        .map((y) => ({ item: this.resolveItem(m, y.item), amount: y.amount }))
        .filter((y): y is { item: ItemId; amount: number } => y.item !== null);
      const outputs = recipe.outputs
        .map((y) => ({ item: this.resolveItem(m, y.item), amount: y.amount }))
        .filter((y): y is { item: ItemId; amount: number } => y.item !== null);
      if (outputs.length === 0) {
        mod.problems.push('recipe ' + id + ' makes nothing that exists');
        continue;
      }
      const def: Recipe = {
        id: id as RecipeId,
        name: recipe.name,
        inputs,
        outputs,
        work: recipe.work,
        skill: 'crafting',
        defaultPriority: 1,
      };
      (RECIPES as Record<string, Recipe>)[id] = def;
      if (!building.recipes) building.recipes = [];
      building.recipes.push(id as RecipeId);
      done.recipes.push(id);
    }

    this.applied.set(m.id, done);
  }

  private unapply(modId: string): void {
    const done = this.applied.get(modId);
    if (!done) return;
    for (const id of done.items) delete (ITEMS as Record<string, unknown>)[id];
    for (const id of done.blocks) {
      delete (RESOURCES as Record<string, unknown>)[id];
      MOD_LOOKS.delete(id);
      for (const table of [BIOME_FLORA, PRIMEVAL_FLORA]) {
        for (const flora of Object.values(table)) {
          if (!flora) continue;
          for (let i = flora.entries.length - 1; i >= 0; i--) {
            if (flora.entries[i].kind === id) flora.entries.splice(i, 1);
          }
        }
      }
    }
    for (const id of done.creatures) delete (ANIMALS as Record<string, unknown>)[id];
    for (const id of done.recipes) {
      delete (RECIPES as Record<string, unknown>)[id];
      for (const b of Object.values(BUILDINGS)) {
        const i = b.recipes?.indexOf(id as RecipeId) ?? -1;
        if (i >= 0) b.recipes?.splice(i, 1);
      }
    }
    this.applied.delete(modId);
  }

  /**
   * An item id as written in a mod, resolved to one in the game.
   *
   * A bare name means the mod's own, because that is what a mod author means
   * nine times in ten. A name with a colon in it means somebody else's:
   * `core:log` is the game's own log.
   */
  private resolveItem(m: ModManifest, written: string): ItemId | null {
    if (written.includes(':')) {
      const [ns, rest] = written.split(':', 2);
      const id = ns === 'core' ? rest : ModRegistry.qualify(ns, rest);
      return id in ITEMS ? (id as ItemId) : null;
    }
    const own = ModRegistry.qualify(m.id, written);
    if (own in ITEMS) return own as ItemId;
    // Falling back to the game's own is a kindness: a mod that says `log`
    // almost certainly means a log.
    return written in ITEMS ? (written as ItemId) : null;
  }

  /** Every enabled mod's panels, for the interface to render. */
  get panels(): { modId: string; panel: ModManifest['ui'] extends undefined ? never : NonNullable<ModManifest['ui']>[number] }[] {
    const out: { modId: string; panel: NonNullable<ModManifest['ui']>[number] }[] = [];
    for (const mod of this.mods) {
      if (!mod.enabled) continue;
      for (const panel of mod.manifest.ui ?? []) out.push({ modId: mod.manifest.id, panel });
    }
    return out;
  }
}

/** The one registry the game uses. Mods are global, like the content they add. */
export const mods = new ModRegistry();
