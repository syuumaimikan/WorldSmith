/**
 * Blueprint placement.
 *
 * Placing a building never builds it. It creates a construction site: stakes go
 * into the ground, the job board raises material requests, and from that moment
 * the settlement has to physically supply and staff it.
 */

import { Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { World } from '../sim/World';
import { BuildingId, buildingDef } from '../data/buildings';
import { buildBuildingGeometry } from './../render/geometry/buildings';
import { buildPlacementMarker } from '../render/geometry/props';
import { PALETTE } from '../render/Palette';
import { Season } from '../render/TerrainColors';

export interface PlacementState {
  buildingId: BuildingId | null;
  rotation: number;
  valid: boolean;
  reason: string;
  tileX: number;
  tileZ: number;
  /** Set while dragging a linear structure such as a road. */
  dragging: boolean;
  dragTiles: number;
  cost: { item: string; need: number; have: number }[];
}

export class BuildController {
  readonly group = new Object3D();
  private scene: Scene;
  private world: World;
  private season: Season;

  private ghost: Mesh;
  private marker: Mesh;
  private ghostMaterial: MeshBasicMaterial;
  private markerMaterial: MeshBasicMaterial;
  private currentGhostKey = '';

  selected: BuildingId | null = null;
  rotation = 0;
  private dragStart: { tx: number; tz: number } | null = null;
  private lastValid = false;
  private lastReason = '';
  private hoverTile = { tx: -1, tz: -1 };
  private hoverPoint = new Vector3();

  constructor(scene: Scene, world: World, season: Season) {
    this.scene = scene;
    this.world = world;
    this.season = season;
    this.group.name = 'placement';
    this.group.visible = false;
    scene.add(this.group);

    this.ghostMaterial = new MeshBasicMaterial({
      color: PALETTE.ui.valid,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.markerMaterial = new MeshBasicMaterial({
      color: PALETTE.ui.valid,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    this.ghost = new Mesh(buildPlacementMarker(1, 1), this.ghostMaterial);
    this.ghost.frustumCulled = false;
    this.group.add(this.ghost);

    this.marker = new Mesh(buildPlacementMarker(1, 1), this.markerMaterial);
    this.marker.frustumCulled = false;
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  setSeason(season: Season): void {
    this.season = season;
    this.currentGhostKey = '';
  }

  select(id: BuildingId | null): void {
    this.selected = id;
    this.rotation = 0;
    this.dragStart = null;
    this.group.visible = id !== null;
    this.currentGhostKey = '';
  }

  rotate(): void {
    if (!this.selected) return;
    const def = buildingDef(this.selected);
    if (def.width === def.depth && !def.linear) {
      // Square buildings still rotate so the door faces where you want.
      this.rotation = (this.rotation + 1) & 3;
    } else {
      this.rotation = (this.rotation + 1) & 3;
    }
    this.currentGhostKey = '';
  }

  get isPlacing(): boolean {
    return this.selected !== null;
  }

  /** Updates the preview from the mouse ray. Returns the current state. */
  update(camera: PerspectiveCamera, ndcX: number, ndcY: number): PlacementState {
    const state: PlacementState = {
      buildingId: this.selected,
      rotation: this.rotation,
      valid: false,
      reason: '',
      tileX: -1,
      tileZ: -1,
      dragging: this.dragStart !== null,
      dragTiles: 0,
      cost: [],
    };
    if (!this.selected) {
      this.group.visible = false;
      return state;
    }

    const origin = new Vector3();
    const dir = new Vector3(ndcX, ndcY, 0.5);
    camera.getWorldPosition(origin);
    dir.unproject(camera).sub(origin).normalize();

    const hit = this.world.terrain.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 700);
    if (!hit) {
      this.group.visible = false;
      return state;
    }
    this.hoverPoint.set(hit.x, hit.y, hit.z);

    const def = buildingDef(this.selected);
    const t = this.world.terrain;
    const w = this.rotation % 2 === 0 ? def.width : def.depth;
    const d = this.rotation % 2 === 0 ? def.depth : def.width;
    // Centre the footprint on the cursor.
    const tx = t.tileX(hit.x) - Math.floor(w / 2);
    const tz = t.tileZ(hit.z) - Math.floor(d / 2);

    this.hoverTile.tx = tx;
    this.hoverTile.tz = tz;

    const check = this.world.canPlace(this.selected, tx, tz, this.rotation);
    this.lastValid = check.ok;
    this.lastReason = check.reason;

    state.tileX = tx;
    state.tileZ = tz;
    state.valid = check.ok;
    state.reason = check.reason;
    state.cost = this.costSummary();

    if (this.dragStart) {
      state.dragTiles = this.dragLine().length;
    }

    // Build or reuse the ghost geometry.
    const key = `${this.selected}|${this.rotation}`;
    if (key !== this.currentGhostKey) {
      this.currentGhostKey = key;
      this.ghost.geometry.dispose();
      this.ghost.geometry = buildBuildingGeometry({
        def,
        progress: { completed: [], current: def.stages[0]?.id ?? null, currentProgress: 1, complete: true },
        tilesW: w,
        tilesD: d,
        tileSize: t.tileSize,
        seed: 1,
        season: this.season,
        lit: false,
        condition: 1,
      });
      this.marker.geometry.dispose();
      this.marker.geometry = buildPlacementMarker(w * t.tileSize, d * t.tileSize);
    }

    const cx = (tx + w / 2) * t.tileSize;
    const cz = (tz + d / 2) * t.tileSize;
    const cy = check.ok ? check.groundY : t.heightAt(cx, cz);

    this.group.visible = true;
    this.ghost.position.set(cx, cy, cz);
    this.marker.position.set(cx, cy, cz);
    this.marker.visible = true;

    const colour = check.ok ? PALETTE.ui.valid : PALETTE.ui.invalid;
    this.ghostMaterial.color.setHex(colour);
    this.markerMaterial.color.setHex(colour);

    return state;
  }

  /** Materials the selected building will need, against what is in store. */
  costSummary(): { item: string; need: number; have: number }[] {
    if (!this.selected) return [];
    const def = buildingDef(this.selected);
    const out: { item: string; need: number; have: number }[] = [];
    for (const [item, need] of Object.entries(def.totalMaterials)) {
      let have = 0;
      for (const b of this.world.buildings) {
        if (b.complete) have += b.inventory.count(item as never);
      }
      have += this.world.player.inventory.count(item as never);
      out.push({ item, need: need as number, have });
    }
    return out;
  }

  beginDrag(): void {
    if (!this.selected) return;
    const def = buildingDef(this.selected);
    if (!def.linear) return;
    this.dragStart = { tx: this.hoverTile.tx, tz: this.hoverTile.tz };
  }

  /** Tiles covered by the current drag, as a straight line. */
  private dragLine(): { tx: number; tz: number }[] {
    if (!this.dragStart) return [];
    const out: { tx: number; tz: number }[] = [];
    const a = this.dragStart;
    const b = this.hoverTile;
    const dx = b.tx - a.tx;
    const dz = b.tz - a.tz;
    // Lock to the dominant axis so drag-placed roads stay straight.
    if (Math.abs(dx) >= Math.abs(dz)) {
      const step = dx >= 0 ? 1 : -1;
      for (let i = 0; i <= Math.abs(dx); i++) out.push({ tx: a.tx + i * step, tz: a.tz });
    } else {
      const step = dz >= 0 ? 1 : -1;
      for (let i = 0; i <= Math.abs(dz); i++) out.push({ tx: a.tx, tz: a.tz + i * step });
    }
    return out;
  }

  /**
   * Commits the placement. For linear structures this places every tile in the
   * drag; for everything else, one building.
   *
   * @returns how many blueprints were created.
   */
  commit(): number {
    if (!this.selected) return 0;
    const def = buildingDef(this.selected);

    if (def.linear) {
      const line = this.dragStart ? this.dragLine() : [{ tx: this.hoverTile.tx, tz: this.hoverTile.tz }];
      let placed = 0;
      for (const tile of line) {
        if (this.world.placeBuilding(this.selected, tile.tx, tile.tz, this.rotation)) placed++;
      }
      this.dragStart = null;
      return placed;
    }

    if (!this.lastValid) return 0;
    const b = this.world.placeBuilding(this.selected, this.hoverTile.tx, this.hoverTile.tz, this.rotation);
    return b ? 1 : 0;
  }

  cancelDrag(): void {
    this.dragStart = null;
  }

  get validNow(): boolean {
    return this.lastValid;
  }

  get reasonNow(): string {
    return this.lastReason;
  }

  get cursorWorld(): Vector3 {
    return this.hoverPoint;
  }

  dispose(): void {
    this.ghost.geometry.dispose();
    this.marker.geometry.dispose();
    this.ghostMaterial.dispose();
    this.markerMaterial.dispose();
    this.scene.remove(this.group);
  }
}
