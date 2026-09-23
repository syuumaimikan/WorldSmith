/**
 * Game clock.
 *
 * Simulation runs on a fixed tick that is independent of render frame rate, so
 * a slow machine produces the same world as a fast one, just rendered less
 * often. Speed multipliers scale how much game time each real second buys.
 */

/**
 * Real seconds of simulated time per game hour at normal speed.
 *
 * Twenty real minutes to a game day, which is long enough that a day has
 * shape to it -- a morning, an afternoon, a dusk you can work through -- and
 * short enough that a season still turns while you are watching.
 */
export const SECONDS_PER_GAME_HOUR = 50;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_MONTH = 5;
export const MONTHS_PER_SEASON = 3;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_SEASON = DAYS_PER_MONTH * MONTHS_PER_SEASON;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export const MONTH_NAMES = [
  'Thawmoon',
  'Seedmoon',
  'Blossom',
  'Longsun',
  'Highsun',
  'Goldfall',
  'Harvest',
  'Emberfall',
  'Greyfall',
  'Frostmoon',
  'Deepwinter',
  'Stillmoon',
];

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

export type GameSpeed = 0 | 1 | 2 | 4 | 8;
export const SPEED_OPTIONS: GameSpeed[] = [0, 1, 2, 4, 8];

export interface TimeSnapshot {
  totalHours: number;
  hour: number;
  minute: number;
  dayOfMonth: number;
  month: number;
  year: number;
  season: SeasonName;
  dayOfSeason: number;
  /** 0..1 through the day. */
  timeOfDay: number;
  totalDays: number;
}

export class GameTime {
  /** Total elapsed game hours since world founding. */
  totalHours = 6; // worlds start at dawn
  speed: GameSpeed = 1;
  private previousSeason: SeasonName = 'spring';
  private previousDay = 0;

  /** Fires when the calendar day rolls over. */
  onNewDay: ((day: number) => void)[] = [];
  /** Fires when the season changes. */
  onNewSeason: ((season: SeasonName) => void)[] = [];

  constructor(startHours = 6) {
    this.totalHours = startHours;
    const s = this.snapshot();
    this.previousSeason = s.season;
    this.previousDay = s.totalDays;
  }

  /**
   * Advances the clock by *simulated* seconds. The speed multiplier is applied
   * by the game loop when it decides how much simulated time a frame buys, not
   * here, so that one simulation tick always means the same thing.
   */
  advance(simSeconds: number, fireCallbacks = true): void {
    if (simSeconds <= 0) return;
    this.totalHours += simSeconds / SECONDS_PER_GAME_HOUR;

    // The pre-simulation runs centuries in five-day strides and has no
    // settlers, buildings, piles or economy for a daily pass to serve. Firing
    // one anyway meant a seven-hundred-year world spent most of its loading
    // time on days nobody lived through.
    if (!fireCallbacks) {
      const quiet = this.snapshot();
      this.previousDay = quiet.totalDays;
      this.previousSeason = quiet.season;
      return;
    }

    const s = this.snapshot();
    if (s.totalDays !== this.previousDay) {
      const days = s.totalDays - this.previousDay;
      this.previousDay = s.totalDays;
      for (let i = 0; i < days; i++) {
        for (const fn of this.onNewDay) fn(s.totalDays);
      }
    }
    if (s.season !== this.previousSeason) {
      this.previousSeason = s.season;
      for (const fn of this.onNewSeason) fn(s.season);
    }
  }

  /** Game hours represented by a number of simulated seconds. */
  hoursFor(simSeconds: number): number {
    return simSeconds / SECONDS_PER_GAME_HOUR;
  }

  snapshot(): TimeSnapshot {
    const totalDays = Math.floor(this.totalHours / HOURS_PER_DAY);
    const hourFloat = this.totalHours - totalDays * HOURS_PER_DAY;
    const hour = Math.floor(hourFloat);
    const minute = Math.floor((hourFloat - hour) * 60);
    const month = Math.floor(totalDays / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
    const year = Math.floor(totalDays / DAYS_PER_YEAR) + 1;
    const dayOfMonth = (totalDays % DAYS_PER_MONTH) + 1;
    const seasonIndex = Math.floor(month / MONTHS_PER_SEASON) % 4;
    const dayOfSeason = (totalDays % DAYS_PER_SEASON) + 1;
    return {
      totalHours: this.totalHours,
      hour,
      minute,
      dayOfMonth,
      month,
      year,
      season: SEASON_NAMES[seasonIndex],
      dayOfSeason,
      timeOfDay: hourFloat / HOURS_PER_DAY,
      totalDays,
    };
  }

  get season(): SeasonName {
    return this.snapshot().season;
  }

  get totalDays(): number {
    return Math.floor(this.totalHours / HOURS_PER_DAY);
  }

  /** Progress through the current season, 0..1. Drives gradual snow melt etc. */
  seasonProgress(): number {
    const totalDays = this.totalHours / HOURS_PER_DAY;
    return (totalDays % DAYS_PER_SEASON) / DAYS_PER_SEASON;
  }

  /** Temperature offset in celsius applied by the current point in the year. */
  seasonalTemperatureOffset(): number {
    const yearPhase = ((this.totalHours / HOURS_PER_DAY) % DAYS_PER_YEAR) / DAYS_PER_YEAR;
    // Peak warmth mid-summer, trough mid-winter.
    return Math.sin((yearPhase - 0.125) * Math.PI * 2) * 11;
  }

  /** -1..1 daylight skew: long summer days, short winter ones. */
  daylightSkew(): number {
    const yearPhase = ((this.totalHours / HOURS_PER_DAY) % DAYS_PER_YEAR) / DAYS_PER_YEAR;
    return Math.sin((yearPhase - 0.125) * Math.PI * 2);
  }

  static formatClock(s: TimeSnapshot): string {
    return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  }

  static formatDate(s: TimeSnapshot): string {
    return `${MONTH_NAMES[s.month]} ${s.dayOfMonth}, Year ${s.year}`;
  }

  static formatShortDate(s: TimeSnapshot): string {
    return `Y${s.year} ${MONTH_NAMES[s.month].slice(0, 3)} ${s.dayOfMonth}`;
  }

  serialize(): { totalHours: number; speed: GameSpeed } {
    return { totalHours: this.totalHours, speed: this.speed };
  }

  static deserialize(data: { totalHours: number; speed: GameSpeed }): GameTime {
    const t = new GameTime(data.totalHours);
    t.speed = data.speed ?? 1;
    return t;
  }
}
