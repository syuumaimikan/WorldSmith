/**
 * Sky, sun, moon, clouds and the lighting rig they drive.
 *
 * Reference image 7 is the target: a clean vertical gradient, hard-edged flat
 * clouds, warm low sun, and fog whose colour is exactly the horizon colour so
 * distant land dissolves into the sky.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { clamp01, lerp, smoothstep, TAU } from '../core/math';
import { Rng } from '../core/rng';
import { PALETTE } from './Palette';
import { buildCloudGeometry } from './geometry/clouds';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'heavy_rain' | 'fog' | 'storm' | 'snow';

export interface SkyState {
  /** 0..1 through the day. 0 = midnight, 0.5 = noon. */
  timeOfDay: number;
  weather: WeatherKind;
  /** 0..1 blend into the current weather, so changes are not instant. */
  weatherBlend: number;
  /** -1..1 seasonal daylight skew; positive = long summer days. */
  daylightSkew: number;
}

const WEATHER_PARAMS: Record<
  WeatherKind,
  { cloudCover: number; sunScale: number; fogScale: number; desaturate: number; ambientScale: number }
> = {
  clear: { cloudCover: 0.16, sunScale: 1, fogScale: 1, desaturate: 0, ambientScale: 1 },
  cloudy: { cloudCover: 0.72, sunScale: 0.62, fogScale: 1.5, desaturate: 0.3, ambientScale: 1.05 },
  rain: { cloudCover: 0.92, sunScale: 0.34, fogScale: 2.6, desaturate: 0.5, ambientScale: 0.9 },
  heavy_rain: { cloudCover: 1, sunScale: 0.2, fogScale: 4.2, desaturate: 0.62, ambientScale: 0.8 },
  fog: { cloudCover: 0.5, sunScale: 0.4, fogScale: 6.5, desaturate: 0.55, ambientScale: 1.1 },
  storm: { cloudCover: 1, sunScale: 0.14, fogScale: 5, desaturate: 0.7, ambientScale: 0.7 },
  snow: { cloudCover: 0.86, sunScale: 0.45, fogScale: 3.4, desaturate: 0.4, ambientScale: 1.15 },
};

const SKY_VERT = `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunGlow;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float h = clamp(dir.y * 1.25 + 0.06, 0.0, 1.0);
  // Slight curve keeps the horizon band tight, like the reference sky.
  float t = pow(h, 0.62);
  vec3 col = mix(uHorizon, uZenith, t);
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 32.0) * uSunGlow * 0.85;
  col += uSunColor * pow(sd, 5.0) * uSunGlow * 0.14;
  gl_FragColor = vec4(col, 1.0);
}`;

export class SkySystem {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly moon: DirectionalLight;
  readonly sunDirection = new Vector3(0, 1, 0);

  private scene: Scene;
  private dome: Mesh;
  private domeMat: ShaderMaterial;
  private sunDisc: Mesh;
  private moonDisc: Mesh;
  private clouds: InstancedMesh;
  private cloudBase: { x: number; y: number; z: number; s: number; r: number }[] = [];
  private cloudDrift = 0;
  private stars: Points;
  private starMat: PointsMaterial;
  private fog: FogExp2;

  private horizonColor = new Color();
  private zenithColor = new Color();
  private tmpColor = new Color();
  private tmpColor2 = new Color();
  private mat4 = new Matrix4();
  private quat = new Quaternion();
  private vec = new Vector3();
  private scaleVec = new Vector3();

  /** 0 at night, 1 in full day. Read by gameplay for lamp lighting etc. */
  daylight = 1;
  cloudCover = 0.2;

  constructor(scene: Scene, seed: number, worldSize: number) {
    this.scene = scene;
    const rng = new Rng(seed ^ 0x5c1f);

    this.domeMat = new ShaderMaterial({
      uniforms: {
        uHorizon: { value: new Color(PALETTE.sky.dayHorizon) },
        uZenith: { value: new Color(PALETTE.sky.dayZenith) },
        uSunColor: { value: new Color(PALETTE.light.sun) },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunGlow: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(3000, 24, 16), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.matrixAutoUpdate = false;
    scene.add(this.dome);

    this.fog = new FogExp2(PALETTE.sky.dayHorizon, 0.0016);
    scene.fog = this.fog;
    scene.background = null;

    this.sun = new DirectionalLight(PALETTE.light.sun, 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -110;
    this.sun.shadow.camera.right = 110;
    this.sun.shadow.camera.top = 110;
    this.sun.shadow.camera.bottom = -110;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new DirectionalLight(PALETTE.light.moon, 0);
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.hemi = new HemisphereLight(PALETTE.light.hemiSky, PALETTE.light.hemiGround, 0.75);
    scene.add(this.hemi);

    const discMat = new MeshBasicMaterial({ color: PALETTE.light.sun, fog: false, depthWrite: false });
    this.sunDisc = new Mesh(new SphereGeometry(34, 10, 8), discMat);
    this.sunDisc.frustumCulled = false;
    this.sunDisc.renderOrder = -999;
    scene.add(this.sunDisc);

    const moonMat = new MeshBasicMaterial({ color: 0xe8eefc, fog: false, depthWrite: false });
    this.moonDisc = new Mesh(new SphereGeometry(22, 10, 8), moonMat);
    this.moonDisc.frustumCulled = false;
    this.moonDisc.renderOrder = -999;
    scene.add(this.moonDisc);

    // ------------------------------------------------------------- clouds
    const cloudGeo = buildCloudGeometry();
    const cloudMat = new MeshLambertMaterial({
      color: PALETTE.sky.cloud,
      flatShading: true,
      fog: false,
      transparent: true,
      opacity: 0.94,
    });
    const CLOUD_MAX = 160;
    this.clouds = new InstancedMesh(cloudGeo, cloudMat, CLOUD_MAX);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -900;
    this.clouds.castShadow = false;
    scene.add(this.clouds);

    const spread = Math.max(worldSize, 1200) * 1.5;
    for (let i = 0; i < CLOUD_MAX; i++) {
      this.cloudBase.push({
        x: rng.range(-spread, spread),
        y: rng.range(230, 420),
        z: rng.range(-spread, spread),
        s: rng.range(22, 62),
        r: rng.range(0, TAU),
      });
    }

    // -------------------------------------------------------------- stars
    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Upper hemisphere only.
      const u = rng.range(-1, 1);
      const phi = rng.range(0, TAU);
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.9 + 0.08;
      starPos[i * 3] = Math.cos(phi) * r * 2400;
      starPos[i * 3 + 1] = y * 2400;
      starPos[i * 3 + 2] = Math.sin(phi) * r * 2400;
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new BufferAttribute(starPos, 3));
    this.starMat = new PointsMaterial({
      color: 0xffffff,
      size: 9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.stars = new Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -995;
    scene.add(this.stars);
  }

  /**
   * @param focus the point the shadow frustum should centre on (the player).
   */
  update(state: SkyState, focus: Vector3, dt: number): void {
    const { timeOfDay, weather, daylightSkew } = state;

    // Sun arc. The seasonal skew lengthens summer days and shortens winter ones
    // by shifting the effective time the sun spends above the horizon.
    const a = (timeOfDay - 0.25) * TAU;
    const elevRaw = Math.sin(a);
    const elev = elevRaw >= 0 ? Math.pow(elevRaw, 1 - daylightSkew * 0.3) : -Math.pow(-elevRaw, 1 + daylightSkew * 0.3);
    this.sunDirection.set(Math.cos(a), elev * 1.05, -0.35).normalize();

    const rising = Math.cos(a) > 0;
    const day = clamp01(elev * 2.6);
    const twilight = smoothstep(-0.28, 0.16, elev) * (1 - smoothstep(0.16, 0.42, elev));
    const night = 1 - smoothstep(-0.16, 0.06, elev);
    this.daylight = day;

    const wp = WEATHER_PARAMS[weather];
    const blend = clamp01(state.weatherBlend);
    const clear = WEATHER_PARAMS.clear;
    const cloudCover = lerp(clear.cloudCover, wp.cloudCover, blend);
    const sunScale = lerp(clear.sunScale, wp.sunScale, blend);
    const fogScale = lerp(clear.fogScale, wp.fogScale, blend);
    const desat = lerp(0, wp.desaturate, blend);
    const ambientScale = lerp(1, wp.ambientScale, blend);
    this.cloudCover = cloudCover;

    // ------------------------------------------------------------- colours
    const twiZenith = rising ? PALETTE.sky.dawnZenith : PALETTE.sky.duskZenith;
    const twiHorizon = rising ? PALETTE.sky.dawnHorizon : PALETTE.sky.duskHorizon;

    this.zenithColor.setHex(PALETTE.sky.nightZenith);
    this.horizonColor.setHex(PALETTE.sky.nightHorizon);
    this.tmpColor.setHex(twiZenith);
    this.zenithColor.lerp(this.tmpColor, 1 - night);
    this.tmpColor.setHex(twiHorizon);
    this.horizonColor.lerp(this.tmpColor, 1 - night);
    this.tmpColor.setHex(PALETTE.sky.dayZenith);
    this.zenithColor.lerp(this.tmpColor, day);
    this.tmpColor.setHex(PALETTE.sky.dayHorizon);
    this.horizonColor.lerp(this.tmpColor, day);

    if (desat > 0) {
      this.tmpColor.setHex(PALETTE.sky.overcastZenith);
      this.zenithColor.lerp(this.tmpColor, desat * day);
      this.tmpColor.setHex(PALETTE.sky.overcastHorizon);
      this.horizonColor.lerp(this.tmpColor, desat * day);
    }

    (this.domeMat.uniforms.uHorizon.value as Color).copy(this.horizonColor);
    (this.domeMat.uniforms.uZenith.value as Color).copy(this.zenithColor);
    (this.domeMat.uniforms.uSunDir.value as Vector3).copy(this.sunDirection);
    this.domeMat.uniforms.uSunGlow.value = day * (1 - desat * 0.8) + twilight * 0.6;
    this.tmpColor2.setHex(rising ? PALETTE.light.sunDawn : PALETTE.light.sunDusk);
    this.tmpColor.setHex(PALETTE.light.sun);
    (this.domeMat.uniforms.uSunColor.value as Color).copy(this.tmpColor2).lerp(this.tmpColor, day);

    // Fog takes the horizon colour exactly so land dissolves into sky.
    this.fog.color.copy(this.horizonColor);
    this.fog.density = (0.00085 + (1 - day) * 0.0005) * fogScale;

    // -------------------------------------------------------------- lights
    const sunIntensity = Math.max(0, day) * 1.35 * sunScale;
    this.sun.intensity = sunIntensity;
    this.sun.color.copy(this.tmpColor2).lerp(this.tmpColor, clamp01(day * 1.4));
    this.sun.position
      .copy(focus)
      .addScaledVector(this.sunDirection, 190);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.visible = sunIntensity > 0.01;

    this.moon.intensity = night * 0.24;
    this.moon.position.copy(focus).addScaledVector(this.sunDirection, -190);
    this.moon.target.position.copy(focus);
    this.moon.target.updateMatrixWorld();
    this.moon.visible = this.moon.intensity > 0.005;

    const hemiIntensity = (0.28 + day * 0.58) * ambientScale;
    this.hemi.intensity = hemiIntensity;
    this.hemi.color.copy(this.zenithColor).lerp(this.tmpColor, 0.25);
    this.hemi.groundColor.setHex(PALETTE.light.hemiGround);

    // --------------------------------------------------------------- props
    this.dome.position.copy(focus);
    this.dome.updateMatrix();

    this.sunDisc.position.copy(focus).addScaledVector(this.sunDirection, 2200);
    this.sunDisc.visible = elev > -0.12;
    (this.sunDisc.material as MeshBasicMaterial).color
      .copy(this.tmpColor2)
      .lerp(this.tmpColor, clamp01(day * 1.4));

    this.moonDisc.position.copy(focus).addScaledVector(this.sunDirection, -2200);
    this.moonDisc.visible = elev < 0.12;

    this.starMat.opacity = night * 0.85 * (1 - cloudCover * 0.7);
    this.stars.position.copy(focus);
    this.stars.visible = this.starMat.opacity > 0.01;

    this.updateClouds(focus, cloudCover, day, dt);
  }

  private updateClouds(focus: Vector3, cover: number, day: number, dt: number): void {
    const count = Math.min(this.cloudBase.length, Math.round(this.cloudBase.length * cover));
    this.clouds.count = count;
    if (count === 0) {
      this.clouds.visible = false;
      return;
    }
    this.clouds.visible = true;

    this.cloudDrift += dt * 2.6;
    const wrap = 3000;
    const mat = this.clouds.material as MeshLambertMaterial;
    // Clouds catch the sun colour at dawn and dusk.
    mat.color.copy(this.horizonColor).lerp(this.tmpColor.setHex(PALETTE.sky.cloud), 0.35 + day * 0.5);
    mat.opacity = 0.55 + cover * 0.4;

    for (let i = 0; i < count; i++) {
      const b = this.cloudBase[i];
      let x = b.x + this.cloudDrift;
      x = ((((x - focus.x + wrap) % (wrap * 2)) + wrap * 2) % (wrap * 2)) - wrap + focus.x;
      let z = b.z;
      z = ((((z - focus.z + wrap) % (wrap * 2)) + wrap * 2) % (wrap * 2)) - wrap + focus.z;
      this.vec.set(x, b.y, z);
      this.quat.setFromAxisAngle(UP, b.r);
      this.scaleVec.set(b.s, b.s * 0.42, b.s);
      this.mat4.compose(this.vec, this.quat, this.scaleVec);
      this.clouds.setMatrixAt(i, this.mat4);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.dome, this.sunDisc, this.moonDisc, this.clouds, this.stars);
    this.scene.remove(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.clouds.geometry.dispose();
    (this.clouds.material as MeshLambertMaterial).dispose();
    this.stars.geometry.dispose();
    this.starMat.dispose();
  }
}

const UP = new Vector3(0, 1, 0);
