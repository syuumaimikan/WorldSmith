/**
 * Localized names for game entities.
 *
 * Data definitions keep their English name inline so that adding content never
 * requires touching a translation file; these helpers look for a translation
 * first and fall back to that definition. Every UI surface goes through here
 * rather than reading `def.name` directly.
 */

import { t, tName, tDesc } from './index';
import { ItemId, ITEMS } from '../data/items';
import { BuildingId, BUILDINGS, BuildingCategory, StageId } from '../data/buildings';
import { ProfessionId, PROFESSIONS } from '../data/professions';
import { ResearchId, RESEARCH } from '../data/research';
import { RECIPES, RecipeId } from '../data/recipes';
import { Biome, BIOME_NAMES } from '../world/types';
import { ResourceKind, RESOURCES } from '../world/resources';
import { NpcActivity } from '../sim/Npc';
import { SettlementTier } from '../sim/Settlement';
import type { WeatherKind } from '../sim/Weather';
import { WEATHER_PROFILES } from '../sim/Weather';
import type { Season } from '../render/TerrainColors';

export function itemName(id: ItemId): string {
  return tName('item', id, ITEMS[id]?.name ?? id);
}

export function itemDescription(id: ItemId): string {
  return tDesc('item', id, ITEMS[id]?.description ?? '');
}

export function buildingName(id: BuildingId): string {
  return tName('building', id, BUILDINGS[id]?.name ?? id);
}

export function buildingDescription(id: BuildingId): string {
  return tDesc('building', id, BUILDINGS[id]?.description ?? '');
}

export function categoryName(c: BuildingCategory): string {
  return t(`cat.${c}`);
}

export function stageName(id: StageId, fallback: string): string {
  return tName('stage', id, fallback);
}

export function professionName(id: ProfessionId): string {
  return tName('profession', id, PROFESSIONS[id]?.name ?? id);
}

export function researchName(id: ResearchId): string {
  return tName('research', id, RESEARCH[id]?.name ?? id);
}

export function researchDescription(id: ResearchId): string {
  return tDesc('research', id, RESEARCH[id]?.description ?? '');
}

export function recipeName(id: RecipeId): string {
  return tName('recipe', id, RECIPES[id]?.name ?? id);
}

export function biomeName(b: Biome): string {
  return tName('biome', Biome[b] ?? String(b), BIOME_NAMES[b] ?? String(b));
}

export function resourceName(kind: ResourceKind): string {
  return tName('resource', kind, RESOURCES[kind]?.name ?? kind);
}

export function activityName(a: NpcActivity): string {
  return t(`activity.${a}`);
}

export function seasonName(s: Season): string {
  return t(`season.${s}`);
}

export function weatherName(w: WeatherKind): string {
  return tName('weather', w, WEATHER_PROFILES[w]?.label ?? w);
}

export function tierName(tier: SettlementTier): string {
  return t(`tier.${tier}`);
}

export function moodName(mood: number): string {
  if (mood > 82) return t('mood.content');
  if (mood > 66) return t('mood.fine');
  if (mood > 48) return t('mood.tired');
  if (mood > 30) return t('mood.unhappy');
  return t('mood.miserable');
}

export function priorityName(priority: number): string {
  return t(['priority.low', 'priority.normal', 'priority.high', 'priority.critical'][priority] ?? 'priority.normal');
}

/** "3 planks, 2 stone" in the active language. */
export function itemList(entries: { item: ItemId; amount: number }[]): string {
  return entries.map((e) => `${e.amount} ${itemName(e.item)}`).join(', ');
}
