/**
 * The other peoples' towns.
 *
 * A nation used to be a coloured patch on the world map and nothing at all on
 * the ground: you could walk across a kingdom of four thousand people and see
 * an empty valley. Each of its settlements is now a real cluster of buildings
 * standing where the simulation says it stands, as big as the number of
 * people in it.
 *
 * The layout is generated from the town's own id, so it is the same every
 * time the world is loaded and the same in a screenshot taken a century
 * apart. Buildings sit on the ground individually rather than on a flat pad,
 * which is what makes a hillside town look built on a hillside.
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
import { GeoBuilder } from './geometry/GeoBuilder';
import { PALETTE, shade } from './Palette';
import { Rng } from '../core/rng';
import { tierOf, Town } from '../sim/Nations';
import type { Terrain } from '../world/Terrain';

type Archetype = 'hut' | 'house' | 'hall' | 'tower' | 'wall';

/** Buildings at a glance, one instanced mesh each. */
const ARCHETYPES: Archetype[] = ['hut', 'house', 'hall', 'tower', 'wall'];

export class TownRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private meshes = new Map<Archetype, InstancedMesh>();
  private geometries = new Map<Archetype, BufferGeometry>();

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private tint = new Color(1, 1, 1);

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'towns';
    scene.add(this.group);
    for (const kind of ARCHETYPES) {
      const geometry = buildTownGeometry(kind);
      this.geometries.set(kind, geometry);
      const mesh = new InstancedMesh(geometry, this.material, 64);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `town_${kind}`;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
  }

  /**
   * Lays out every town in the world.
   *
   * Called when the world loads and whenever the map of towns changes, which
   * is rare -- a town is founded or emptied over years, not over frames.
   */
  build(towns: Town[], terrain: Terrain): void {
    const placements = new Map<
      Archetype,
      { x: number; z: number; rot: number; s: number; tint: number }[]
    >();
    for (const kind of ARCHETYPES) placements.set(kind, []);

    for (const town of towns) {
      const tier = tierOf(town);
      const rng = new Rng(`town:${town.id}`);
      // How many buildings a place of that size shows. Ancient towns were
      // small; a "city" here is a few thousand people, not a million.
      const count =
        tier === 'city'
          ? 26 + Math.min(34, Math.round(town.population / 60))
          : tier === 'town'
            ? 12 + Math.round(town.population / 34)
            : 4 + Math.round(town.population / 26);
      const spread = tier === 'city' ? 26 : tier === 'town' ? 17 : 10;

      for (let i = 0; i < count; i++) {
        // Packed near the middle and thinning out, which is how a town that
        // grew rather than one that was planned actually looks.
        const a = rng.range(0, Math.PI * 2);
        const r = Math.pow(rng.next(), 0.65) * spread;
        const x = town.x + Math.cos(a) * r;
        const z = town.z + Math.sin(a) * r;
        if (terrain.waterDepthAt(x, z) > 0.2) continue;

        const central = r < spread * 0.3;
        let kind: Archetype = 'hut';
        if (tier !== 'village' && central && i === 0) kind = 'hall';
        else if (tier === 'city' && central && rng.chance(0.18)) kind = 'tower';
        else if (tier !== 'village' && rng.chance(0.45)) kind = 'house';
        placements.get(kind)!.push({
          x,
          z,
          rot: rng.range(0, Math.PI * 2),
          s: rng.range(0.85, 1.2),
          tint: rng.range(0.86, 1.14),
        });
      }

      // A city has a wall, because a city is worth walling.
      if (tier === 'city') {
        const segments = 22;
        for (let i = 0; i < segments; i++) {
          const a = (i / segments) * Math.PI * 2;
          const r = spread * 1.12;
          const x = town.x + Math.cos(a) * r;
          const z = town.z + Math.sin(a) * r;
          if (terrain.waterDepthAt(x, z) > 0.2) continue;
          placements.get('wall')!.push({ x, z, rot: -a, s: 1, tint: 1 });
        }
      }
    }

    for (const kind of ARCHETYPES) {
      const list = placements.get(kind)!;
      let mesh = this.meshes.get(kind)!;
      if (list.length > mesh.count || list.length > mesh.instanceMatrix.count) {
        // Grow the buffer rather than clipping the town.
        this.group.remove(mesh);
        mesh.dispose();
        mesh = new InstancedMesh(
          this.geometries.get(kind)!,
          this.material,
          Math.max(64, list.length),
        );
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = `town_${kind}`;
        this.meshes.set(kind, mesh);
        this.group.add(mesh);
      }

      list.forEach((p, i) => {
        this.pos.set(p.x, terrain.heightAt(p.x, p.z) - 0.1, p.z);
        this.quat.setFromAxisAngle(this.up, p.rot);
        this.scale.set(p.s, p.s, p.s);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
        // A street of identical houses is a street nobody built. One shade
        // either way is enough to break it up.
        this.tint.setRGB(p.tint, p.tint, p.tint);
        mesh.setColorAt(i, this.tint);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get buildingCount(): number {
    let n = 0;
    for (const m of this.meshes.values()) n += m.count;
    return n;
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      this.group.remove(m);
      m.dispose();
    }
    for (const g of this.geometries.values()) g.dispose();
    this.meshes.clear();
    this.geometries.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}

/** One building, in the vernacular of a world that has not invented much yet. */
function buildTownGeometry(kind: Archetype): BufferGeometry {
  const b = new GeoBuilder();
  const rng = new Rng(`townbuild:${kind}`);
  const wall = PALETTE.build.plasterWarm;
  const timber = PALETTE.build.woodDark;
  const thatch = PALETTE.build.roofThatch;
  const stone = PALETTE.build.stone;

  switch (kind) {
    case 'hut': {
      const w = 2.6;
      const h = 1.9;
      b.boxOnGround(w, h, w * 0.9, shade(wall, rng.range(0.94, 1.06)));
      b.hipRoof(w * 1.15, w, 1.8, 0.25, thatch, { y: h });
      break;
    }
    case 'house': {
      const w = 3.6;
      const d = 2.8;
      const h = 2.8;
      b.boxOnGround(w, h, d, shade(wall, rng.range(0.94, 1.06)));
      // Exposed framing, which is most of what makes it read as a building
      // rather than as a box.
      b.box(w * 1.02, 0.16, 0.16, timber, { y: h * 0.55, z: -d / 2 });
      b.box(0.16, h, 0.16, timber, { x: -w / 2 + 0.1, z: -d / 2 });
      b.box(0.16, h, 0.16, timber, { x: w / 2 - 0.1, z: -d / 2 });
      b.gableRoof(w * 1.12, d * 1.15, 1.5, 0.25, thatch, shade(thatch, 0.88), { y: h });
      break;
    }
    case 'hall': {
      const w = 7;
      const d = 4.2;
      const h = 3.6;
      b.boxOnGround(w, h, d, shade(stone, 1.02));
      b.gableRoof(w * 1.08, d * 1.18, 2.1, 0.35, PALETTE.build.roofTile, PALETTE.build.roofTileAlt, { y: h });
      b.box(1.1, 2.1, 0.2, timber, { y: 1.05, z: d / 2 + 0.05 });
      break;
    }
    case 'tower': {
      const r = 1.5;
      const h = 8;
      b.cylinder(r, r * 1.2, h, 8, stone, { y: h / 2 });
      b.cylinder(r * 1.3, r * 1.3, 0.5, 8, PALETTE.build.stoneDark, { y: h });
      b.cone(r * 1.25, 2.2, 8, PALETTE.build.roofSlate, { y: h + 1.35 });
      break;
    }
    case 'wall': {
      b.boxOnGround(4.4, 3.2, 0.9, shade(stone, 0.96));
      b.box(4.6, 0.35, 1.1, PALETTE.build.stoneDark, { y: 3.3 });
      break;
    }
  }
  return b.build();
}
