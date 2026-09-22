/**
 * Sky, sun, moon, clouds and the lighting rig they drive.
 *
 * Reference image 7 is the target: a clean vertical gradient, hard-edged flat
 * clouds, warm low sun, and fog whose colour is exactly the horizon colour so
 * distant land dissolves into the sky.
 */

import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { clamp01, lerp, smoothstep, TAU } from '../core/math';
import { PALETTE } from './Palette';
import { CloudLayer } from './Clouds';

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

const MOON_VERT = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FRAG = `
varying vec3 vNormal;
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uDark;
uniform float uOpacity;
uniform float uEclipse;
void main() {
  // Straight Lambert against the sun: this is the phase, not a texture of one.
  float lit = dot(normalize(vNormal), normalize(uSunDir));
  float f = smoothstep(-0.06, 0.06, lit);
  vec3 col = mix(uDark, uLit, f);
  // A moon in the world's shadow goes the colour of every sunset at once.
  col = mix(col, vec3(0.42, 0.11, 0.08), uEclipse);
  gl_FragColor = vec4(col, uOpacity);
}
`;

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
  private moonMaterial: ShaderMaterial;
  /** Where the moon actually is, set by the astronomy each frame. */
  readonly moonDirection = new Vector3(0, -1, 0);
  private clouds: CloudLayer;

  private fog: FogExp2;
  /** The camera's view matrix, needed to light the clouds from the sun. */
  private viewElements: Float32Array | number[] = new Float32Array(16);

  /** The sky colour at the horizon. Water and clouds both pick it up. */
  readonly horizonColor = new Color();
  private zenithColor = new Color();
  private tmpColor = new Color();
  private tmpColor2 = new Color();

  /** 0 at night, 1 in full day. Read by gameplay for lamp lighting etc. */
  daylight = 1;
  /** 0..1 how much of the moon's disc is lit, set from the astronomy. */
  moonBrightness = 0;
  /** 0..1 how much of the sun is currently covered. */
  private solarEclipse = 0;
  cloudCover = 0.2;

  constructor(scene: Scene, seed: number, worldSize: number) {
    this.scene = scene;

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

    // The moon is a sphere lit from wherever the sun is, so the phase is not
    // drawn: it is what you get when you light a ball from one side.
    this.moonMaterial = new ShaderMaterial({
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      uniforms: {
        uSunDir: { value: new Vector3(1, 0, 0) },
        uLit: { value: new Color(0xe8eefc) },
        uDark: { value: new Color(0x11151f) },
        uOpacity: { value: 1 },
        uEclipse: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.moonDisc = new Mesh(new SphereGeometry(26, 24, 18), this.moonMaterial);
    this.moonDisc.frustumCulled = false;
    this.moonDisc.renderOrder = -999;
    scene.add(this.moonDisc);

    this.clouds = new CloudLayer(scene, seed, worldSize);
  }

  /**
   * Darkens the sun, or reddens the moon, while a real eclipse is under way.
   */
  setEclipse(eclipse: { kind: 'solar' | 'lunar'; magnitude: number } | null): void {
    this.solarEclipse = eclipse?.kind === 'solar' ? eclipse.magnitude : 0;
    this.moonMaterial.uniforms.uEclipse.value =
      eclipse?.kind === 'lunar' ? eclipse.magnitude : 0;
  }

  /**
   * @param focus the point the shadow frustum should centre on (the player).
   */
  /** Told each frame, so the lit side of a cloud is right as the head turns. */
  setViewMatrix(elements: Float32Array | number[]): void {
    this.viewElements = elements;
  }

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
    // An eclipse takes the sun away as surely as a cloud does, and faster.
    const eclipseDim = 1 - this.solarEclipse * 0.92;
    const sunIntensity = Math.max(0, day) * 1.35 * sunScale * eclipseDim;
    this.sun.intensity = sunIntensity;
    this.sun.color.copy(this.tmpColor2).lerp(this.tmpColor, clamp01(day * 1.4));
    this.sun.position
      .copy(focus)
      .addScaledVector(this.sunDirection, 190);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.visible = sunIntensity > 0.01;

    // Moonlight comes from where the moon is and is only as strong as the
    // lit fraction of it: a new moon lights nothing at all.
    const moonUp = this.moonDirection.y > 0;
    this.moon.intensity = night * 0.42 * this.moonBrightness * (moonUp ? 1 : 0.08);
    this.moon.position.copy(focus).addScaledVector(this.moonDirection, 190);
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

    // The moon goes where the astronomy puts it, not opposite the sun.
    this.moonDisc.position.copy(focus).addScaledVector(this.moonDirection, 2200);
    this.moonDisc.visible = this.moonDirection.y > -0.08 && night > 0.02;
    this.moonMaterial.uniforms.uSunDir.value.copy(this.sunDirection);
    this.moonMaterial.uniforms.uOpacity.value = clamp01(night * 1.6) * (1 - cloudCover * 0.8);


    this.clouds.update(
      focus,
      cloudCover,
      day,
      this.sunDirection,
      this.horizonColor,
      this.viewElements,
      dt,
    );
  }

  dispose(): void {
    this.clouds.dispose();
    this.scene.remove(this.dome, this.sunDisc, this.moonDisc);
    this.scene.remove(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.moonMaterial.dispose();
  }
}

