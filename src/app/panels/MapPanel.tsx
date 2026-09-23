import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { Window } from '../components/common';
import { Biome } from '../../world/types';
import { OVERLAY } from '../../world/Terrain';
import { hexToCss, PALETTE, mixHex, shade } from '../../render/Palette';
import { clamp, clamp01 } from '../../core/math';
import { tierOf } from '../../sim/Nations';
import { useT } from '../../i18n';
import { biomeName } from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

type MapMode =
  | 'terrain'
  | 'biome'
  | 'resources'
  | 'fertility'
  | 'political'
  | 'faith'
  | 'knowledge'
  | 'temperature'
  | 'rainfall'
  | 'strain';

const MAP_MODES: MapMode[] = [
  'terrain',
  'biome',
  'resources',
  'fertility',
  'political',
  'faith',
  'knowledge',
  'temperature',
  'rainfall',
  'strain',
];

/** Modes that read a system rather than the ground, and ignore fog of war. */
const OVERVIEW_MODES = new Set<MapMode>([
  'political',
  'faith',
  'knowledge',
  'temperature',
  'rainfall',
  'strain',
]);

/**
 * A ramp from cold to hot. Used for anything measured rather than named, so
 * the same reading means the same colour on every map.
 */
function heat(t: number): number {
  const v = clamp01(t);
  if (v < 0.5) return mixHex(0x2b4c7e, 0x7fb069, v * 2);
  return mixHex(0x7fb069, 0xc4553a, (v - 0.5) * 2);
}

/**
 * A stable colour per polity or faith. The golden angle keeps neighbouring
 * ids well apart on the wheel, so two that share a border never come out the
 * same shade of green.
 */
function wheelColour(id: number): number {
  const h = (id * 137.508) % 360;
  const c = 0.42;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 0.52 - c / 2;
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

const MAP_SIZE = 520;

const BIOME_COLOURS: Record<Biome, number> = {
  [Biome.Ocean]: 0x25628f,
  [Biome.Lake]: 0x3f92c0,
  [Biome.River]: 0x4ea8d8,
  [Biome.Beach]: PALETTE.terrain.sand,
  [Biome.Grassland]: PALETTE.terrain.grass,
  [Biome.TemperateForest]: 0x4a7a34,
  [Biome.DenseForest]: 0x35602a,
  [Biome.Taiga]: PALETTE.terrain.taiga,
  [Biome.Tundra]: PALETTE.terrain.tundra,
  [Biome.Desert]: PALETTE.terrain.sand,
  [Biome.Savanna]: PALETTE.terrain.savanna,
  [Biome.Wetland]: PALETTE.terrain.wetland,
  [Biome.Mountain]: PALETTE.terrain.rock,
  [Biome.Alpine]: PALETTE.terrain.snow,
};

/** How far in the map will go. Eight times is about one tile per pixel. */
const MAX_ZOOM = 8;

export function MapPanel({ game, onClose }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useT();
  const [mode, setMode] = useState<MapMode>('terrain');
  const [hover, setHover] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null,
  );
  const world = game.world;

  // Keeps the visible window inside the map however far it is zoomed, so you
  // cannot drag the world off the edge of its own frame.
  const clampPan = (px: number, py: number, z: number): { x: number; y: number } => {
    const limit = MAP_SIZE * (z - 1);
    return { x: clamp(px, 0, Math.max(0, limit)), y: clamp(py, 0, Math.max(0, limit)) };
  };

  const zoomBy = (factor: number, originX: number, originY: number): void => {
    setZoom((z) => {
      const next = clamp(z * factor, 1, MAX_ZOOM);
      // Zoom about the cursor, so the thing you are pointing at stays put.
      setPan((p) => {
        const k = next / z;
        return clampPan((p.x + originX) * k - originX, (p.y + originY) * k - originY, next);
      });
      return next;
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = world.terrain;
    const N = t.gridSize;
    const img = ctx.createImageData(N, N);
    const data = img.data;

    const maxH = Math.max(1, t.data.maxHeight);

    // Heat maps are readings, not places, so the range is taken from the
    // world as it actually is rather than from a guessed constant.
    let lo = Infinity;
    let hi = -Infinity;
    if (mode === 'temperature' || mode === 'rainfall') {
      for (let c = 0; c < world.climate.cells * world.climate.cells; c++) {
        const v =
          mode === 'temperature' ? world.climate.temperature[c] : world.climate.rainfallMean[c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = Math.max(1e-6, hi - lo);
    const foremost = world.technology.foremost(world);
    const topKnowledge = Math.max(1, foremost ? foremost.era.threshold + 400 : 1);

    for (let i = 0; i < N * N; i++) {
      let colour: number;
      const explored = world.explored[i] === 1 || OVERVIEW_MODES.has(mode);
      const biome = t.data.biome[i] as Biome;
      const h = t.data.height[i];
      const water = t.waterHeight[i] > h;

      const wx = (i % N) * t.tileSize;
      const wz = Math.floor(i / N) * t.tileSize;

      if (mode === 'political' || mode === 'faith' || mode === 'knowledge') {
        // The land underneath, so an empty corner still reads as a map.
        colour = water ? 0x1d3448 : 0x2f3630;
        const owner = world.nations.nationAt(wx, wz);
        if (owner && !water) {
          if (mode === 'political') {
            colour = wheelColour(owner.id);
          } else if (mode === 'faith') {
            const f = world.culture.faithFor(owner.id);
            colour = f ? wheelColour(f.id * 7 + 3) : 0x3a3f46;
          } else {
            colour = heat(world.technology.knowledgeOf(world, owner) / topKnowledge);
          }
        }
      } else if (mode === 'temperature') {
        colour = heat((world.climate.temperatureAt(wx, wz) - lo) / span);
      } else if (mode === 'rainfall') {
        colour = water
          ? PALETTE.water.deep
          : heat((cellRain(world, wx, wz) - lo) / span);
      } else if (mode === 'strain') {
        colour = water
          ? PALETTE.water.deep
          : heat(clamp01(world.tectonics.stressAt(wx, wz)));
      } else if (mode === 'biome') {
        colour = BIOME_COLOURS[biome] ?? PALETTE.terrain.grass;
      } else if (mode === 'fertility') {
        colour = water
          ? PALETTE.water.deep
          : mixHex(0x40342a, PALETTE.vegetation.crop, clamp01(t.data.fertility[i]));
      } else if (mode === 'resources') {
        colour = water ? 0x2a4a66 : 0x30343c;
      } else {
        // Shaded relief: biome colour with a hillshade from the west.
        colour = water
          ? mixHex(PALETTE.water.shallow, PALETTE.water.deep, clamp01((t.waterHeight[i] - h) / 8))
          : BIOME_COLOURS[biome] ?? PALETTE.terrain.grass;
        if (!water) {
          const x = i % N;
          const left = x > 0 ? t.data.height[i - 1] : h;
          const slope = (h - left) * 0.16;
          colour = shade(colour, 1 + Math.max(-0.45, Math.min(0.45, slope)));
          colour = mixHex(colour, PALETTE.terrain.snow, clamp01((h / maxH - 0.72) * 2.6));
        }
      }

      // Player-made roads show on the maps that are about the ground.
      if (!OVERVIEW_MODES.has(mode)) {
        if (t.overlay[i] & (OVERLAY.Road | OVERLAY.Path)) colour = PALETTE.terrain.path;
        if (t.overlay[i] & (OVERLAY.Field | OVERLAY.Tilled)) colour = PALETTE.terrain.farmTilled;
      }

      const p = i * 4;
      if (!explored) {
        // Unexplored ground is hinted at, not shown.
        data[p] = 18;
        data[p + 1] = 21;
        data[p + 2] = 27;
        data[p + 3] = 255;
      } else {
        data[p] = (colour >> 16) & 0xff;
        data[p + 1] = (colour >> 8) & 0xff;
        data[p + 2] = colour & 0xff;
        data[p + 3] = 255;
      }
    }

    // Resource mode overlays node positions on the dark base.
    if (mode === 'resources') {
      for (const n of world.nodes) {
        if (n.depleted) continue;
        const tx = t.tileX(n.x);
        const tz = t.tileZ(n.z);
        const i = tz * N + tx;
        if (world.explored[i] !== 1) continue;
        const colour = resourceColour(n.kind);
        const p = i * 4;
        data[p] = (colour >> 16) & 0xff;
        data[p + 1] = (colour >> 8) & 0xff;
        data[p + 2] = colour & 0xff;
      }
    }

    canvas.width = N;
    canvas.height = N;
    ctx.putImageData(img, 0, 0);
  }, [mode, world]);

  /**
   * Screen point to world metres.
   *
   * The rectangle is the viewport, not the map: the map inside it is `zoom`
   * times bigger and scrolled by `pan`, and a reading taken without undoing
   * that is a reading of the wrong place.
   */
  const toWorld = (e: { clientX: number; clientY: number }, rect: DOMRect): { x: number; z: number } => {
    const sx = e.clientX - rect.left + pan.x;
    const sy = e.clientY - rect.top + pan.y;
    const size = MAP_SIZE * zoom;
    return { x: (sx / size) * world.terrain.worldSize, z: (sy / size) * world.terrain.worldSize };
  };

  const scale = MAP_SIZE / world.terrain.worldSize;
  const view = game.viewPoint;
  // Only worth drawing when it is somewhere other than on top of the player.
  const viewAway =
    Math.hypot(view.x - world.player.position.x, view.z - world.player.position.z) > 12;

  return (
    <Window title={t('map.title')} onClose={onClose} width="normal">
      <div className="choice-row" style={{ marginBottom: 12 }}>
        {MAP_MODES.map((m) => (
          <button key={m} className={`choice ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
            {t('map.' + m)}
          </button>
        ))}
      </div>

      <div className="map-wrap">
        <div
          className="map-viewport"
          style={{ position: 'relative', width: MAP_SIZE, height: MAP_SIZE, overflow: 'hidden' }}
          onWheel={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            zoomBy(e.deltaY < 0 ? 1.22 : 1 / 1.22, e.clientX - rect.left, e.clientY - rect.top);
          }}
          onMouseDown={(e) => {
            dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const drag = dragRef.current;
            if (drag) {
              const dx = e.clientX - drag.x;
              const dy = e.clientY - drag.y;
              if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
              if (drag.moved) setPan(clampPan(drag.panX - dx, drag.panY - dy, zoom));
              return;
            }
            const w = toWorld(e, rect);
            if (!world.terrain.inWorld(w.x, w.z)) {
              setHover('');
              return;
            }
            const biome = world.terrain.biomeAt(w.x, w.z);
            const tx = world.terrain.tileX(w.x);
            const tz = world.terrain.tileZ(w.z);
            const known = world.explored[world.terrain.index(tx, tz)] === 1;
            setHover(readout(world, mode, w.x, w.z, biome, known, t));
          }}
          onMouseUp={(e) => {
            const drag = dragRef.current;
            dragRef.current = null;
            // A drag moved the map; only a click without one travels.
            if (!drag || drag.moved) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const w = toWorld(e, rect);
            if (!world.terrain.inWorld(w.x, w.z)) return;
            const tx = world.terrain.tileX(w.x);
            const tz = world.terrain.tileZ(w.z);
            if (world.explored[world.terrain.index(tx, tz)] !== 1) return;
            game.focusOn(w.x, w.z);
            onClose();
          }}
          onMouseLeave={() => {
            dragRef.current = null;
            setHover('');
          }}
        >
        <div
          style={{
            position: 'absolute',
            width: MAP_SIZE,
            height: MAP_SIZE,
            transformOrigin: '0 0',
            transform: `translate(${-pan.x}px, ${-pan.y}px) scale(${zoom})`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="map-canvas"
            style={{ width: MAP_SIZE, height: MAP_SIZE, pointerEvents: 'none' }}
          />

          {/* Landmarks and settlement markers sit above the canvas. */}
          <svg
            width={MAP_SIZE}
            height={MAP_SIZE}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {world.buildings
              .filter((b) => b.complete)
              .map((b) => (
                <rect
                  key={b.id}
                  x={b.worldX * scale - 2}
                  y={b.worldZ * scale - 2}
                  width={4}
                  height={4}
                  fill={hexToCss(b.def.housing ? PALETTE.build.roofTile : PALETTE.build.wood)}
                />
              ))}
            {/* Other people's towns, sized by what they are. A city is a
                mark you can see from across the map; a village is a dot. */}
            {world.nations.allTowns.map((town) => {
              // A town you have not been near is a town you have not heard
              // of, except on the maps that read a system rather than the
              // ground -- those are what the player knows about the world,
              // not what they have walked over.
              const known =
                OVERVIEW_MODES.has(mode) ||
                world.explored[
                  world.terrain.index(
                    world.terrain.tileX(town.x),
                    world.terrain.tileZ(town.z),
                  )
                ] === 1;
              if (!known) return null;
              const tier = tierOf(town);
              const r = tier === 'city' ? 5 : tier === 'town' ? 3.5 : 2.2;
              const nation = world.nations.nations.find((n) => n.id === town.nationId);
              const colour = nation ? hexToCss(wheelColour(nation.id)) : '#cccccc';
              return (
                <g key={`town${town.id}`}>
                  <circle
                    cx={town.x * scale}
                    cy={town.z * scale}
                    r={r}
                    fill={colour}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth={1}
                  />
                  {tier !== 'village' && (
                    <text
                      x={town.x * scale + r + 3}
                      y={town.z * scale + 3}
                      fill="rgba(255,255,255,0.82)"
                      fontSize={tier === 'city' ? 10 : 8.5}
                    >
                      {town.name}
                    </text>
                  )}
                </g>
              );
            })}
            {world.pois
              .filter((p) => p.discovered)
              .map((p) => (
                <g key={p.id}>
                  <circle cx={p.x * scale} cy={p.z * scale} r={3.5} fill="none" stroke="#e0b24a" strokeWidth={1.4} />
                  <text x={p.x * scale + 6} y={p.z * scale + 3} fill="#e0b24a" fontSize={9}>
                    {p.name}
                  </text>
                </g>
              ))}
            <circle
              cx={world.settlement.centre.x * scale}
              cy={world.settlement.centre.z * scale}
              r={world.settlement.radius * scale}
              fill="none"
              stroke="rgba(224,178,74,0.35)"
              strokeDasharray="4 4"
            />
            <circle
              cx={world.player.position.x * scale}
              cy={world.player.position.z * scale}
              r={4 / zoom}
              fill={hexToCss(PALETTE.cloak.player)}
              stroke="#fff"
              strokeWidth={1.2 / zoom}
            />
            {/* Where the eye actually is. In god mode the camera leaves the
                body behind, and marking only the body made the map look like
                it was of a smaller world than the one you were flying over. */}
            {viewAway && (
              <g>
                <circle
                  cx={view.x * scale}
                  cy={view.z * scale}
                  r={5 / zoom}
                  fill="none"
                  stroke="#e8e8ec"
                  strokeWidth={1.4 / zoom}
                />
                <line
                  x1={view.x * scale}
                  y1={view.z * scale}
                  x2={(view.x - Math.sin(game.viewYaw) * 26) * scale}
                  y2={(view.z - Math.cos(game.viewYaw) * 26) * scale}
                  stroke="#e8e8ec"
                  strokeWidth={1.4 / zoom}
                />
              </g>
            )}
          </svg>
        </div>
        </div>
      </div>

      <div className="map-zoom">
        <button className="mini" onClick={() => zoomBy(1 / 1.5, MAP_SIZE / 2, MAP_SIZE / 2)}>
          &minus;
        </button>
        <span className="mono tiny">{zoom.toFixed(1)}&times;</span>
        <button className="mini" onClick={() => zoomBy(1.5, MAP_SIZE / 2, MAP_SIZE / 2)}>
          +
        </button>
        <span className="tiny muted">{t('map.scaleNote', { km: (world.terrain.worldSize / 1000).toFixed(1) })}</span>
      </div>

      <div className="map-legend">
        <span className="mono">{hover || t('map.clickToTravel')}</span>
      </div>
      <div className="map-legend">
        <span>
          <i style={{ background: hexToCss(PALETTE.cloak.player) }} /> {t('map.you')}
        </span>
        <span>
          <i style={{ background: hexToCss(PALETTE.build.roofTile) }} /> {t('map.housingLegend')}
        </span>
        <span>
          <i style={{ background: hexToCss(PALETTE.build.wood) }} /> {t('map.otherBuildings')}
        </span>
        <span>
          <i style={{ background: hexToCss(PALETTE.terrain.path) }} /> {t('map.roadsLegend')}
        </span>
        <span>
          <i style={{ background: '#e0b24a' }} /> {t('map.landmarks')}
        </span>
      </div>
    </Window>
  );
}

function resourceColour(kind: string): number {
  if (kind.includes('iron')) return 0xc4704a;
  if (kind.includes('copper')) return 0x5fd0a8;
  if (kind.includes('coal')) return 0x8a8a94;
  if (kind.includes('clay')) return 0xd89a6a;
  if (kind.includes('sand')) return PALETTE.terrain.sand;
  if (kind === 'rock' || kind === 'boulder') return PALETTE.terrain.rock;
  if (kind === 'berry_bush') return PALETTE.vegetation.flowerB;
  if (kind === 'herb_patch') return 0x7fe0a0;
  if (kind === 'reeds' || kind === 'fiber_plant' || kind === 'bush') return PALETTE.vegetation.bush;
  return PALETTE.vegetation.leafSummer;
}

/** What the map is showing under the cursor, in the language being read. */
function readout(
  world: Game['world'],
  mode: MapMode,
  x: number,
  z: number,
  biome: Biome,
  known: boolean,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (mode === 'political' || mode === 'faith' || mode === 'knowledge') {
    const owner = world.nations.nationAt(x, z);
    if (!owner) return t('map.unclaimed');
    if (mode === 'political') return owner.name;
    if (mode === 'faith') {
      return world.culture.faithFor(owner.id)?.name ?? t('common.none');
    }
    return `${owner.name} \u00b7 ${t(`era.${world.technology.eraOf(world, owner).id}`)}`;
  }
  if (mode === 'temperature') return `${world.climate.temperatureAt(x, z).toFixed(1)} \u00b0C`;
  if (mode === 'rainfall') {
    return t('map.rainReading', { mm: cellRain(world, x, z).toFixed(2) });
  }
  if (mode === 'strain') {
    return t('map.strainReading', {
      percent: Math.round(clamp01(world.tectonics.stressAt(x, z)) * 100),
    });
  }
  if (!known) return t('map.unexplored');
  return `${biomeName(biome)} \u00b7 ${Math.round(world.terrain.heightAt(x, z))} m`;
}

/** The long-run rainfall in the air cell over a point, in mm per hour. */
function cellRain(world: Game['world'], x: number, z: number): number {
  const c = world.climate;
  const cx = Math.max(0, Math.min(c.cells - 1, Math.floor(x / c.cellSize)));
  const cz = Math.max(0, Math.min(c.cells - 1, Math.floor(z / c.cellSize)));
  return c.rainfallMean[cz * c.cells + cx];
}
