/**
 * Finding the mods.
 *
 * Two places they come from. `public/mods/index.json` lists the ones that
 * ship with the game or have been dropped into its folder, and the player can
 * add one from a file they were sent. Both go through the same validation,
 * because "it came with the game" is a claim about provenance and not about
 * whether the JSON is well formed.
 *
 * Which ones are switched on is remembered in the browser's own settings,
 * separately from any world, because a mod is a property of the installation
 * rather than of a save.
 */

import { mods } from './ModRegistry';
import type { InstalledMod } from './types';
import { registerModStrings } from '../i18n';

const ENABLED_KEY = 'worldsmith.mods.enabled';
const EXTRA_KEY = 'worldsmith.mods.extra';

function readEnabledSet(): Set<string> | null {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? new Set(list.filter((x) => typeof x === 'string')) : null;
  } catch {
    return null;
  }
}

function writeEnabledSet(): void {
  try {
    const on = mods.mods.filter((m) => m.enabled).map((m) => m.manifest.id);
    localStorage.setItem(ENABLED_KEY, JSON.stringify(on));
  } catch {
    // A browser with storage switched off still gets to play; it just does
    // not remember which mods were on.
  }
}

function readExtras(): unknown[] {
  try {
    const raw = localStorage.getItem(EXTRA_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeExtras(list: unknown[]): void {
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(list));
  } catch {
    // As above.
  }
}

/**
 * Loads every mod the game can find and applies the enabled ones.
 *
 * Called once, before the first world is built, because the content tables
 * are what world generation reads.
 */
export async function loadMods(): Promise<void> {
  let names: string[] = [];
  try {
    const res = await fetch('mods/index.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      const list = (data as { mods?: unknown }).mods;
      if (Array.isArray(list)) {
        names = list.filter((n): n is string => typeof n === 'string' && /^[a-z0-9_-]{1,40}$/.test(n));
      }
    }
  } catch {
    // No index, no bundled mods. Not an error: a game with no mods is the
    // ordinary case.
  }

  for (const name of names) {
    try {
      const res = await fetch('mods/' + name + '/mod.json', { cache: 'no-cache' });
      if (!res.ok) continue;
      mods.install(await res.json(), 'bundled');
    } catch (err) {
      console.warn('[WorldSmith] could not read mod ' + name, err);
    }
  }

  for (const extra of readExtras()) mods.install(extra, 'file');

  const enabled = readEnabledSet();
  for (const mod of mods.mods) {
    // A mod is on unless it was switched off. A newly added one arriving
    // switched off would look broken.
    mod.enabled = enabled ? enabled.has(mod.manifest.id) : true;
  }
  mods.applyAll();
  publishModStrings();
}

/** Hands the mods' text to the dictionary, which renders it as text. */
function publishModStrings(): void {
  for (const [locale, table] of mods.strings) registerModStrings(locale, table);
}

/** Turns one on or off and remembers the choice. */
export function setModEnabled(id: string, enabled: boolean): void {
  mods.setEnabled(id, enabled);
  publishModStrings();
  writeEnabledSet();
}

/**
 * Adds a mod from a file the player chose.
 *
 * Kept in the browser's storage so it survives a reload, and applied through
 * exactly the same path as a bundled one.
 */
export function installFromText(text: string): InstalledMod | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const mod = mods.install(parsed, 'file');
  if (!mod) return null;

  const extras = readExtras().filter(
    (e) => (e as { id?: unknown }).id !== mod.manifest.id,
  );
  extras.push(parsed);
  writeExtras(extras);
  mods.applyAll();
  publishModStrings();
  writeEnabledSet();
  return mod;
}

/** Forgets a mod the player added. Bundled ones can only be switched off. */
export function uninstall(id: string): void {
  const mod = mods.mods.find((m) => m.manifest.id === id);
  if (!mod || mod.source !== 'file') return;
  mods.remove(id);
  writeExtras(readExtras().filter((e) => (e as { id?: unknown }).id !== id));
  writeEnabledSet();
}
