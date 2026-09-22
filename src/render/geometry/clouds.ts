/** Flat-faceted cloud cluster, matching the hard-edged clouds in reference 7. */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { PALETTE } from '../Palette';

export function buildCloudGeometry(): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(0xc10d);
  const lobes = 5;
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1) - 0.5;
    b.blob(
      0.55 - Math.abs(t) * 0.26 + rng.range(-0.05, 0.08),
      0,
      PALETTE.sky.cloud,
      {
        x: t * 1.5,
        y: rng.range(-0.06, 0.1) + (0.12 - Math.abs(t) * 0.16),
        z: rng.range(-0.22, 0.22),
        sy: 0.62,
      },
    );
  }
  return b.build();
}
