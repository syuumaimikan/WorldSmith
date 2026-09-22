/**
 * Low-poly animals, built the way reference images 2 and 3 build them: a boxy
 * body, four tapered legs, a cube head, and markings made from separate
 * coloured faces rather than textures.
 */

import { BufferGeometry } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { Rng } from '../../core/rng';
import { shade } from '../Palette';
import { ANIMALS, AnimalSpecies } from '../../sim/Wildlife';

export function buildAnimalGeometry(species: AnimalSpecies, lod: 0 | 1 = 0): BufferGeometry {
  const def = ANIMALS[species];
  const b = new GeoBuilder();
  const rng = new Rng(`animal:${species}`);
  const s = def.size;
  const body = def.colour;
  const belly = def.bellyColour;

  if (species === 'bird') {
    // Birds are tiny; a body, two wings and a beak is plenty at any distance.
    b.box(0.22, 0.16, 0.34, body, { y: 0 });
    b.box(0.5, 0.03, 0.18, shade(body, 1.15), { y: 0.03, rz: 0.12 });
    b.cone(0.05, 0.14, 4, 0xe0a83c, { y: 0.02, z: 0.24, rx: Math.PI / 2 });
    b.box(0.08, 0.1, 0.22, shade(body, 0.85), { y: 0.02, z: -0.26, rx: 0.3 });
    return b.build();
  }

  const bodyLen = 1.05 * s;
  const bodyH = 0.44 * s;
  const bodyW = 0.42 * s;
  const legLen = 0.5 * s;
  const legY = legLen / 2;

  // Torso, slightly tapered by using two boxes.
  b.box(bodyW, bodyH, bodyLen, body, { y: legLen + bodyH / 2 });
  b.box(bodyW * 0.92, bodyH * 0.45, bodyLen * 0.8, belly, { y: legLen + bodyH * 0.28 });

  if (lod === 0) {
    // Legs.
    const positions: [number, number][] = [
      [bodyW * 0.34, bodyLen * 0.32],
      [-bodyW * 0.34, bodyLen * 0.32],
      [bodyW * 0.34, -bodyLen * 0.32],
      [-bodyW * 0.34, -bodyLen * 0.32],
    ];
    for (const [x, z] of positions) {
      b.box(0.11 * s, legLen, 0.11 * s, shade(body, 0.82), { x, y: legY, z });
      b.box(0.13 * s, 0.08 * s, 0.15 * s, shade(body, 0.6), { x, y: 0.04 * s, z });
    }
  } else {
    b.box(bodyW * 0.9, legLen, bodyLen * 0.8, shade(body, 0.8), { y: legY });
  }

  // Neck and head.
  const neckY = legLen + bodyH * 0.9;
  const headZ = bodyLen * 0.5;
  const upright = species === 'deer' || species === 'sheep';
  if (upright) {
    b.box(0.2 * s, 0.42 * s, 0.2 * s, body, { x: 0, y: neckY + 0.16 * s, z: headZ - 0.06 * s, rx: -0.3 });
    b.box(0.26 * s, 0.26 * s, 0.4 * s, body, { y: neckY + 0.38 * s, z: headZ + 0.12 * s });
    b.box(0.2 * s, 0.16 * s, 0.14 * s, shade(body, 0.7), { y: neckY + 0.34 * s, z: headZ + 0.34 * s });
  } else {
    b.box(0.3 * s, 0.3 * s, 0.4 * s, body, { y: neckY - 0.02 * s, z: headZ + 0.1 * s, rx: 0.1 });
    b.box(0.22 * s, 0.18 * s, 0.16 * s, shade(body, 0.7), { y: neckY - 0.04 * s, z: headZ + 0.34 * s });
  }

  // Eyes, small but they matter for readability up close.
  if (lod === 0) {
    for (const side of [1, -1]) {
      b.box(0.05 * s, 0.05 * s, 0.03 * s, 0x14141a, {
        x: side * 0.11 * s,
        y: neckY + (upright ? 0.42 : 0.04) * s,
        z: headZ + (upright ? 0.28 : 0.3) * s,
      });
    }
  }

  // Ears.
  for (const side of [1, -1]) {
    b.cone(0.07 * s, 0.16 * s, 4, shade(body, 0.85), {
      x: side * 0.12 * s,
      y: neckY + (upright ? 0.54 : 0.16) * s,
      z: headZ + (upright ? 0.06 : 0.1) * s,
      rz: side * 0.3,
    });
  }

  // Tail.
  b.box(0.08 * s, 0.08 * s, 0.26 * s, shade(body, 0.75), {
    y: legLen + bodyH * 0.8,
    z: -bodyLen * 0.52,
    rx: 0.4,
  });

  // Species detailing.
  if (species === 'deer' && lod === 0) {
    // Antlers, the thing that makes a deer read as a deer.
    for (const side of [1, -1]) {
      const bx = side * 0.12 * s;
      const by = neckY + 0.6 * s;
      const bz = headZ + 0.08 * s;
      b.box(0.05 * s, 0.3 * s, 0.05 * s, 0x8a7458, { x: bx, y: by, z: bz, rz: side * 0.3 });
      b.box(0.04 * s, 0.2 * s, 0.04 * s, 0x8a7458, { x: bx + side * 0.13 * s, y: by + 0.16 * s, z: bz, rz: side * 0.8 });
      b.box(0.04 * s, 0.18 * s, 0.04 * s, 0x8a7458, { x: bx + side * 0.06 * s, y: by + 0.22 * s, z: bz + 0.1 * s, rx: 0.5 });
    }
    // Pale rump patch.
    b.box(bodyW * 0.7, bodyH * 0.4, 0.06 * s, belly, { y: legLen + bodyH * 0.6, z: -bodyLen * 0.5 });
  }

  if (species === 'boar') {
    b.box(0.06 * s, 0.05 * s, 0.14 * s, 0xe8e0cc, { x: 0.09 * s, y: neckY - 0.06 * s, z: headZ + 0.36 * s, rx: -0.5 });
    b.box(0.06 * s, 0.05 * s, 0.14 * s, 0xe8e0cc, { x: -0.09 * s, y: neckY - 0.06 * s, z: headZ + 0.36 * s, rx: -0.5 });
    // Bristled back.
    for (let i = 0; i < 4; i++) {
      b.box(0.04 * s, 0.12 * s, 0.05 * s, shade(body, 0.6), {
        y: legLen + bodyH + 0.04 * s,
        z: -bodyLen * 0.3 + i * 0.2 * s,
      });
    }
  }

  if (species === 'sheep') {
    // Fleece: a few extra lumps over the body.
    for (let i = 0; i < 5; i++) {
      b.blob(0.2 * s, 0, shade(belly, rng.range(0.94, 1.06)), {
        x: rng.range(-0.18, 0.18) * s,
        y: legLen + bodyH * rng.range(0.7, 1.05),
        z: rng.range(-0.4, 0.4) * s,
        sy: 0.8,
      });
    }
  }

  if (species === 'wolf' || species === 'fox') {
    // Longer snout and a bushier tail.
    b.box(0.16 * s, 0.14 * s, 0.24 * s, shade(body, 0.8), { y: neckY - 0.06 * s, z: headZ + 0.4 * s });
    b.box(0.16 * s, 0.16 * s, 0.4 * s, shade(body, 0.9), { y: legLen + bodyH * 0.75, z: -bodyLen * 0.62, rx: 0.5 });
    if (species === 'fox') {
      b.box(0.14 * s, 0.1 * s, 0.1 * s, 0xf0f0f0, { y: legLen + bodyH * 0.7, z: -bodyLen * 0.8 });
    }
  }

  if (species === 'rabbit') {
    for (const side of [1, -1]) {
      b.box(0.06 * s, 0.3 * s, 0.05 * s, shade(body, 0.9), {
        x: side * 0.09 * s,
        y: neckY + 0.2 * s,
        z: headZ,
        rz: side * 0.16,
      });
    }
  }

  return b.build();
}
