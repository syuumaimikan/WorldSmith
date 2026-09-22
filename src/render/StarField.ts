/**
 * The night sky.
 *
 * Draws the catalogue the simulation keeps: every star at its own place, with
 * a size and a colour that come from its magnitude and its temperature, and
 * the Milky Way as the dense band of faint ones it actually is. The whole
 * thing turns together on the world's axis, once a day and once a year, so the
 * sky people see in autumn is not the sky they saw in spring.
 *
 * Constellation lines are drawn only when the player asks for them. A sky
 * permanently criss-crossed with lines is a star chart, not a night.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Astronomy, Constellation } from '../sim/Astronomy';
import { TAU } from '../core/math';

/** How far out the celestial sphere sits. Beyond everything else in the scene. */
const SPHERE_RADIUS = 2400;

/**
 * Points sized per-star, because a sky where every star is the same dot reads
 * as static. Magnitude drives both size and brightness, as it does in life.
 */
const STAR_VERT = `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vTwinkle;
uniform float uTime;
uniform float uPixelRatio;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // A slow, tiny shimmer, different for each star.
  vTwinkle = 0.86 + 0.14 * sin(uTime * 1.7 + position.x * 0.013 + position.z * 0.007);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STAR_FRAG = `
varying vec3 vColor;
varying float vTwinkle;
uniform float uOpacity;
void main() {
  // Round, soft-edged points; a square star is a pixel, not a star.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float falloff = smoothstep(0.5, 0.06, r);
  gl_FragColor = vec4(vColor * vTwinkle, falloff * uOpacity);
}
`;

export class StarField {
  readonly group = new Object3D();
  private scene: Scene;
  private points: Points;
  private material: ShaderMaterial;

  private lines: LineSegments;
  private lineMaterial: LineBasicMaterial;
  private meteorGroup = new Object3D();
  private meteors: { line: Line; life: number; total: number }[] = [];
  private meteorMaterial: LineBasicMaterial;

  private elapsed = 0;
  /** Meteors owed since the last frame, kept fractional so slow rates work. */
  private meteorDebt = 0;

  constructor(scene: Scene, astronomy: Astronomy, pixelRatio: number) {
    this.scene = scene;
    this.group.name = 'stars';
    scene.add(this.group);

    // ------------------------------------------------------------- stars
    const stars = astronomy.stars;
    const positions = new Float32Array(stars.length * 3);
    const sizes = new Float32Array(stars.length);
    const colours = new Float32Array(stars.length * 3);
    const tint = new Color();

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const v = celestialToLocal(s.ra, s.dec, SPHERE_RADIUS);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;

      // Magnitude 1 is bright and big; magnitude 7 is a speck.
      const brightness = Math.pow(2.512, -(s.magnitude - 1)) ;
      sizes[i] = 2.2 + Math.min(16, brightness * 15);

      // Colour temperature: cool red through white to hot blue.
      tint.setHSL(
        s.colour > 0.5 ? 0.58 : 0.07,
        0.55 * Math.abs(s.colour - 0.5) * 2,
        0.62 + Math.min(0.35, brightness * 0.5),
      );
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new BufferAttribute(colours, 3));

    this.material = new ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
    });

    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -996;
    this.group.add(this.points);

    // ----------------------------------------------- constellation lines
    const linePositions: number[] = [];
    for (const c of astronomy.constellations) {
      for (const [a, b] of c.lines) {
        const sa = stars[a];
        const sb = stars[b];
        if (!sa || !sb) continue;
        const va = celestialToLocal(sa.ra, sa.dec, SPHERE_RADIUS * 0.998);
        const vb = celestialToLocal(sb.ra, sb.dec, SPHERE_RADIUS * 0.998);
        linePositions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
    }
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(linePositions), 3));
    this.lineMaterial = new LineBasicMaterial({
      color: 0x8fb4d8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.lines = new LineSegments(lineGeo, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -995;
    this.lines.visible = false;
    this.group.add(this.lines);

    // ------------------------------------------------------------ meteors
    this.meteorMaterial = new LineBasicMaterial({
      color: 0xfff2d0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.group.add(this.meteorGroup);
  }

  /** Whether the constellation figures are drawn over the stars. */
  setConstellationsVisible(on: boolean): void {
    this.lines.visible = on;
  }

  get constellationsVisible(): boolean {
    return this.lines.visible;
  }

  /**
   * @param nightFactor 0 in daylight, 1 at full dark.
   * @param cloudCover 0..1, which is what actually hides the stars.
   */
  update(
    focus: Vector3,
    totalDays: number,
    nightFactor: number,
    cloudCover: number,
    meteorRate: number,
    dt: number,
  ): void {
    this.elapsed += dt;
    this.group.position.copy(focus);

    // The sky turns once a day, and a further turn over the year, so the
    // constellations rise about four minutes earlier each night.
    const sidereal = (totalDays * (1 + 1 / 60)) * TAU;
    this.group.rotation.set(0, -sidereal, 0);
    // Tilt the axis so stars wheel about a pole rather than straight overhead.
    this.group.rotation.z = 0.42;

    const visibility = nightFactor * (1 - cloudCover * 0.85);
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uOpacity.value = visibility;
    this.points.visible = visibility > 0.01;

    this.lineMaterial.opacity = visibility * 0.5;

    this.updateMeteors(visibility > 0.05 ? meteorRate : 0, dt);
  }

  /**
   * Meteors are drawn as short streaks that fade. The rate is whatever the
   * simulation says it is, so a shower night is genuinely full of them.
   */
  private updateMeteors(ratePerHour: number, dt: number): void {
    // Game hours pass faster than real seconds; use a readable real-time rate.
    this.meteorDebt += (ratePerHour / 3600) * dt * 24;
    while (this.meteorDebt >= 1 && this.meteors.length < 40) {
      this.meteorDebt -= 1;
      this.spawnMeteor();
    }

    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life -= dt;
      if (m.life <= 0) {
        this.meteorGroup.remove(m.line);
        m.line.geometry.dispose();
        this.meteors.splice(i, 1);
        continue;
      }
      const t = m.life / m.total;
      (m.line.material as LineBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.95;
    }
  }

  private spawnMeteor(): void {
    // Start somewhere in the upper sky and streak a short way across it.
    const ra = Math.random() * TAU;
    const dec = Math.asin(Math.random() * 0.9 + 0.05);
    const from = celestialToLocal(ra, dec, SPHERE_RADIUS * 0.97);
    const to = celestialToLocal(
      ra + (Math.random() - 0.5) * 0.28,
      dec - Math.random() * 0.22 - 0.04,
      SPHERE_RADIUS * 0.97,
    );

    const geo = new BufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]), 3),
    );
    const line = new Line(geo, this.meteorMaterial.clone());
    line.frustumCulled = false;
    line.renderOrder = -994;
    this.meteorGroup.add(line);
    this.meteors.push({ line, life: 0.55 + Math.random() * 0.5, total: 1 });
    this.meteors[this.meteors.length - 1].total = this.meteors[this.meteors.length - 1].life;
  }

  /** Where a constellation currently sits, for pointing a camera at it. */
  directionOf(c: Constellation, totalDays: number): Vector3 {
    const v = celestialToLocal(c.ra, c.dec, 1);
    const sidereal = (totalDays * (1 + 1 / 60)) * TAU;
    const cos = Math.cos(-sidereal);
    const sin = Math.sin(-sidereal);
    return new Vector3(v.x * cos - v.z * sin, v.y, v.x * sin + v.z * cos).normalize();
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.lines.geometry.dispose();
    this.lineMaterial.dispose();
    for (const m of this.meteors) {
      m.line.geometry.dispose();
      (m.line.material as LineBasicMaterial).dispose();
    }
    this.meteorMaterial.dispose();
    this.scene.remove(this.group);
  }
}

/** Right ascension and declination onto the local celestial sphere. */
function celestialToLocal(ra: number, dec: number, radius: number): Vector3 {
  return new Vector3(
    Math.cos(dec) * Math.cos(ra) * radius,
    Math.sin(dec) * radius,
    Math.cos(dec) * Math.sin(ra) * radius,
  );
}

export { SPHERE_RADIUS as STAR_SPHERE_RADIUS };
