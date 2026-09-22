/**
 * Things falling out of the sky.
 *
 * There are never more than a handful at once, so each one gets its own small
 * mesh rather than going through the instanced particle system: a burning
 * core, a halo around it that stands in for the glow, and a tail of smoke and
 * embers laid down along the track it has already flown. The tail is what
 * actually sells it — a bright dot crossing the sky reads as a bug on the
 * screen, and the same dot with four hundred metres of smoke behind it reads
 * as a rock coming in.
 */

import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
} from 'three';
import type { FallingBody } from '../sim/Disasters';
import type { ParticleSystem } from './Particles';

interface Entry {
  group: Group;
  core: Mesh;
  halo: Mesh;
  /** Seconds since the last puff of smoke was laid down. */
  trailTimer: number;
}

export class SkyfallRenderer {
  private scene: Scene;
  private entries = new Map<number, Entry>();
  private coreGeo = new SphereGeometry(1, 10, 8);
  private coreMat: MeshBasicMaterial;
  private haloMat: MeshBasicMaterial;

  constructor(scene: Scene) {
    this.scene = scene;
    this.coreMat = new MeshBasicMaterial({ color: new Color(0xfff0c0), toneMapped: false });
    this.haloMat = new MeshBasicMaterial({
      color: new Color(0xff8a3c),
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false,
      side: BackSide,
      toneMapped: false,
    });
  }

  /**
   * @param bodies what is currently in the air.
   * @param particles used for the trail, so the smoke behaves like every
   *   other piece of smoke in the world and drifts on the same wind.
   */
  update(bodies: readonly FallingBody[], particles: ParticleSystem, dt: number): void {
    const live = new Set<number>();

    for (const b of bodies) {
      live.add(b.id);
      let entry = this.entries.get(b.id);
      if (!entry) {
        const group = new Group();
        const core = new Mesh(this.coreGeo, this.coreMat);
        const halo = new Mesh(this.coreGeo, this.haloMat);
        group.add(core);
        group.add(halo);
        this.scene.add(group);
        entry = { group, core, halo, trailTimer: 0 };
        this.entries.set(b.id, entry);
      }

      // It grows as it comes in, partly because it really is getting closer
      // and partly because the fireball around it really does get bigger.
      const progress = 1 - Math.max(0, b.left) / Math.max(0.001, b.flight);
      const r = 1.6 + b.size * 5 + progress * (3 + b.size * 9);
      entry.group.position.set(b.x, b.y, b.z);
      entry.core.scale.setScalar(r);
      entry.halo.scale.setScalar(r * (2.4 + progress * 1.6));

      // A trail of smoke and embers, laid down often enough to be continuous
      // at the speed it is travelling.
      entry.trailTimer += dt;
      if (entry.trailTimer > 0.045) {
        entry.trailTimer = 0;
        particles.emit('smoke', b.x, b.y, b.z, 2);
        particles.emit('sparks', b.x, b.y, b.z, 3, -b.vx * 0.02, -b.vz * 0.02);
      }
    }

    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      this.scene.remove(entry.group);
      this.entries.delete(id);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.scene.remove(entry.group);
    this.entries.clear();
    this.coreGeo.dispose();
    this.coreMat.dispose();
    this.haloMat.dispose();
  }
}
