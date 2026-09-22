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
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { Terrain } from '../world/Terrain';
import { Biome } from '../world/types';
import { NO_WATER } from '../world/TerrainGen';
import { groundColor, TerrainTint } from './TerrainColors';
import { makeWaterMaterial, WaterUniforms } from './Water';
import { PALETTE } from './Palette';
import { mulberry32 } from '../core/rng';
import { clamp01 } from '../core/math';

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
  private waterMat: ShaderMaterial;
  private waterUniforms: WaterUniforms;
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

    const water = makeWaterMaterial();
    this.waterMat = water.material;
    this.waterUniforms = water.uniforms;

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

  /** Every chunk is rebuilt next time it is in range. */
  markAllDirty(): void {
    for (const c of this.chunks) c.dirty = true;
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
    this.waterUniforms.uTime.value += dt;

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

  /**
   * A smooth patchiness field over the ground, 0..1.
   *
   * Real ground is blotchy at a scale of tens of metres -- damper hollows,
   * thinner soil over a rise, a stretch that got grazed -- and it is that
   * scale, not per-triangle noise, that makes a hillside look like a
   * hillside. Value noise on a lattice a few tiles wide, smoothed, costs
   * almost nothing and is stable: the same tile gets the same value every
   * time its chunk is rebuilt.
   */
  private groundVariation(tx: number, tz: number): number {
    const at = (gx: number, gz: number): number =>
      this.jitterRandom(((gx * 73856093) ^ (gz * 19349663)) >>> 0);
    let sum = 0;
    let amp = 0;
    for (const [cell, weight] of [
      [9, 0.55],
      [3, 0.3],
      [1, 0.15],
    ] as [number, number][]) {
      const fx = tx / cell;
      const fz = tz / cell;
      const gx = Math.floor(fx);
      const gz = Math.floor(fz);
      const sx = fx - gx;
      const sz = fz - gz;
      const ux = sx * sx * (3 - 2 * sx);
      const uz = sz * sz * (3 - 2 * sz);
      const a = at(gx, gz);
      const b = at(gx + 1, gz);
      const cc = at(gx, gz + 1);
      const dd = at(gx + 1, gz + 1);
      sum += (a + (b - a) * ux + (cc - a + (dd - cc - b + a) * ux) * uz) * weight;
      amp += weight;
    }
    return sum / amp;
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
        // One value for the whole quad, drawn from a field that varies
        // smoothly across the map. Two independent random values per quad --
        // one for each triangle -- was what turned every hillside into a
        // chequerboard: the eye reads the pair of triangles, not the tile.
        const jitter = this.groundVariation(mx, mz);
        const avgH = (h00 + h10 + h01 + h11) * 0.25;

        const span = ts * step;
        // Face slopes for the two triangles of this quad.
        const slopeA = Math.atan(Math.hypot(h11 - h01, h01 - h00) / span);
        const slopeB = Math.atan(Math.hypot(h10 - h00, h11 - h10) / span);

        // The two triangles of a quad differ only where they really do
        // differ, which is how steep each of them is.
        const cA = groundColor(biome, avgH, temp, moist, slopeA, overlay, traffic, jitter, this.tint);
        const cB =
          Math.abs(slopeA - slopeB) < 0.02
            ? cA
            : groundColor(biome, avgH, temp, moist, slopeB, overlay, traffic, jitter, this.tint);

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

  /**
   * Builds one continuous sheet for the chunk.
   *
   * Vertices are shared across the whole grid, so the ripple in the shader is
   * a wave crossing a surface rather than a set of squares each jittering on
   * their own. A vertex takes its level from the wet tiles that touch it,
   * which is what stops two neighbouring pools at different heights from
   * terracing against each other.
   */
  private buildWater(c: Chunk, lod: number): BufferGeometry | null {
    const t = this.terrain;
    const d = t.data;
    const N = t.gridSize;
    const ts = t.tileSize;
    const step = 1 << Math.min(lod, 2);
    const tiles = this.chunkTiles;
    const quads = Math.max(1, tiles / step);
    const side = quads + 1;
    const baseX = c.cx * tiles;
    const baseZ = c.cz * tiles;

    const clampTile = (v: number): number => (v < 0 ? 0 : v >= N ? N - 1 : v);
    const waterAt = (tx: number, tz: number): number =>
      t.waterHeight[clampTile(tz) * N + clampTile(tx)];
    const groundAt = (tx: number, tz: number): number =>
      d.height[clampTile(tz) * N + clampTile(tx)];
    const flowAt = (tx: number, tz: number): number =>
      d.flow[clampTile(tz) * N + clampTile(tx)];

    const positions = new Float32Array(side * side * 3);
    const depths = new Float32Array(side * side);
    const flows = new Float32Array(side * side);
    const levels = new Float32Array(side * side);
    const grounds = new Float32Array(side * side);
    const wetVertex = new Uint8Array(side * side);

    for (let vz = 0; vz < side; vz++) {
      for (let vx = 0; vx < side; vx++) {
        const tx = baseX + vx * step;
        const tz = baseZ + vz * step;
        const vi = vz * side + vx;

        // The level here is the mean of the wet tiles that meet at this point.
        // Averaging rather than taking the highest keeps a pond from climbing
        // the bank it sits against.
        let sum = 0;
        let wet = 0;
        for (let oz = -1; oz <= 0; oz++) {
          for (let ox = -1; ox <= 0; ox++) {
            const w = waterAt(tx + ox * step, tz + oz * step);
            if (w > NO_WATER) {
              sum += w;
              wet++;
            }
          }
        }
        grounds[vi] = groundAt(tx, tz);
        wetVertex[vi] = wet > 0 ? 1 : 0;
        levels[vi] = wet > 0 ? sum / wet : Number.NaN;
        flows[vi] = clamp01((flowAt(tx, tz) - 0.35) * 2.2);
      }
    }

    // A dry point on the edge of a sheet takes its height from the water
    // beside it, not from the ground beneath it. Giving it the ground height
    // is what hung those curtains down the mountainsides: a quad with one
    // corner in a river and three on the slope below became a wall of water
    // from the river down to the valley floor. A surface of water is level,
    // and the shader throws away the part of it that is over dry land.
    for (let vz = 0; vz < side; vz++) {
      for (let vx = 0; vx < side; vx++) {
        const vi = vz * side + vx;
        if (wetVertex[vi]) continue;
        let sum = 0;
        let found = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = vx + ox;
            const nz = vz + oz;
            if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue;
            const ni = nz * side + nx;
            if (!wetVertex[ni]) continue;
            sum += levels[ni];
            found++;
          }
        }
        levels[vi] = found > 0 ? sum / found : grounds[vi];
      }
    }

    for (let vi = 0; vi < side * side; vi++) {
      const vx = vi % side;
      const vz = Math.floor(vi / side);
      positions[vi * 3] = (baseX + vx * step) * ts;
      positions[vi * 3 + 1] = levels[vi];
      positions[vi * 3 + 2] = (baseZ + vz * step) * ts;
      depths[vi] = Math.max(0, levels[vi] - grounds[vi]);
    }

    // A quad is kept only if some corner of it holds real water. A corner
    // that is merely marked wet with no depth under it sits exactly on the
    // ground, and a sheet lying on the ground fights the ground for every
    // pixel -- which is the flicker along every shoreline. The shader
    // discards what is left of the edge, so the sheet ends at the water line
    // rather than carrying on over the bank.
    const indices: number[] = [];
    for (let qz = 0; qz < quads; qz++) {
      for (let qx = 0; qx < quads; qx++) {
        const a = qz * side + qx;
        const b = a + 1;
        const cIdx = a + side;
        const dIdx = cIdx + 1;
        const deepest = Math.max(depths[a], depths[b], depths[cIdx], depths[dIdx]);
        if (deepest < 0.06) continue;
        // Two bodies of water at very different heights are two bodies of
        // water. Bridging them with one quad draws a wall between a tarn and
        // the sea below it.
        const hi = Math.max(levels[a], levels[b], levels[cIdx], levels[dIdx]);
        const lo = Math.min(levels[a], levels[b], levels[cIdx], levels[dIdx]);
        if (hi - lo > 2.5) continue;
        indices.push(a, cIdx, dIdx, a, dIdx, b);
      }
    }
    if (indices.length === 0) return null;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aDepth', new BufferAttribute(depths, 1));
    geo.setAttribute('aFlow', new BufferAttribute(flows, 1));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * The water is lit by the same sun everything else is, so it has to be told
   * where the sun is and what colour the sky has gone.
   */
  setSunlight(direction: Vector3, sunColour: Color, skyColour: Color, night: number): void {
    this.waterUniforms.uSunDir.value.copy(direction);
    this.waterUniforms.uSunColor.value.copy(sunColour);
    this.waterUniforms.uSkyColor.value.copy(skyColour);
    this.waterUniforms.uNight.value = night;
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
