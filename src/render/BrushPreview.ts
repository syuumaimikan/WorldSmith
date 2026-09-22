/**
 * The ring that shows where a god power will land.
 *
 * It follows the terrain rather than floating as a flat disc, so on a hillside
 * you can see exactly which ground is inside the brush.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Object3D,
  Scene,
  Vector3,
} from 'three';
import { Terrain } from '../world/Terrain';
import { PALETTE } from './Palette';

const SEGMENTS = 72;

export class BrushPreview {
  readonly group = new Object3D();
  private scene: Scene;
  private outer: Line;
  private inner: Line;
  private outerPositions: Float32Array;
  private innerPositions: Float32Array;
  private material: LineBasicMaterial;
  private pulse = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'brush';
    this.group.visible = false;
    scene.add(this.group);

    this.material = new LineBasicMaterial({
      color: PALETTE.ui.valid,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });

    this.outerPositions = new Float32Array((SEGMENTS + 1) * 3);
    this.innerPositions = new Float32Array((SEGMENTS + 1) * 3);
    this.outer = makeRing(this.outerPositions, this.material);
    this.inner = makeRing(this.innerPositions, this.material);
    this.group.add(this.outer, this.inner);
  }

  update(visible: boolean, centre: Vector3, radius: number, terrain: Terrain): void {
    this.group.visible = visible;
    if (!visible) return;
    this.pulse += 0.02;

    writeRing(this.outerPositions, centre, radius, terrain);
    writeRing(this.innerPositions, centre, radius * 0.35, terrain);
    (this.outer.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.inner.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.material.opacity = 0.6 + Math.sin(this.pulse) * 0.2;
  }

  setColour(hex: number): void {
    this.material.color.setHex(hex);
  }

  dispose(): void {
    this.outer.geometry.dispose();
    this.inner.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

function makeRing(positions: Float32Array, material: LineBasicMaterial): Line {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  const line = new Line(geo, material);
  line.frustumCulled = false;
  line.renderOrder = 950;
  return line;
}

function writeRing(out: Float32Array, centre: Vector3, radius: number, terrain: Terrain): void {
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const x = centre.x + Math.cos(a) * radius;
    const z = centre.z + Math.sin(a) * radius;
    out[i * 3] = x;
    // Lifted slightly so it never z-fights with the ground it traces.
    out[i * 3 + 1] = terrain.heightAt(x, z) + 0.35;
    out[i * 3 + 2] = z;
  }
}
