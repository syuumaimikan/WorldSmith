/**
 * Third-person orbit camera with an overhead build mode.
 *
 * FOV, default distance and pitch are taken from the art direction document so
 * the framing matches the reference diorama: a fairly tight 55 degree lens at
 * about nine metres, looking slightly down.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, dampAngle, TAU } from '../core/math';
import { Terrain } from '../world/Terrain';

export type CameraMode = 'third' | 'first' | 'build' | 'overview' | 'god';

const MIN_PITCH = -1.35;
const MAX_PITCH = 0.62;

export class CameraController {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'third';

  yaw = 0;
  pitch = -0.32;
  distance = 9;
  targetDistance = 9;

  /** Point the camera orbits, usually the player's chest. */
  readonly focus = new Vector3();
  private smoothFocus = new Vector3();
  private smoothYaw = 0;
  private smoothPitch = -0.32;
  private smoothDistance = 9;
  private terrain: Terrain | null = null;

  private tmp = new Vector3();
  private desired = new Vector3();

  /** Free-look pan offset used in build and overview modes. */
  private panOffset = new Vector3();
  /** Absolute camera position while flying in god mode. */
  readonly godPosition = new Vector3();
  private godVelocity = new Vector3();
  private forward = new Vector3();
  private right = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.25, 4000);
    this.camera.position.set(0, 20, 20);
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    switch (mode) {
      case 'third':
        this.targetDistance = 9;
        this.pitch = clamp(this.pitch, -0.7, 0.2);
        this.panOffset.set(0, 0, 0);
        this.camera.fov = 55;
        break;
      case 'first':
        this.targetDistance = 0;
        this.camera.fov = 68;
        break;
      case 'build':
        this.targetDistance = 26;
        this.pitch = -0.95;
        this.camera.fov = 48;
        break;
      case 'overview':
        this.targetDistance = 90;
        this.pitch = -1.05;
        this.camera.fov = 45;
        break;
      case 'god':
        // Free flight starts just above the player and can climb to a view of
        // the whole continent.
        this.camera.fov = 52;
        this.godPosition.copy(this.camera.position);
        this.pitch = clamp(this.pitch, MIN_PITCH, -0.15);
        break;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Mouse-drag look. */
  rotate(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * 0.0032 * sensitivity;
    this.pitch = clamp(this.pitch - dy * 0.0028 * sensitivity, MIN_PITCH, MAX_PITCH);
    if (this.yaw > Math.PI) this.yaw -= TAU;
    if (this.yaw < -Math.PI) this.yaw += TAU;
  }

  /**
   * Flies the god camera. Movement scales with altitude, so the same controls
   * work whether you are inspecting a doorway or looking at a whole coastline.
   */
  flyGod(forwardAxis: number, rightAxis: number, upAxis: number, fast: boolean, dt: number): void {
    const groundY = this.terrain ? this.terrain.heightAt(this.godPosition.x, this.godPosition.z) : 0;
    const altitude = Math.max(2, this.godPosition.y - groundY);
    const speed = altitude * (fast ? 3.2 : 1.1) + 12;

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.godVelocity.set(0, 0, 0);
    this.godVelocity.addScaledVector(this.forward, forwardAxis * speed);
    this.godVelocity.addScaledVector(this.right, rightAxis * speed);
    this.godVelocity.y += upAxis * speed;

    this.godPosition.addScaledVector(this.godVelocity, dt);

    if (this.terrain) {
      const size = this.terrain.worldSize;
      this.godPosition.x = clamp(this.godPosition.x, -size * 0.2, size * 1.2);
      this.godPosition.z = clamp(this.godPosition.z, -size * 0.2, size * 1.2);
      const floor = this.terrain.heightAt(this.godPosition.x, this.godPosition.z) + 2.5;
      this.godPosition.y = clamp(this.godPosition.y, floor, size * 1.6);
    }
  }

  /** Altitude above the ground, used to pick simulation and render detail. */
  godAltitude(): number {
    const groundY = this.terrain ? this.terrain.heightAt(this.godPosition.x, this.godPosition.z) : 0;
    return Math.max(0, this.godPosition.y - groundY);
  }

  zoom(steps: number): void {
    if (this.mode === 'god') {
      // The wheel changes altitude directly rather than an orbit distance --
      // but in the same direction as everywhere else. Climbing in god mode
      // has to mean the same wheel turn as backing away in third person, or
      // the wheel does opposite things depending on what the player is
      // looking through.
      const alt = this.godAltitude();
      this.godPosition.y += steps * Math.max(4, alt * 0.22);
      return;
    }
    const min = this.mode === 'build' ? 8 : this.mode === 'overview' ? 30 : 2.2;
    const max = this.mode === 'build' ? 90 : this.mode === 'overview' ? 320 : 24;
    const factor = Math.pow(1.16, steps);
    this.targetDistance = clamp(this.targetDistance * factor, min, max);
    if (this.mode === 'third' && this.targetDistance < 2.6) this.targetDistance = 2.2;
  }

  /** Pans the build camera across the ground plane. */
  pan(dx: number, dz: number): void {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.panOffset.x += dx * cos - dz * sin;
    this.panOffset.z += dx * sin + dz * cos;
  }

  clearPan(): void {
    this.panOffset.set(0, 0, 0);
  }

  get panned(): Vector3 {
    return this.panOffset;
  }

  /** Forward vector projected onto the ground, for movement relative to view. */
  groundForward(out: Vector3): Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  groundRight(out: Vector3): Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt: number, target: Vector3, instant = false): void {
    if (this.mode === 'god') {
      this.camera.position.copy(this.godPosition);
      const cp = Math.cos(this.pitch);
      this.camera.lookAt(
        this.godPosition.x - Math.sin(this.yaw) * cp,
        this.godPosition.y + Math.sin(this.pitch),
        this.godPosition.z - Math.cos(this.yaw) * cp,
      );
      return;
    }

    this.focus.copy(target).add(this.panOffset);

    const lambda = instant ? 1000 : 14;
    this.smoothFocus.x = damp(this.smoothFocus.x, this.focus.x, lambda, dt);
    this.smoothFocus.y = damp(this.smoothFocus.y, this.focus.y, lambda * 0.7, dt);
    this.smoothFocus.z = damp(this.smoothFocus.z, this.focus.z, lambda, dt);
    this.smoothYaw = instant ? this.yaw : dampAngle(this.smoothYaw, this.yaw, 18, dt);
    this.smoothPitch = instant ? this.pitch : damp(this.smoothPitch, this.pitch, 18, dt);
    this.smoothDistance = instant
      ? this.targetDistance
      : damp(this.smoothDistance, this.targetDistance, 9, dt);
    this.distance = this.smoothDistance;

    if (this.mode === 'first') {
      this.camera.position.copy(this.smoothFocus);
      this.camera.position.y += 0.35;
      this.tmp.set(
        Math.sin(this.smoothYaw) * Math.cos(this.smoothPitch),
        Math.sin(this.smoothPitch),
        Math.cos(this.smoothYaw) * Math.cos(this.smoothPitch),
      );
      this.camera.lookAt(
        this.camera.position.x - this.tmp.x,
        this.camera.position.y + this.tmp.y,
        this.camera.position.z - this.tmp.z,
      );
      return;
    }

    const cp = Math.cos(this.smoothPitch);
    this.desired.set(
      this.smoothFocus.x + Math.sin(this.smoothYaw) * cp * this.smoothDistance,
      this.smoothFocus.y - Math.sin(this.smoothPitch) * this.smoothDistance,
      this.smoothFocus.z + Math.cos(this.smoothYaw) * cp * this.smoothDistance,
    );

    // Keep the camera above the ground so it never ends up inside a hillside.
    if (this.terrain) {
      const groundY = this.terrain.heightAt(this.desired.x, this.desired.z);
      const minY = Math.max(groundY + 1.4, this.terrain.waterHeight[
        this.terrain.index(this.terrain.tileX(this.desired.x), this.terrain.tileZ(this.desired.z))
      ] + 0.8);
      if (this.desired.y < minY) this.desired.y = minY;

      // Pull in if terrain blocks the line of sight to the focus point.
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sx = this.smoothFocus.x + (this.desired.x - this.smoothFocus.x) * t;
        const sz = this.smoothFocus.z + (this.desired.z - this.smoothFocus.z) * t;
        const sy = this.smoothFocus.y + (this.desired.y - this.smoothFocus.y) * t;
        const gh = this.terrain.heightAt(sx, sz) + 0.9;
        if (sy < gh) {
          this.desired.set(sx, Math.max(sy, gh), sz);
          break;
        }
      }
    }

    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.smoothFocus);
  }

  /** Snaps smoothing state, used after teleports and on world load. */
  snap(target: Vector3): void {
    this.smoothFocus.copy(target);
    this.smoothYaw = this.yaw;
    this.smoothPitch = this.pitch;
    this.smoothDistance = this.targetDistance;
    this.update(1, target, true);
  }
}
