/**
 * Rain and snow you can actually see.
 *
 * The sky already darkened, the fog already thickened and the sun already
 * dimmed when the weather turned -- but a dozen particles a second scattered
 * within twenty metres of the camera is not rain, it is a rumour of rain, and
 * the honest complaint was that nothing changed.
 *
 * This is the standard and correct way to draw weather: one box of points
 * that travels with the camera, with every drop's position computed in the
 * vertex shader from its own seed and a single time uniform, wrapped back to
 * the top of the box when it falls out of the bottom. Nothing is simulated on
 * the processor, nothing is allocated per frame, and ten thousand drops cost
 * one draw call.
 *
 * Rain is drawn as a streak rather than a dot because that is what a falling
 * drop looks like to an eye with any persistence at all, and the streak leans
 * with the wind, which is the thing that makes weather read as weather rather
 * than as a screen effect.
 */

import {
  AdditiveBlending,
  NormalBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { WeatherKind } from './Sky';

/**
 * Half-width of the box of weather that follows the camera, in metres.
 *
 * Small on purpose. Rain is only legible near the eye -- past twenty metres
 * it is haze, which the fog is already doing -- so spending drops out there
 * buys nothing and thins out the ones that count.
 */
const EXTENT = 19;

/** Height of the box. Drops wrap from the bottom back to the top. */
const HEIGHT = 24;

/** The most drops ever drawn. Intensity is expressed by drawing fewer. */
const MAX_DROPS = 14000;

export interface PrecipitationState {
  kind: WeatherKind;
  /** 0..1, how hard it is coming down. */
  intensity: number;
  /** Metres per second, in world units, for the lean and the drift. */
  wind: Vector3;
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uWind;
  uniform float uFall;      // metres per second downward
  uniform float uExtent;
  uniform float uHeight;
  uniform float uSize;
  uniform float uCount;     // how many of the drops are in use
  uniform float uSway;      // lateral wander, for snow

  attribute vec3 seed;      // 0..1 per drop: start position and phase

  varying float vAlive;

  void main() {
    // A drop only exists when its index is under the current count, which is
    // how intensity is expressed without touching a buffer.
    float index = seed.z * 10000.0;
    vAlive = step(index, uCount);

    // The box is anchored to the camera and snapped to its own grid, so it
    // travels without the drops appearing to slide sideways with the view.
    vec3 base = vec3(
      (seed.x - 0.5) * 2.0 * uExtent,
      seed.y * uHeight,
      (seed.z - 0.5) * 2.0 * uExtent
    );

    // Fall, wrapped. The modulo is what makes an endless downpour out of a
    // fixed number of points.
    float fallen = uTime * uFall;
    float y = uHeight - mod(uHeight - base.y + fallen, uHeight);

    // Carried by the wind on the way down, and -- for snow -- wandering.
    float age = mod(uHeight - base.y + fallen, uHeight) / max(0.001, uFall);
    vec3 drift = uWind * age;
    float sway = uSway * sin(uTime * 1.7 + seed.x * 31.4) * (0.4 + seed.y);

    vec3 world = vec3(
      base.x + drift.x + sway,
      y,
      base.z + drift.z
    );

    // Wrap back into the box around the camera. Snapping the anchor to whole
    // metres stops the whole field shimmering as the camera moves.
    vec3 anchor = floor(uCamera);
    world.x = mod(world.x - anchor.x + uExtent, uExtent * 2.0) - uExtent + anchor.x;
    world.z = mod(world.z - anchor.z + uExtent, uExtent * 2.0) - uExtent + anchor.z;
    world.y += anchor.y - uHeight * 0.35;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uStreak;   // 0 for a flake, 1 for a streak
  varying float vAlive;

  void main() {
    if (vAlive < 0.5) discard;
    vec2 p = gl_PointCoord - 0.5;
    // A streak is a point squashed along x, which is what a falling drop
    // looks like; a flake stays round.
    p.x /= mix(1.0, 0.16, uStreak);
    float d = length(p);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(uColour, uOpacity * edge);
  }
`;

export class Precipitation {
  private scene: Scene;
  private points: Points;
  private material: ShaderMaterial;
  private elapsed = 0;
  private colour = new Color();

  constructor(scene: Scene) {
    this.scene = scene;

    const geometry = new BufferGeometry();
    const seeds = new Float32Array(MAX_DROPS * 3);
    const positions = new Float32Array(MAX_DROPS * 3);
    for (let i = 0; i < MAX_DROPS; i++) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      // The third component doubles as the drop's index, scaled, so the
      // shader can decide whether this drop is in use.
      seeds[i * 3 + 2] = i / 10000;
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new BufferAttribute(seeds, 3));
    // The box is anchored to the camera, so frustum culling by the geometry's
    // own (empty) bounds would remove it entirely.
    geometry.boundingSphere = null;

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCamera: { value: new Vector3() },
        uWind: { value: new Vector3() },
        uFall: { value: 14 },
        uExtent: { value: EXTENT },
        uHeight: { value: HEIGHT },
        uSize: { value: 2.2 },
        uCount: { value: 0 },
        uSway: { value: 0 },
        uColour: { value: new Color(0.72, 0.8, 0.92) },
        uOpacity: { value: 0.5 },
        uStreak: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });

    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'precipitation';
    this.points.renderOrder = 6;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(dt: number, state: PrecipitationState, cameraPos: Vector3): void {
    const u = this.material.uniforms;
    const falling = state.intensity > 0.01 && FALLS.has(state.kind);
    this.points.visible = falling;
    if (!falling) return;

    this.elapsed += dt;
    u.uTime.value = this.elapsed;
    (u.uCamera.value as Vector3).copy(cameraPos);

    const snow = state.kind === 'snow';
    // Rain falls at something near its terminal velocity; snow does not fall
    // so much as descend, which is why a snowfall reads as calm and a
    // downpour as violent even at the same density.
    u.uFall.value = snow ? 1.6 : 15 + state.intensity * 9;
    u.uSway.value = snow ? 1.6 : 0.1;
    u.uStreak.value = snow ? 0 : 1;
    u.uSize.value = snow ? 3.4 : 2.6;
    u.uOpacity.value = snow ? 0.85 : 0.36 + state.intensity * 0.2;

    // Snow is white; rain takes the colour of the light it is falling
    // through, which is why it looks grey rather than blue.
    this.colour.setRGB(snow ? 1 : 0.74, snow ? 1 : 0.8, snow ? 1 : 0.9);
    (u.uColour.value as Color).copy(this.colour);

    // Wind both leans the fall and, for snow, carries it a long way sideways.
    (u.uWind.value as Vector3).copy(state.wind).multiplyScalar(snow ? 1.1 : 0.55);

    // The shader recovers each drop's own index from its seed, so this is a
    // plain count of drops.
    u.uCount.value = MAX_DROPS * state.intensity;

    this.material.blending = snow ? AdditiveBlending : NormalBlending;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** The weathers that actually put something in the air. */
const FALLS = new Set<WeatherKind>(['rain', 'heavy_rain', 'storm', 'snow']);
