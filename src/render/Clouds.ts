/**
 * Clouds.
 *
 * Everything else in this world is faceted on purpose. A cloud is the one
 * thing that cannot be: a low-poly blob reads as a lump of polystyrene, and
 * the old one did. These are camera-facing sheets with the cloud itself
 * evaluated in the fragment shader — layered value noise, drifting slowly,
 * eroded from the edges so there is no quad to see — and lit from the real
 * sun direction so a bank of them is bright along the lit side and grey
 * underneath, which is most of what makes a sky look like a sky.
 *
 * Many overlapping soft sheets is cheap and reads as depth. They never write
 * depth, so they layer over each other without cutting into anything.
 */

import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';

const CLOUD_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute float aOpacity;

  varying vec2 vUv;
  varying float vSeed;
  varying float vOpacity;
  varying float vDepth;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vOpacity = aOpacity;

    // The instance matrix carries where the cloud is; the quad itself is built
    // in view space so it always faces the camera however the head turns.
    vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec4 mv = viewMatrix * vec4(centre, 1.0);
    mv.xy += position.xy * aSize;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uSunView;
  uniform float uCover;
  uniform float uDay;

  varying vec2 vUv;
  varying float vSeed;
  varying float vOpacity;
  varying float vDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /** Four octaves is enough for a cloud and cheap enough for two hundred. */
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * amp;
      p = p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = vUv * 3.4 + vec2(vSeed * 37.0, vSeed * 19.0);
    // Two layers moving at different speeds: the cloud boils rather than
    // sliding, which is what stops it looking like a printed texture.
    float d = fbm(p + vec2(uTime * 0.012, uTime * 0.004));
    d = mix(d, fbm(p * 1.9 - vec2(uTime * 0.021, 0.0)), 0.35);

    // Eaten away from the rim, so the quad never shows.
    vec2 c = vUv - 0.5;
    float radial = 1.0 - smoothstep(0.16, 0.5, length(c));
    float density = clamp((d * radial - 0.30) * 2.6, 0.0, 1.0);
    // A thicker sky means fuller clouds, not merely more of them.
    density = clamp(density * (0.75 + uCover * 0.6), 0.0, 1.0);
    if (density <= 0.004) discard;

    // Lit from wherever the sun is: a fake normal pointing out of the sheet,
    // which gives a bright edge on the sun side and a grey base away from it.
    vec3 n = normalize(vec3(c * 2.0, 0.55));
    float lit = clamp(dot(n, normalize(uSunView)) * 0.5 + 0.5, 0.0, 1.0);
    // The thick middle of a cloud is darker than its edges.
    float thickness = 1.0 - density * 0.55;
    vec3 colour = mix(uShade, uLit, lit * thickness);
    colour = mix(colour, uLit, pow(lit, 6.0) * uDay * 0.6);

    // Distant clouds fade rather than ending abruptly at the far plane.
    float far = 1.0 - smoothstep(1600.0, 2600.0, vDepth);
    gl_FragColor = vec4(colour, density * vOpacity * far);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface Puff {
  x: number;
  y: number;
  z: number;
  size: number;
  /** How fast this one is carried along, relative to the wind. */
  drift: number;
}

const MAX_PUFFS = 220;

export class CloudLayer {
  private mesh: InstancedMesh;
  private material: ShaderMaterial;
  private puffs: Puff[] = [];
  private opacities: InstancedBufferAttribute;
  private scene: Scene;
  private drift = 0;
  private spread: number;

  private litColour = new Color();
  private shadeColour = new Color();
  private sunView = new Vector3();

  constructor(scene: Scene, seed: number, worldSize: number) {
    this.scene = scene;
    const rng = new Rng(seed ^ 0xc10d);
    this.spread = Math.max(worldSize, 1400) * 1.6;

    const geo = new PlaneGeometry(1, 1);
    const sizes = new Float32Array(MAX_PUFFS);
    const seeds = new Float32Array(MAX_PUFFS);
    const opacity = new Float32Array(MAX_PUFFS);

    for (let i = 0; i < MAX_PUFFS; i++) {
      // Clouds cluster: a few centres with a handful of sheets around each,
      // which is what makes a bank rather than an even scatter of dots.
      const size = rng.range(90, 260);
      this.puffs.push({
        x: rng.range(-this.spread, this.spread),
        y: rng.range(170, 330),
        z: rng.range(-this.spread, this.spread),
        size,
        drift: rng.range(0.7, 1.35),
      });
      sizes[i] = size;
      seeds[i] = rng.next();
      opacity[i] = rng.range(0.55, 0.95);
    }

    geo.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    this.opacities = new InstancedBufferAttribute(opacity, 1);
    geo.setAttribute('aOpacity', this.opacities);

    this.material = new ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: new Color(0xffffff) },
        uShade: { value: new Color(0x8a97a8) },
        uSunView: { value: new Vector3(0, 0, 1) },
        uCover: { value: 0.2 },
        uDay: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new InstancedMesh(geo, this.material, MAX_PUFFS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  /**
   * @param cover 0..1 how much of the sky is clouded.
   * @param day 0..1 how much daylight there is.
   * @param sunDir the sun's world direction, for which side is lit.
   * @param horizon the sky colour at the horizon, which clouds pick up.
   */
  update(
    focus: { x: number; z: number },
    cover: number,
    day: number,
    sunDir: Vector3,
    horizon: Color,
    viewMatrixElements: Float32Array | number[],
    dt: number,
  ): void {
    const count = Math.round(MAX_PUFFS * clamp01(cover));
    this.mesh.count = count;
    if (count === 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uCover.value = cover;
    this.material.uniforms.uDay.value = day;

    // Lit and shaded tones follow the sky, so clouds go pink at dawn with
    // everything else rather than staying stubbornly white.
    this.litColour.copy(horizon).lerp(WHITE, 0.45 + day * 0.35);
    this.shadeColour.copy(horizon).multiplyScalar(0.55).lerp(SLATE, 0.45);
    (this.material.uniforms.uLit.value as Color).copy(this.litColour);
    (this.material.uniforms.uShade.value as Color).copy(this.shadeColour);

    // The sun direction in view space, so the lit side is right whichever way
    // the camera is looking.
    const e = viewMatrixElements;
    this.sunView.set(
      e[0] * sunDir.x + e[4] * sunDir.y + e[8] * sunDir.z,
      e[1] * sunDir.x + e[5] * sunDir.y + e[9] * sunDir.z,
      e[2] * sunDir.x + e[6] * sunDir.y + e[10] * sunDir.z,
    );
    (this.material.uniforms.uSunView.value as Vector3).copy(this.sunView);

    this.drift += dt * 3.2;

    const span = this.spread * 2;
    for (let i = 0; i < count; i++) {
      const p = this.puffs[i];
      let x = p.x + this.drift * p.drift;
      // Wrap around the player rather than around the origin, so the sky is
      // never empty however far they have walked.
      x = ((((x - focus.x + this.spread) % span) + span) % span) - this.spread + focus.x;
      const z = p.z + focus.z;
      // The quad is built in view space, so all the instance matrix carries
      // is where in the world the cloud is.
      this.mesh.setMatrixAt(i, SCRATCH.makeTranslation(x, p.y, z));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const WHITE = new Color(0xffffff);
const SLATE = new Color(0x5d6675);
const SCRATCH = new Matrix4();
