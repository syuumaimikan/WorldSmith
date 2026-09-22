/**
 * Instanced wildlife with a simple gait bob, plus the soft contact shadow the
 * reference animal sets all sit on.
 */

import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { Animal, ANIMALS, AnimalSpecies } from '../sim/Wildlife';
import { buildAnimalGeometry } from './geometry/animals';
import { GeoBuilder } from './geometry/GeoBuilder';

const RANGE = 300;

export class WildlifeRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private shadowMaterial: MeshBasicMaterial;
  private meshes = new Map<string, InstancedMesh>();
  private shadows: InstancedMesh;
  private shadowGeo: BufferGeometry;
  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private time = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'wildlife';
    scene.add(this.group);

    const b = new GeoBuilder();
    b.quadXZ(1, 1, 0x000000, { y: 0 });
    this.shadowGeo = b.build();
    this.shadowMaterial = new MeshBasicMaterial({
      color: 0x0d1a12,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: DoubleSide,
    });
    this.shadows = new InstancedMesh(this.shadowGeo, this.shadowMaterial, 320);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 2;
    this.group.add(this.shadows);
  }

  update(animals: Animal[], cameraPos: Vector3, dt: number): void {
    this.time += dt;
    const lists = new Map<string, Animal[]>();
    const r2 = RANGE * RANGE;

    for (const a of animals) {
      const dx = a.x - cameraPos.x;
      const dz = a.z - cameraPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const lod = d2 < 70 * 70 ? 0 : 1;
      const key = `${a.species}|${lod}`;
      let list = lists.get(key);
      if (!list) {
        list = [];
        lists.set(key, list);
      }
      list.push(a);
    }

    for (const [key, mesh] of this.meshes) {
      if (!lists.has(key)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }

    let shadowCount = 0;

    for (const [key, list] of lists) {
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          mesh.dispose();
        }
        const [species, lodStr] = key.split('|');
        const geo = buildAnimalGeometry(species as AnimalSpecies, Number(lodStr) as 0 | 1);
        mesh = new InstancedMesh(geo, this.material, Math.max(24, list.length * 2));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = Number(lodStr) === 0;
        mesh.name = `animal_${key}`;
        this.group.add(mesh);
        this.meshes.set(key, mesh);
      }

      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const def = ANIMALS[a.species];
        // A little vertical bob while moving sells the gait without bones.
        const bob = a.speed > 0.2 ? Math.abs(Math.sin(this.time * 6 + a.id)) * 0.055 * def.size : 0;
        const y = a.y + a.altitude + bob;
        this.pos.set(a.x, y, a.z);
        this.quat.setFromAxisAngle(this.up, a.yaw);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);

        if (shadowCount < 320 && a.species !== 'bird') {
          const s = def.size * 1.5;
          this.pos.set(a.x, a.y + 0.04, a.z);
          this.scale.set(s, 1, s * 1.35);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shadows.setMatrixAt(shadowCount++, this.mat4);
          this.scale.set(1, 1, 1);
        }
      }
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.shadows.count = shadowCount;
    this.shadows.visible = shadowCount > 0;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  get drawCallCount(): number {
    let n = this.shadows.visible ? 1 : 0;
    for (const m of this.meshes.values()) if (m.visible && m.count > 0) n++;
    return n;
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    this.meshes.clear();
    this.shadowGeo.dispose();
    this.shadowMaterial.dispose();
    this.shadows.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
