import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Pill, Tabs, Window } from '../components/common';
import { hexToCss, mixHex, PALETTE } from '../../render/Palette';
import { clamp01 } from '../../core/math';
import { useT } from '../../i18n';

interface Props {
  game: Game;
  onClose: () => void;
}

type ClimateTab = 'now' | 'map' | 'history';
type MapField = 'temperature' | 'precipitation' | 'wind' | 'snowpack';

const MAP_PX = 460;

export function ClimatePanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<ClimateTab>('now');
  const [field, setField] = useState<MapField>('temperature');

  return (
    <Window title={t('climate.title')} onClose={onClose} width="wide">
      <Tabs
        tabs={[
          { id: 'now', label: t('climate.tab.now') },
          { id: 'map', label: t('climate.tab.map') },
          { id: 'history', label: t('climate.tab.history') },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'now' && <NowTab game={game} />}
      {tab === 'map' && <MapTab game={game} field={field} onField={setField} />}
      {tab === 'history' && <HistoryTab game={game} />}
    </Window>
  );
}

// ---------------------------------------------------------------- right now

function NowTab({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const climate = world.climate;
  const here = world.player.position;
  const air = climate.sampleAt(here.x, here.z);
  const local = climate.temperatureAt(here.x, here.z);

  const warming = climate.warmingSinceFounding();

  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>
        {t('climate.here')}
      </div>
      <div className="stat-grid">
        <Reading label={t('climate.temperature')} value={`${local.toFixed(1)} °C`} />
        <Reading label={t('climate.humidity')} value={`${Math.round(air.saturation * 100)} %`} />
        <Reading label={t('climate.pressure')} value={`${Math.round(air.pressure)} hPa`} />
        <Reading
          label={t('climate.wind')}
          value={`${air.windSpeed.toFixed(1)} m/s ${compass(air.windDirection)}`}
        />
        <Reading label={t('climate.cloud')} value={`${Math.round(air.cloud * 100)} %`} />
        <Reading
          label={t('climate.rainfall')}
          value={air.precipitation > 0.02 ? `${air.precipitation.toFixed(1)} mm/h` : '—'}
        />
        <Reading
          label={t('climate.snowpack')}
          value={air.snowpack > 0.5 ? `${Math.round(air.snowpack)} mm` : '—'}
        />
      </div>

      <div className="section-label">{t('climate.world')}</div>
      <div className="stat-grid">
        <Reading label={t('climate.era')} value={t(`climate.era.${climate.era}`)} />
        <Reading label={t('climate.meanTemp')} value={`${climate.meanTemperature().toFixed(1)} °C`} />
        <Reading
          label={t('climate.snowCover')}
          value={`${Math.round(climate.snowCover() * 100)} %`}
        />
        <Reading label={t('climate.lightning')} value={String(world.lightningStrikes)} />
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {Math.abs(warming) < 0.25
          ? t('climate.steady')
          : warming > 0
            ? t('climate.warming', { value: `${warming.toFixed(1)} °C` })
            : t('climate.cooling', { value: `${(-warming).toFixed(1)} °C` })}
      </div>

      <div className="section-label">{t('climate.happening')}</div>
      {climate.extremes.length === 0 && climate.fronts.length === 0 && world.storms.storms.length === 0 ? (
        <EmptyNote>{t('climate.settled')}</EmptyNote>
      ) : (
        <div className="chip-row">
          {climate.extremes.map((e) => (
            <Pill key={e.kind} tone={e.kind === 'monsoon' ? 'warn' : 'bad'}>
              {t(`climate.extreme.${e.kind}`)} · {Math.round(e.severity * 100)}%
            </Pill>
          ))}
          {climate.fronts.map((f) => (
            <Pill key={f.id}>{t('climate.front', { kind: t(`climate.front.${f.kind}`) })}</Pill>
          ))}
          {world.storms.storms.map((s) => (
            <Pill key={s.id} tone="bad">
              {t(`climate.storm.${s.kind}`)} · {s.name}
            </Pill>
          ))}
        </div>
      )}
    </>
  );
}

function Reading({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <span className="tiny muted">{label}</span>
      <b className="mono">{value}</b>
    </div>
  );
}

// ------------------------------------------------------------------ the map

function MapTab({
  game,
  field,
  onField,
}: {
  game: Game;
  field: MapField;
  onField: (f: MapField) => void;
}): JSX.Element {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const climate = game.world.climate;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const n = climate.cells;
    const img = ctx.createImageData(n, n);
    const values = fieldValues(climate, field);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1e-4) hi = lo + 1;

    for (let i = 0; i < n * n; i++) {
      const s = clamp01((values[i] - lo) / (hi - lo));
      const colour = rampFor(field, s);
      img.data[i * 4] = (colour >> 16) & 0xff;
      img.data[i * 4 + 1] = (colour >> 8) & 0xff;
      img.data[i * 4 + 2] = colour & 0xff;
      img.data[i * 4 + 3] = 255;
    }

    // Draw the coarse grid, then scale it up with smoothing off so the cells
    // read as the discrete parcels of air they are.
    const off = document.createElement('canvas');
    off.width = n;
    off.height = n;
    off.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    ctx.drawImage(off, 0, 0, MAP_PX, MAP_PX);

    // Wind barbs, so you can see where the air is actually going.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    const step = MAP_PX / n;
    for (let cz = 0; cz < n; cz += 2) {
      for (let cx = 0; cx < n; cx += 2) {
        const i = cz * n + cx;
        const u = climate.windU[i];
        const v = climate.windV[i];
        const speed = Math.hypot(u, v);
        if (speed < 0.6) continue;
        const px = (cx + 0.5) * step;
        const pz = (cz + 0.5) * step;
        const len = Math.min(step * 1.6, speed * 1.5);
        ctx.beginPath();
        ctx.moveTo(px, pz);
        ctx.lineTo(px + (u / speed) * len, pz + (v / speed) * len);
        ctx.stroke();
      }
    }

    // Where the fronts are.
    ctx.lineWidth = 2;
    const scale = MAP_PX / (climate.cells * climate.cellSize);
    for (const f of climate.fronts) {
      ctx.strokeStyle =
        f.kind === 'cold' ? 'rgba(120,180,255,0.85)' : f.kind === 'warm' ? 'rgba(255,150,120,0.85)' : 'rgba(210,160,255,0.85)';
      const nx = Math.cos(f.heading);
      const nz = Math.sin(f.heading);
      // The line itself runs across the direction of travel.
      const tx = -nz;
      const tz = nx;
      const half = MAP_PX;
      ctx.beginPath();
      ctx.moveTo(f.x * scale - tx * half, f.z * scale - tz * half);
      ctx.lineTo(f.x * scale + tx * half, f.z * scale + tz * half);
      ctx.stroke();
    }
  }, [climate, field]);

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 8 }}>
        {(['temperature', 'precipitation', 'wind', 'snowpack'] as MapField[]).map((f) => (
          <button key={f} className={`chip ${field === f ? 'active' : ''}`} onClick={() => onField(f)}>
            {t(`climate.${f === 'precipitation' ? 'rainfall' : f}`)}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={MAP_PX} height={MAP_PX} className="map-canvas" />
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {t('climate.mapNote')}
      </div>
    </>
  );
}

function fieldValues(
  climate: Game['world']['climate'],
  field: MapField,
): Float32Array | number[] {
  if (field === 'temperature') return climate.temperature;
  if (field === 'precipitation') return climate.precipitation;
  if (field === 'snowpack') return climate.snowpack;
  const out: number[] = [];
  for (let i = 0; i < climate.windU.length; i++) {
    out.push(Math.hypot(climate.windU[i], climate.windV[i]));
  }
  return out;
}

function rampFor(field: MapField, s: number): number {
  switch (field) {
    case 'temperature':
      return mixHex(0x2a4d8f, 0xd4643a, s);
    case 'precipitation':
      return mixHex(0x2c3a33, 0x4ea8d8, s);
    case 'snowpack':
      return mixHex(0x33384a, PALETTE.terrain.snow, s);
    default:
      return mixHex(0x2c3340, 0xd8d066, s);
  }
}

// -------------------------------------------------------------- the record

function HistoryTab({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const history = game.world.climate.history;
  if (history.length === 0) return <EmptyNote>{t('climate.noRecord')}</EmptyNote>;

  const temps = history.map((h) => h.meanTemperature);
  const lo = Math.min(...temps) - 0.5;
  const hi = Math.max(...temps) + 0.5;
  const maxRain = Math.max(1, ...history.map((h) => h.totalRain + h.totalSnow));

  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>
        {t('climate.byYear')}
      </div>
      <div className="climate-chart">
        {history.slice(-60).map((h) => {
          const heat = clamp01((h.meanTemperature - lo) / (hi - lo));
          const wet = clamp01((h.totalRain + h.totalSnow) / maxRain);
          return (
            <div
              key={h.year}
              className="climate-bar"
              title={`${h.year}: ${h.meanTemperature.toFixed(1)} °C · ${Math.round(h.totalRain)} mm · ${h.storms} storms`}
            >
              <div
                className="climate-bar-rain"
                style={{ height: `${wet * 100}%`, background: hexToCss(mixHex(0x2c3a33, 0x4ea8d8, 0.7)) }}
              />
              <div
                className="climate-bar-heat"
                style={{ bottom: `${heat * 92}%`, background: hexToCss(mixHex(0x2a4d8f, 0xd4643a, heat)) }}
              />
            </div>
          );
        })}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {t('climate.chartNote')}
      </div>

      <div className="section-label">{t('climate.recent')}</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('climate.year')}</th>
            <th>{t('climate.meanTemp')}</th>
            <th>{t('climate.rain')}</th>
            <th>{t('climate.snow')}</th>
            <th>{t('climate.storms')}</th>
          </tr>
        </thead>
        <tbody>
          {history
            .slice(-12)
            .reverse()
            .map((h) => (
              <tr key={h.year}>
                <td className="mono">{h.year}</td>
                <td className="mono">{h.meanTemperature.toFixed(1)} °C</td>
                <td className="mono">{Math.round(h.totalRain)} mm</td>
                <td className="mono">{Math.round(h.totalSnow)} mm</td>
                <td className="mono">{h.storms}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}

function compass(radians: number): string {
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const i = Math.round(((radians + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return dirs[i];
}
