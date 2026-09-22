/** Player settings persisted to localStorage (small, synchronous, no schema). */

import { DEFAULT_SETTINGS, GameSettings } from '../game/Game';
import { Action, DEFAULT_BINDINGS } from '../engine/Input';

const KEY = 'worldsmith.settings.v1';
const BIND_KEY = 'worldsmith.bindings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable in private browsing; settings just won't persist */
  }
}

export function loadBindings(): Record<Action, string[]> {
  try {
    const raw = localStorage.getItem(BIND_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<Record<Action, string[]>>;
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Record<Action, string[]>): void {
  try {
    localStorage.setItem(BIND_KEY, JSON.stringify(bindings));
  } catch {
    /* ignore */
  }
}
