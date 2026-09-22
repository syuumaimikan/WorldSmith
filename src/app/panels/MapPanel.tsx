import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { Window } from '../components/common';
import { Biome } from '../../world/types';
import { OVERLAY } from '../../world/Terrain';
import { hexToCss, PALETTE, mixHex, shade } from '../../render/Palette';
import { clamp01 } from '../../core/math';
import { useT } from '../../i18n';
import { biomeName } from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

type MapMode = 'terrain' | 'biome' | 'resources' | 'fertility';

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

export function MapPanel({ game, onClose }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useT();
  const [mode, setMode] = useState<MapMode>('terrain');
  const [hover, setHover] = useState<string>('');
  const world = game.world;

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

    for (let i = 0; i < N * N; i++) {
      let colour: number;
      const explored = world.explored[i] === 1;
      const biome = t.data.biome[i] as Biome;
      const h = t.data.height[i];
      const water = t.waterHeight[i] > h;

      if (mode === 'biome') {
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

      // Player-made roads show on every mode.
      if (t.overlay[i] & (OVERLAY.Road | OVERLAY.Path)) colour = PALETTE.terrain.path;
      if (t.overlay[i] & (OVERLAY.Field | OVERLAY.Tilled)) colour = PALETTE.terrain.farmTilled;

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

  const toWorld = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; z: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fz = (e.clientY - rect.top) / rect.height;
    return { x: fx * world.terrain.worldSize, z: fz * world.terrain.worldSize };
  };

  const scale = MAP_SIZE / world.terrain.worldSize;

  return (
    <Window title={t('map.title')} onClose={onClose} width="normal">
      <div className="choice-row" style={{ marginBottom: 12 }}>
        {(['terrain', 'biome', 'resources', 'fertility'] as MapMode[]).map((m) => (
          <button key={m} className={`choice ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
            {t('map.' + m)}
          </button>
        ))}
      </div>

      <div className="map-wrap">
        <div style={{ position: 'relative', width: MAP_SIZE, height: MAP_SIZE }}>
          <canvas
            ref={canvasRef}
            className="map-canvas"
            style={{ width: MAP_SIZE, height: MAP_SIZE }}
            onMouseMove={(e) => {
              const w = toWorld(e);
              const biome = world.terrain.biomeAt(w.x, w.z);
              const tx = world.terrain.tileX(w.x);
              const tz = world.terrain.tileZ(w.z);
              const known = world.explored[world.terrain.index(tx, tz)] === 1;
              setHover(
                known
                  ? `${biomeName(biome)} \u00b7 ${Math.round(world.terrain.heightAt(w.x, w.z))} m`
                  : t('map.unexplored'),
              );
            }}
            onMouseLeave={() => setHover('')}
            onClick={(e) => {
              const w = toWorld(e);
              const tx = world.terrain.tileX(w.x);
              const tz = world.terrain.tileZ(w.z);
              if (world.explored[world.terrain.index(tx, tz)] !== 1) return;
              game.focusOn(w.x, w.z);
              onClose();
            }}
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
              r={4}
              fill={hexToCss(PALETTE.cloak.player)}
              stroke="#fff"
              strokeWidth={1.2}
            />
          </svg>
        </div>
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
