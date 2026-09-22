/**
 * Draws the world's landmarks.
 *
 * There are only a few dozen of these in a world and they never move, so each
 * kind and variant gets one instanced mesh and the whole set is written once
 * at load. The only thing that changes afterwards is whether the player has
 * found one, which is not something the geometry cares about.
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
import { buildLandmarkGeometry, LANDMARK_VARIANTS, LandmarkKind } from './geometry/landmarks';
import type { PointOfInterest } from '../world/types';
import type { Terrain } from '../world/Terrain';

export class LandmarkRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private meshes: InstancedMesh[] = [];

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'landmarks';
    scene.add(this.group);
  }

  /** Called once, when the world is loaded. */
  build(pois: PointOfInterest[], terrain: Terrain): void {
    this.clear();

    // Bucket by kind and variant so each bucket is one draw call.
    const buckets = new Map<string, PointOfInterest[]>();
    for (const poi of pois) {
      const variant = poi.id % LANDMARK_VARIANTS[poi.kind];
      const key = `${poi.kind}|${variant}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(poi);
    }

    for (const [key, list] of buckets) {
      const [kind, variantText] = key.split('|');
      const geometry = buildLandmarkGeometry(kind as LandmarkKind, Number(variantText));
      const mesh = new InstancedMesh(geometry, this.material, list.length);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `landmark_${key}`;
      mesh.frustumCulled = false;

      list.forEach((poi, i) => {
        this.pos.set(poi.x, terrain.heightAt(poi.x, poi.z) - 0.15, poi.z);
        // Deterministic from the landmark's own id, so it does not spin when
        // the world is reloaded.
        this.quat.setFromAxisAngle(this.up, ((poi.id * 2654435761) % 1000) / 1000 * Math.PI * 2);
        const s = 0.9 + ((poi.id * 40503) % 100) / 100 * 0.35;
        this.scale.set(s, s, s);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = list.length;

      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private clear(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.length = 0;
  }

  get drawCount(): number {
    return this.meshes.length;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
