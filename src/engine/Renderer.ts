/**
 * WebGL renderer setup and frame statistics.
 *
 * Tone mapping, colour space and shadow settings come straight from the art
 * direction: ACES filmic at exposure 1.0 with soft PCF shadows, which is what
 * gives the reference look its soft, slightly filmic falloff without needing
 * any post-processing chain.
 */

import { ACESFilmicToneMapping, PCFSoftShadowMap, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { PerspectiveCamera } from 'three';

export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
}

export type QualityLevel = 'low' | 'medium' | 'high';

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly stats: RenderStats = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    geometries: 0,
    textures: 0,
  };

  private frameTimes: number[] = [];
  private lastStatsUpdate = 0;
  private quality: QualityLevel = 'high';
  private resizeObserver: ResizeObserver | null = null;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.gl = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.canvas = this.gl.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.onWindowResize);
  }

  private onWindowResize = (): void => this.resize();

  get width(): number {
    return Math.max(1, this.container.clientWidth);
  }

  get height(): number {
    return Math.max(1, this.container.clientHeight);
  }

  resize(camera?: PerspectiveCamera): void {
    const w = this.width;
    const h = this.height;
    this.gl.setSize(w, h, false);
    if (camera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    switch (level) {
      case 'low':
        this.gl.setPixelRatio(1);
        this.gl.shadowMap.enabled = false;
        break;
      case 'medium':
        this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        this.gl.shadowMap.enabled = true;
        this.gl.shadowMap.type = PCFSoftShadowMap;
        break;
      case 'high':
        this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.gl.shadowMap.enabled = true;
        this.gl.shadowMap.type = PCFSoftShadowMap;
        break;
    }
    this.gl.shadowMap.needsUpdate = true;
    this.resize();
  }

  get qualityLevel(): QualityLevel {
    return this.quality;
  }

  render(scene: Scene, camera: PerspectiveCamera, frameMs: number): void {
    this.gl.render(scene, camera);

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastStatsUpdate > 400) {
      this.lastStatsUpdate = now;
      let sum = 0;
      for (const t of this.frameTimes) sum += t;
      const avg = sum / Math.max(1, this.frameTimes.length);
      this.stats.frameMs = avg;
      this.stats.fps = avg > 0 ? 1000 / avg : 0;
      this.stats.drawCalls = this.gl.info.render.calls;
      this.stats.triangles = this.gl.info.render.triangles;
      this.stats.programs = this.gl.info.programs?.length ?? 0;
      this.stats.geometries = this.gl.info.memory.geometries;
      this.stats.textures = this.gl.info.memory.textures;
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.gl.dispose();
    this.canvas.remove();
  }
}
