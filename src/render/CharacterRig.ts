/**
 * Procedural animation for the hooded characters.
 *
 * There are no animation clips to load: walk, run, carry, chop, mine, hammer
 * and sleep are all driven from a phase accumulator and a handful of bone
 * rotations. That keeps the game asset-free while still making it obvious at a
 * glance what every person in the settlement is doing.
 */

import { Bone, BufferGeometry, Group, MeshLambertMaterial, Object3D, SkinnedMesh } from 'three';
import { BONE, CharacterLook, createCharacterMesh } from './geometry/character';
import { damp, lerp } from '../core/math';

export type AnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'carry'
  | 'chop'
  | 'mine'
  | 'build'
  | 'farm'
  | 'craft'
  | 'sit'
  | 'sleep'
  | 'cheer';

interface StateParams {
  /** Steps per second at reference speed. */
  cadence: number;
  legSwing: number;
  armSwing: number;
  bob: number;
  lean: number;
}

const PARAMS: Record<AnimState, StateParams> = {
  idle: { cadence: 0.5, legSwing: 0, armSwing: 0.04, bob: 0.008, lean: 0 },
  walk: { cadence: 1.55, legSwing: 0.58, armSwing: 0.42, bob: 0.035, lean: 0.05 },
  run: { cadence: 2.3, legSwing: 0.85, armSwing: 0.72, bob: 0.06, lean: 0.17 },
  carry: { cadence: 1.4, legSwing: 0.46, armSwing: 0.06, bob: 0.03, lean: 0.09 },
  chop: { cadence: 1.05, legSwing: 0, armSwing: 0, bob: 0.012, lean: 0.12 },
  mine: { cadence: 1.25, legSwing: 0, armSwing: 0, bob: 0.014, lean: 0.16 },
  build: { cadence: 1.7, legSwing: 0, armSwing: 0, bob: 0.01, lean: 0.1 },
  farm: { cadence: 0.9, legSwing: 0, armSwing: 0, bob: 0.02, lean: 0.34 },
  craft: { cadence: 1.9, legSwing: 0, armSwing: 0, bob: 0.008, lean: 0.14 },
  sit: { cadence: 0.4, legSwing: 0, armSwing: 0.02, bob: 0.005, lean: 0.1 },
  sleep: { cadence: 0.25, legSwing: 0, armSwing: 0, bob: 0.012, lean: 0 },
  cheer: { cadence: 2.6, legSwing: 0.1, armSwing: 0, bob: 0.07, lean: -0.08 },
};

export class CharacterRig {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  /** Attachment point that follows the hands; held items parent here. */
  readonly handAnchor = new Object3D();

  private bones: Bone[];
  private ownsGeometry = true;
  private phase = 0;
  private state: AnimState = 'idle';
  private blendLean = 0;
  private blendBob = 0;
  private speedNorm = 0;
  /** Set for one frame when a work swing lands, so callers can spawn effects. */
  impactThisFrame = false;

  constructor(look: CharacterLook, material: MeshLambertMaterial, sharedGeometry?: BufferGeometry) {
    const { mesh, bones } = createCharacterMesh(look, material, sharedGeometry);
    this.ownsGeometry = sharedGeometry === undefined;
    this.mesh = mesh;
    this.bones = bones;
    this.root.add(mesh);
    this.root.add(this.handAnchor);
    this.handAnchor.position.set(0, 0.55, 0.3);
  }

  setState(state: AnimState): void {
    if (this.state === state) return;
    this.state = state;
    // Restart work animations from the top so the first strike reads clearly.
    if (state === 'chop' || state === 'mine' || state === 'build' || state === 'craft') this.phase = 0;
  }

  get currentState(): AnimState {
    return this.state;
  }

  /**
   * @param speed horizontal speed in m/s, used to scale gait cadence.
   */
  update(dt: number, speed: number): void {
    const p = PARAMS[this.state];
    const moving = this.state === 'walk' || this.state === 'run' || this.state === 'carry';
    this.speedNorm = damp(this.speedNorm, moving ? Math.max(0.35, speed / 3.4) : 1, 10, dt);

    const prevPhase = this.phase;
    this.phase += dt * p.cadence * Math.PI * 2 * (moving ? this.speedNorm : 1);
    if (this.phase > Math.PI * 200) this.phase -= Math.PI * 200;

    this.impactThisFrame = false;
    if (this.state === 'chop' || this.state === 'mine' || this.state === 'build' || this.state === 'farm') {
      // Impact occurs once per cycle as the swing bottoms out.
      const cycles = Math.floor(this.phase / (Math.PI * 2));
      const prevCycles = Math.floor(prevPhase / (Math.PI * 2));
      if (cycles !== prevCycles) this.impactThisFrame = true;
    }

    const hips = this.bones[BONE.hips];
    const head = this.bones[BONE.head];
    const armL = this.bones[BONE.armL];
    const armR = this.bones[BONE.armR];
    const legL = this.bones[BONE.legL];
    const legR = this.bones[BONE.legR];

    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    this.blendLean = damp(this.blendLean, p.lean, 9, dt);
    this.blendBob = damp(this.blendBob, p.bob, 9, dt);

    // Reset anything a previous state may have left rotated.
    hips.rotation.set(this.blendLean, 0, 0);
    head.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0);
    armR.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    hips.position.y = HIP_REST;

    switch (this.state) {
      case 'idle': {
        hips.position.y = HIP_REST + Math.sin(this.phase * 0.7) * this.blendBob;
        head.rotation.y = Math.sin(this.phase * 0.31) * 0.16;
        head.rotation.z = Math.sin(this.phase * 0.23) * 0.05;
        armL.rotation.x = Math.sin(this.phase * 0.6) * 0.06;
        armR.rotation.x = -Math.sin(this.phase * 0.6) * 0.06;
        break;
      }
      case 'walk':
      case 'run': {
        legL.rotation.x = s * p.legSwing;
        legR.rotation.x = -s * p.legSwing;
        armL.rotation.x = -s * p.armSwing;
        armR.rotation.x = s * p.armSwing;
        armL.rotation.z = -0.1;
        armR.rotation.z = 0.1;
        hips.position.y = HIP_REST + Math.abs(c) * this.blendBob;
        hips.rotation.y = s * 0.07;
        head.rotation.y = -s * 0.05;
        break;
      }
      case 'carry': {
        legL.rotation.x = s * p.legSwing;
        legR.rotation.x = -s * p.legSwing;
        // Both arms forward, holding the load in front.
        armL.rotation.x = -1.15;
        armR.rotation.x = -1.15;
        armL.rotation.z = -0.28;
        armR.rotation.z = 0.28;
        hips.position.y = HIP_REST + Math.abs(c) * this.blendBob;
        hips.rotation.x = this.blendLean;
        break;
      }
      case 'chop': {
        // Raise high, swing down hard, small recoil.
        const t = (this.phase % (Math.PI * 2)) / (Math.PI * 2);
        const swing = t < 0.55 ? lerp(-2.3, 0.5, easeIn(t / 0.55)) : lerp(0.5, -2.3, easeOut((t - 0.55) / 0.45));
        armL.rotation.x = swing;
        armR.rotation.x = swing;
        armL.rotation.z = -0.22;
        armR.rotation.z = 0.22;
        hips.rotation.x = this.blendLean + Math.max(0, swing + 1.2) * 0.14;
        head.rotation.x = 0.16;
        break;
      }
      case 'mine': {
        const t = (this.phase % (Math.PI * 2)) / (Math.PI * 2);
        const swing = t < 0.5 ? lerp(-1.9, 0.3, easeIn(t / 0.5)) : lerp(0.3, -1.9, easeOut((t - 0.5) / 0.5));
        armL.rotation.x = swing;
        armR.rotation.x = swing * 0.9;
        hips.rotation.x = this.blendLean + 0.1;
        head.rotation.x = 0.28;
        break;
      }
      case 'build': {
        // Short repeated hammer taps.
        const t = (this.phase % (Math.PI * 2)) / (Math.PI * 2);
        const swing = t < 0.4 ? lerp(-1.25, -0.25, easeIn(t / 0.4)) : lerp(-0.25, -1.25, easeOut((t - 0.4) / 0.6));
        armL.rotation.x = swing;
        armR.rotation.x = -0.75;
        armL.rotation.z = -0.3;
        armR.rotation.z = 0.45;
        hips.rotation.x = this.blendLean;
        head.rotation.x = 0.2;
        break;
      }
      case 'farm': {
        const t = (this.phase % (Math.PI * 2)) / (Math.PI * 2);
        const bend = Math.sin(t * Math.PI) * 0.35;
        hips.rotation.x = this.blendLean + bend;
        armL.rotation.x = -0.9 - bend;
        armR.rotation.x = -0.9 - bend;
        armL.rotation.z = -0.18;
        armR.rotation.z = 0.18;
        head.rotation.x = 0.3;
        break;
      }
      case 'craft': {
        armL.rotation.x = -1.1 + Math.sin(this.phase) * 0.22;
        armR.rotation.x = -1.1 - Math.sin(this.phase) * 0.22;
        armL.rotation.z = -0.35;
        armR.rotation.z = 0.35;
        hips.rotation.x = this.blendLean;
        head.rotation.x = 0.3;
        break;
      }
      case 'sit': {
        hips.position.y = HIP_REST - 0.26;
        legL.rotation.x = -1.4;
        legR.rotation.x = -1.4;
        armL.rotation.x = -0.35;
        armR.rotation.x = -0.35;
        hips.rotation.x = this.blendLean;
        head.rotation.y = Math.sin(this.phase * 0.4) * 0.2;
        break;
      }
      case 'sleep': {
        // Curled on the ground; the whole rig is laid over by the caller.
        hips.position.y = HIP_REST - 0.42;
        legL.rotation.x = -1.7;
        legR.rotation.x = -1.6;
        armL.rotation.x = -0.6;
        armR.rotation.x = -0.6;
        head.rotation.x = 0.4;
        head.position.y = HEAD_REST + Math.sin(this.phase) * 0.012;
        break;
      }
      case 'cheer': {
        armL.rotation.x = -2.5 + Math.sin(this.phase) * 0.3;
        armR.rotation.x = -2.5 - Math.sin(this.phase) * 0.3;
        hips.position.y = HIP_REST + Math.abs(Math.sin(this.phase)) * 0.09;
        break;
      }
    }

    // Keep the hand anchor roughly where the hands ended up.
    const handForward = this.state === 'carry' ? 0.42 : 0.26;
    this.handAnchor.position.set(0.16, 0.56 + hips.position.y - HIP_REST, handForward);
    this.handAnchor.rotation.x = armL.rotation.x * 0.85;
  }

  dispose(): void {
    if (this.ownsGeometry) this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}

const HIP_REST = 0.52;
const HEAD_REST = 0.42;

function easeIn(t: number): number {
  return t * t;
}
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
