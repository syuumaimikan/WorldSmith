/**
 * Rendering world events into the player's language.
 *
 * Events are stored as a key plus parameters, so the chronicle re-reads
 * correctly in whatever language is active when it is opened rather than in
 * whatever language was active when the event happened.
 *
 * Parameters that are entity ids (a building id, a stage id, a season) are
 * resolved to localized names here. The table is explicit rather than
 * guessing, because "tent" is a valid building id and also a plausible piece
 * of free text.
 */

import { t } from './index';
import type { WorldEvent } from '../sim/EventLog';
import { MONTH_NAMES } from '../sim/Time';
import {
  buildingName,
  researchName,
  resourceName,
  seasonName,
  stageName,
  tierName,
  weatherName,
} from './names';
import type { BuildingId, StageId } from '../data/buildings';
import type { ResearchId } from '../data/research';
import type { ResourceKind } from '../world/resources';
import type { WeatherKind } from '../sim/Weather';
import type { Season } from '../render/TerrainColors';
import type { SettlementTier } from '../sim/Settlement';

type Resolver = (value: string) => string;

const asBuilding: Resolver = (v) => buildingName(v as BuildingId);
const asStage: Resolver = (v) => stageName(v as StageId, v);
const asResource: Resolver = (v) => resourceName(v as ResourceKind);
const asResearch: Resolver = (v) => researchName(v as ResearchId);
const asSeason: Resolver = (v) => seasonName(v as Season);
const asWeather: Resolver = (v) => weatherName(v as WeatherKind).toLowerCase();
const asTier: Resolver = (v) => tierName(v as SettlementTier);
/**
 * Landmark lore is stored as a key. Worlds saved before it was a key hold the
 * English prose itself, so anything that is not a key is passed through.
 */
const asLore: Resolver = (v) => (v.startsWith('poi.lore.') ? t(v) : v);

const RESOLVERS: Record<string, Record<string, Resolver>> = {
  'ev.blueprint': { name: asBuilding },
  'ev.stageDone': { name: asBuilding, stage: asStage },
  'ev.completed': { name: asBuilding },
  'ev.completedBy': { name: asBuilding },
  'ev.cancelled': { name: asBuilding },
  'ev.demolishScheduled': { name: asBuilding },
  'ev.demolished': { name: asBuilding },
  'ev.felled': { what: asResource },
  'ev.researchDone': { name: asResearch },
  'ev.seasonArrives': { season: asSeason },
  'ev.weatherTurns': { weather: asWeather },
  'ev.promoted': { tier: asTier },
  'ev.discovered': { lore: asLore },
  'ev.revolution': { from: (v) => t(v), to: (v) => t(v) },
  'ev.eraReached': { era: (v) => t(v) },
  'ev.eraLost': { era: (v) => t(v) },
  'ev.warDeclared': { goal: (v) => t(v) },
  'ev.repaired': { name: asBuilding },
  'event.eruption': { name: (v) => v },
};

export function eventText(e: WorldEvent): string {
  if (e.literal) return e.literal;
  const resolvers = RESOLVERS[e.key];
  if (!resolvers || !e.params) return t(e.key, e.params);

  const resolved: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.params)) {
    const r = resolvers[k];
    resolved[k] = r !== undefined && typeof v === 'string' ? r(v) : v;
  }
  return t(e.key, resolved);
}

export function eventDate(e: WorldEvent): string {
  if (e.day < 0) return t('chron.before');
  return t('date.short', { year: e.year, month: monthName(e.month), day: e.dayOfMonth });
}

export function monthName(index: number): string {
  const safe = ((index % 12) + 12) % 12;
  const key = `month.${safe}`;
  const value = t(key);
  return value === key ? MONTH_NAMES[safe] : value;
}

/** "Seedmoon 3, Year 2" for the HUD clock. */
export function formatDate(year: number, month: number, dayOfMonth: number): string {
  return t('date.long', { year, month: monthName(month), day: dayOfMonth });
}
