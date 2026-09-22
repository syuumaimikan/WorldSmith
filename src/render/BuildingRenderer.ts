/**
 * Draws buildings at their true construction state, and the crops growing in
 * fields.
 *
 * A building's mesh is rebuilt whenever its visual key changes — a new stage,
 * a meaningful step of progress within a stage, nightfall lighting the windows,
 * or the season putting snow on the roof. Geometry is cached by key so a street
 * of identical cottages costs one build, not twenty.
 */

import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { Building } from '../sim/Building';
import { World } from '../sim/World';
import { StageId } from '../data/buildings';
import { buildBuildingGeometry, BuildProgress, visualKey } from './geometry/buildings';
import { buildCropGeometry } from './geometry/props';
import { Season } from './TerrainColors';

const CROP_STAGES = [0, 1, 2, 3] as const;

export class BuildingRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private meshes = new Map<number, { mesh: Mesh; key: string }>();
  private geoCache = new Map<string, { geo: BufferGeometry; refs: number }>();
  private crops = new Map<string, InstancedMesh>();
  private season: Season;
  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);

  /** Buildings rebuilt this frame, used for the performance readout. */
  rebuildsLastFrame = 0;

  constructor(scene: Scene, season: Season) {
    this.scene = scene;
    this.season = season;
    this.group.name = 'buildings';
    scene.add(this.group);
  }

  setSeason(season: Season): void {
    if (this.season === season) return;
    this.season = season;
    // Force every building to re-evaluate (snow on roofs, crop colours).
    for (const entry of this.meshes.values()) entry.key = '';
    for (const mesh of this.crops.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.crops.clear();
  }

  update(world: World, cameraPos: Vector3, nightFactor: number): void {
    this.rebuildsLastFrame = 0;
    const seen = new Set<number>();
    const ts = world.terrain.tileSize;

    for (const b of world.buildings) {
      seen.add(b.id);
      const lit = nightFactor > 0.35 && b.complete && (b.residentIds.length > 0 || b.workerIds.length > 0);
      const options = {
        def: b.def,
        progress: progressOf(b),
        tilesW: b.footprintWidth,
        tilesD: b.footprintDepth,
        tileSize: ts,
        seed: b.id * 2654435761,
        season: this.season,
        lit,
        condition: b.condition,
      };
      const key = visualKey(options);

      let entry = this.meshes.get(b.id);
      if (!entry) {
        const mesh = new Mesh(this.acquire(key, () => buildBuildingGeometry(options)), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = `building_${b.id}`;
        this.group.add(mesh);
        entry = { mesh, key };
        this.meshes.set(b.id, entry);
        this.rebuildsLastFrame++;
      } else if (entry.key !== key) {
        this.release(entry.key);
        entry.mesh.geometry = this.acquire(key, () => buildBuildingGeometry(options));
        entry.key = key;
        this.rebuildsLastFrame++;
      }

      // Buildings sit on the average ground height of their footprint.
      entry.mesh.position.set(b.worldX, b.groundY, b.worldZ);
      entry.mesh.rotation.y = 0;
      entry.mesh.updateMatrix();

      // Cull far buildings outright; fog hides them anyway.
      const d = Math.hypot(b.worldX - cameraPos.x, b.worldZ - cameraPos.z);
      entry.mesh.visible = d < 900;
      entry.mesh.castShadow = d < 160;
    }

    // Remove meshes for buildings that no longer exist.
    for (const [id, entry] of this.meshes) {
      if (seen.has(id)) continue;
      this.group.remove(entry.mesh);
      this.release(entry.key);
      this.meshes.delete(id);
    }

    this.updateCrops(world, cameraPos);
  }

  private acquire(key: string, build: () => BufferGeometry): BufferGeometry {
    let entry = this.geoCache.get(key);
    if (!entry) {
      entry = { geo: build(), refs: 0 };
      this.geoCache.set(key, entry);
    }
    entry.refs++;
    return entry.geo;
  }

  private release(key: string): void {
    const entry = this.geoCache.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.geo.dispose();
      this.geoCache.delete(key);
    }
  }

  // ------------------------------------------------------------------ crops

  private updateCrops(world: World, cameraPos: Vector3): void {
    const ts = world.terrain.tileSize;
    const counts = new Map<string, number>();
    const buckets = new Map<string, { x: number; y: number; z: number }[]>();

    for (const b of world.buildings) {
      if (!b.complete || b.fields.length === 0) continue;
      if (Math.hypot(b.worldX - cameraPos.x, b.worldZ - cameraPos.z) > 420) continue;
      for (const f of b.fields) {
        const crop = f.crop ?? 'grain';
        const stage: 0 | 1 | 2 | 3 = !f.planted
          ? 0
          : f.growth > 0.85
            ? 3
            : f.growth > 0.45
              ? 2
              : 1;
        const key = `${crop}:${stage}`;
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        const x = (f.tx + 0.5) * ts;
        const z = (f.tz + 0.5) * ts;
        list.push({ x, y: world.terrain.heightAt(x, z), z });
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    // Hide anything we did not fill this frame.
    for (const [key, mesh] of this.crops) {
      if (!buckets.has(key)) mesh.count = 0;
    }

    for (const [key, list] of buckets) {
      let mesh = this.crops.get(key);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.dispose();
        }
        const [crop, stageStr] = key.split(':');
        const stage = Number(stageStr) as (typeof CROP_STAGES)[number];
        const geo = buildCropGeometry(crop as 'grain' | 'vegetables', stage, this.season);
        mesh = new InstancedMesh(geo, this.material, Math.max(64, list.length * 2));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = `crop_${key}`;
        this.group.add(mesh);
        this.crops.set(key, mesh);
      }
      for (let i = 0; i < list.length; i++) {
        this.pos.set(list[i].x, list[i].y, list[i].z);
        this.quat.setFromAxisAngle(this.up, ((i * 37) % 4) * (Math.PI / 2));
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
      }
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get drawCallCount(): number {
    let n = 0;
    for (const e of this.meshes.values()) if (e.mesh.visible) n++;
    for (const c of this.crops.values()) if (c.count > 0) n++;
    return n;
  }

  dispose(): void {
    for (const e of this.meshes.values()) this.group.remove(e.mesh);
    for (const c of this.geoCache.values()) c.geo.dispose();
    for (const c of this.crops.values()) {
      c.geometry.dispose();
      c.dispose();
    }
    this.meshes.clear();
    this.geoCache.clear();
    this.crops.clear();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

function progressOf(b: Building): BuildProgress {
  const completed: StageId[] = [];
  for (let i = 0; i < Math.min(b.stageIndex, b.def.stages.length); i++) {
    completed.push(b.def.stages[i].id);
  }
  const current = b.complete ? null : (b.def.stages[b.stageIndex]?.id ?? null);
  return {
    completed,
    current,
    currentProgress: b.stageProgress,
    complete: b.complete,
  };
}

export { Color };
