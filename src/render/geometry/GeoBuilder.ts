/**
 * Builds a single merged, vertex-coloured, non-indexed BufferGeometry from
 * primitive parts.
 *
 * Every asset in WorldSmith — trees, rocks, houses, characters, carts — is
 * assembled here from boxes, cones, cylinders and low-facet spheres, with
 * colour baked per vertex. One asset ends up as one geometry, which is what
 * lets us draw thousands of them with instancing.
 */

import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';

const _m4 = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _pos = new Vector3();
const _scale = new Vector3();
const _nm = new Matrix3();
const _c = new Color();

export interface PartTransform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  s?: number;
}

/** Cached primitives — building the same BoxGeometry thousands of times is waste. */
const boxCache = new Map<string, BufferGeometry>();

function cachedBox(w: number, h: number, d: number): BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new BoxGeometry(w, h, d).toNonIndexed();
    boxCache.set(key, g);
  }
  return g;
}

export class GeoBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private skinIndices: number[] = [];
  private skinWeights: number[] = [];
  private bone = -1;

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  /**
   * Assigns subsequent parts to a bone index. Weighting is rigid (one bone per
   * vertex), which is exactly right for blocky low-poly characters and keeps a
   * whole character down to a single draw call.
   */
  setBone(index: number): this {
    this.bone = index;
    return this;
  }

  /** Appends any geometry, transformed, with a flat colour. */
  add(geo: BufferGeometry, color: number, t: PartTransform = {}): this {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const pos = src.getAttribute('position');
    const nor = src.getAttribute('normal');

    _pos.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    _e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
    _q.setFromEuler(_e);
    const s = t.s ?? 1;
    _scale.set((t.sx ?? 1) * s, (t.sy ?? 1) * s, (t.sz ?? 1) * s);
    _m4.compose(_pos, _q, _scale);
    _nm.getNormalMatrix(_m4);

    // Color.setHex already converts from sRGB into the renderer's working
    // colour space; converting again here would darken everything twice.
    _c.setHex(color);

    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
      this.positions.push(v.x, v.y, v.z);
      if (nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
        this.normals.push(v.x, v.y, v.z);
      } else {
        this.normals.push(0, 1, 0);
      }
      this.colors.push(_c.r, _c.g, _c.b);
      if (this.bone >= 0) {
        this.skinIndices.push(this.bone, 0, 0, 0);
        this.skinWeights.push(1, 0, 0, 0);
      }
    }
    if (src !== geo) src.dispose();
    return this;
  }

  box(w: number, h: number, d: number, color: number, t: PartTransform = {}): this {
    return this.add(cachedBox(w, h, d), color, t);
  }

  /** Axis-aligned box placed by its base centre rather than its middle. */
  boxOnGround(w: number, h: number, d: number, color: number, t: PartTransform = {}): this {
    return this.box(w, h, d, color, { ...t, y: (t.y ?? 0) + h / 2 });
  }

  cone(radius: number, height: number, segments: number, color: number, t: PartTransform = {}): this {
    const g = new ConeGeometry(radius, height, segments, 1, false);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  cylinder(
    rTop: number,
    rBottom: number,
    height: number,
    segments: number,
    color: number,
    t: PartTransform = {},
  ): this {
    const g = new CylinderGeometry(rTop, rBottom, height, segments, 1, false);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  /** Low-facet blob — the canopy/rock workhorse. */
  blob(radius: number, detail: number, color: number, t: PartTransform = {}): this {
    const g = new IcosahedronGeometry(radius, detail);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  dodec(radius: number, color: number, t: PartTransform = {}): this {
    const g = new DodecahedronGeometry(radius, 0);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  tetra(radius: number, color: number, t: PartTransform = {}): this {
    const g = new TetrahedronGeometry(radius, 0);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  sphere(radius: number, wSeg: number, hSeg: number, color: number, t: PartTransform = {}): this {
    const g = new SphereGeometry(radius, wSeg, hSeg);
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  /** Flat quad on the XZ plane, used for contact shadows and markers. */
  quadXZ(w: number, d: number, color: number, t: PartTransform = {}): this {
    const g = new BufferGeometry();
    const hw = w / 2;
    const hd = d / 2;
    g.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -hw, 0, -hd, -hw, 0, hd, hw, 0, hd,
          -hw, 0, -hd, hw, 0, hd, hw, 0, -hd,
        ]),
        3,
      ),
    );
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  /**
   * A gabled roof: two sloping rectangles plus the triangular end caps.
   * Written by hand because it is the single most common shape in the game.
   */
  gableRoof(
    width: number,
    depth: number,
    rise: number,
    overhang: number,
    color: number,
    gableColor: number,
    t: PartTransform = {},
  ): this {
    const hw = width / 2 + overhang;
    const hd = depth / 2 + overhang;
    const g = new BufferGeometry();
    const p: number[] = [];
    const push = (a: number[], b: number[], c: number[]) => p.push(...a, ...b, ...c);

    // Two slopes (ridge runs along X).
    push([-hw, 0, -hd], [hw, 0, -hd], [hw, rise, 0]);
    push([-hw, 0, -hd], [hw, rise, 0], [-hw, rise, 0]);
    push([hw, 0, hd], [-hw, 0, hd], [-hw, rise, 0]);
    push([hw, 0, hd], [-hw, rise, 0], [hw, rise, 0]);

    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    g.computeVertexNormals();
    this.add(g, color, t);
    g.dispose();

    // Gable end triangles.
    const g2 = new BufferGeometry();
    const p2: number[] = [];
    const hw2 = width / 2;
    const hd2 = depth / 2;
    p2.push(-hw2, 0, -hd2, -hw2, 0, hd2, -hw2, rise, 0);
    p2.push(hw2, 0, hd2, hw2, 0, -hd2, hw2, rise, 0);
    g2.setAttribute('position', new BufferAttribute(new Float32Array(p2), 3));
    g2.computeVertexNormals();
    this.add(g2, gableColor, t);
    g2.dispose();
    return this;
  }

  /** Four-sided pyramid roof. */
  hipRoof(width: number, depth: number, rise: number, overhang: number, color: number, t: PartTransform = {}): this {
    const hw = width / 2 + overhang;
    const hd = depth / 2 + overhang;
    const g = new BufferGeometry();
    const p: number[] = [];
    const apex = [0, rise, 0];
    const c0 = [-hw, 0, -hd];
    const c1 = [hw, 0, -hd];
    const c2 = [hw, 0, hd];
    const c3 = [-hw, 0, hd];
    p.push(...c0, ...c1, ...apex);
    p.push(...c1, ...c2, ...apex);
    p.push(...c2, ...c3, ...apex);
    p.push(...c3, ...c0, ...apex);
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    g.computeVertexNormals();
    this.add(g, color, t);
    g.dispose();
    return this;
  }

  /** Merges another builder's contents. */
  merge(other: GeoBuilder): this {
    for (let i = 0; i < other.positions.length; i++) this.positions.push(other.positions[i]);
    for (let i = 0; i < other.normals.length; i++) this.normals.push(other.normals[i]);
    for (let i = 0; i < other.colors.length; i++) this.colors.push(other.colors[i]);
    for (let i = 0; i < other.skinIndices.length; i++) this.skinIndices.push(other.skinIndices[i]);
    for (let i = 0; i < other.skinWeights.length; i++) this.skinWeights.push(other.skinWeights[i]);
    return this;
  }

  isEmpty(): boolean {
    return this.positions.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    if (this.skinIndices.length > 0) {
      g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.skinIndices), 4));
      g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.skinWeights), 4));
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Convenience: build in one expression. */
export function buildGeo(fn: (b: GeoBuilder) => void): BufferGeometry {
  const b = new GeoBuilder();
  fn(b);
  return b.build();
}
