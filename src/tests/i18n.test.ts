/**
 * Localization guards.
 *
 * The English dictionary is the key registry. Any key it defines must exist in
 * every other language, and every placeholder must survive translation —
 * a dropped `{name}` shows the player a literal brace.
 */

import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { getLocale, missingKeys, setLocale, t, tName } from '../i18n';
import { ALL_ITEM_IDS, ITEMS } from '../data/items';
import { ALL_BUILDING_IDS, BUILDINGS } from '../data/buildings';
import { ALL_PROFESSIONS } from '../data/professions';

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}

describe('localization', () => {
  it('translates every English key into Japanese', () => {
    const missing = missingKeys('ja');
    expect(missing, `untranslated keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the same placeholders in every translation', () => {
    const mismatched: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const jaValue = ja[key];
      if (!jaValue) continue;
      const a = placeholders(value).join(',');
      const b = placeholders(jaValue).join(',');
      if (a !== b) mismatched.push(`${key}: en(${a}) vs ja(${b})`);
    }
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('has no empty strings', () => {
    for (const [key, value] of Object.entries(en)) expect(value.length, key).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(ja)) expect(value.length, key).toBeGreaterThan(0);
  });

  it('names every item, building and profession in Japanese', () => {
    const missing: string[] = [];
    for (const id of ALL_ITEM_IDS) if (!ja[`item.${id}`]) missing.push(`item.${id}`);
    for (const id of ALL_BUILDING_IDS) if (!ja[`building.${id}`]) missing.push(`building.${id}`);
    for (const id of ALL_PROFESSIONS) if (!ja[`profession.${id}`]) missing.push(`profession.${id}`);
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('substitutes parameters', () => {
    setLocale('en');
    expect(t('hud.settlers', { count: 7 })).toBe('7 settlers');
    setLocale('ja');
    expect(t('hud.settlers', { count: 7 })).toContain('7');
    setLocale('en');
  });

  it('falls back to the data definition for untranslated entity names', () => {
    setLocale('en');
    expect(tName('item', 'log', ITEMS.log.name)).toBe(ITEMS.log.name);
    expect(tName('building', 'tent', BUILDINGS.tent.name)).toBe(BUILDINGS.tent.name);
    // An id with no dictionary entry in either language still renders.
    expect(tName('item', 'not_a_real_item', 'Fallback')).toBe('Fallback');
  });

  it('switches locale and reports it', () => {
    setLocale('ja');
    expect(getLocale()).toBe('ja');
    expect(t('hud.build')).not.toBe('Build');
    setLocale('en');
    expect(t('hud.build')).toBe('Build');
  });
});
