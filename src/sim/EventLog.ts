/**
 * The world's memory.
 *
 * Events store a translation key and its parameters rather than a finished
 * sentence, so a chronicle written in one language reads correctly after the
 * player switches to another. Pre-history generated at world creation is the
 * one exception: it is already prose, and is stored as a literal.
 */

import { GameTime, TimeSnapshot } from './Time';

export type EventCategory =
  | 'construction'
  | 'production'
  | 'settlement'
  | 'weather'
  | 'people'
  | 'discovery'
  | 'economy'
  | 'warning'
  | 'history'
  | 'nature'
  | 'disaster'
  | 'politics';

export type EventParams = Record<string, string | number>;

export interface WorldEvent {
  id: number;
  day: number;
  year: number;
  month: number;
  dayOfMonth: number;
  category: EventCategory;
  /** Translation key, or '' when `literal` carries the text. */
  key: string;
  params?: EventParams;
  /** Pre-formatted text, used only for generated pre-history. */
  literal?: string;
  /** Optional world position so the UI can take the player there. */
  x?: number;
  z?: number;
  /** Shown as a toast when true. */
  notable: boolean;
}

const MAX_EVENTS = 800;

export class EventLog {
  /**
   * Called for everything that happens, so the long memory can decide what is
   * worth keeping at the moment it happens rather than trawling a feed that
   * has already thrown most of it away.
   */
  readonly onAdd: ((e: WorldEvent) => void)[] = [];
  private events: WorldEvent[] = [];
  private nextId = 1;
  /** Events added since the UI last drained them, for toast notifications. */
  private pendingToasts: WorldEvent[] = [];

  add(
    time: GameTime | TimeSnapshot,
    category: EventCategory,
    key: string,
    params?: EventParams,
    options: { notable?: boolean; x?: number; z?: number } = {},
  ): WorldEvent {
    const snap = time instanceof GameTime ? time.snapshot() : time;
    const ev: WorldEvent = {
      id: this.nextId++,
      day: snap.totalDays,
      year: snap.year,
      month: snap.month,
      dayOfMonth: snap.dayOfMonth,
      category,
      key,
      params,
      notable: options.notable ?? false,
      x: options.x,
      z: options.z,
    };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    if (ev.notable) {
      this.pendingToasts.push(ev);
      if (this.pendingToasts.length > 8) this.pendingToasts.shift();
    }
    for (const fn of this.onAdd) fn(ev);
    return ev;
  }

  /** Pre-history written at world generation, before the clock starts. */
  addHistory(text: string): void {
    const ev: WorldEvent = {
      id: this.nextId++,
      day: -1,
      year: 0,
      month: 0,
      dayOfMonth: 0,
      category: 'history',
      key: '',
      literal: text,
      notable: false,
    };
    this.events.push(ev);
    for (const fn of this.onAdd) fn(ev);
  }

  all(): readonly WorldEvent[] {
    return this.events;
  }

  recent(count: number): WorldEvent[] {
    return this.events.slice(-count).reverse();
  }

  byCategory(category: EventCategory): WorldEvent[] {
    return this.events.filter((e) => e.category === category);
  }

  drainToasts(): WorldEvent[] {
    const out = this.pendingToasts;
    this.pendingToasts = [];
    return out;
  }

  serialize(): WorldEvent[] {
    return this.events;
  }

  static deserialize(events: WorldEvent[]): EventLog {
    const log = new EventLog();
    log.events = (events ?? []).filter((e) => e && typeof e.id === 'number');
    log.nextId = log.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    return log;
  }
}
