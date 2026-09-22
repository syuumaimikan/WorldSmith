/**
 * The WorldSmith character: a hooded chibi figure with glowing eyes and a
 * flared cloak, taken directly from reference images 4, 5 and 6.
 *
 * Built as a rigidly-skinned mesh over a seven-bone skeleton, so one character
 * is one draw call while still supporting procedural walk, carry and work
 * animation. Cloak colour encodes profession — that is the whole reason you can
 * read a settlement at a glance.
 */

import { Bone, BufferGeometry, Color, Mesh, MeshLambertMaterial, Skeleton, SkinnedMesh } from 'three';
import { GeoBuilder } from './GeoBuilder';
import { PALETTE, shade } from '../Palette';
import { Rng } from '../../core/rng';

export const BONE = {
  root: 0,
  hips: 1,
  head: 2,
  armL: 3,
  armR: 4,
  legL: 5,
  legR: 6,
} as const;

export const CHARACTER_HEIGHT = 1.62;
const HIP_Y = 0.52;
const HEAD_Y = 0.94;
const SHOULDER_Y = 0.84;

export interface CharacterLook {
  cloak: number;
  /** Slight body-colour variation between individuals. */
  bodyShade: number;
  /** 0..1 how tall this individual is relative to the archetype. */
  height: number;
  /** Adds a gold trim, used for the player. */
  trim?: number;
  hasPack?: boolean;
  hoodStyle: 0 | 1 | 2;
}

export function lookFor(cloak: number, seed: number, trim?: number): CharacterLook {
  const rng = new Rng(seed);
  return {
    cloak,
    bodyShade: 0.88 + rng.next() * 0.26,
    height: 0.92 + rng.next() * 0.17,
    trim,
    hoodStyle: rng.int(0, 2) as 0 | 1 | 2,
    hasPack: rng.chance(0.35),
  };
}

/**
 * Builds the skinned geometry in bind pose. Vertices are authored in world
 * space with the figure facing +Z.
 */
export function buildCharacterGeometry(look: CharacterLook): BufferGeometry {
  const b = new GeoBuilder();
  const body = shade(PALETTE.character.body, look.bodyShade);
  const bodyLight = shade(PALETTE.character.bodyLight, look.bodyShade);
  const cloak = look.cloak;
  const cloakDark = shade(cloak, 0.76);

  // ------------------------------------------------------------------ legs
  for (const side of [1, -1]) {
    b.setBone(side > 0 ? BONE.legL : BONE.legR);
    const x = side * 0.105;
    // Tapering to a ragged point, as in reference 6.
    b.cylinder(0.082, 0.098, 0.34, 6, body, { x, y: HIP_Y - 0.17 });
    b.cone(0.082, 0.2, 6, shade(body, 0.85), { x, y: HIP_Y - 0.4, rx: Math.PI });
  }

  // ------------------------------------------------------------------ hips
  b.setBone(BONE.hips);
  b.cylinder(0.16, 0.145, 0.3, 8, body, { y: HIP_Y + 0.12 });
  b.cylinder(0.175, 0.16, 0.1, 8, bodyLight, { y: HIP_Y + 0.29 });

  // Cloak: a flared cone that is the character's largest readable shape.
  b.cone(0.34, 0.62, 9, cloak, { y: HIP_Y + 0.18, z: -0.02 });
  // Back panel gives the cloak a trailing edge instead of a neat cone.
  b.box(0.42, 0.5, 0.05, cloakDark, { y: HIP_Y + 0.08, z: -0.2, rx: 0.14 });
  b.cone(0.2, 0.26, 7, cloakDark, { y: HIP_Y - 0.06, z: -0.26, rx: 0.3 });
  // Collar knot from the concept art.
  b.sphere(0.075, 6, 5, cloakDark, { y: SHOULDER_Y - 0.04, z: 0.13 });

  if (look.trim !== undefined) {
    b.cylinder(0.215, 0.235, 0.05, 9, look.trim, { y: HIP_Y + 0.42 });
  }

  if (look.hasPack) {
    b.box(0.22, 0.24, 0.13, PALETTE.build.woodDark, { y: SHOULDER_Y - 0.16, z: -0.19 });
    b.box(0.24, 0.05, 0.14, shade(PALETTE.build.wood, 0.8), { y: SHOULDER_Y - 0.06, z: -0.19 });
  }

  // ------------------------------------------------------------------ arms
  for (const side of [1, -1]) {
    b.setBone(side > 0 ? BONE.armL : BONE.armR);
    const x = side * 0.205;
    b.cylinder(0.055, 0.065, 0.26, 6, body, { x, y: SHOULDER_Y - 0.13 });
    // Flat paddle hands.
    b.box(0.1, 0.12, 0.06, PALETTE.character.hand, { x, y: SHOULDER_Y - 0.3 });
  }

  // ------------------------------------------------------------------ head
  b.setBone(BONE.head);
  // Dark face plate: the void the eyes sit in.
  b.sphere(0.235, 9, 7, shade(body, 0.68), { y: HEAD_Y + 0.22, sz: 0.92 });

  // Hood shell over the back and sides of the head.
  b.sphere(0.265, 10, 8, cloak, { y: HEAD_Y + 0.24, z: -0.035, sz: 1.02 });
  // Cut the front open by pushing a dark ellipse forward.
  b.sphere(0.2, 9, 7, shade(body, 0.55), { y: HEAD_Y + 0.21, z: 0.085, sz: 0.72 });

  // The hood's backward-curving horn — the key silhouette of the concept art.
  const hornTilt = look.hoodStyle === 0 ? 0.5 : look.hoodStyle === 1 ? 0.78 : 0.32;
  b.cone(0.15, 0.3, 7, cloak, { y: HEAD_Y + 0.46, z: -0.1, rx: -hornTilt * 0.5 });
  b.cone(0.1, 0.26, 6, cloak, { y: HEAD_Y + 0.62, z: -0.21, rx: -hornTilt });
  b.cone(0.055, 0.2, 5, cloakDark, { y: HEAD_Y + 0.74, z: -0.34, rx: -hornTilt * 1.5 });

  // Hood shoulder drape.
  b.cone(0.3, 0.2, 9, cloakDark, { y: HEAD_Y - 0.02, rx: Math.PI });

  // Eyes: big flat ovals, bright enough to read at night.
  for (const side of [1, -1]) {
    b.sphere(0.072, 7, 6, PALETTE.character.eye, {
      x: side * 0.083,
      y: HEAD_Y + 0.235,
      z: 0.185,
      sx: 0.78,
      sy: 1.25,
      sz: 0.5,
    });
  }

  return b.build();
}

export function createSkeleton(): { bones: Bone[]; skeleton: Skeleton } {
  const root = new Bone();
  root.name = 'root';

  const hips = new Bone();
  hips.name = 'hips';
  hips.position.set(0, HIP_Y, 0);
  root.add(hips);

  const head = new Bone();
  head.name = 'head';
  head.position.set(0, HEAD_Y - HIP_Y, 0);
  hips.add(head);

  const armL = new Bone();
  armL.name = 'armL';
  armL.position.set(0.205, SHOULDER_Y - HIP_Y, 0);
  hips.add(armL);

  const armR = new Bone();
  armR.name = 'armR';
  armR.position.set(-0.205, SHOULDER_Y - HIP_Y, 0);
  hips.add(armR);

  const legL = new Bone();
  legL.name = 'legL';
  legL.position.set(0.105, 0, 0);
  hips.add(legL);

  const legR = new Bone();
  legR.name = 'legR';
  legR.position.set(-0.105, 0, 0);
  hips.add(legR);

  const bones = [root, hips, head, armL, armR, legL, legR];
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  return { bones, skeleton };
}

/**
 * Parts are authored in world space, so each bone's bind matrix must be undone
 * before skinning. Building the skeleton from world-space bind positions and
 * letting three compute inverses handles that for us.
 */
export function createCharacterMesh(
  look: CharacterLook,
  material: MeshLambertMaterial,
  sharedGeometry?: BufferGeometry,
): { mesh: SkinnedMesh; bones: Bone[] } {
  const geometry = sharedGeometry ?? buildCharacterGeometry(look);
  const { bones, skeleton } = createSkeleton();
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, bones };
}

/** Simplified single-mesh version for distant crowds — no bones, no skinning. */
export function buildCharacterLodGeometry(cloak: number): BufferGeometry {
  const b = new GeoBuilder();
  const body = PALETTE.character.body;
  b.cylinder(0.09, 0.1, 0.5, 5, body, { y: 0.26 });
  b.cone(0.3, 0.56, 7, cloak, { y: 0.72 });
  b.sphere(0.24, 6, 5, cloak, { y: 1.14 });
  b.cone(0.1, 0.26, 5, cloak, { y: 1.38, z: -0.14, rx: -0.7 });
  b.sphere(0.14, 5, 4, shade(body, 0.6), { y: 1.12, z: 0.13, sz: 0.5 });
  b.box(0.16, 0.08, 0.03, PALETTE.character.eye, { y: 1.15, z: 0.24 });
  return b.build();
}

export function characterMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/** Debug helper: renders the bind pose as a plain mesh. */
export function createStaticCharacter(look: CharacterLook, material: MeshLambertMaterial): Mesh {
  const m = new Mesh(buildCharacterGeometry(look), material);
  m.castShadow = true;
  return m;
}

export const CLOAK_COLORS = PALETTE.cloak;
export { Color };
