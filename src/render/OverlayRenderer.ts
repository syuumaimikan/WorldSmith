/**
 * Information overlays drawn into the 3D world.
 *
 * These exist because a simulation you cannot see is indistinguishable from a
 * fake one. The logistics overlay draws a line from every haul job's source to
 * its destination, so you can watch goods actually being routed; the
 * construction overlay puts progress and material readiness above each site.
 *
 * All of them are off by default — the world should be the thing you look at.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { World } from '../sim/World';
import { HaulJob } from '../sim/Jobs';
import { GeoBuilder } from './geometry/GeoBuilder';
import { PALETTE } from './Palette';
import { clamp01 } from '../core/math';

export type Overlay = 'none' | 'logistics' | 'jobs' | 'construction';

export const OVERLAY_LABELS: Record<Overlay, string> = {
  none: 'No overlay',
  logistics: 'Logistics',
  jobs: 'Jobs',
  construction: 'Construction',
};

const OVERLAY_ORDER: Overlay[] = ['none', 'logistics', 'jobs', 'construction'];
const MAX_LINES = 400;
const MAX_MARKERS = 320;

export class OverlayRenderer {
  readonly group = new Object3D();
  current: Overlay = 'none';

  private scene: Scene;
  private world: World;
  private lines: LineSegments;
  private linePositions: Float32Array;
  private lineColors: Float32Array;

  private bars: InstancedMesh;
  private barBack: InstancedMesh;
  private markers: InstancedMesh;
  private selectionRing: InstancedMesh;

  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private colour = new Color();
  private pulse = 0;

  constructor(scene: Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.group.name = 'overlays';
    scene.add(this.group);

    this.linePositions = new Float32Array(MAX_LINES * 6);
    this.lineColors = new Float32Array(MAX_LINES * 6);
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(this.linePositions, 3));
    lineGeo.setAttribute('color', new BufferAttribute(this.lineColors, 3));
    lineGeo.setDrawRange(0, 0);
    this.lines = new LineSegments(
      lineGeo,
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 900;
    this.lines.visible = false;
    this.group.add(this.lines);

    const quad = new GeoBuilder();
    quad.box(1, 1, 0.02, 0xffffff, {});
    const quadGeo = quad.build();

    const barMat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      side: DoubleSide,
    });
    this.bars = new InstancedMesh(quadGeo, barMat, MAX_MARKERS);
    this.bars.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 902;
    this.bars.count = 0;
    this.group.add(this.bars);

    this.barBack = new InstancedMesh(
      quadGeo,
      new MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.7, depthTest: false, side: DoubleSide }),
      MAX_MARKERS,
    );
    this.barBack.instanceMatrix.setUsage(DynamicDrawUsage);
    this.barBack.frustumCulled = false;
    this.barBack.renderOrder = 901;
    this.barBack.count = 0;
    this.group.add(this.barBack);

    const markerGeo = new GeoBuilder();
    markerGeo.cone(0.26, 0.5, 5, 0xffffff, { rx: Math.PI });
    this.markers = new InstancedMesh(
      markerGeo.build(),
      new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }),
      MAX_MARKERS,
    );
    this.markers.instanceMatrix.setUsage(DynamicDrawUsage);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 903;
    this.markers.count = 0;
    this.group.add(this.markers);

    const ring = new GeoBuilder();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.box(0.16, 0.04, 0.06, 0xffffff, { x: Math.cos(a), z: Math.sin(a), ry: -a });
    }
    this.selectionRing = new InstancedMesh(
      ring.build(),
      new MeshBasicMaterial({ color: PALETTE.ui.valid, transparent: true, opacity: 0.85, depthTest: false }),
      8,
    );
    this.selectionRing.frustumCulled = false;
    this.selectionRing.renderOrder = 904;
    this.selectionRing.count = 0;
    this.group.add(this.selectionRing);
  }

  set(overlay: Overlay): void {
    this.current = overlay;
  }

  cycle(): void {
    const i = OVERLAY_ORDER.indexOf(this.current);
    this.current = OVERLAY_ORDER[(i + 1) % OVERLAY_ORDER.length];
  }

  update(cameraPos: Vector3, dt: number): void {
    this.pulse += dt;
    let lineCount = 0;
    let barCount = 0;
    let markerCount = 0;

    const world = this.world;
    const ts = world.terrain.tileSize;

    // ------------------------------------------------------------ logistics
    if (this.current === 'logistics') {
      for (const job of world.jobs.all) {
        if (job.kind !== 'haul') continue;
        if (lineCount >= MAX_LINES) break;
        const h = job as HaulJob;
        const dest = world.buildingById.get(h.destId);
        if (!dest) continue;

        let sx = h.x;
        let sz = h.z;
        if (h.sourceType === 'pile') {
          const p = world.pileById.get(h.sourceId);
          if (!p) continue;
          sx = p.x;
          sz = p.z;
        } else {
          const src = world.buildingById.get(h.sourceId);
          if (!src) continue;
          const ap = src.accessPoint(ts);
          sx = ap.x;
          sz = ap.z;
        }
        const dp = dest.accessPoint(ts);
        if (Math.hypot(sx - cameraPos.x, sz - cameraPos.z) > 420) continue;

        const carried = h.assignedTo !== 0;
        this.colour.setHex(carried ? PALETTE.ui.good : PALETTE.ui.warn);
        this.pushLine(
          lineCount++,
          sx, world.terrain.heightAt(sx, sz) + 1.1, sz,
          dp.x, world.terrain.heightAt(dp.x, dp.z) + 1.1, dp.z,
          this.colour,
        );
      }
    }

    // ----------------------------------------------------------------- jobs
    if (this.current === 'jobs') {
      for (const npc of world.npcs) {
        if (markerCount >= MAX_MARKERS) break;
        if (Math.hypot(npc.x - cameraPos.x, npc.z - cameraPos.z) > 180) continue;
        this.colour.setHex(activityColour(npc.activity));
        this.pos.set(npc.x, npc.y + 2.35 + Math.sin(this.pulse * 2 + npc.id) * 0.06, npc.z);
        this.quat.setFromAxisAngle(this.up, 0);
        this.scale.set(1, 1, 1);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.markers.setMatrixAt(markerCount, this.mat4);
        this.markers.setColorAt(markerCount, this.colour);
        markerCount++;

        // A line to where they are headed makes their plan legible.
        if (npc.task.type !== 'none' && lineCount < MAX_LINES) {
          this.colour.setHex(activityColour(npc.activity));
          this.pushLine(
            lineCount++,
            npc.x, npc.y + 1.2, npc.z,
            npc.task.x, world.terrain.heightAt(npc.task.x, npc.task.z) + 0.4, npc.task.z,
            this.colour,
          );
        }
      }
    }

    // --------------------------------------------------------- construction
    const showConstruction = this.current === 'construction';
    for (const b of world.buildings) {
      if (b.complete && !showConstruction) continue;
      if (barCount >= MAX_MARKERS) break;
      if (Math.hypot(b.worldX - cameraPos.x, b.worldZ - cameraPos.z) > 220) continue;
      if (b.complete) continue;

      const y = b.groundY + b.def.height + 1.2;
      const width = Math.max(1.6, b.footprintWidth * ts * 0.55);

      // Background track.
      this.colour.setRGB(0.08, 0.09, 0.11);
      this.pos.set(b.worldX, y, b.worldZ);
      this.quat.setFromAxisAngle(this.up, 0);
      this.scale.set(width, 0.24, 1);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.barBack.setMatrixAt(barCount, this.mat4);

      // Filled portion. Colour says whether it is working or waiting.
      const waiting = !b.readyForWork();
      const fill = waiting ? b.materialReadiness() : b.progress;
      this.colour.setHex(waiting ? PALETTE.ui.warn : PALETTE.ui.good);
      const w = Math.max(0.02, width * clamp01(fill));
      this.pos.set(b.worldX - width / 2 + w / 2, y, b.worldZ + 0.01);
      this.scale.set(w, 0.18, 1);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.bars.setMatrixAt(barCount, this.mat4);
      this.bars.setColorAt(barCount, this.colour);
      barCount++;
    }

    // ------------------------------------------------------------ selection
    let ringCount = 0;
    const sel = world.selection;
    if (sel) {
      let x: number | null = null;
      let z = 0;
      let r = 1;
      if (sel.kind === 'npc') {
        const n = world.npcById.get(sel.id);
        if (n) {
          x = n.x;
          z = n.z;
          r = 0.75;
        }
      } else if (sel.kind === 'building') {
        const b = world.buildingById.get(sel.id);
        if (b) {
          x = b.worldX;
          z = b.worldZ;
          r = Math.max(b.footprintWidth, b.footprintDepth) * ts * 0.62;
        }
      } else if (sel.kind === 'node') {
        const n = world.nodeById.get(sel.id);
        if (n) {
          x = n.x;
          z = n.z;
          r = 1.1;
        }
      }
      if (x !== null) {
        this.pos.set(x, world.terrain.heightAt(x, z) + 0.12, z);
        this.quat.setFromAxisAngle(this.up, this.pulse * 0.6);
        this.scale.set(r, 1, r);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.selectionRing.setMatrixAt(ringCount++, this.mat4);
      }

      // Show a selected worker's destination even without the jobs overlay.
      if (sel.kind === 'npc' && lineCount < MAX_LINES) {
        const n = world.npcById.get(sel.id);
        if (n && n.task.type !== 'none') {
          this.colour.setHex(PALETTE.ui.valid);
          this.pushLine(
            lineCount++,
            n.x, n.y + 1.2, n.z,
            n.task.x, world.terrain.heightAt(n.task.x, n.task.z) + 0.4, n.task.z,
            this.colour,
          );
        }
      }
    }

    // ------------------------------------------------------------- finalise
    this.lines.geometry.setDrawRange(0, lineCount * 2);
    (this.lines.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.lines.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    this.lines.visible = lineCount > 0;

    this.bars.count = barCount;
    this.barBack.count = barCount;
    this.bars.visible = barCount > 0;
    this.barBack.visible = barCount > 0;
    this.bars.instanceMatrix.needsUpdate = true;
    this.barBack.instanceMatrix.needsUpdate = true;
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;

    this.markers.count = markerCount;
    this.markers.visible = markerCount > 0;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;

    this.selectionRing.count = ringCount;
    this.selectionRing.visible = ringCount > 0;
    this.selectionRing.instanceMatrix.needsUpdate = true;

    // Billboards face the camera.
    const yaw = Math.atan2(cameraPos.x - this.group.position.x, cameraPos.z - this.group.position.z);
    this.bars.rotation.y = 0;
    this.barBack.rotation.y = 0;
    void yaw;
  }

  private pushLine(
    i: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    colour: Color,
  ): void {
    const p = i * 6;
    this.linePositions[p] = x1;
    this.linePositions[p + 1] = y1;
    this.linePositions[p + 2] = z1;
    this.linePositions[p + 3] = x2;
    this.linePositions[p + 4] = y2;
    this.linePositions[p + 5] = z2;
    for (let k = 0; k < 2; k++) {
      this.lineColors[p + k * 3] = colour.r;
      this.lineColors[p + k * 3 + 1] = colour.g;
      this.lineColors[p + k * 3 + 2] = colour.b;
    }
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
    this.bars.geometry.dispose();
    (this.bars.material as MeshBasicMaterial).dispose();
    (this.barBack.material as MeshBasicMaterial).dispose();
    this.bars.dispose();
    this.barBack.dispose();
    this.markers.geometry.dispose();
    (this.markers.material as MeshBasicMaterial).dispose();
    this.markers.dispose();
    this.selectionRing.geometry.dispose();
    (this.selectionRing.material as MeshBasicMaterial).dispose();
    this.selectionRing.dispose();
    this.scene.remove(this.group);
  }
}

function activityColour(activity: string): number {
  switch (activity) {
    case 'hauling':
      return PALETTE.cloak.hauler;
    case 'building':
    case 'demolishing':
      return PALETTE.cloak.builder;
    case 'chopping':
      return PALETTE.cloak.logger;
    case 'mining':
      return PALETTE.cloak.miner;
    case 'farming':
    case 'planting':
      return PALETTE.cloak.farmer;
    case 'crafting':
      return PALETTE.cloak.crafter;
    case 'researching':
      return PALETTE.cloak.researcher;
    case 'sleeping':
      return 0x3a4a6a;
    case 'eating':
      return 0xd8a83c;
    case 'socialising':
      return 0xd86fa8;
    case 'idle':
      return 0x7a7a7a;
    default:
      return 0xaaaaaa;
  }
}
