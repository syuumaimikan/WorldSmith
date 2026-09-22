/**
 * Instanced rendering for every harvestable world object plus decorative
 * ground clutter.
 *
 * Tens of thousands of trees, rocks and bushes are drawn in a few dozen draw
 * calls by bucketing them into (kind, variant, detail level) instance sets that
 * are refilled only when the camera moves meaningfully or the world changes.
 */

import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { ResourceKind, ResourceNode } from '../world/resources';
import { Terrain } from '../world/Terrain';
import { Biome } from '../world/types';
import { buildFloraGeometry, Lod, VARIANT_COUNT } from './geometry/flora';
import { Season } from './TerrainColors';
import { GeoBuilder } from './geometry/GeoBuilder';
import { PALETTE, shade } from './Palette';
import { mulberry32 } from '../core/rng';
import { seasonColors } from './geometry/flora';

const LOD0_RANGE = 78;
const LOD1_RANGE = 190;
const LOD2_RANGE = 470;
const CLUTTER_RANGE = 58;
const REFILL_MOVE = 7;

interface Bucket {
  mesh: InstancedMesh;
  capacity: number;
  count: number;
  geometry: BufferGeometry;
  kind: ResourceKind;
  variant: number;
  lod: Lod;
}

export class VegetationRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private terrain: Terrain;
  private material: MeshLambertMaterial;
  private buckets = new Map<string, Bucket>();
  private season: Season;
  private cold: boolean;

  private lastRefillX = -1e9;
  private lastRefillZ = -1e9;
  private dirty = true;

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3();
  private up = new Vector3(0, 1, 0);
  private tmpColor = new Color();

  // Ground clutter (grass tufts, flowers) — decorative, not entities.
  private clutter: InstancedMesh;
  private clutterCapacity = 4200;
  private clutterRandom: (i: number) => number;

  constructor(scene: Scene, terrain: Terrain, season: Season, cold: boolean) {
    this.scene = scene;
    this.terrain = terrain;
    this.season = season;
    this.cold = cold;
    this.group.name = 'vegetation';
    scene.add(this.group);

    this.material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

    const table = new Float32Array(8192);
    const rnd = mulberry32(0x9a71cd);
    for (let i = 0; i < table.length; i++) table[i] = rnd();
    this.clutterRandom = (i: number) => table[i & 8191];

    this.clutter = new InstancedMesh(
      this.buildClutterGeometry(season),
      this.material,
      this.clutterCapacity,
    );
    this.clutter.instanceMatrix.setUsage(DynamicDrawUsage);
    this.clutter.frustumCulled = false;
    this.clutter.castShadow = false;
    this.clutter.receiveShadow = false;
    this.clutter.count = 0;
    this.group.add(this.clutter);
  }

  setSeason(season: Season, cold: boolean): void {
    if (this.season === season && this.cold === cold) return;
    this.season = season;
    this.cold = cold;
    // Rebuild every geometry so canopies change colour with the season.
    for (const b of this.buckets.values()) {
      b.geometry.dispose();
      b.geometry = buildFloraGeometry(b.kind, b.variant, b.lod, season, cold);
      b.mesh.geometry = b.geometry;
    }
    this.clutter.geometry.dispose();
    this.clutter.geometry = this.buildClutterGeometry(season);
    this.dirty = true;
  }

  /** Call when nodes are added or removed. */
  markDirty(): void {
    this.dirty = true;
  }

  update(nodes: ResourceNode[], camera: Vector3): void {
    const moved = Math.hypot(camera.x - this.lastRefillX, camera.z - this.lastRefillZ);
    if (!this.dirty && moved < REFILL_MOVE) return;
    this.lastRefillX = camera.x;
    this.lastRefillZ = camera.z;
    this.dirty = false;

    for (const b of this.buckets.values()) b.count = 0;

    const r0 = LOD0_RANGE * LOD0_RANGE;
    const r1 = LOD1_RANGE * LOD1_RANGE;
    const r2 = LOD2_RANGE * LOD2_RANGE;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.depleted) continue;
      const dx = n.x - camera.x;
      const dz = n.z - camera.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;

      const lod: Lod = d2 < r0 ? 0 : d2 < r1 ? 1 : 2;
      const variant = lod === 0 ? n.variant % VARIANT_COUNT[n.kind] : 0;
      const bucket = this.bucketFor(n.kind, variant, lod);

      if (bucket.count >= bucket.capacity) this.growBucket(bucket);

      const s = n.scale * (0.28 + n.growth * 0.72);
      this.pos.set(n.x, n.y, n.z);
      this.quat.setFromAxisAngle(this.up, n.rot);
      this.scale.set(s, s, s);
      this.mat4.compose(this.pos, this.quat, this.scale);
      bucket.mesh.setMatrixAt(bucket.count, this.mat4);

      // Per-instance tint, so a grove is not a field of clones.
      const j = 0.9 + ((n.id * 2654435761) % 1000) / 1000 * 0.2;
      this.tmpColor.setRGB(j, j, j);
      bucket.mesh.setColorAt(bucket.count, this.tmpColor);

      bucket.count++;
    }

    for (const b of this.buckets.values()) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }

    this.refillClutter(camera);
  }

  private bucketFor(kind: ResourceKind, variant: number, lod: Lod): Bucket {
    const key = `${kind}|${variant}|${lod}`;
    let b = this.buckets.get(key);
    if (b) return b;

    const geometry = buildFloraGeometry(kind, variant, lod, this.season, this.cold);
    const capacity = lod === 0 ? 256 : lod === 1 ? 768 : 2048;
    const mesh = new InstancedMesh(geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = lod === 0;
    mesh.receiveShadow = lod === 0;
    mesh.count = 0;
    mesh.name = key;
    this.group.add(mesh);

    b = { mesh, capacity, count: 0, geometry, kind, variant, lod };
    this.buckets.set(key, b);
    return b;
  }

  private growBucket(b: Bucket): void {
    const newCapacity = b.capacity * 2;
    const mesh = new InstancedMesh(b.geometry, this.material, newCapacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = b.mesh.castShadow;
    mesh.receiveShadow = b.mesh.receiveShadow;
    mesh.name = b.mesh.name;
    // Preserve what has already been written this frame.
    for (let i = 0; i < b.count; i++) {
      b.mesh.getMatrixAt(i, this.mat4);
      mesh.setMatrixAt(i, this.mat4);
    }
    this.group.remove(b.mesh);
    b.mesh.dispose();
    this.group.add(mesh);
    b.mesh = mesh;
    b.capacity = newCapacity;
  }

  // ------------------------------------------------------------- clutter

  private buildClutterGeometry(season: Season): BufferGeometry {
    const sc = seasonColors(season, this.cold);
    const b = new GeoBuilder();
    // A tiny crossed-blade tuft: 6 triangles, drawn thousands of times.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      b.box(0.1, 0.34, 0.015, shade(sc.grass, 0.88 + i * 0.1), {
        y: 0.17,
        ry: a,
        rz: (i - 1) * 0.18,
      });
    }
    return b.build();
  }

  private refillClutter(camera: Vector3): void {
    const t = this.terrain;
    const ts = t.tileSize;
    const range = CLUTTER_RANGE;
    const minTx = t.tileX(camera.x - range);
    const maxTx = t.tileX(camera.x + range);
    const minTz = t.tileZ(camera.z - range);
    const maxTz = t.tileZ(camera.z + range);
    const r2 = range * range;

    let n = 0;
    const cap = this.clutterCapacity;

    for (let tz = minTz; tz <= maxTz && n < cap; tz++) {
      for (let tx = minTx; tx <= maxTx && n < cap; tx++) {
        const i = tz * t.gridSize + tx;
        const biome = t.data.biome[i] as Biome;
        const density = CLUTTER_DENSITY[biome] ?? 0;
        if (density <= 0) continue;
        if (t.waterHeight[i] > t.data.height[i]) continue;
        if (t.data.slope[i] > 0.55) continue;
        if (t.overlay[i] !== 0) continue;

        const per = Math.round(density * 3);
        for (let k = 0; k < per && n < cap; k++) {
          const h1 = this.clutterRandom(i * 7 + k * 131);
          if (h1 > density) continue;
          const jx = this.clutterRandom(i * 13 + k * 17);
          const jz = this.clutterRandom(i * 29 + k * 53);
          const wx = (tx + jx) * ts;
          const wz = (tz + jz) * ts;
          const dx = wx - camera.x;
          const dz = wz - camera.z;
          if (dx * dx + dz * dz > r2) continue;

          const y = t.heightAt(wx, wz);
          const s = 0.7 + this.clutterRandom(i * 61 + k * 7) * 0.9;
          this.pos.set(wx, y, wz);
          this.quat.setFromAxisAngle(this.up, this.clutterRandom(i * 97 + k) * Math.PI * 2);
          this.scale.set(s, s * (0.75 + jx * 0.6), s);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.clutter.setMatrixAt(n, this.mat4);
          n++;
        }
      }
    }

    this.clutter.count = n;
    this.clutter.visible = n > 0;
    this.clutter.instanceMatrix.needsUpdate = true;
  }

  get drawCallCount(): number {
    let n = this.clutter.visible ? 1 : 0;
    for (const b of this.buckets.values()) if (b.mesh.visible) n++;
    return n;
  }

  dispose(): void {
    for (const b of this.buckets.values()) {
      b.geometry.dispose();
      b.mesh.dispose();
    }
    this.buckets.clear();
    this.clutter.geometry.dispose();
    this.clutter.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

/** Probability weight of decorative tufts per biome. */
const CLUTTER_DENSITY: Partial<Record<Biome, number>> = {
  [Biome.Grassland]: 0.55,
  [Biome.TemperateForest]: 0.4,
  [Biome.DenseForest]: 0.3,
  [Biome.Savanna]: 0.45,
  [Biome.Wetland]: 0.42,
  [Biome.Taiga]: 0.16,
  [Biome.Tundra]: 0.08,
  [Biome.Beach]: 0.05,
  [Biome.Mountain]: 0.05,
};

export { PALETTE };
