/**
 * The water surface.
 *
 * The rest of the world is deliberately faceted. Water is not: a lake made of
 * flat coloured quads reads as a tiled floor, and the old one genuinely was
 * one — each quad carried its own height and its own colour and owned its six
 * vertices outright, so neighbouring quads at different levels terraced
 * against each other and the ripple animation pulled the surface apart at
 * every seam.
 *
 * This builds one continuous sheet per chunk with shared vertices, so the
 * ripple is a wave travelling across a surface rather than a set of squares
 * jittering independently. Everything that makes water look like water is
 * done in the shader, where it belongs: colour and opacity from how deep it
 * is, a Fresnel rim so the far side of a lake goes bright and the water at
 * your feet stays clear, moving specular highlights from the real sun
 * direction, and foam where the sheet runs out against the shore.
 */

import { Color, ShaderMaterial, Vector3 } from 'three';

export const WATER_VERT = /* glsl */ `
  uniform float uTime;

  attribute float aDepth;
  attribute float aFlow;

  varying float vDepth;
  varying float vFlow;
  varying vec3 vWorld;
  varying vec3 vNormal;

  /**
   * Three crossing swells. Returning the height and both slopes together means
   * the normal is the analytic derivative of the surface rather than something
   * recomputed from neighbouring triangles, which is what keeps a low-poly
   * grid from looking low-poly.
   */
  vec3 swell(vec2 p, float t) {
    float h = 0.0;
    float dx = 0.0;
    float dz = 0.0;

    // amplitude, wavelength, speed, direction
    const int COUNT = 3;
    vec2 dirs[COUNT];
    dirs[0] = normalize(vec2(1.0, 0.35));
    dirs[1] = normalize(vec2(-0.4, 1.0));
    dirs[2] = normalize(vec2(0.7, -0.8));
    float amps[COUNT];
    amps[0] = 0.055; amps[1] = 0.038; amps[2] = 0.022;
    float lens[COUNT];
    lens[0] = 0.21;  lens[1] = 0.34;  lens[2] = 0.62;
    float spds[COUNT];
    spds[0] = 0.9;   spds[1] = 1.3;   spds[2] = 2.1;

    for (int i = 0; i < COUNT; i++) {
      float phase = dot(p, dirs[i]) * lens[i] + t * spds[i];
      h += sin(phase) * amps[i];
      float d = cos(phase) * amps[i] * lens[i];
      dx += d * dirs[i].x;
      dz += d * dirs[i].y;
    }
    return vec3(h, dx, dz);
  }

  void main() {
    vDepth = aDepth;
    vFlow = aFlow;

    vec3 pos = position;
    vec3 s = swell(pos.xz, uTime);
    // Shallow water barely moves: a puddle is not an ocean.
    float reach = smoothstep(0.0, 1.4, aDepth);
    pos.y += s.x * reach;

    vNormal = normalize(vec3(-s.y * reach, 1.0, -s.z * reach));
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const WATER_FRAG = /* glsl */ `
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uNight;

  varying float vDepth;
  varying float vFlow;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    // Where the sheet has run out there is no water, and drawing it anyway
    // puts a transparent film on the bank that fights the ground for every
    // pixel. It ends here instead.
    if (vDepth < 0.03) discard;

    vec3 n = normalize(vNormal);
    vec3 view = normalize(cameraPosition - vWorld);

    // Deep water is darker and more its own colour; shallow water is mostly
    // whatever is underneath it, which is why it reads as see-through.
    float deepness = clamp(vDepth / 6.0, 0.0, 1.0);
    vec3 body = mix(uShallow, uDeep, deepness);

    // Looking straight down you see into it; looking along it you see the sky.
    float fresnel = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.0);
    vec3 colour = mix(body, uSkyColor, fresnel * 0.65);

    // A sun on the water. The sharp lobe is the glitter, the wide one is the
    // general brightening of a lit surface.
    vec3 h = normalize(uSunDir + view);
    float spec = pow(max(dot(n, h), 0.0), 220.0) * 1.4
               + pow(max(dot(n, h), 0.0), 18.0) * 0.16;
    colour += uSunColor * spec * (1.0 - uNight * 0.85);

    // White water where it is running, and a pale edge where the sheet thins
    // out against the shore.
    float shore = smoothstep(0.03, 0.10, vDepth) * (1.0 - smoothstep(0.10, 0.65, vDepth));
    float foam = max(shore * 0.55, vFlow * 0.35);
    colour = mix(colour, vec3(0.92, 0.96, 0.99), foam * 0.55);

    // Shallow water is see-through; deep water is not; foam is solid. The
    // very edge fades out entirely, so the water line is a water line rather
    // than a cut edge of geometry.
    float alpha = mix(0.40, 0.96, deepness);
    alpha = max(alpha, foam * 0.85);
    alpha *= smoothstep(0.03, 0.22, vDepth);
    gl_FragColor = vec4(colour, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface WaterUniforms {
  uTime: { value: number };
  uShallow: { value: Color };
  uDeep: { value: Color };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
  uSkyColor: { value: Color };
  uNight: { value: number };
}

export function makeWaterMaterial(): { material: ShaderMaterial; uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(0x4fa3c7) },
    uDeep: { value: new Color(0x10334f) },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(0xfff0d6) },
    uSkyColor: { value: new Color(0x9fc4de) },
    uNight: { value: 0 },
  };

  const material = new ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    transparent: true,
    depthWrite: false,
    // Nudged towards the camera so a sheet lying a centimetre above the mud
    // never ties with it in the depth buffer.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return { material, uniforms };
}
