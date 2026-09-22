import { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Tabs, Window } from '../components/common';
import { EventCategory } from '../../sim/EventLog';
import { Age, Annal, Snapshot } from '../../sim/History';
import { useT } from '../../i18n';
import { eventDate, eventText } from '../../i18n/events';
import { hexToCss } from '../../render/Palette';
import { DAYS_PER_YEAR } from '../../sim/Time';

interface Props {
  game: Game;
  onClose: () => void;
}

type View = 'events' | 'ages' | 'maps' | 'numbers';
type Filter = 'all' | EventCategory;

const FILTER_IDS: { id: Filter; key: string }[] = [
  { id: 'all', key: 'chron.everything' },
  { id: 'construction', key: 'chron.building' },
  { id: 'settlement', key: 'chron.settlement' },
  { id: 'people', key: 'chron.people' },
  { id: 'weather', key: 'chron.weather' },
  { id: 'discovery', key: 'chron.discovery' },
  { id: 'history', key: 'chron.before' },
];

export function ChroniclePanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [view, setView] = useState<View>('events');
  const world = game.world;

  return (
    <Window title={t('chron.title', { name: world.config.name })} onClose={onClose} width="normal">
      <Tabs<View>
        tabs={[
          { id: 'events', label: t('chron.tab.events') },
          { id: 'ages', label: t('chron.tab.ages') },
          { id: 'maps', label: t('chron.tab.maps') },
          { id: 'numbers', label: t('chron.tab.numbers') },
        ]}
        active={view}
        onChange={setView}
      />
      {view === 'events' && <EventsView game={game} onClose={onClose} />}
      {view === 'ages' && <AgesView game={game} onClose={onClose} />}
      {view === 'maps' && <MapsView game={game} />}
      {view === 'numbers' && <NumbersView game={game} />}
    </Window>
  );
}

function EventsView({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const world = game.world;

  const events = [...world.log.all()]
    .filter((e) => filter === 'all' || e.category === filter)
    .reverse();

  return (
    <>
      <Tabs<Filter>
        tabs={FILTER_IDS.map((f) => ({ id: f.id, label: t(f.key) }))}
        active={filter}
        onChange={setFilter}
      />
      <div className="list" style={{ paddingTop: 14 }}>
        {events.map((e) => (
          <div
            className={`list-row ${e.x !== undefined ? 'clickable' : ''}`}
            key={e.id}
            style={{ gridTemplateColumns: '92px 1fr' }}
            onClick={() => {
              if (e.x !== undefined && e.z !== undefined) {
                game.focusOn(e.x, e.z);
                onClose();
              }
            }}
          >
            <span className="mono tiny muted">{eventDate(e)}</span>
            <span>{eventText(e)}</span>
          </div>
        ))}
        {events.length === 0 && <EmptyNote>{t('chron.nothing')}</EmptyNote>}
      </div>
    </>
  );
}

/**
 * The world divided into the kinds of time it has been through.
 *
 * No age is scheduled: each one is the world's own reading of what the last
 * few years were, so a settlement that is simply left alone gets one very long
 * age and the chronicle says so rather than inventing drama.
 */
function AgesView({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const ages = [...world.history.ages].reverse();
  const [open, setOpen] = useState<number>(ages[0]?.id ?? 0);

  if (ages.length === 0) return <EmptyNote>{t('chron.nothing')}</EmptyNote>;

  return (
    <div className="list" style={{ paddingTop: 14 }}>
      {ages.map((age) => (
        <div key={age.id}>
          <button
            className="list-row"
            style={{ gridTemplateColumns: '1fr 92px', textAlign: 'left', width: '100%' }}
            onClick={() => setOpen(open === age.id ? 0 : age.id)}
          >
            <div>
              <div>{t(`age.${age.kind}`, { name: age.subject })}</div>
              <div className="tiny muted">{ageSpan(t, age)}</div>
            </div>
            <span className="tiny mono muted">
              {t('age.entries', { count: world.history.annalsOf(age).length })}
            </span>
          </button>
          {open === age.id && (
            <AnnalList game={game} annals={world.history.annalsOf(age)} onClose={onClose} />
          )}
        </div>
      ))}
    </div>
  );
}

function AnnalList({
  game,
  annals,
  onClose,
}: {
  game: Game;
  annals: Annal[];
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  if (annals.length === 0) return <EmptyNote>{t('chron.quietAge')}</EmptyNote>;
  return (
    <div className="list" style={{ paddingLeft: 12 }}>
      {annals
        .slice()
        .reverse()
        .map((a) => (
          <div
            key={a.id}
            className={`list-row ${a.x !== undefined ? 'clickable' : ''}`}
            style={{ gridTemplateColumns: '78px 1fr' }}
            onClick={() => {
              if (a.x !== undefined && a.z !== undefined) {
                game.focusOn(a.x, a.z);
                onClose();
              }
            }}
          >
            <span className="mono tiny muted">{t('hist.year', { year: a.year })}</span>
            <span className="tiny">
              {eventText({
                id: a.id,
                day: a.day,
                year: a.year,
                month: 0,
                dayOfMonth: 1,
                category: a.category,
                key: a.key,
                params: a.params,
                notable: true,
              })}
            </span>
          </div>
        ))}
    </div>
  );
}

/**
 * The borders as they stood, wound back through every snapshot the world has
 * kept. The claim grid is the same one the nations actually use, so this is a
 * record of where the lines were, not an illustration of it.
 */
function MapsView({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const shots = world.history.snapshots;
  const [at, setAt] = useState(shots.length - 1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const index = Math.max(0, Math.min(shots.length - 1, at));
  const shot: Snapshot | undefined = shots[index];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const n = shot.cells;
    const img = ctx.createImageData(n, n);
    const terrain = world.terrain;
    const step = terrain.gridSize / n;

    for (let i = 0; i < n * n; i++) {
      const cx = i % n;
      const cz = Math.floor(i / n);
      // The land underneath, so an empty map still reads as a map.
      const ti = terrain.index(
        Math.min(terrain.gridSize - 1, Math.floor((cx + 0.5) * step)),
        Math.min(terrain.gridSize - 1, Math.floor((cz + 0.5) * step)),
      );
      const water = terrain.waterHeight[ti] > terrain.data.height[ti];
      let colour = water ? 0x1d3448 : 0x2f3630;

      const owner = shot.claims[i];
      if (owner !== 0) colour = nationColour(owner);

      const p = i * 4;
      img.data[p] = (colour >> 16) & 0xff;
      img.data[p + 1] = (colour >> 8) & 0xff;
      img.data[p + 2] = colour & 0xff;
      img.data[p + 3] = 255;
    }

    canvas.width = n;
    canvas.height = n;
    ctx.putImageData(img, 0, 0);
  }, [shot, world]);

  if (shots.length === 0 || !shot) return <EmptyNote>{t('chron.noMaps')}</EmptyNote>;

  return (
    <div style={{ paddingTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        {t('hist.year', { year: shot.year })}
      </div>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 6 }}
      />
      <div className="field" style={{ marginTop: 8 }}>
        <input
          type="range"
          min={0}
          max={shots.length - 1}
          step={1}
          value={index}
          onChange={(e) => setAt(Number(e.target.value))}
        />
      </div>
      <div className="tiny muted" style={{ marginBottom: 8 }}>
        {t('hist.mapHint')}
      </div>

      <div className="list">
        {shot.powers
          .slice()
          .sort((a, b) => b.territory - a.territory)
          .map((p) => (
            <div key={p.id} className="list-row" style={{ gridTemplateColumns: '18px 1fr 90px' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: hexToCss(nationColour(p.id)),
                }}
              />
              <span className="tiny">{p.name}</span>
              <span className="tiny mono muted">
                {p.population} · {p.territory}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

/** The shape of the world's past, as numbers that were actually recorded. */
function NumbersView({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const shots = game.world.history.snapshots;

  const series = useMemo(
    () => [
      { key: 'hist.population', values: shots.map((s) => s.population), colour: 0x8fb98a },
      { key: 'hist.settlers', values: shots.map((s) => s.settlers), colour: 0xd9b26a },
      { key: 'hist.nations', values: shots.map((s) => s.nations), colour: 0x7fa5c4 },
      { key: 'hist.faiths', values: shots.map((s) => s.faiths), colour: 0xb890c0 },
      { key: 'hist.wars', values: shots.map((s) => s.wars), colour: 0xc47f7f },
      { key: 'hist.temperature', values: shots.map((s) => s.meanTemperature), colour: 0xc9c07f },
    ],
    [shots],
  );

  if (shots.length < 2) return <EmptyNote>{t('chron.noMaps')}</EmptyNote>;

  return (
    <div style={{ paddingTop: 14 }}>
      <div className="tiny muted" style={{ marginBottom: 10 }}>
        {t('hist.span', { from: shots[0].year, to: shots[shots.length - 1].year })}
      </div>
      {series.map((s) => (
        <div key={s.key} style={{ marginBottom: 12 }}>
          <div className="kv" style={{ marginBottom: 2 }}>
            <span className="tiny muted">{t(s.key)}</span>
            <span className="tiny mono">{format(s.values[s.values.length - 1])}</span>
          </div>
          <Sparkline values={s.values} colour={s.colour} />
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values, colour }: { values: number[]; colour: number }): JSX.Element {
  const width = 300;
  const height = 42;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return <div />;
  const range = Math.max(1e-6, hi - lo);
  const points = values
    .map((v, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const y = height - ((v - lo) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }} role="img">
      <polyline
        points={points}
        fill="none"
        stroke={hexToCss(colour)}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '—';
  // A count of countries is a count. Only the measured things get a decimal.
  if (Number.isInteger(v) || Math.abs(v) >= 100) return String(Math.round(v));
  return v.toFixed(1);
}

function ageSpan(
  t: (key: string, params?: Record<string, string | number>) => string,
  age: Age,
): string {
  const from = Math.floor(age.startDay / DAYS_PER_YEAR) + 1;
  if (age.endDay < 0) return t('age.present', { from });
  return t('age.span', { from, to: Math.floor(age.endDay / DAYS_PER_YEAR) + 1 });
}

/**
 * A stable colour per polity. The golden angle keeps neighbouring ids well
 * apart on the wheel, so two countries that share a border never come out the
 * same shade of green.
 */
function nationColour(id: number): number {
  const hue = (id * 137.508) % 360;
  return hslToHex(hue, 0.42, 0.52);
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): number => Math.round((v + m) * 255) & 0xff;
  return (to(r) << 16) | (to(g) << 8) | to(b);
}
