/**
 * A small pooled particle system.
 *
 * Used for wood chips when an axe lands, stone dust at the quarry, chimney
 * smoke, rain and snow. Everything is one instanced draw call, so the effects
 * cost almost nothing even with a busy settlement.
 */

import {
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
import { PALETTE } from './Palette';

const MAX_PARTICLES = 1400;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  rot: number;
  gravity: number;
  colour: Color;
  drag: number;
  alive: boolean;
}

export type EffectKind = 'woodchips' | 'stonedust' | 'sparks' | 'smoke' | 'dust' | 'leaves' | 'splash';

export class ParticleSystem {
  readonly group = new Object3D();
  private scene: Scene;
  private mesh: InstancedMesh;
  private material: MeshLambertMaterial;
  private particles: Particle[] = [];
  private cursor = 0;
  private mat4 = new Matrix4();
  private pos = new Vector3();
  private quat = new Quaternion();
  private scale = new Vector3();
  private axis = new Vector3(0.4, 1, 0.2).normalize();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'particles';
    scene.add(this.group);

    const b = new GeoBuilder();
    b.box(1, 1, 1, 0xffffff, {});
    const geo = b.build();

    this.material = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.95,
    });
    this.mesh = new InstancedMesh(geo, this.material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.1, spin: 0, rot: 0,
        gravity: -9, colour: new Color(), drag: 0.02, alive: false,
      });
    }
  }

  /** Emits a burst of particles of a given kind. */
  emit(kind: EffectKind, x: number, y: number, z: number, count = 6, dirX = 0, dirZ = 0): void {
    for (let i = 0; i < count; i++) {
      const p = this.next();
      p.x = x;
      p.y = y;
      p.z = z;
      p.rot = Math.random() * Math.PI;
      p.alive = true;

      switch (kind) {
        case 'woodchips':
          p.vx = (Math.random() - 0.5) * 2.4 + dirX;
          p.vy = 1.2 + Math.random() * 2.2;
          p.vz = (Math.random() - 0.5) * 2.4 + dirZ;
          p.size = 0.05 + Math.random() * 0.05;
          p.maxLife = 0.7 + Math.random() * 0.5;
          p.gravity = -11;
          p.drag = 0.6;
          p.colour.setHex(PALETTE.vegetation.trunk);
          break;
        case 'stonedust':
          p.vx = (Math.random() - 0.5) * 1.6 + dirX;
          p.vy = 0.8 + Math.random() * 1.6;
          p.vz = (Math.random() - 0.5) * 1.6 + dirZ;
          p.size = 0.04 + Math.random() * 0.06;
          p.maxLife = 0.6 + Math.random() * 0.6;
          p.gravity = -9;
          p.drag = 1.2;
          p.colour.setHex(PALETTE.terrain.rock);
          break;
        case 'sparks':
          p.vx = (Math.random() - 0.5) * 2.6;
          p.vy = 1.6 + Math.random() * 2;
          p.vz = (Math.random() - 0.5) * 2.6;
          p.size = 0.03 + Math.random() * 0.02;
          p.maxLife = 0.4 + Math.random() * 0.3;
          p.gravity = -7;
          p.drag = 0.4;
          p.colour.setHex(PALETTE.light.fire);
          break;
        case 'smoke':
          p.vx = (Math.random() - 0.5) * 0.3;
          p.vy = 0.7 + Math.random() * 0.5;
          p.vz = (Math.random() - 0.5) * 0.3;
          p.size = 0.16 + Math.random() * 0.16;
          p.maxLife = 2.6 + Math.random() * 2;
          p.gravity = 0.4;
          p.drag = 0.5;
          p.colour.setHex(0x9aa3ad);
          break;
        case 'dust':
          p.vx = (Math.random() - 0.5) * 0.9;
          p.vy = 0.3 + Math.random() * 0.5;
          p.vz = (Math.random() - 0.5) * 0.9;
          p.size = 0.07 + Math.random() * 0.08;
          p.maxLife = 0.8 + Math.random() * 0.7;
          p.gravity = -1.6;
          p.drag = 1.6;
          p.colour.setHex(PALETTE.terrain.dirt);
          break;
        case 'leaves':
          p.vx = (Math.random() - 0.5) * 1.4;
          p.vy = -0.4 - Math.random() * 0.4;
          p.vz = (Math.random() - 0.5) * 1.4;
          p.size = 0.07 + Math.random() * 0.05;
          p.maxLife = 2.4 + Math.random() * 1.8;
          p.gravity = -0.8;
          p.drag = 1.9;
          p.colour.setHex(PALETTE.vegetation.leafAutumn);
          break;
        case 'splash':
          p.vx = (Math.random() - 0.5) * 1.8;
          p.vy = 1 + Math.random() * 1.6;
          p.vz = (Math.random() - 0.5) * 1.8;
          p.size = 0.05 + Math.random() * 0.05;
          p.maxLife = 0.5 + Math.random() * 0.4;
          p.gravity = -12;
          p.drag = 0.3;
          p.colour.setHex(PALETTE.water.foam);
          break;
      }
      p.spin = (Math.random() - 0.5) * 8;
      p.life = p.maxLife;
    }
  }

  private next(): Particle {
    // Ring buffer: the oldest particle is recycled when we run out.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (!this.particles[this.cursor].alive) return this.particles[this.cursor];
    }
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    return this.particles[this.cursor];
  }

  update(dt: number): void {
    let n = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravity * dt;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;

      if (n >= MAX_PARTICLES) break;
      const t = p.life / p.maxLife;
      const s = p.size * (0.4 + t * 0.6) * (p.gravity > 0 ? 2 - t : 1);
      this.pos.set(p.x, p.y, p.z);
      this.quat.setFromAxisAngle(this.axis, p.rot);
      this.scale.set(s, s, s);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(n, this.mat4);
      this.mesh.setColorAt(n, p.colour);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get activeCount(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
