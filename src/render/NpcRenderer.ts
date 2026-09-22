/**
 * Draws the settlers.
 *
 * Nearby people get a fully articulated rig so you can see them swing an axe or
 * shoulder a load; distant crowds fall back to a single instanced silhouette
 * per cloak colour. Because cloak colour is profession, a distant crowd still
 * tells you what the settlement is doing.
 */

import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { CharacterRig, AnimState } from './CharacterRig';
import {
  buildCharacterGeometry,
  buildCharacterLodGeometry,
  characterMaterial,
  CharacterLook,
  lookFor,
} from './geometry/character';
import { Npc, NpcActivity } from '../sim/Npc';
import { PROFESSIONS } from '../data/professions';
import { ItemId, ITEMS } from '../data/items';
import { GeoBuilder } from './geometry/GeoBuilder';
import { PALETTE } from './Palette';

const NEAR_RANGE = 62;
const FAR_RANGE = 340;
const MAX_RIGS = 44;

interface RigEntry {
  rig: CharacterRig;
  npcId: number;
}

export class NpcRenderer {
  readonly group = new Object3D();
  private scene: Scene;
  private material = characterMaterial();
  private rigs = new Map<number, RigEntry>();
  private pool: CharacterRig[] = [];
  private geoCache = new Map<string, BufferGeometry>();
  private lookCache = new Map<number, CharacterLook>();

  private farMeshes = new Map<number, InstancedMesh>();
  private carriedMeshes = new Map<ItemId, InstancedMesh>();
  private carryGeo = new Map<ItemId, BufferGeometry>();

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'npcs';
    scene.add(this.group);
  }

  private lookOf(npc: Npc): CharacterLook {
    let look = this.lookCache.get(npc.id);
    if (!look) {
      look = lookFor(PROFESSIONS[npc.profession].cloak, npc.seed);
      this.lookCache.set(npc.id, look);
    } else if (look.cloak !== PROFESSIONS[npc.profession].cloak) {
      // Someone changed trade: give them the new cloak.
      look = lookFor(PROFESSIONS[npc.profession].cloak, npc.seed);
      this.lookCache.set(npc.id, look);
      if (this.rigs.has(npc.id)) this.releaseRig(npc.id);
    }
    return look;
  }

  private geometryFor(look: CharacterLook): BufferGeometry {
    const key = `${look.cloak}|${look.hoodStyle}|${Math.round(look.bodyShade * 10)}|${look.hasPack ? 1 : 0}`;
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = buildCharacterGeometry(look);
      this.geoCache.set(key, geo);
    }
    return geo;
  }

  update(npcs: Npc[], cameraPos: Vector3, dt: number): void {
    // --- Decide who gets a full rig ---------------------------------------
    const near: Npc[] = [];
    const far: Npc[] = [];
    const nearR2 = NEAR_RANGE * NEAR_RANGE;
    const farR2 = FAR_RANGE * FAR_RANGE;

    for (const npc of npcs) {
      const dx = npc.x - cameraPos.x;
      const dz = npc.z - cameraPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > farR2) continue;
      if (d2 < nearR2 && near.length < MAX_RIGS) near.push(npc);
      else far.push(npc);
    }

    // Release rigs for anyone who left the near set.
    const nearIds = new Set(near.map((n) => n.id));
    for (const id of [...this.rigs.keys()]) {
      if (!nearIds.has(id)) this.releaseRig(id);
    }

    // --- Articulated near characters -------------------------------------
    for (const npc of near) {
      let entry = this.rigs.get(npc.id);
      if (!entry) {
        const look = this.lookOf(npc);
        const rig = this.pool.pop() ?? new CharacterRig(look, this.material, this.geometryFor(look));
        // Pooled rigs may carry the wrong geometry; swap it.
        rig.mesh.geometry = this.geometryFor(look);
        rig.root.visible = true;
        this.group.add(rig.root);
        entry = { rig, npcId: npc.id };
        this.rigs.set(npc.id, entry);
      }

      const rig = entry.rig;
      rig.root.position.set(npc.x, npc.y, npc.z);
      rig.root.rotation.y = npc.yaw;
      rig.setState(animStateFor(npc));
      rig.update(dt, npc.speed);

      // Sleeping settlers lie down rather than standing with their eyes shut.
      rig.root.rotation.x = npc.activity === 'sleeping' ? -1.15 : 0;
    }

    // --- Distant crowd ----------------------------------------------------
    const farByCloak = new Map<number, Npc[]>();
    for (const npc of far) {
      const cloak = PROFESSIONS[npc.profession].cloak;
      let list = farByCloak.get(cloak);
      if (!list) {
        list = [];
        farByCloak.set(cloak, list);
      }
      list.push(npc);
    }

    for (const [cloak, mesh] of this.farMeshes) {
      if (!farByCloak.has(cloak)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }

    for (const [cloak, list] of farByCloak) {
      let mesh = this.farMeshes.get(cloak);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          mesh.dispose();
        }
        mesh = new InstancedMesh(
          buildCharacterLodGeometry(cloak),
          this.material,
          Math.max(32, list.length * 2),
        );
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.name = `npc_far_${cloak}`;
        this.group.add(mesh);
        this.farMeshes.set(cloak, mesh);
      }

      for (let i = 0; i < list.length; i++) {
        const npc = list[i];
        this.pos.set(npc.x, npc.y, npc.z);
        this.quat.setFromAxisAngle(this.up, npc.yaw);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
      }
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.updateCarried(near);
  }

  /** Shows what a hauler is actually carrying, held in front of them. */
  private updateCarried(near: Npc[]): void {
    const byItem = new Map<ItemId, Npc[]>();
    for (const npc of near) {
      if (npc.inventory.isEmpty()) continue;
      const item = npc.inventory.summary()[0].item;
      let list = byItem.get(item);
      if (!list) {
        list = [];
        byItem.set(item, list);
      }
      list.push(npc);
    }

    for (const [item, mesh] of this.carriedMeshes) {
      if (!byItem.has(item)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }

    for (const [item, list] of byItem) {
      let mesh = this.carriedMeshes.get(item);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.dispose();
        }
        let geo = this.carryGeo.get(item);
        if (!geo) {
          geo = buildCarriedGeometry(item);
          this.carryGeo.set(item, geo);
        }
        mesh = new InstancedMesh(geo, this.material, Math.max(16, list.length * 2));
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.name = `carried_${item}`;
        this.group.add(mesh);
        this.carriedMeshes.set(item, mesh);
      }

      for (let i = 0; i < list.length; i++) {
        const npc = list[i];
        const fx = Math.sin(npc.yaw);
        const fz = Math.cos(npc.yaw);
        this.pos.set(npc.x + fx * 0.42, npc.y + 0.72, npc.z + fz * 0.42);
        this.quat.setFromAxisAngle(this.up, npc.yaw);
        this.mat4.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.mat4);
      }
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private releaseRig(id: number): void {
    const entry = this.rigs.get(id);
    if (!entry) return;
    this.group.remove(entry.rig.root);
    entry.rig.root.visible = false;
    this.pool.push(entry.rig);
    this.rigs.delete(id);
  }

  get drawCallCount(): number {
    let n = this.rigs.size;
    for (const m of this.farMeshes.values()) if (m.visible && m.count > 0) n++;
    for (const m of this.carriedMeshes.values()) if (m.visible && m.count > 0) n++;
    return n;
  }

  dispose(): void {
    for (const entry of this.rigs.values()) entry.rig.dispose();
    for (const rig of this.pool) rig.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    for (const m of this.farMeshes.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.carriedMeshes.values()) m.dispose();
    for (const g of this.carryGeo.values()) g.dispose();
    this.rigs.clear();
    this.pool.length = 0;
    this.geoCache.clear();
    this.farMeshes.clear();
    this.carriedMeshes.clear();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

function animStateFor(npc: Npc): AnimState {
  const a: NpcActivity = npc.activity;
  switch (a) {
    case 'chopping':
      return 'chop';
    case 'mining':
      return 'mine';
    case 'building':
    case 'demolishing':
      return 'build';
    case 'farming':
    case 'planting':
    case 'foraging':
      return 'farm';
    case 'crafting':
    case 'researching':
    case 'fishing':
      return 'craft';
    case 'hunting':
      return npc.speed > 0.4 ? 'run' : 'idle';
    case 'sleeping':
      return 'sleep';
    case 'eating':
      return 'sit';
    case 'socialising':
      return 'idle';
    case 'hauling':
      return npc.speed > 0.3 ? 'carry' : 'idle';
    case 'walking':
      return npc.speed > 3.2 ? 'run' : npc.speed > 0.25 ? (npc.isCarrying() ? 'carry' : 'walk') : 'idle';
    default:
      return npc.speed > 0.25 ? 'walk' : 'idle';
  }
}

/** A small representation of whatever a person is carrying. */
function buildCarriedGeometry(item: ItemId): BufferGeometry {
  const b = new GeoBuilder();
  const tint = ITEMS[item].color;
  switch (item) {
    case 'log':
      b.cylinder(0.11, 0.11, 1.1, 6, tint, { rz: Math.PI / 2 });
      break;
    case 'plank':
    case 'beam':
      b.box(0.9, 0.08, 0.26, tint, {});
      b.box(0.9, 0.08, 0.26, tint, { y: 0.1 });
      break;
    case 'stone':
    case 'stone_block':
    case 'iron_ore':
    case 'copper_ore':
    case 'coal':
      b.dodec(0.2, tint, { sy: 0.8 });
      b.dodec(0.15, tint, { x: 0.18, y: 0.1, sy: 0.8 });
      break;
    case 'grain':
    case 'flour':
    case 'fiber':
    case 'reed':
    case 'thatch':
      b.sphere(0.24, 6, 5, PALETTE.build.canvas, { sy: 1.2 });
      break;
    default:
      b.box(0.34, 0.3, 0.3, PALETTE.build.wood, {});
      b.box(0.36, 0.05, 0.14, tint, { y: 0.12 });
  }
  return b.build();
}
