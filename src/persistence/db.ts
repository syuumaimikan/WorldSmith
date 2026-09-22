/** IndexedDB access for saved worlds, via Dexie. */

import Dexie, { Table } from 'dexie';
import type { SaveData, SaveSummary } from './schema';

export interface SaveRecord {
  id: string;
  summary: SaveSummary;
  data: SaveData;
}

class WorldSmithDb extends Dexie {
  saves!: Table<SaveRecord, string>;

  constructor() {
    super('worldsmith');
    this.version(1).stores({ saves: 'id' });
  }
}

let db: WorldSmithDb | null = null;

export function getDb(): WorldSmithDb {
  if (!db) db = new WorldSmithDb();
  return db;
}
