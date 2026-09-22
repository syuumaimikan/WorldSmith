/**
 * The world's memory.
 *
 * Every notable thing that happens is recorded with the in-game date, so the
 * settlement accumulates a readable history: when the first house went up,
 * which storm took out the eastern road, when the sawmill started running.
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
  | 'history';

export interface WorldEvent {
  id: number;
  day: number;
  dateLabel: string;
  category: EventCategory;
  text: string;
  /** Optional world position so the UI can take the player there. */
  x?: number;
  z?: number;
  /** Shown as a toast when true. */
  notable: boolean;
}

const MAX_EVENTS = 600;

export class EventLog {
  private events: WorldEvent[] = [];
  private nextId = 1;
  /** Events added since the UI last drained them, for toast notifications. */
  private pendingToasts: WorldEvent[] = [];

  add(
    time: GameTime | TimeSnapshot,
    category: EventCategory,
    text: string,
    options: { notable?: boolean; x?: number; z?: number } = {},
  ): WorldEvent {
    const snap = time instanceof GameTime ? time.snapshot() : time;
    const ev: WorldEvent = {
      id: this.nextId++,
      day: snap.totalDays,
      dateLabel: GameTime.formatShortDate(snap),
      category,
      text,
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
    return ev;
  }

  /** Pre-history written at world generation, before the clock starts. */
  addHistory(text: string): void {
    this.events.push({
      id: this.nextId++,
      day: -1,
      dateLabel: 'Before',
      category: 'history',
      text,
      notable: false,
    });
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
    log.events = events ?? [];
    log.nextId = log.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    return log;
  }
}
