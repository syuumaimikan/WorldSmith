/**
 * The corner map.
 *
 * A small window on the ground immediately around you, north-up, drawn from
 * the same terrain the big map uses so the two never disagree. It is a
 * navigation aid rather than an overview: it shows what is within a few
 * hundred metres and nothing beyond that, and only ground you have actually
 * walked past.
 *
 * It redraws a few times a second rather than every frame -- a tile does not
 * change colour between two frames, and a per-frame redraw of ten thousand
 * pixels for the sake of a moving dot is a poor trade.
 */

import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { Biome } from '../../world/types';
import { OVERLAY } from '../../world/Terrain';
import { PALETTE, hexToCss, shade } from '../../render/Palette';
import { clamp01 } from '../../core/math';
import { useT } from '../../i18n';

/** Pixels across. The element is drawn at this size too, so one tile is one pixel at 1x. */
const SIZE = 168;

/** Metres across, at each zoom step. */
const RANGES = [120, 260, 560, 1200];

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

export function Minimap({ game, onOpenMap }: { game: Game; onOpenMap: () => void }): JSX.Element {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(1);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 220);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const world = game.world;
    const terrain = world.terrain;
    const range = RANGES[step];
    const centre = game.viewPoint;
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    const metresPerPixel = range / SIZE;

    for (let py = 0; py < SIZE; py++) {
      const wz = centre.z + (py - SIZE / 2) * metresPerPixel;
      for (let px = 0; px < SIZE; px++) {
        const wx = centre.x + (px - SIZE / 2) * metresPerPixel;
        const p = (py * SIZE + px) * 4;
        const tx = terrain.tileX(wx);
        const tz = terrain.tileZ(wz);
        if (!terrain.inBounds(tx, tz)) {
          // Off the edge of the world, drawn as nothing rather than as sea:
          // the world does have an edge and pretending otherwise is what
          // made the map and the ground disagree.
          data[p] = 14;
          data[p + 1] = 16;
          data[p + 2] = 20;
          data[p + 3] = 255;
          continue;
        }
        const i = terrain.index(tx, tz);
        if (world.explored[i] !== 1) {
          data[p] = 18;
          data[p + 1] = 20;
          data[p + 2] = 26;
          data[p + 3] = 255;
          continue;
        }

        const h = terrain.data.height[i];
        let colour: number;
        if (terrain.waterHeight[i] > h) {
          colour = BIOME_COLOURS[Biome.Ocean];
        } else if (terrain.overlay[i] & OVERLAY.Path) {
          colour = PALETTE.terrain.path;
        } else {
          // Shaded by slope so ridges and valleys read at a glance.
          const lit = 0.82 + clamp01(1 - terrain.data.slope[i]) * 0.34;
          colour = shade(BIOME_COLOURS[terrain.data.biome[i] as Biome], lit);
        }
        data[p] = (colour >> 16) & 0xff;
        data[p + 1] = (colour >> 8) & 0xff;
        data[p + 2] = colour & 0xff;
        data[p + 3] = 255;
      }
    }
    canvas.width = SIZE;
    canvas.height = SIZE;
    ctx.putImageData(img, 0, 0);
  });

  const world = game.world;
  const centre = game.viewPoint;
  const range = RANGES[step];
  const toPixel = (x: number, z: number): { x: number; y: number } => ({
    x: SIZE / 2 + ((x - centre.x) / range) * SIZE,
    y: SIZE / 2 + ((z - centre.z) / range) * SIZE,
  });
  const inView = (x: number, z: number): boolean =>
    Math.abs(x - centre.x) < range / 2 && Math.abs(z - centre.z) < range / 2;

  const player = toPixel(world.player.position.x, world.player.position.z);
  const yaw = game.viewYaw;

  return (
    <div className="minimap">
      <canvas ref={canvasRef} width={SIZE} height={SIZE} onClick={onOpenMap} title={t('map.title')} />
      <svg width={SIZE} height={SIZE} className="minimap-marks">
        {world.buildings
          .filter((b) => b.complete && inView(b.worldX, b.worldZ))
          .map((b) => {
            const p = toPixel(b.worldX, b.worldZ);
            return (
              <rect
                key={b.id}
                x={p.x - 2}
                y={p.y - 2}
                width={4}
                height={4}
                fill={hexToCss(b.def.housing ? PALETTE.build.roofTile : PALETTE.build.wood)}
              />
            );
          })}
        {world.npcs
          .filter((n) => inView(n.x, n.z))
          .map((n) => {
            const p = toPixel(n.x, n.z);
            return <circle key={n.id} cx={p.x} cy={p.y} r={1.6} fill="#d8d2c4" />;
          })}
        {inView(world.player.position.x, world.player.position.z) && (
          <g transform={`translate(${player.x} ${player.y}) rotate(${(-yaw * 180) / Math.PI})`}>
            <path d="M 0 -5 L 3.4 4 L 0 2 L -3.4 4 Z" fill={hexToCss(PALETTE.cloak.player)} stroke="#fff" strokeWidth={0.8} />
          </g>
        )}
      </svg>
      <div className="minimap-zoom">
        <button
          className="mini"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          +
        </button>
        <span className="mono tiny">{range >= 1000 ? `${(range / 1000).toFixed(1)}km` : `${range}m`}</span>
        <button
          className="mini"
          onClick={() => setStep((s) => Math.min(RANGES.length - 1, s + 1))}
          disabled={step === RANGES.length - 1}
        >
          &minus;
        </button>
      </div>
    </div>
  );
}
