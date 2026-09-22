/**
 * Audio, synthesised rather than loaded.
 *
 * There are no sound files to ship or fail to load: chops, picks, footsteps and
 * ambience are all generated with the Web Audio API. If audio is unavailable
 * for any reason the whole engine degrades to silent no-ops rather than
 * throwing — sound must never be able to break the game.
 */

import type { World } from '../sim/World';
import { Biome } from '../world/types';

export type Sfx = 'chop' | 'mine' | 'place' | 'pickup' | 'store' | 'complete' | 'error' | 'hammer';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private volume: number;
  private enabled = true;
  private lastBirdCall = 0;
  private elapsed = 0;
  private resumeHooked = false;

  constructor(volume = 0.7) {
    this.volume = volume;
    this.tryInit();
  }

  private tryInit(): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0;
      this.ambientGain.connect(this.master);

      this.startWind();
      this.hookResume();
    } catch {
      this.enabled = false;
      this.ctx = null;
    }
  }

  /** Browsers block audio until the user interacts; resume on the first input. */
  private hookResume(): void {
    if (this.resumeHooked) return;
    this.resumeHooked = true;
    const resume = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume, { passive: true });
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise reads as wind far better than white noise.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  private startWind(): void {
    if (!this.ctx || !this.ambientGain) return;
    const buffer = this.noiseBuffer(4);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.4;

    src.connect(filter);
    filter.connect(this.ambientGain);
    src.start();

    this.windSource = src;
    this.windFilter = filter;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Adjusts ambience to where the player is standing and what time it is. */
  update(world: World, daylight: number, dt: number): void {
    if (!this.ctx || !this.ambientGain || !this.enabled) return;
    this.elapsed += dt;

    const p = world.player.position;
    const biome = world.terrain.biomeAt(p.x, p.z);
    const altitude = world.terrain.heightAt(p.x, p.z);

    // Wind: stronger high up, in storms, and in open country.
    const exposure = biome === Biome.Alpine || biome === Biome.Mountain || biome === Biome.Tundra ? 1 : 0.45;
    const target = (0.035 + exposure * 0.05 + world.weather.severity * 0.16) * this.volume;
    const gain = this.ambientGain.gain;
    gain.value += (target - gain.value) * Math.min(1, dt * 1.5);

    if (this.windFilter) {
      const freq = 280 + exposure * 320 + altitude * 1.2 + world.weather.severity * 700;
      this.windFilter.frequency.value += (freq - this.windFilter.frequency.value) * Math.min(1, dt * 2);
    }

    // Birdsong in wooded daylight, when it is not pouring.
    const wooded =
      biome === Biome.TemperateForest ||
      biome === Biome.DenseForest ||
      biome === Biome.Grassland ||
      biome === Biome.Wetland;
    if (wooded && daylight > 0.35 && world.weather.severity < 0.35) {
      if (this.elapsed - this.lastBirdCall > 2.5 + Math.random() * 6) {
        this.lastBirdCall = this.elapsed;
        this.birdCall();
      }
    }
  }

  private birdCall(): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const base = 1800 + Math.random() * 1400;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.7), t + 0.08);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.035 * this.volume, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /** One-shot effects, all synthesised. */
  play(sfx: Sfx): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    if (this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;

    switch (sfx) {
      case 'chop':
      case 'hammer': {
        this.thump(now, sfx === 'chop' ? 180 : 320, 0.1, 0.22);
        this.noiseBurst(now, 2400, 0.05, 0.1);
        break;
      }
      case 'mine': {
        this.thump(now, 130, 0.12, 0.18);
        this.noiseBurst(now, 3600, 0.07, 0.14);
        break;
      }
      case 'place': {
        this.tone(now, 440, 0.09, 0.08, 'triangle');
        this.tone(now + 0.07, 660, 0.12, 0.07, 'triangle');
        break;
      }
      case 'pickup': {
        this.tone(now, 660, 0.06, 0.06, 'sine');
        this.tone(now + 0.05, 880, 0.08, 0.05, 'sine');
        break;
      }
      case 'store': {
        this.thump(now, 220, 0.08, 0.12);
        break;
      }
      case 'complete': {
        this.tone(now, 523, 0.16, 0.09, 'triangle');
        this.tone(now + 0.12, 659, 0.16, 0.09, 'triangle');
        this.tone(now + 0.24, 784, 0.3, 0.1, 'triangle');
        break;
      }
      case 'error': {
        this.tone(now, 180, 0.16, 0.08, 'square');
        break;
      }
    }
  }

  private tone(at: number, freq: number, duration: number, level: number, type: OscillatorType): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level * this.volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private thump(at: number, freq: number, duration: number, level: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, at + duration);
    gain.gain.setValueAtTime(level * this.volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private noiseBurst(at: number, cutoff: number, duration: number, level: number): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.noiseBuffer(Math.max(0.05, duration));
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 1.1;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level * this.volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(at);
    src.stop(at + duration + 0.02);
  }

  dispose(): void {
    try {
      this.windSource?.stop();
    } catch {
      /* already stopped */
    }
    this.windSource = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
