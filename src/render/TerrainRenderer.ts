/**
 * Chunked terrain and water rendering with distance LOD.
 *
 * The world is finite but large, so chunks are built on demand at a detail
 * level chosen by distance, and rebuilt when the player moves or when the
 * ground itself changes (a road is laid, a field is tilled, the season turns).
 * Rebuilds are budgeted per frame so streaming never causes a hitch.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Scene,
  Sphere,
  Vector3,
} from 'three';
import { Terrain } from '../world/Terrain';
import { Biome } from '../world/types';
import { NO_WATER } from '../world/TerrainGen';
import { groundColor, TerrainTint, waterColor } from './TerrainColors';
import { PALETTE } from './Palette';
import { mulberry32 } from '../core/rng';

const LOD_DISTANCES = [150, 290, 520, 900];
const MAX_VISIBLE_DISTANCE = 1500;

interface Chunk {
  index: number;
  cx: number;
  cz: number;
  centreX: number;
  centreZ: number;
  radius: number;
  lod: number;
  mesh: Mesh | null;
  water: Mesh | null;
  dirty: boolean;
  queued: boolean;
}

export class TerrainRenderer {
  readonly group = new Object3D();
  readonly waterGroup = new Object3D();
  private terrain: Terrain;
  private chunks: Chunk[] = [];
  private chunksPerRow: number;
  private chunkTiles: number;
  private queue: Chunk[] = [];
  private tint: TerrainTint;
  private groundMat: MeshLambertMaterial;
  private waterMat: MeshLambertMaterial;
  private waterTimeUniform = { value: 0 };
  private jitterRandom: (i: number) => number;

  constructor(terrain: Terrain, scene: Scene, tint: TerrainTint) {
    this.terrain = terrain;
    this.tint = tint;
    this.chunkTiles = terrain.chunkTiles;
    this.chunksPerRow = Math.ceil(terrain.gridSize / this.chunkTiles);

    this.group.name = 'terrain';
    this.waterGroup.name = 'water';
    scene.add(this.group);
    scene.add(this.waterGroup);

    this.groundMat = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });

    this.waterMat = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.86,
    });
    this.applyWaterWaves(this.waterMat);

    // Deterministic per-face value jitter; cheap stand-in for texture detail.
    const table = new Float32Array(4096);
    const rnd = mulberry32(0x51f0a3);
    for (let i = 0; i < table.length; i++) table[i] = rnd();
    this.jitterRandom = (i: number) => table[i & 4095];

    const n = this.chunksPerRow;
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const size = this.chunkTiles * terrain.tileSize;
        this.chunks.push({
          index: cz * n + cx,
          cx,
          cz,
          centreX: (cx + 0.5) * size,
          centreZ: (cz + 0.5) * size,
          radius: size * 0.75,
          lod: -1,
          mesh: null,
          water: null,
          dirty: true,
          queued: false,
        });
      }
    }
  }

  setTint(tint: TerrainTint): void {
    this.tint = tint;
    for (const c of this.chunks) c.dirty = true;
  }

  get tintRef(): TerrainTint {
    return this.tint;
  }

  /** Forces a rebuild of the chunk containing a tile. */
  markDirtyChunk(index: number): void {
    const c = this.chunks[index];
    if (c) c.dirty = true;
  }

  /**
   * Chooses LODs from the camera position and services the rebuild queue
   * within a millisecond budget.
   */
  update(camera: Vector3, dt: number, budgetMs = 4): void {
    this.waterTimeUniform.value += dt;

    // Drain overlay changes recorded by gameplay.
    if (this.terrain.dirtyChunks.size > 0) {
      for (const idx of this.terrain.dirtyChunks) this.markDirtyChunk(idx);
      this.terrain.dirtyChunks.clear();
    }

    for (const c of this.chunks) {
      const d = Math.hypot(camera.x - c.centreX, camera.z - c.centreZ) - c.radius;
      let wanted: number;
      if (d > MAX_VISIBLE_DISTANCE) wanted = -2;
      else if (d < LOD_DISTANCES[0]) wanted = 0;
      else if (d < LOD_DISTANCES[1]) wanted = 1;
      else if (d < LOD_DISTANCES[2]) wanted = 2;
      else wanted = 3;

      if (wanted === -2) {
        if (c.mesh) c.mesh.visible = false;
        if (c.water) c.water.visible = false;
        continue;
      }
      if (c.mesh) c.mesh.visible = true;
      if (c.water) c.water.visible = true;

      if ((wanted !== c.lod || c.dirty) && !c.queued) {
        c.queued = true;
        // Nearest chunks first so the player never looks at a hole.
        this.queue.push(c);
      }
    }

    if (this.queue.length > 1) {
      this.queue.sort(
        (a, b) =>
          Math.hypot(camera.x - a.centreX, camera.z - a.centreZ) -
          Math.hypot(camera.x - b.centreX, camera.z - b.centreZ),
      );
    }

    const start = performance.now();
    while (this.queue.length > 0) {
      const c = this.queue.shift() as Chunk;
      c.queued = false;
      const d = Math.hypot(camera.x - c.centreX, camera.z - c.centreZ) - c.radius;
      const lod = d < LOD_DISTANCES[0] ? 0 : d < LOD_DISTANCES[1] ? 1 : d < LOD_DISTANCES[2] ? 2 : 3;
      this.buildChunk(c, lod);
      if (performance.now() - start > budgetMs) break;
    }
  }

  /** Builds every chunk immediately. Used once during world loading. */
  buildAll(onProgress?: (f: number) => void): void {
    const centre = this.terrain.worldSize / 2;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const d = Math.hypot(centre - c.centreX, centre - c.centreZ);
      const lod = d < LOD_DISTANCES[0] ? 0 : d < LOD_DISTANCES[1] ? 1 : d < LOD_DISTANCES[2] ? 2 : 3;
      this.buildChunk(c, lod);
      if (onProgress && (i & 7) === 0) onProgress(i / this.chunks.length);
    }
    onProgress?.(1);
  }

  private buildChunk(c: Chunk, lod: number): void {
    const geo = this.buildGround(c, lod);
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      const m = new Mesh(geo, this.groundMat);
      m.castShadow = false;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = `chunk_${c.cx}_${c.cz}`;
      this.group.add(m);
      c.mesh = m;
    }
    c.mesh.geometry.boundingSphere = new Sphere(
      new Vector3(c.centreX, 0, c.centreZ),
      c.radius * 2.2,
    );

    const wgeo = this.buildWater(c, lod);
    if (wgeo) {
      if (c.water) {
        c.water.geometry.dispose();
        c.water.geometry = wgeo;
        c.water.visible = true;
      } else {
        const wm = new Mesh(wgeo, this.waterMat);
        wm.matrixAutoUpdate = false;
        wm.renderOrder = 1;
        wm.name = `water_${c.cx}_${c.cz}`;
        this.waterGroup.add(wm);
        c.water = wm;
      }
      c.water.geometry.boundingSphere = new Sphere(
        new Vector3(c.centreX, 0, c.centreZ),
        c.radius * 2.2,
      );
    } else if (c.water) {
      c.water.visible = false;
    }

    c.lod = lod;
    c.dirty = false;
  }

  // ---------------------------------------------------------------- ground

  private buildGround(c: Chunk, lod: number): BufferGeometry {
    const t = this.terrain;
    const d = t.data;
    const N = t.gridSize;
    const ts = t.tileSize;
    const step = 1 << lod;
    const tiles = this.chunkTiles;
    const quads = Math.max(1, tiles / step);

    const baseX = c.cx * tiles;
    const baseZ = c.cz * tiles;

    // 2 triangles per quad + a skirt quad on each of the 4 edges.
    const quadCount = quads * quads + quads * 4;
    const vertCount = quadCount * 6;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);

    let p = 0;
    const tmp = new Color();
    const sampleH = (tx: number, tz: number): number => {
      const x = tx < 0 ? 0 : tx >= N ? N - 1 : tx;
      const z = tz < 0 ? 0 : tz >= N ? N - 1 : tz;
      return d.height[z * N + x];
    };

    const pushTri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      hex: number,
    ): void => {
      positions[p * 3] = ax; positions[p * 3 + 1] = ay; positions[p * 3 + 2] = az;
      positions[p * 3 + 3] = bx; positions[p * 3 + 4] = by; positions[p * 3 + 5] = bz;
      positions[p * 3 + 6] = cx; positions[p * 3 + 7] = cy; positions[p * 3 + 8] = cz;
      tmp.setHex(hex);
      for (let k = 0; k < 3; k++) {
        colors[(p + k) * 3] = tmp.r;
        colors[(p + k) * 3 + 1] = tmp.g;
        colors[(p + k) * 3 + 2] = tmp.b;
      }
      p += 3;
    };

    let minY = Infinity;

    for (let qz = 0; qz < quads; qz++) {
      for (let qx = 0; qx < quads; qx++) {
        const tx = baseX + qx * step;
        const tz = baseZ + qz * step;
        const x0 = tx * ts;
        const z0 = tz * ts;
        const x1 = (tx + step) * ts;
        const z1 = (tz + step) * ts;

        const h00 = sampleH(tx, tz);
        const h10 = sampleH(tx + step, tz);
        const h01 = sampleH(tx, tz + step);
        const h11 = sampleH(tx + step, tz + step);
        if (h00 < minY) minY = h00;

        // Data for colouring is taken from the quad's representative tile.
        const mx = Math.min(N - 1, tx + (step >> 1));
        const mz = Math.min(N - 1, tz + (step >> 1));
        const mi = mz * N + mx;
        const biome = d.biome[mi] as Biome;
        const temp = d.temperature[mi];
        const moist = d.moisture[mi];
        const overlay = t.overlay[mi];
        const traffic = t.traffic[mi];
        const jitter = this.jitterRandom(mi * 7 + c.index);
        const avgH = (h00 + h10 + h01 + h11) * 0.25;

        const span = ts * step;
        // Face slopes for the two triangles of this quad.
        const slopeA = Math.atan(Math.hypot(h11 - h01, h01 - h00) / span);
        const slopeB = Math.atan(Math.hypot(h10 - h00, h11 - h10) / span);

        const cA = groundColor(biome, avgH, temp, moist, slopeA, overlay, traffic, jitter, this.tint);
        const cB = groundColor(
          biome, avgH, temp, moist, slopeB, overlay, traffic,
          this.jitterRandom(mi * 13 + c.index + 1), this.tint,
        );

        pushTri(x0, h00, z0, x0, h01, z1, x1, h11, z1, cA);
        pushTri(x0, h00, z0, x1, h11, z1, x1, h10, z0, cB);
      }
    }

    // Skirts: a vertical apron around the chunk that hides LOD seam cracks.
    const skirtDrop = 6 + (1 << lod) * 2;
    const skirtColor = PALETTE.terrain.rockDark;
    const edge = (
      ax: number, az: number, bx: number, bz: number, ha: number, hb: number,
    ): void => {
      pushTri(ax, ha, az, ax, ha - skirtDrop, az, bx, hb - skirtDrop, bz, skirtColor);
      pushTri(ax, ha, az, bx, hb - skirtDrop, bz, bx, hb, bz, skirtColor);
    };
    for (let q = 0; q < quads; q++) {
      const a = baseX + q * step;
      const b = a + step;
      // north (z = baseZ) and south edges
      edge(b * ts, baseZ * ts, a * ts, baseZ * ts, sampleH(b, baseZ), sampleH(a, baseZ));
      const sz = baseZ + tiles;
      edge(a * ts, sz * ts, b * ts, sz * ts, sampleH(a, sz), sampleH(b, sz));
      // west and east edges
      const az = baseZ + q * step;
      const bz = az + step;
      edge(baseX * ts, az * ts, baseX * ts, bz * ts, sampleH(baseX, az), sampleH(baseX, bz));
      const sx = baseX + tiles;
      edge(sx * ts, bz * ts, sx * ts, az * ts, sampleH(sx, bz), sampleH(sx, az));
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions.subarray(0, p * 3), 3));
    geo.setAttribute('color', new BufferAttribute(colors.subarray(0, p * 3), 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ----------------------------------------------------------------- water

  private buildWater(c: Chunk, lod: number): BufferGeometry | null {
    const t = this.terrain;
    const d = t.data;
    const N = t.gridSize;
    const ts = t.tileSize;
    const step = 1 << Math.min(lod, 2);
    const tiles = this.chunkTiles;
    const quads = Math.max(1, tiles / step);
    const baseX = c.cx * tiles;
    const baseZ = c.cz * tiles;

    const positions: number[] = [];
    const colors: number[] = [];
    const tmp = new Color();

    const waterAt = (tx: number, tz: number): number => {
      const x = tx < 0 ? 0 : tx >= N ? N - 1 : tx;
      const z = tz < 0 ? 0 : tz >= N ? N - 1 : tz;
      return t.waterHeight[z * N + x];
    };
    const groundAt = (tx: number, tz: number): number => {
      const x = tx < 0 ? 0 : tx >= N ? N - 1 : tx;
      const z = tz < 0 ? 0 : tz >= N ? N - 1 : tz;
      return d.height[z * N + x];
    };

    const push = (x: number, y: number, z: number, hex: number): void => {
      positions.push(x, y, z);
      tmp.setHex(hex);
      colors.push(tmp.r, tmp.g, tmp.b);
    };

    for (let qz = 0; qz < quads; qz++) {
      for (let qx = 0; qx < quads; qx++) {
        const tx = baseX + qx * step;
        const tz = baseZ + qz * step;

        // A quad is wet if any corner tile carries water.
        let level = NO_WATER;
        let wet = 0;
        for (let k = 0; k < 4; k++) {
          const sx = tx + (k & 1 ? step : 0);
          const sz = tz + (k & 2 ? step : 0);
          const w = waterAt(sx, sz);
          if (w > NO_WATER) {
            wet++;
            if (w > level) level = w;
          }
        }
        if (wet === 0) continue;

        const mi = Math.min(N - 1, tz + (step >> 1)) * N + Math.min(N - 1, tx + (step >> 1));
        const flowing = d.flow[mi] > 0.42 && level > 0.4;

        const x0 = tx * ts;
        const z0 = tz * ts;
        const x1 = (tx + step) * ts;
        const z1 = (tz + step) * ts;

        const depth = level - (groundAt(tx, tz) + groundAt(tx + step, tz) + groundAt(tx, tz + step) + groundAt(tx + step, tz + step)) * 0.25;
        const hex = waterColor(Math.max(0, depth), flowing);

        push(x0, level, z0, hex);
        push(x0, level, z1, hex);
        push(x1, level, z1, hex);
        push(x0, level, z0, hex);
        push(x1, level, z1, hex);
        push(x1, level, z0, hex);
      }
    }

    if (positions.length === 0) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** Cheap vertex ripple so water is not a dead flat plane. */
  private applyWaterWaves(mat: MeshLambertMaterial): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTimeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float w = sin(position.x * 0.28 + uTime * 1.1) * 0.055
                   + sin(position.z * 0.21 - uTime * 0.83) * 0.045
                   + sin((position.x + position.z) * 0.11 + uTime * 0.5) * 0.03;
           transformed.y += w;`,
        );
    };
  }

  dispose(): void {
    for (const c of this.chunks) {
      if (c.mesh) {
        c.mesh.geometry.dispose();
        this.group.remove(c.mesh);
      }
      if (c.water) {
        c.water.geometry.dispose();
        this.waterGroup.remove(c.water);
      }
    }
    this.chunks.length = 0;
    this.groundMat.dispose();
    this.waterMat.dispose();
  }
}
