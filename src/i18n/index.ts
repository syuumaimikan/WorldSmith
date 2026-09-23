/**
 * Localization.
 *
 * Strings live in dictionaries keyed by id, never inline in components. The
 * current locale is a module-level store that React subscribes to with
 * useSyncExternalStore, so switching language re-renders the interface
 * immediately without a reload.
 *
 * Missing keys fall back to English and then to the key itself, so a partial
 * translation degrades to readable text rather than blanks.
 */

import { useSyncExternalStore } from 'react';
import { en } from './en';
import { ja } from './ja';

export type Locale = 'en' | 'ja';

export const LOCALES: { id: Locale; label: string; nativeLabel: string }[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'ja', label: 'Japanese', nativeLabel: '日本語' },
];

export type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { en, ja };

const STORAGE_KEY = 'worldsmith.locale';

let current: Locale = detectInitialLocale();
const listeners = new Set<() => void>();

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ja') return stored;
  } catch {
    /* storage unavailable; fall through to browser preference */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja')) {
      return 'ja';
    }
  } catch {
    /* no navigator in tests */
  }
  return 'en';
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (current === locale) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* preference simply will not persist */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Looks up a string. `params` are substituted into `{name}` placeholders.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTIONARIES[current];
  // A mod's own strings, looked up after the game's so a mod cannot silently
  // redefine anything the game says about itself.
  const modded = dict[key] === undefined && en[key] === undefined ? modString(key) : undefined;
  let value = dict[key] ?? en[key] ?? modded ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

/** True when a key exists in the active dictionary or in English. */
export function hasKey(key: string): boolean {
  return (
    DICTIONARIES[current][key] !== undefined ||
    en[key] !== undefined ||
    modString(key) !== undefined
  );
}

/**
 * A string a mod supplied.
 *
 * Registered rather than imported, so that the dictionary does not depend on
 * the mod layer and the tests can run without one. Everything in here is text
 * from a file somebody else wrote; it is substituted into `{name}` slots and
 * rendered as text, never as markup.
 */
const modStrings = new Map<string, Map<string, string>>();

export function registerModStrings(locale: string, table: Map<string, string>): void {
  modStrings.set(locale, table);
}

function modString(key: string): string | undefined {
  return modStrings.get(current)?.get(key) ?? modStrings.get('en')?.get(key);
}

/**
 * Translates an entity name, falling back to the name baked into the data
 * definition. This means adding a new item never breaks the UI in any
 * language — it just shows the English name until someone translates it.
 */
export function tName(kind: string, id: string, fallback: string): string {
  const key = `${kind}.${id}`;
  const dict = DICTIONARIES[current];
  return dict[key] ?? (current === 'en' ? fallback : en[key] ?? fallback);
}

export function tDesc(kind: string, id: string, fallback: string): string {
  const key = `${kind}.${id}.desc`;
  const dict = DICTIONARIES[current];
  return dict[key] ?? (current === 'en' ? fallback : en[key] ?? fallback);
}

/** React hook: re-renders the component when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/**
 * React hook returning a translate function bound to the current locale.
 * Components use this rather than importing `t` directly so that they
 * re-render on a language change.
 */
export function useT(): typeof t {
  useLocale();
  return t;
}

/** Applies the initial locale to the document. Called once at startup. */
export function initLocale(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    document.documentElement.dataset.locale = current;
  }
}

/** Reports untranslated keys. Used by a test to keep the dictionaries honest. */
export function missingKeys(locale: Locale): string[] {
  const dict = DICTIONARIES[locale];
  return Object.keys(en).filter((k) => dict[k] === undefined);
}
