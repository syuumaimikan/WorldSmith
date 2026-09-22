/**
 * Saving and loading worlds.
 *
 * Saves are versioned and migrated on load rather than rejected, and validated
 * before anything from them is trusted — a save file is untrusted input like
 * any other.
 */

import { World } from '../sim/World';
import { getDb } from './db';
import { migrate, SaveData, SaveSummary, validate } from './schema';
import { deserializeWorld, serializeWorld, summarise } from './serialize';

export type { SaveSummary };

const AUTOSAVE_PREFIX = 'auto:';

export function newSaveId(): string {
  return `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function listSaves(): Promise<SaveSummary[]> {
  try {
    const rows = await getDb().saves.toArray();
    return rows
      .map((r) => r.summary)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    console.warn('[WorldSmith] could not read saves', e);
    return [];
  }
}

export async function saveWorld(world: World, id: string): Promise<SaveSummary> {
  const data = serializeWorld(world, id);
  const summary = summarise(world, id);
  await getDb().saves.put({ id, summary, data });
  return summary;
}

/** Writes to the world's dedicated autosave slot. */
export async function autosaveWorld(world: World, baseId: string): Promise<SaveSummary> {
  const id = `${AUTOSAVE_PREFIX}${baseId}`;
  const data = serializeWorld(world, id);
  const summary = { ...summarise(world, id), name: `${world.config.name} (autosave)` };
  await getDb().saves.put({ id, summary, data });
  return summary;
}

export async function loadWorld(id: string, onProgress?: (f: number) => void): Promise<World> {
  onProgress?.(0.1);
  const row = await getDb().saves.get(id);
  if (!row) throw new Error('That save could not be found.');

  onProgress?.(0.35);
  const data = migrate(row.data as SaveData & Record<string, unknown>);
  const problem = validate(data);
  if (problem) throw new Error(`Save file is not usable: ${problem}`);

  onProgress?.(0.6);
  const world = deserializeWorld(data);
  onProgress?.(1);
  return world;
}

export async function deleteSave(id: string): Promise<void> {
  await getDb().saves.delete(id);
}

export async function exportSave(id: string): Promise<Blob> {
  const row = await getDb().saves.get(id);
  if (!row) throw new Error('Save not found');
  // Typed arrays do not survive JSON, so export as plain arrays.
  const json = JSON.stringify(row.data, (_key, value) => {
    if (ArrayBuffer.isView(value)) {
      return { __typed: value.constructor.name, data: Array.from(value as unknown as ArrayLike<number>) };
    }
    return value;
  });
  return new Blob([json], { type: 'application/json' });
}
