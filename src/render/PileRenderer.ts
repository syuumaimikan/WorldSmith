/**
 * Draws goods lying on the ground.
 *
 * These matter more than they look: a heap of logs at the treeline that nobody
 * has collected is the clearest possible signal that the settlement is short of
 * haulers.
 */

import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { ItemPile } from '../sim/ItemPile';
import { ItemId, ITEMS } from '../data/items';
import { buildPileGeometry, pileShapeFor } from './geometry/props';
import { clamp01 } from '../core/math';

const RANGE = 320;
/** Stacks are bucketed by fullness so they visibly grow and shrink. */
const FILL_BUCKETS = 3;

export class PileRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private buckets = new Map<string, InstancedMesh>();
  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'piles';
    scene.add(this.group);
  }

  update(piles: ItemPile[], cameraPos: Vector3): void {
    const lists = new Map<string, ItemPile[]>();
    const r2 = RANGE * RANGE;

    for (const p of piles) {
      const dx = p.x - cameraPos.x;
      const dz = p.z - cameraPos.z;
      if (dx * dx + dz * dz > r2) continue;
      const stackSize = ITEMS[p.item].stackSize;
      const fill = clamp01(p.count / (stackSize * 1.5));
      const bucket = Math.min(FILL_BUCKETS - 1, Math.floor(fill * FILL_BUCKETS));
      const key = `${p.item}|${bucket}`;
      let list = lists.get(key);
      if (!list) {
        list = [];
        lists.set(key, list);
      }
      list.push(p);
    }

    for (const [key, mesh] of this.buckets) {
      if (!lists.has(key)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }

    for (const [key, list] of lists) {
      let mesh = this.buckets.get(key);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          mesh.dispose();
        }
        const [item, bucketStr] = key.split('|');
        const bucket = Number(bucketStr);
        const geo = buildPileGeometry(
          item as ItemId,
          pileShapeFor(item as ItemId),
          (bucket + 0.5) / FILL_BUCKETS,
        );
        mesh = new InstancedMesh(geo, this.material, Math.max(32, list.length * 2));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `pile_${key}`;
        this.group.add(mesh);
        this.buckets.set(key, mesh);
      }

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        this.pos.set(p.x, p.y, p.z);
        this.quat.setFromAxisAngle(this.up, p.rot);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
      }
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get drawCallCount(): number {
    let n = 0;
    for (const m of this.buckets.values()) if (m.visible && m.count > 0) n++;
    return n;
  }

  dispose(): void {
    for (const m of this.buckets.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    this.buckets.clear();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
