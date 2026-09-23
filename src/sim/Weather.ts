/**
 * Weather and its consequences.
 *
 * Weather is not a screen effect. Rain slows building and field work, storms
 * damage roads and roofs, snow stops crops growing and makes everyone colder.
 * The renderer reads the same state the simulation acts on.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01, damp } from '../core/math';
import type { ClimateSystem } from './Climate';
import type { WeatherKind } from '../render/Sky';
import { ClimatePreset } from '../world/types';
import { SeasonName } from './Time';

export type { WeatherKind };

interface WeatherProfile {
  label: string;
  severity: number;
  workPenalty: number;
  moveMultiplier: number;
  cropGrowth: number;
  minDurationHours: number;
  maxDurationHours: number;
}

export const WEATHER_PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: { label: 'Clear', severity: 0, workPenalty: 1, moveMultiplier: 1, cropGrowth: 1, minDurationHours: 6, maxDurationHours: 30 },
  cloudy: { label: 'Cloudy', severity: 0.1, workPenalty: 1, moveMultiplier: 1, cropGrowth: 0.94, minDurationHours: 5, maxDurationHours: 22 },
  rain: { label: 'Rain', severity: 0.4, workPenalty: 0.78, moveMultiplier: 0.9, cropGrowth: 1.3, minDurationHours: 3, maxDurationHours: 14 },
  heavy_rain: { label: 'Heavy Rain', severity: 0.68, workPenalty: 0.55, moveMultiplier: 0.78, cropGrowth: 1.15, minDurationHours: 2, maxDurationHours: 8 },
  fog: { label: 'Fog', severity: 0.25, workPenalty: 0.88, moveMultiplier: 0.88, cropGrowth: 1, minDurationHours: 2, maxDurationHours: 7 },
  storm: { label: 'Storm', severity: 0.95, workPenalty: 0.35, moveMultiplier: 0.66, cropGrowth: 0.7, minDurationHours: 2, maxDurationHours: 6 },
  snow: { label: 'Snow', severity: 0.62, workPenalty: 0.66, moveMultiplier: 0.74, cropGrowth: 0, minDurationHours: 4, maxDurationHours: 20 },
};

/** Seasonal weather likelihoods, before climate adjustment. */
const SEASON_WEIGHTS: Record<SeasonName, Partial<Record<WeatherKind, number>>> = {
  spring: { clear: 30, cloudy: 26, rain: 24, heavy_rain: 8, fog: 8, storm: 3, snow: 1 },
  summer: { clear: 48, cloudy: 22, rain: 14, heavy_rain: 6, fog: 4, storm: 6, snow: 0 },
  autumn: { clear: 24, cloudy: 28, rain: 24, heavy_rain: 10, fog: 10, storm: 4, snow: 0 },
  winter: { clear: 20, cloudy: 28, rain: 8, heavy_rain: 2, fog: 10, storm: 4, snow: 28 },
};

const CLIMATE_BIAS: Record<ClimatePreset, Partial<Record<WeatherKind, number>>> = {
  temperate: {},
  cold: { snow: 2.2, clear: 0.8, rain: 0.6 },
  warm: { snow: 0, storm: 1.4, clear: 1.2 },
  arid: { clear: 2.0, rain: 0.35, heavy_rain: 0.2, snow: 0.1, fog: 0.4 },
};

export class WeatherSystem {
  current: WeatherKind = 'clear';
  /** 0..1 how far the transition into `current` has progressed. */
  blend = 1;
  /** Game hours remaining before the next change. */
  private hoursRemaining = 8;
  /** Debounce before the sky is allowed to change state again. */
  private settleHours = 0.6;
  private rng: Rng;
  private climate: ClimatePreset;

  /**
    * Prevailing wind, in radians. Fire spread, cloud drift, smoke and sailing
    * all read this, so it turns slowly rather than jumping with the weather.
    */
  windDirection = 0;
  /** 0..1. */
  windStrength = 0.2;
  private windTarget = 0;

  /** Smoothed effect values so changes are not instant. */
  severity = 0;
  workPenalty = 1;
  moveMultiplier = 1;
  cropGrowthMultiplier = 1;

  /** Set for one tick when a new weather state begins. */
  justChanged = false;

  /** Local conditions at the observer, read straight from the atmosphere. */
  temperature = 12;
  /** Rain or snow rate over the observer, roughly mm per hour. */
  precipitation = 0;
  /** Lying snow at the observer, mm of water. */
  snowDepth = 0;
  /** Game hours a forced weather still overrides the atmosphere for. */
  private forcedHours = 0;

  constructor(seed: number, climate: ClimatePreset) {
    this.rng = new Rng(seed ^ 0x7ea7);
    this.climate = climate;
  }

  get label(): string {
    return WEATHER_PROFILES[this.current].label;
  }

  get isPrecipitating(): boolean {
    return (
      this.current === 'rain' ||
      this.current === 'heavy_rain' ||
      this.current === 'storm' ||
      this.current === 'snow'
    );
  }

  /**
   * Reads the air over a point and reports what it is like to stand there.
   *
   * The atmosphere decides the weather; this turns it into the handful of
   * numbers the rest of the game and the renderer already speak. A forced
   * weather (a god power, a scripted event) overrides it until it expires.
   */
  driveFrom(climate: ClimateSystem, x: number, z: number, hours: number): void {
    this.justChanged = false;

    this.temperature = climate.temperatureAt(x, z);
    this.precipitation = climate.precipitationAt(x, z);
    this.snowDepth = climate.snowDepthAt(x, z);

    const air = climate.sampleAt(x, z);
    this.windDirection = air.windDirection;
    this.windStrength = clamp01(air.windSpeed / 26);

    if (this.forcedHours > 0) {
      this.forcedHours -= hours;
      // The blend has to move here too. Forcing a weather set it to zero and
      // then only the *unforced* path ever advanced it, so a god-summoned
      // storm changed the word in the corner of the screen and nothing else:
      // no darkening, no fog, no severity, no rain. That was the whole of
      // "the weather changes and nothing looks different".
      this.blend = Math.min(1, this.blend + hours * 1.4);
      this.applyProfile(hours);
      return;
    }

    const kind = climate.kindAt(x, z);
    if (kind !== this.current) {
      // Hold each state briefly so a boundary between two cells does not
      // make the sky flicker as the player walks along it.
      this.settleHours -= hours;
      if (this.settleHours <= 0) {
        this.current = kind;
        this.blend = 0;
        this.justChanged = true;
        this.settleHours = 0.6;
      }
    } else {
      this.settleHours = 0.6;
    }

    this.blend = Math.min(1, this.blend + hours * 0.9);
    this.applyProfile(hours);
  }

  /** Smooths the consequences of the current state toward their targets. */
  private applyProfile(hours: number): void {
    const p = WEATHER_PROFILES[this.current];
    const t = clamp01(this.blend);
    // Heavier rain hurts work more than a drizzle, so scale by what is falling.
    const intensity = clamp(0.55 + this.precipitation * 0.16, 0.55, 1.6);
    const sev = clamp01(p.severity * t * intensity);
    this.severity = damp(this.severity, sev, 1.2, hours);
    this.workPenalty = damp(this.workPenalty, 1 + (p.workPenalty - 1) * t, 1.2, hours);
    this.moveMultiplier = damp(this.moveMultiplier, 1 + (p.moveMultiplier - 1) * t, 1.2, hours);
    // Crops care about the actual temperature, not just the label in the sky.
    const cold = this.temperature < 4 ? clamp01((this.temperature + 2) / 6) : 1;
    const scorch = this.temperature > 34 ? clamp01(1 - (this.temperature - 34) / 12) : 1;
    this.cropGrowthMultiplier = (1 + (p.cropGrowth - 1) * t) * cold * scorch;
  }

  /** Legacy standalone mode, kept so headless tests can run without air. */
  update(dt: number, hoursPerSecond: number, season: SeasonName): void {
    this.justChanged = false;
    const hours = dt * hoursPerSecond;
    this.hoursRemaining -= hours;

    if (this.hoursRemaining <= 0) {
      this.roll(season);
      this.justChanged = true;
      this.blend = 0;
    }

    this.blend = Math.min(1, this.blend + hours * 0.7);

    // Wind swings around gradually and blows harder in bad weather.
    if (this.justChanged) this.windTarget = this.rng.range(0, Math.PI * 2);
    let delta = this.windTarget - this.windDirection;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.windDirection += delta * Math.min(1, hours * 0.25);

    const p = WEATHER_PROFILES[this.current];
    const t = clamp01(this.blend);
    this.windStrength = damp(this.windStrength, 0.12 + p.severity * 0.85 * t, 0.8, hours);
    this.severity = damp(this.severity, p.severity * t, 1.2, hours);
    this.workPenalty = damp(this.workPenalty, 1 + (p.workPenalty - 1) * t, 1.2, hours);
    this.moveMultiplier = damp(this.moveMultiplier, 1 + (p.moveMultiplier - 1) * t, 1.2, hours);
    this.cropGrowthMultiplier = 1 + (p.cropGrowth - 1) * t;
  }

  private roll(season: SeasonName): void {
    const base = SEASON_WEIGHTS[season];
    const bias = CLIMATE_BIAS[this.climate];
    const entries: { value: WeatherKind; weight: number }[] = [];
    for (const [kind, w] of Object.entries(base) as [WeatherKind, number][]) {
      const multiplier = bias[kind] ?? 1;
      let weight = w * multiplier;
      // Discourage repeating the same weather immediately.
      if (kind === this.current) weight *= 0.35;
      if (weight > 0) entries.push({ value: kind, weight });
    }
    if (entries.length === 0) entries.push({ value: 'clear', weight: 1 });
    this.current = this.rng.weighted(entries);
    const p = WEATHER_PROFILES[this.current];
    this.hoursRemaining = this.rng.range(p.minDurationHours, p.maxDurationHours);
  }

  /** Force a specific weather, used by god powers and world events. */
  force(kind: WeatherKind, hours: number): void {
    this.current = kind;
    this.hoursRemaining = hours;
    this.forcedHours = hours;
    this.blend = 0;
    this.justChanged = true;
  }

  get isForced(): boolean {
    return this.forcedHours > 0;
  }

  serialize(): Record<string, unknown> {
    return {
      current: this.current,
      blend: this.blend,
      hoursRemaining: this.hoursRemaining,
      windDirection: this.windDirection,
      windStrength: this.windStrength,
      forcedHours: this.forcedHours,
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    if (typeof data.current === 'string' && data.current in WEATHER_PROFILES) {
      this.current = data.current as WeatherKind;
    }
    if (typeof data.blend === 'number') this.blend = data.blend;
    if (typeof data.hoursRemaining === 'number') this.hoursRemaining = data.hoursRemaining;
    if (typeof data.windDirection === 'number') this.windDirection = data.windDirection;
    if (typeof data.windStrength === 'number') this.windStrength = data.windStrength;
    if (typeof data.forcedHours === 'number') this.forcedHours = clamp(data.forcedHours, 0, 500);
  }
}
