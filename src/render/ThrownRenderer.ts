/**
 * Whatever is currently in the air because somebody threw it.
 *
 * There are never many of these and they are never on screen long, so one
 * instanced mesh of one small tumbling shape does the whole job; the item's
 * own colour is enough to tell a stone from a loaf.
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { ITEMS } from '../data/items';
import type { ThrownItem } from '../sim/Throwing';

const MAX = 48;

export class ThrownRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private geometry = new BoxGeometry(0.26, 0.26, 0.26);
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private mesh: InstancedMesh;

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private euler = new Euler();
  private scale = new Vector3(1, 1, 1);
  private tint = new Color();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'thrown';
    scene.add(this.group);
    this.mesh = new InstancedMesh(this.geometry, this.material, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  update(thrown: ThrownItem[]): void {
    const n = Math.min(MAX, thrown.length);
    for (let i = 0; i < n; i++) {
      const t = thrown[i];
      this.pos.set(t.x, t.y + 0.12, t.z);
      // Tumbling on two axes, because a thrown thing does not stay level.
      this.euler.set(t.spin, t.spin * 0.61, t.spin * 0.37);
      this.quat.setFromEuler(this.euler);
      // Heavier things read as bigger, within reason.
      const s = 0.7 + Math.min(1.2, ITEMS[t.item].weight / 14);
      this.scale.set(s, s, s);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.mat4);
      this.tint.setHex(ITEMS[t.item].color);
      this.mesh.setColorAt(i, this.tint);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.group.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
