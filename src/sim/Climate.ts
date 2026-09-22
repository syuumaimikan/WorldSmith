/**
 * The atmosphere.
 *
 * The world is covered by a coarse grid of air cells, each with a temperature,
 * a humidity, a pressure and a wind. Nothing about the weather is rolled from
 * a table: air warms over sun-baked ground and cools over mountains, water
 * evaporates into it, wind carries that moisture until rising ground forces it
 * up, and where it can no longer hold the water it rains. Rain shadows,
 * coastal fog and mountain snow all fall out of that rather than being
 * special-cased.
 *
 * Fronts sweep across the grid and disturb it. Storms form where warm wet air
 * meets cold, and only then. Over years the whole grid drifts warmer or colder
 * with the long climate cycles, and a big enough eruption cools it for a while.
 */

import { Rng } from '../core/rng';
import { clamp, clamp01, lerp, smoothstep, TAU } from '../core/math';
import { Terrain } from '../world/Terrain';
import { GameTime, DAYS_PER_YEAR } from './Time';
import type { WeatherKind } from '../render/Sky';
import { ClimatePreset } from '../world/types';

/** Air cells across the map, in each direction. */
const CELLS = 24;

/** Sea-level reference pressure, hPa. */
const BASE_PRESSURE = 1013;

/**
 * Millimetres of water in a fully saturated air column at the reference
 * temperature. Humidity is stored as a fraction of this, which is what lets
 * evaporation and rainfall be written in millimetres and actually balance.
 */
const COLUMN_MM = 30;

/** Relative humidity at which rain begins, before lift lowers the bar. */
const RAIN_THRESHOLD = 0.84;

/**
 * How many cells an hour of a one-metre-per-second wind carries the air.
 * The map stands in for a continent, so weather crosses it in hours rather
 * than in the seconds a literal reading of the distance would give.
 */
const CELLS_PER_HOUR_PER_MS = 0.18;

/** Wind, in metres per second, per hPa of pressure difference between cells. */
const WIND_PER_HPA = 7.5;

/** Humidity a parcel of air can hold, by temperature (a crude Clausius line). */
function saturationHumidity(tempC: number): number {
  // Warm air holds far more water than cold. Normalised so 20 C holds ~1.
  return clamp(Math.exp((tempC - 20) * 0.058), 0.12, 3.4);
}

export type FrontKind = 'cold' | 'warm' | 'occluded';

export interface WeatherFront {
  id: number;
  kind: FrontKind;
  /** A point on the front line. */
  x: number;
  z: number;
  /** Direction of travel, radians. */
  heading: number;
  /** Metres per game hour. */
  speed: number;
  /** Half-width of the band it disturbs, in metres. */
  width: number;
  /** 0..1 */
  strength: number;
  /** Game hours it has left before it dissipates. */
  life: number;
}

export type ExtremeKind = 'heatwave' | 'coldsnap' | 'drought' | 'monsoon';

export interface ClimateExtreme {
  kind: ExtremeKind;
  /** Game hours remaining. */
  hoursLeft: number;
  /** 0..1 */
  severity: number;
  /** Set when the player has been told about it. */
  announced: boolean;
}

export interface AirSample {
  temperature: number;
  humidity: number;
  /** Relative to saturation, 0..1+. */
  saturation: number;
  pressure: number;
  cloud: number;
  /** Precipitation rate, roughly mm per hour. */
  precipitation: number;
  /** Lying snow, in mm of water. */
  snowpack: number;
  windU: number;
  windV: number;
  windSpeed: number;
  windDirection: number;
}

/** A yearly summary, kept so the chronicle can show the climate drifting. */
export interface ClimateYear {
  year: number;
  meanTemperature: number;
  totalRain: number;
  totalSnow: number;
  storms: number;
}

export type ClimateEra = 'glacial' | 'cold' | 'temperate' | 'warm' | 'hot';

export class ClimateSystem {
  readonly cells = CELLS;
  readonly cellSize: number;

  // --- live state, one entry per cell ------------------------------------
  readonly temperature: Float32Array;
  readonly humidity: Float32Array;
  readonly pressure: Float32Array;
  readonly cloud: Float32Array;
  readonly precipitation: Float32Array;
  readonly snowpack: Float32Array;
  readonly windU: Float32Array;
  readonly windV: Float32Array;

  // --- fixed geography ----------------------------------------------------
  private readonly baseTemp: Float32Array;
  private readonly altitude: Float32Array;
  /** How much of each cell is sea or lake. Storms feed on warm water. */
  readonly waterFraction: Float32Array;
  /** Thermal inertia: water is slow to warm and slow to cool. */
  private readonly inertia: Float32Array;

  private readonly scratch = new Float32Array(CELLS * CELLS);
  /** Temperature shift and lift contributed by the fronts, rebuilt each step. */
  private readonly frontTemp = new Float32Array(CELLS * CELLS);
  private readonly frontLift = new Float32Array(CELLS * CELLS);

  readonly fronts: WeatherFront[] = [];
  readonly extremes: ClimateExtreme[] = [];
  readonly history: ClimateYear[] = [];

  /** Long-term temperature offset in celsius, from the slow climate cycles. */
  trend = 0;
  /** Cooling from ash and aerosol in the high atmosphere, celsius. */
  aerosolCooling = 0;
  /** Warming contributed by what the settlement burns, celsius. */
  anthropogenic = 0;

  /** Lightning strikes waiting to be resolved by the world this tick. */
  readonly strikes: { x: number; z: number }[] = [];

  private rng: Rng;
  private terrain: Terrain;
  private preset: ClimatePreset;
  private nextFrontId = 1;
  private hoursToNextFront = 30;
  /** Mean temperature this world would have today with no anomaly. */
  private seasonalNormal = 0;
  /** How strongly the ground is radiating heat away: peaks just before dawn. */
  private fogFactor = 0;
  /** Slow average of how wet this world usually is, for judging drought. */
  private normalPrecipitation = -1;
  /** Consecutive game hours the world has been unusually dry, or unusually wet. */
  private dryHours = 0;
  private wetHours = 0;
  private yearAccum = { year: 0, tempSum: 0, samples: 0, rain: 0, snow: 0, storms: 0 };

  constructor(terrain: Terrain, seed: number, preset: ClimatePreset) {
    this.terrain = terrain;
    this.preset = preset;
    this.rng = new Rng(seed ^ 0xc11a);
    this.cellSize = terrain.worldSize / CELLS;

    const n = CELLS * CELLS;
    this.temperature = new Float32Array(n);
    this.humidity = new Float32Array(n);
    this.pressure = new Float32Array(n).fill(BASE_PRESSURE);
    this.cloud = new Float32Array(n);
    this.precipitation = new Float32Array(n);
    this.snowpack = new Float32Array(n);
    this.windU = new Float32Array(n);
    this.windV = new Float32Array(n);
    this.baseTemp = new Float32Array(n);
    this.altitude = new Float32Array(n);
    this.waterFraction = new Float32Array(n);
    this.inertia = new Float32Array(n);

    this.sampleGeography();

    // Start the atmosphere in equilibrium with the ground beneath it so the
    // first hour of play is not a continent-wide thunderstorm.
    for (let i = 0; i < n; i++) {
      this.temperature[i] = this.baseTemp[i];
      this.humidity[i] = saturationHumidity(this.baseTemp[i]) * (0.4 + this.waterFraction[i] * 0.3);
      if (this.baseTemp[i] < -2) this.snowpack[i] = 20 + -this.baseTemp[i] * 6;
    }
    this.yearAccum.year = 1;
    this.seasonalNormal = this.meanBaseTemperature();
  }

  /** Averages the terrain under each air cell, once, at world creation. */
  private sampleGeography(): void {
    const t = this.terrain;
    const per = Math.max(1, Math.floor(t.gridSize / CELLS));
    for (let cz = 0; cz < CELLS; cz++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const c = cz * CELLS + cx;
        let temp = 0;
        let alt = 0;
        let water = 0;
        let count = 0;
        for (let dz = 0; dz < per; dz++) {
          for (let dx = 0; dx < per; dx++) {
            const tx = cx * per + dx;
            const tz = cz * per + dz;
            if (!t.inBounds(tx, tz)) continue;
            const i = t.index(tx, tz);
            temp += t.data.temperature[i];
            alt += Math.max(0, t.data.height[i]);
            if (t.waterHeight[i] > t.data.height[i]) water++;
            count++;
          }
        }
        if (count === 0) count = 1;
        this.baseTemp[c] = temp / count;
        this.altitude[c] = alt / count;
        this.waterFraction[c] = water / count;
        // Deep water changes temperature roughly four times slower than rock.
        this.inertia[c] = 1 + this.waterFraction[c] * 3.4;
      }
    }
  }

  // =======================================================================
  // Addressing
  // =======================================================================

  cellX(worldX: number): number {
    return clamp(Math.floor(worldX / this.cellSize), 0, CELLS - 1);
  }

  cellZ(worldZ: number): number {
    return clamp(Math.floor(worldZ / this.cellSize), 0, CELLS - 1);
  }

  cellIndex(worldX: number, worldZ: number): number {
    return this.cellZ(worldZ) * CELLS + this.cellX(worldX);
  }

  /** Bilinear read so conditions change smoothly as you walk, not in blocks. */
  private smooth(field: Float32Array, worldX: number, worldZ: number): number {
    const fx = worldX / this.cellSize - 0.5;
    const fz = worldZ / this.cellSize - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const at = (x: number, z: number): number =>
      field[clamp(z, 0, CELLS - 1) * CELLS + clamp(x, 0, CELLS - 1)];
    const a = lerp(at(x0, z0), at(x0 + 1, z0), tx);
    const b = lerp(at(x0, z0 + 1), at(x0 + 1, z0 + 1), tx);
    return lerp(a, b, tz);
  }

  sampleAt(worldX: number, worldZ: number): AirSample {
    const temperature = this.smooth(this.temperature, worldX, worldZ);
    const humidity = this.smooth(this.humidity, worldX, worldZ);
    const windU = this.smooth(this.windU, worldX, worldZ);
    const windV = this.smooth(this.windV, worldX, worldZ);
    return {
      temperature,
      humidity,
      saturation: humidity / saturationHumidity(temperature),
      pressure: this.smooth(this.pressure, worldX, worldZ),
      cloud: this.smooth(this.cloud, worldX, worldZ),
      precipitation: this.smooth(this.precipitation, worldX, worldZ),
      snowpack: this.smooth(this.snowpack, worldX, worldZ),
      windU,
      windV,
      windSpeed: Math.hypot(windU, windV),
      windDirection: Math.atan2(windV, windU),
    };
  }

  /** Mean ground height under a cell, which is what makes rain shadows. */
  altitudeOf(cellIndex: number): number {
    return this.altitude[cellIndex] ?? 0;
  }

  temperatureAt(worldX: number, worldZ: number): number {
    // Cells are coarse, so correct for the lapse rate of the actual ground.
    const c = this.cellIndex(worldX, worldZ);
    const local = Math.max(0, this.terrain.heightAt(worldX, worldZ));
    const lapse = (local - this.altitude[c]) * 0.0065 * 10;
    return this.smooth(this.temperature, worldX, worldZ) - lapse;
  }

  precipitationAt(worldX: number, worldZ: number): number {
    return this.smooth(this.precipitation, worldX, worldZ);
  }

  snowDepthAt(worldX: number, worldZ: number): number {
    return this.smooth(this.snowpack, worldX, worldZ);
  }

  /** What the sky is doing over a point, in the terms the renderer knows. */
  kindAt(worldX: number, worldZ: number): WeatherKind {
    const s = this.sampleAt(worldX, worldZ);
    const local = this.temperatureAt(worldX, worldZ);
    // Below a quarter of a millimetre an hour nobody would call it rain.
    if (s.precipitation > 0.25) {
      if (local <= 0.5) return 'snow';
      if (s.precipitation > 4.5 && s.windSpeed > 6) return 'storm';
      if (s.precipitation > 2.2) return 'heavy_rain';
      return 'rain';
    }
    // Fog is a ground-level thing: still, damp air over cold ground before
    // dawn, which is why it sits in valleys and burns off in the morning.
    if (
      this.fogFactor > 0.35 &&
      s.windSpeed < 4.5 &&
      s.saturation > 0.7 &&
      s.cloud < 0.7 &&
      local > -4
    ) {
      return 'fog';
    }
    if (s.cloud > 0.45) return 'cloudy';
    return 'clear';
  }

  // =======================================================================
  // Simulation
  // =======================================================================

  /**
   * Advances the atmosphere by `hours` of game time. Called on a slower
   * cadence than the main tick: air does not need 15 Hz.
   */
  update(time: GameTime, hours: number): void {
    if (hours <= 0) return;
    this.strikes.length = 0;

    const snap = time.snapshot();
    const seasonal = time.seasonalTemperatureOffset();
    // Ground heats and cools through the day; the sea barely notices.
    const diurnal = Math.sin((snap.timeOfDay - 0.29) * TAU) * 6.5;
    // Coldest, stillest part of the night, a little before sunrise.
    this.fogFactor = clamp01(-Math.sin((snap.timeOfDay - 0.29) * TAU));

    this.updateLongTerm(snap.totalHours, hours);
    const extremeTemp = this.extremeTemperatureOffset();
    const extremeWet = this.extremeMoistureFactor();
    const offset = seasonal + this.trend - this.aerosolCooling + this.anthropogenic + extremeTemp;

    // What this world would be like right now with no anomaly at all. Extremes
    // are judged against that, so an ordinary winter is not a cold snap.
    this.seasonalNormal = this.meanBaseTemperature() + seasonal + this.trend;
    this.updateExtremes(hours);
    this.updateFronts(hours);
    this.gatherFrontEffects();

    this.relaxTemperature(offset, diurnal, hours);
    this.advect(this.temperature, hours, 0.35);
    this.evaporate(hours, extremeWet);
    this.advect(this.humidity, hours, 0.45);
    this.condense(hours);
    this.updatePressureAndWind(hours);
    this.updateSnow(hours);
    this.accumulateYear(snap.year, hours);
  }

  /**
   * Collects what the fronts are doing to each cell into two fields, so the
   * rest of the step can read them once. A front is a moving boundary, not a
   * repeated shove: it changes the temperature the air is heading toward and
   * it lifts the air it passes over. Applying it as a per-step subtraction
   * would ratchet the whole grid downward every time one crossed.
   */
  private gatherFrontEffects(): void {
    this.frontTemp.fill(0);
    this.frontLift.fill(0);
    if (this.fronts.length === 0) return;
    for (let cz = 0; cz < CELLS; cz++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const i = cz * CELLS + cx;
        for (const f of this.fronts) {
          const w = this.frontInfluence(f, cx, cz);
          if (w <= 0.01) continue;
          this.frontTemp[i] += w * (f.kind === 'cold' ? -7 : f.kind === 'warm' ? 4 : -2.5);
          // Cold fronts shove warm air up hardest; that is where it storms.
          this.frontLift[i] += w * (f.kind === 'cold' ? 0.75 : f.kind === 'warm' ? 0.3 : 0.5);
        }
      }
    }
  }

  /** Air relaxes toward the temperature of the ground it is sitting on. */
  private relaxTemperature(offset: number, diurnal: number, hours: number): void {
    const n = CELLS * CELLS;
    for (let i = 0; i < n; i++) {
      // Snow reflects sunlight, so a snowfield stays cold once it has settled.
      const albedo = this.snowpack[i] > 4 ? -2.6 : 0;
      // Cloud caps the daily swing in both directions.
      const swing = diurnal * (1 - this.waterFraction[i] * 0.75) * (1 - this.cloud[i] * 0.55);
      const target = this.baseTemp[i] + offset + swing + albedo + this.frontTemp[i];
      const rate = 1 - Math.exp((-hours * 0.85) / this.inertia[i]);
      this.temperature[i] += (target - this.temperature[i]) * rate;
    }
  }

  /**
   * Moves a field downwind, plus a little diffusion so cells stay coherent.
   *
   * Displacement is capped at just over one cell per step. Semi-Lagrangian
   * advection that reaches further than its own grid stops being advection
   * and starts smearing the whole map toward its edges.
   */
  private advect(field: Float32Array, hours: number, mixing: number): void {
    const src = this.scratch;
    src.set(field);
    for (let z = 0; z < CELLS; z++) {
      for (let x = 0; x < CELLS; x++) {
        const i = z * CELLS + x;
        const ux = clamp(this.windU[i] * CELLS_PER_HOUR_PER_MS * hours, -1.2, 1.2);
        const uz = clamp(this.windV[i] * CELLS_PER_HOUR_PER_MS * hours, -1.2, 1.2);
        const sx = clamp(x - ux, 0, CELLS - 1.001);
        const sz = clamp(z - uz, 0, CELLS - 1.001);
        const x0 = Math.floor(sx);
        const z0 = Math.floor(sz);
        const tx = sx - x0;
        const tz = sz - z0;
        const at = (ax: number, az: number): number =>
          src[clamp(az, 0, CELLS - 1) * CELLS + clamp(ax, 0, CELLS - 1)];
        const upwind = lerp(
          lerp(at(x0, z0), at(x0 + 1, z0), tx),
          lerp(at(x0, z0 + 1), at(x0 + 1, z0 + 1), tx),
          tz,
        );
        // Diffuse with the immediate neighbours: air does not stay in lanes.
        const neigh = (at(x - 1, z) + at(x + 1, z) + at(x, z - 1) + at(x, z + 1)) * 0.25;
        const blend = clamp01(hours * mixing);
        field[i] = lerp(src[i], lerp(upwind, neigh, 0.28), blend);
      }
    }
  }

  /**
   * Water enters the air from the sea, lakes, wet ground and plants.
   *
   * Rates are in millimetres of water per hour, which is what keeps the whole
   * budget honest: a warm ocean gives up around five millimetres a day, so the
   * rain that eventually falls out of the sky has to have come from somewhere.
   */
  private evaporate(hours: number, wetFactor: number): void {
    const n = CELLS * CELLS;
    const presetRate =
      this.preset === 'arid' ? 0.55 : this.preset === 'warm' ? 1.3 : this.preset === 'cold' ? 0.65 : 1;
    for (let i = 0; i < n; i++) {
      const warmth = clamp01((this.temperature[i] + 4) / 32);
      // Open water gives up far more than dry ground and its plants do.
      const surface = 0.14 + this.waterFraction[i] * 0.86;
      const mmPerHour = 0.5 * warmth * surface * presetRate * wetFactor;
      this.humidity[i] += (mmPerHour * hours) / COLUMN_MM;

      // Snow sublimates slowly rather than sitting there for ever.
      if (this.snowpack[i] > 0 && this.temperature[i] > -4) {
        const subl = Math.min(this.snowpack[i], hours * 0.05);
        this.snowpack[i] -= subl;
        this.humidity[i] += subl / COLUMN_MM;
      }

      const cap = saturationHumidity(this.temperature[i]) * 1.25;
      if (this.humidity[i] > cap) this.humidity[i] = cap;
      if (this.humidity[i] < 0) this.humidity[i] = 0;
    }
  }

  /**
   * Cloud, rain and snow.
   *
   * Air does not need to be completely saturated to rain; it starts once it is
   * most of the way there, and it rains harder the wetter it is. Ground rising
   * into the wind, and the lift ahead of a front, both lower that bar, which
   * is how mountains get their rain and the far side gets none.
   */
  private condense(hours: number): void {
    for (let z = 0; z < CELLS; z++) {
      for (let x = 0; x < CELLS; x++) {
        const i = z * CELLS + x;
        const sat = saturationHumidity(this.temperature[i]);
        const rh = this.humidity[i] / sat;

        // Orographic lift: how fast the ground climbs into the wind.
        const ux = this.windU[i];
        const uz = this.windV[i];
        const speed = Math.hypot(ux, uz);
        let lift = this.frontLift[i];
        if (speed > 0.2) {
          const dx = Math.round(ux / speed);
          const dz = Math.round(uz / speed);
          const ax = clamp(x + dx, 0, CELLS - 1);
          const az = clamp(z + dz, 0, CELLS - 1);
          const rise = this.altitude[az * CELLS + ax] - this.altitude[i];
          lift += clamp01((rise / 35) * (speed / 7));
        }
        lift = clamp01(lift);

        const cloudTarget = clamp01((rh - 0.5) * 1.8 + lift * 0.45);
        this.cloud[i] += (cloudTarget - this.cloud[i]) * clamp01(hours * 1.2);

        // Rain begins below full saturation, and lift lowers the bar further.
        const threshold = RAIN_THRESHOLD - lift * 0.22;
        if (rh > threshold) {
          const over = (rh - threshold) / Math.max(0.05, 1.05 - threshold);
          const rate = Math.min(28, 3.6 * over * (1 + lift * 3.2));
          // Take the water that fell back out of the air.
          const used = Math.min(this.humidity[i], (rate * hours) / COLUMN_MM);
          this.humidity[i] -= used;
          this.precipitation[i] = lerp(this.precipitation[i], rate, clamp01(hours * 4));
        } else {
          this.precipitation[i] *= Math.exp(-hours * 3);
          if (this.precipitation[i] < 0.02) this.precipitation[i] = 0;
        }

        // Convective instability: warm wet air with colder air above it.
        const instability = clamp01((this.temperature[i] - this.baseTemp[i]) * 0.1 + rh - 0.85);
        if (this.precipitation[i] > 6 && instability > 0.15 && this.temperature[i] > 2) {
          if (this.rng.chance(clamp01(hours * instability * 0.2))) {
            this.strikes.push({
              x: (x + this.rng.next()) * this.cellSize,
              z: (z + this.rng.next()) * this.cellSize,
            });
            this.yearAccum.storms++;
          }
        }
      }
    }
  }

  /**
   * Pressure follows temperature and moisture; wind follows pressure. Warm wet
   * air is light, so it rises and draws air in beneath it.
   *
   * The gradient is measured across the map rather than in literal metres: the
   * playable world stands in for a continent, so its weather systems have to
   * be sized to the map, not to the walking distance across it.
   */
  private updatePressureAndWind(hours: number): void {
    for (let i = 0; i < CELLS * CELLS; i++) {
      const warmAnomaly = this.temperature[i] - this.baseTemp[i];
      const target =
        BASE_PRESSURE -
        warmAnomaly * 1.15 -
        this.humidity[i] * 3.2 -
        this.altitude[i] * 0.09 +
        this.frontPressureAt(i);
      this.pressure[i] += (target - this.pressure[i]) * clamp01(hours * 1.6);
    }

    const blend = clamp01(hours * 1.1);
    for (let z = 0; z < CELLS; z++) {
      for (let x = 0; x < CELLS; x++) {
        const i = z * CELLS + x;
        const at = (ax: number, az: number): number =>
          this.pressure[clamp(az, 0, CELLS - 1) * CELLS + clamp(ax, 0, CELLS - 1)];
        // hPa per cell, which is the scale the weather actually lives at.
        const gx = (at(x + 1, z) - at(x - 1, z)) * 0.5;
        const gz = (at(x, z + 1) - at(x, z - 1)) * 0.5;

        // Air falls down the pressure gradient, deflected sideways so weather
        // systems rotate instead of collapsing straight into the low.
        const dx = -gx * WIND_PER_HPA;
        const dz = -gz * WIND_PER_HPA;
        const cor = 0.55;
        const targetU = dx - dz * cor;
        const targetV = dz + dx * cor;

        this.windU[i] += (targetU - this.windU[i]) * blend;
        this.windV[i] += (targetV - this.windV[i]) * blend;

        const speed = Math.hypot(this.windU[i], this.windV[i]);
        if (speed > 34) {
          this.windU[i] *= 34 / speed;
          this.windV[i] *= 34 / speed;
        }
      }
    }
  }

  /** Snow piles up where it falls cold and runs off when it thaws. */
  private updateSnow(hours: number): void {
    for (let i = 0; i < CELLS * CELLS; i++) {
      const temp = this.temperature[i];
      if (this.precipitation[i] > 0) {
        const fallen = (this.precipitation[i] * hours) / (CELLS * CELLS);
        if (temp <= 0.5) {
          this.snowpack[i] += this.precipitation[i] * hours;
          this.yearAccum.snow += fallen;
        } else {
          this.yearAccum.rain += fallen;
        }
      }
      if (this.snowpack[i] > 0 && temp > 0.5) {
        // Melt rate rises with how far above freezing it is.
        const melt = Math.min(this.snowpack[i], (temp - 0.5) * 1.4 * hours);
        this.snowpack[i] -= melt;
      }
      if (this.snowpack[i] > 900) this.snowpack[i] = 900;
    }
  }

  /** Total meltwater released this step, for the rivers to carry. */
  meltwater(hours: number): number {
    let total = 0;
    for (let i = 0; i < CELLS * CELLS; i++) {
      if (this.snowpack[i] > 0 && this.temperature[i] > 0.5) {
        total += Math.min(this.snowpack[i], (this.temperature[i] - 0.5) * 1.4 * hours);
      }
    }
    return total;
  }

  // =======================================================================
  // Fronts
  // =======================================================================

  private updateFronts(hours: number): void {
    const size = this.terrain.worldSize;

    this.hoursToNextFront -= hours;
    if (this.hoursToNextFront <= 0 && this.fronts.length < 4) {
      this.spawnFront();
      this.hoursToNextFront = this.rng.range(22, 80);
    }

    for (let k = this.fronts.length - 1; k >= 0; k--) {
      const f = this.fronts[k];
      f.life -= hours;
      const travel = f.speed * hours;
      f.x += Math.cos(f.heading) * travel;
      f.z += Math.sin(f.heading) * travel;
      // A front weakens as it ages and once it has crossed the map.
      f.strength *= Math.exp(-hours * 0.012);
      const out =
        f.x < -size * 0.4 || f.x > size * 1.4 || f.z < -size * 0.4 || f.z > size * 1.4;
      if (f.life <= 0 || f.strength < 0.06 || out) {
        this.fronts.splice(k, 1);
        continue;
      }
    }
  }

  private spawnFront(): void {
    const size = this.terrain.worldSize;
    // Fronts come in from off the map, most often from the prevailing westerly.
    const heading = this.rng.chance(0.65)
      ? this.rng.range(-0.5, 0.5)
      : this.rng.range(0, TAU);
    const kind: FrontKind = this.rng.chance(0.52) ? 'cold' : this.rng.chance(0.7) ? 'warm' : 'occluded';
    this.fronts.push({
      id: this.nextFrontId++,
      kind,
      x: size * 0.5 - Math.cos(heading) * size * 0.75,
      z: size * 0.5 - Math.sin(heading) * size * 0.75,
      heading,
      speed: this.rng.range(size * 0.02, size * 0.055),
      width: size * this.rng.range(0.06, 0.15),
      strength: this.rng.range(0.45, 1),
      life: this.rng.range(60, 190),
    });
  }

  /** How far a cell is into a front's band, 0 outside, 1 on the line. */
  private frontInfluence(f: WeatherFront, cx: number, cz: number): number {
    const wx = (cx + 0.5) * this.cellSize;
    const wz = (cz + 0.5) * this.cellSize;
    // Distance along the front's normal, so the band is a moving line.
    const nx = Math.cos(f.heading);
    const nz = Math.sin(f.heading);
    const d = Math.abs((wx - f.x) * nx + (wz - f.z) * nz);
    return (1 - smoothstep(0, f.width, d)) * f.strength;
  }

  private frontPressureAt(cellIndex: number): number {
    const cx = cellIndex % CELLS;
    const cz = Math.floor(cellIndex / CELLS);
    let delta = 0;
    for (const f of this.fronts) {
      const w = this.frontInfluence(f, cx, cz);
      if (w <= 0) continue;
      delta -= w * (f.kind === 'cold' ? 13 : f.kind === 'warm' ? 7 : 10);
    }
    return delta;
  }

  // =======================================================================
  // Extremes and the long view
  // =======================================================================

  private updateExtremes(hours: number): void {
    for (let i = this.extremes.length - 1; i >= 0; i--) {
      this.extremes[i].hoursLeft -= hours;
      if (this.extremes[i].hoursLeft <= 0) this.extremes.splice(i, 1);
    }

    const wet = this.meanPrecipitation();
    // How wet this world usually is, learned rather than assumed, so an arid
    // map and a rainforest map each get their own idea of "dry".
    if (this.normalPrecipitation < 0) this.normalPrecipitation = wet;
    else {
      const k = clamp01(hours / 900);
      this.normalPrecipitation += (wet - this.normalPrecipitation) * k;
    }

    // Extremes are not rolled at random: they begin when the grid has already
    // been sitting away from normal for a while.
    if (this.extremes.length >= 2) return;
    const anomaly = this.meanTemperature() - this.seasonalNormal;
    const normalWet = Math.max(0.02, this.normalPrecipitation);

    const tryStart = (
      kind: ExtremeKind,
      condition: boolean,
      severity: number,
      span: [number, number],
    ): void => {
      if (!condition) return;
      if (this.extremes.some((e) => e.kind === kind)) return;
      if (!this.rng.chance(clamp01(hours * 0.02))) return;
      this.extremes.push({
        kind,
        hoursLeft: this.rng.range(span[0], span[1]),
        severity: clamp01(severity),
        announced: false,
      });
      if (kind === 'drought') this.dryHours = 0;
      if (kind === 'monsoon') this.wetHours = 0;
    };

    // A dry week is weather. A dry season is a drought, and only somewhere
    // warm enough for the lack of rain to matter to anything growing.
    const growingWeather = this.meanTemperature() > 9;
    if (wet < normalWet * 0.35 && growingWeather) this.dryHours += hours;
    else this.dryHours = Math.max(0, this.dryHours - hours * 3);
    if (wet > normalWet * 2.5) this.wetHours += hours;
    else this.wetHours = Math.max(0, this.wetHours - hours * 3);

    tryStart('heatwave', anomaly > 3.5 && wet < normalWet, (anomaly - 3.5) / 5, [70, 260]);
    tryStart('coldsnap', anomaly < -3.5, (-anomaly - 3.5) / 5, [70, 240]);
    tryStart('drought', this.dryHours > 260, 0.35 + this.dryHours / 2400, [240, 900]);
    tryStart('monsoon', this.wetHours > 90 && this.meanTemperature() > 14, this.wetHours / 600, [90, 320]);
  }

  private extremeTemperatureOffset(): number {
    let d = 0;
    for (const e of this.extremes) {
      if (e.kind === 'heatwave') d += 4 + e.severity * 6;
      else if (e.kind === 'coldsnap') d -= 4 + e.severity * 7;
    }
    return d;
  }

  private extremeMoistureFactor(): number {
    let f = 1;
    for (const e of this.extremes) {
      if (e.kind === 'drought') f *= 1 - 0.55 * (0.4 + e.severity * 0.6);
      else if (e.kind === 'monsoon') f *= 1 + 0.9 * (0.4 + e.severity * 0.6);
    }
    return f;
  }

  /**
   * The slow drift. Two long cycles beat against each other so the climate
   * never settles into an obvious period, and ash from eruptions cools things
   * for a few years the way a real one does.
   */
  private updateLongTerm(totalHours: number, hours: number): void {
    const years = totalHours / (DAYS_PER_YEAR * 24);
    const slow = Math.sin((years / 137) * TAU) * 3.4;
    const fast = Math.sin((years / 41 + 0.37) * TAU) * 1.5;
    const jitter = Math.sin((years / 11 + 0.8) * TAU) * 0.6;
    this.trend = slow + fast + jitter;
    // Aerosol washes out of the sky over a couple of years.
    if (this.aerosolCooling > 0) {
      this.aerosolCooling = Math.max(0, this.aerosolCooling - hours * 0.0006);
    }
  }

  /** An eruption or impact throws enough up to dim the sun for a while. */
  addAerosol(amount: number): void {
    this.aerosolCooling = Math.min(9, this.aerosolCooling + amount);
  }

  private accumulateYear(year: number, hours: number): void {
    if (year !== this.yearAccum.year) {
      const a = this.yearAccum;
      if (a.samples > 0) {
        this.history.push({
          year: a.year,
          meanTemperature: a.tempSum / a.samples,
          totalRain: a.rain,
          totalSnow: a.snow,
          storms: a.storms,
        });
        if (this.history.length > 400) this.history.shift();
      }
      this.yearAccum = { year, tempSum: 0, samples: 0, rain: 0, snow: 0, storms: 0 };
    }
    this.yearAccum.tempSum += this.meanTemperature() * hours;
    this.yearAccum.samples += hours;
  }

  // =======================================================================
  // Readouts
  // =======================================================================

  meanTemperature(): number {
    let sum = 0;
    for (let i = 0; i < this.temperature.length; i++) sum += this.temperature[i];
    return sum / this.temperature.length;
  }

  private meanBaseTemperature(): number {
    let sum = 0;
    for (let i = 0; i < this.baseTemp.length; i++) sum += this.baseTemp[i];
    return sum / this.baseTemp.length;
  }

  meanPrecipitation(): number {
    let sum = 0;
    for (let i = 0; i < this.precipitation.length; i++) sum += this.precipitation[i];
    return sum / this.precipitation.length;
  }

  /**
   * How much colder or warmer the ground is than its long-run average right
   * now. The terrain colours use this to move the snow line, so a volcanic
   * winter or a warming century shows up in the landscape and not just in a
   * readout.
   */
  groundTemperatureOffset(): number {
    return this.meanTemperature() - this.meanBaseTemperature();
  }

  snowCover(): number {
    let covered = 0;
    for (let i = 0; i < this.snowpack.length; i++) if (this.snowpack[i] > 3) covered++;
    return covered / this.snowpack.length;
  }

  get era(): ClimateEra {
    const t = this.meanTemperature();
    if (t < 1) return 'glacial';
    if (t < 8) return 'cold';
    if (t < 18) return 'temperate';
    if (t < 25) return 'warm';
    return 'hot';
  }

  /** Change in mean temperature against the first decade on record. */
  warmingSinceFounding(): number {
    if (this.history.length < 2) return 0;
    const early = this.history.slice(0, Math.min(10, this.history.length));
    const late = this.history.slice(-Math.min(10, this.history.length));
    const avg = (xs: ClimateYear[]): number =>
      xs.reduce((s, y) => s + y.meanTemperature, 0) / xs.length;
    return avg(late) - avg(early);
  }

  // =======================================================================
  // Persistence
  // =======================================================================

  serialize(): Record<string, unknown> {
    return {
      temperature: Array.from(this.temperature),
      humidity: Array.from(this.humidity),
      pressure: Array.from(this.pressure),
      snowpack: Array.from(this.snowpack),
      cloud: Array.from(this.cloud),
      windU: Array.from(this.windU),
      windV: Array.from(this.windV),
      fronts: this.fronts.map((f) => ({ ...f })),
      extremes: this.extremes.map((e) => ({ ...e })),
      history: this.history.slice(-200),
      trend: this.trend,
      aerosolCooling: this.aerosolCooling,
      anthropogenic: this.anthropogenic,
    };
  }

  restore(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    const field = (key: string, into: Float32Array): void => {
      const raw = data[key];
      if (!Array.isArray(raw) || raw.length !== into.length) return;
      for (let i = 0; i < into.length; i++) {
        const v = raw[i];
        into[i] = typeof v === 'number' && Number.isFinite(v) ? v : into[i];
      }
    };
    field('temperature', this.temperature);
    field('humidity', this.humidity);
    field('pressure', this.pressure);
    field('snowpack', this.snowpack);
    field('cloud', this.cloud);
    field('windU', this.windU);
    field('windV', this.windV);

    this.fronts.length = 0;
    if (Array.isArray(data.fronts)) {
      for (const raw of data.fronts as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        const num = (k: string, fallback: number): number =>
          typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : fallback;
        const kind = raw.kind;
        this.fronts.push({
          id: this.nextFrontId++,
          kind: kind === 'cold' || kind === 'warm' || kind === 'occluded' ? kind : 'cold',
          x: num('x', 0),
          z: num('z', 0),
          heading: num('heading', 0),
          speed: num('speed', 20),
          width: num('width', 100),
          strength: clamp01(num('strength', 0.5)),
          life: num('life', 60),
        });
      }
    }

    this.extremes.length = 0;
    if (Array.isArray(data.extremes)) {
      const valid: ExtremeKind[] = ['heatwave', 'coldsnap', 'drought', 'monsoon'];
      for (const raw of data.extremes as Record<string, unknown>[]) {
        if (!raw || typeof raw !== 'object') continue;
        if (!valid.includes(raw.kind as ExtremeKind)) continue;
        this.extremes.push({
          kind: raw.kind as ExtremeKind,
          hoursLeft: typeof raw.hoursLeft === 'number' ? raw.hoursLeft : 24,
          severity: clamp01(typeof raw.severity === 'number' ? raw.severity : 0.5),
          announced: raw.announced === true,
        });
      }
    }

    this.history.length = 0;
    if (Array.isArray(data.history)) {
      for (const raw of data.history as Record<string, unknown>[]) {
        if (!raw || typeof raw.year !== 'number') continue;
        this.history.push({
          year: raw.year,
          meanTemperature: typeof raw.meanTemperature === 'number' ? raw.meanTemperature : 0,
          totalRain: typeof raw.totalRain === 'number' ? raw.totalRain : 0,
          totalSnow: typeof raw.totalSnow === 'number' ? raw.totalSnow : 0,
          storms: typeof raw.storms === 'number' ? raw.storms : 0,
        });
      }
    }

    if (typeof data.trend === 'number') this.trend = data.trend;
    if (typeof data.aerosolCooling === 'number') this.aerosolCooling = clamp(data.aerosolCooling, 0, 9);
    if (typeof data.anthropogenic === 'number') this.anthropogenic = clamp(data.anthropogenic, 0, 12);
  }
}
