/**
 * The game loop and the bridge between simulation and presentation.
 *
 * Simulation advances on a fixed tick independent of frame rate. Speed
 * multipliers scale simulated time only — the player's own character always
 * moves in real time, so controlling them stays pleasant while the world around
 * them races ahead.
 *
 * React never drives the render loop. It subscribes to a snapshot published at
 * a fixed low rate, which keeps a busy HUD from costing frames.
 */

import { Scene, Vector3 } from 'three';
import { Renderer, QualityLevel } from '../engine/Renderer';
import { CameraController, CameraMode } from '../engine/CameraController';
import { Input, Action } from '../engine/Input';
import { SkySystem, SkyState } from '../render/Sky';
import { TerrainRenderer } from '../render/TerrainRenderer';
import { VegetationRenderer } from '../render/VegetationRenderer';
import { BuildingRenderer } from '../render/BuildingRenderer';
import { PileRenderer } from '../render/PileRenderer';
import { ThrownRenderer } from '../render/ThrownRenderer';
import { NpcRenderer } from '../render/NpcRenderer';
import { WildlifeRenderer } from '../render/WildlifeRenderer';
import { ParticleSystem } from '../render/Particles';
import { SkyfallRenderer } from '../render/SkyfallRenderer';
import { LandmarkRenderer } from '../render/LandmarkRenderer';
import { TownRenderer } from '../render/TownRenderer';
import { CharacterRig } from '../render/CharacterRig';
import { characterMaterial, lookFor } from '../render/geometry/character';
import { PALETTE } from '../render/Palette';
import { Season, TerrainTint } from '../render/TerrainColors';
import { World } from '../sim/World';
import { GameSpeed } from '../sim/Time';
import { clamp } from '../core/math';
import { BuildController, PlacementState } from './BuildController';
import {
  InteractTarget,
  applyToolWork,
  equipSlot,
  findTarget,
  interact,
  placeEquipped,
  storeInReach,
  throwEquipped,
  useEquipped,
} from './PlayerActions';
import { BuildingId } from '../data/buildings';
import { Overlay, OverlayRenderer } from '../render/OverlayRenderer';
import { AudioEngine } from '../audio/AudioEngine';
import { GodMode } from './GodMode';
import { BrushPreview } from '../render/BrushPreview';
import { StarField } from '../render/StarField';
import { t } from '../i18n';
import { professionColour, ProfessionId } from '../data/professions';
import type { WeatherKind } from '../sim/Weather';

const SIM_TICK = 1 / 15;
const MAX_TICKS_PER_FRAME = 10;
const HUD_INTERVAL = 0.1;

export interface GameSettings {
  quality: QualityLevel;
  mouseSensitivity: number;
  invertY: boolean;
  showTutorial: boolean;
  autosaveMinutes: number;
  masterVolume: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  mouseSensitivity: 1,
  invertY: false,
  showTutorial: true,
  autosaveMinutes: 5,
  masterVolume: 0.7,
};

/** Everything the React HUD needs, published at a fixed rate. */
export interface HudSnapshot {
  version: number;
  clock: string;
  /** Calendar parts rather than a formatted string: the HUD formats them in
   *  the player's own language. */
  year: number;
  month: number;
  dayOfMonth: number;
  season: Season;
  speed: GameSpeed;
  weather: WeatherKind;
  temperature: number;
  target: InteractTarget;
  placement: PlacementState | null;
  cameraMode: CameraMode;
  godActive: boolean;
  godPower: string | null;
  godRadius: number;
  godStrength: number;
  possessedName: string | null;
  fps: number;
  drawCalls: number;
  triangles: number;
  toast: string | null;
}

export class Game {
  readonly world: World;
  readonly scene = new Scene();
  readonly renderer: Renderer;
  readonly cameras: CameraController;
  readonly input: Input;
  readonly sky: SkySystem;
  readonly terrainRenderer: TerrainRenderer;
  readonly vegetation: VegetationRenderer;
  readonly buildingRenderer: BuildingRenderer;
  readonly pileRenderer: PileRenderer;
  readonly thrownRenderer: ThrownRenderer;
  readonly npcRenderer: NpcRenderer;
  readonly wildlifeRenderer: WildlifeRenderer;
  readonly particles: ParticleSystem;
  readonly landmarks: LandmarkRenderer;
  readonly towns: TownRenderer;
  private townCount = 0;
  readonly skyfall: SkyfallRenderer;
  readonly overlays: OverlayRenderer;
  readonly build: BuildController;
  readonly audio: AudioEngine;
  readonly god: GodMode;
  readonly brush: BrushPreview;
  readonly stars: StarField;

  settings: GameSettings;
  /** Set by the UI when a modal panel wants exclusive keyboard input. */
  uiCapturesInput = false;
  running = false;

  /** Published for React; mutated in place then version-bumped. */
  readonly hud: HudSnapshot;
  onHud: ((snapshot: HudSnapshot) => void) | null = null;
  onAutosave: (() => void) | null = null;
  /** Asks the interface to open a panel, for actions in the world that have one. */
  onOpenPanel: ((panel: string) => void) | null = null;

  private playerRig: CharacterRig;
  private charMaterial = characterMaterial();
  private raf = 0;
  private lastFrame = 0;
  private simAccumulator = 0;
  private hudAccumulator = 0;
  private focusPoint = new Vector3();
  private wishDir = new Vector3();
  private camForward = new Vector3();
  private camRight = new Vector3();
  private tint: TerrainTint;
  private hudVersion = 0;
  private toastText: string | null = null;
  private toastTimer = 0;
  private currentTarget: InteractTarget;
  private smokeTimer = 0;
  private autosaveTimer = 0;
  private discoveryTimer = 0;
  /** Snow cover the ground is currently painted with. */
  private snowShown = 0;
  private pickOrigin = new Vector3();
  private pickDir = new Vector3();

  constructor(world: World, container: HTMLElement, settings: GameSettings = DEFAULT_SETTINGS) {
    this.world = world;
    this.settings = settings;

    this.renderer = new Renderer(container);
    this.renderer.setQuality(settings.quality);

    this.cameras = new CameraController(this.renderer.width / this.renderer.height);
    this.cameras.setTerrain(world.terrain);

    this.input = new Input();
    this.input.attach(this.renderer.canvas);

    this.sky = new SkySystem(this.scene, world.config.seed, world.terrain.worldSize);

    const snap = world.time.snapshot();
    const season = snap.season as Season;
    this.tint = {
      season,
      seasonTempOffset: world.climate.groundTemperatureOffset(),
      snowCover: world.climate.snowCover(),
    };
    this.snowShown = this.tint.snowCover;

    const cold = world.config.climate === 'cold';
    this.terrainRenderer = new TerrainRenderer(world.terrain, this.scene, this.tint);
    this.vegetation = new VegetationRenderer(this.scene, world.terrain, season, cold);
    this.landmarks = new LandmarkRenderer(this.scene);
    this.landmarks.build(world.pois, world.terrain);
    this.towns = new TownRenderer(this.scene);
    this.towns.build(world.nations.allTowns, world.terrain);
    this.townCount = world.nations.allTowns.length;
    // A sinkhole can open a cave that was not there when the world loaded.
    world.onLandmarksChanged = () => this.landmarks.build(world.pois, world.terrain);
    this.buildingRenderer = new BuildingRenderer(this.scene, season);
    this.pileRenderer = new PileRenderer(this.scene);
    this.thrownRenderer = new ThrownRenderer(this.scene);
    this.npcRenderer = new NpcRenderer(this.scene);
    this.wildlifeRenderer = new WildlifeRenderer(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.skyfall = new SkyfallRenderer(this.scene);
    this.overlays = new OverlayRenderer(this.scene, world);
    this.build = new BuildController(this.scene, world, season);
    this.audio = new AudioEngine(settings.masterVolume);
    this.god = new GodMode(world);
    this.brush = new BrushPreview(this.scene);
    this.stars = new StarField(this.scene, world.astronomy, Math.min(2, window.devicePixelRatio || 1));

    const look = lookFor(PALETTE.cloak.player, world.config.seed, PALETTE.cloak.playerTrim);
    this.playerRig = new CharacterRig(look, this.charMaterial);
    this.scene.add(this.playerRig.root);

    world.player.focusPoint(this.focusPoint);
    this.cameras.snap(this.focusPoint);

    world.time.onNewSeason.push((s) => this.applySeason(s as Season));

    this.currentTarget = findTarget(world);

    if (import.meta.env.DEV) {
      // Handy for poking at a running world from the browser console.
      (window as unknown as { worldsmith?: Game }).worldsmith = this;
    }

    this.hud = {
      version: 0,
      clock: '',
      year: snap.year,
      month: snap.month,
      dayOfMonth: snap.dayOfMonth,
      season,
      speed: world.time.speed,
      weather: world.weather.current,
      temperature: 0,
      target: this.currentTarget,
      placement: null,
      cameraMode: 'third',
      godActive: false,
      godPower: null,
      godRadius: 30,
      godStrength: 0.5,
      possessedName: null,
      fps: 0,
      drawCalls: 0,
      triangles: 0,
      toast: null,
    };
  }

  /** Builds the scene up front so the world is fully populated on first frame. */
  warmUp(onProgress?: (fraction: number, label: string) => void): void {
    onProgress?.(0.05, 'Raising the terrain');
    this.terrainRenderer.buildAll((f) => onProgress?.(0.05 + f * 0.6, 'Raising the terrain'));
    onProgress?.(0.7, 'Planting the forests');
    this.vegetation.markDirty();
    this.vegetation.update(this.world.nodes, this.cameras.camera.position);
    onProgress?.(0.85, 'Waking the settlers');
    this.npcRenderer.update(this.world.npcs, this.cameras.camera.position, 0);
    this.wildlifeRenderer.update(this.world.wildlife, this.cameras.camera.position, 0);
    this.pileRenderer.update(this.world.piles, this.cameras.camera.position);
    this.buildingRenderer.update(this.world, this.cameras.camera.position, 0);
    onProgress?.(1, 'Ready');
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      try {
        this.frame(dt);
      } catch (err) {
        // One bad frame should not take the whole game down.
        console.error('[WorldSmith] frame error', err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number): void {
    const t0 = performance.now();

    this.handleInput(dt);
    this.updatePlayer(dt);

    const speed = this.world.time.speed as number;
    this.simAccumulator += dt * speed;
    // The ceiling has to rise with the speed, or the speed is a lie. At eight
    // times, a frame owes the world eight times as many ticks, and a fixed
    // ceiling of ten quietly threw the rest away -- so the clock crawled, the
    // meteor hung in the air, and the number in the corner said 8.
    const budget = Math.max(MAX_TICKS_PER_FRAME, Math.ceil(speed * 6));
    let ticks = 0;
    while (this.simAccumulator >= SIM_TICK && ticks < budget) {
      this.simAccumulator -= SIM_TICK;
      ticks++;
      this.world.simulate(SIM_TICK);
    }
    if (this.simAccumulator > SIM_TICK) this.simAccumulator = 0;

    // Everything the player can see runs on the same clock the world does:
    // at four times speed the wind, the water, the walking and the drifting
    // cloud all go four times as fast. Presentation running at wall-clock
    // speed while the world runs at eight is what makes a sped-up game look
    // like a slideshow of a fast world rather than a fast world.
    this.updatePresentation(dt * Math.max(1, speed));

    this.renderer.render(this.scene, this.cameras.camera, performance.now() - t0);
    this.input.endFrame();

    this.hudAccumulator += dt;
    if (this.hudAccumulator >= HUD_INTERVAL) {
      this.hudAccumulator = 0;
      this.publishHud();
    }

    this.autosaveTimer += dt;
    if (this.settings.autosaveMinutes > 0 && this.autosaveTimer > this.settings.autosaveMinutes * 60) {
      this.autosaveTimer = 0;
      this.onAutosave?.();
    }
  }

  // ----------------------------------------------------------------- input

  private handleInput(dt: number): void {
    const input = this.input;
    const free = !this.uiCapturesInput;

    if (free) {
      if (input.mouseDown(2)) {
        const invert = this.settings.invertY ? -1 : 1;
        this.cameras.rotate(input.deltaX, input.deltaY * invert, this.settings.mouseSensitivity);
      }
      if (input.wheel !== 0 && input.overViewport) this.cameras.zoom(input.wheel);

      if (input.wasPressed('cameraMode')) this.cycleCameraMode();
      if (input.wasPressed('speedUp')) this.cycleSpeed(1);
      if (input.wasPressed('speedDown')) this.cycleSpeed(-1);
      if (input.wasPressed('pause')) {
        this.world.time.speed = this.world.time.speed === 0 ? 1 : 0;
      }
      if (input.wasPressed('rotate') && this.build.isPlacing) this.build.rotate();
      if (input.wasPressed('overlayCycle')) this.overlays.cycle();
      if (input.wasPressed('godMode')) this.toggleGodMode();
    }

    // Movement relative to the camera's ground heading.
    this.wishDir.set(0, 0, 0);
    if (free) {
      this.cameras.groundForward(this.camForward);
      this.cameras.groundRight(this.camRight);
      if (input.isDown('moveForward')) this.wishDir.add(this.camForward);
      if (input.isDown('moveBack')) this.wishDir.sub(this.camForward);
      if (input.isDown('moveRight')) this.wishDir.add(this.camRight);
      if (input.isDown('moveLeft')) this.wishDir.sub(this.camRight);
    }

    // God mode flies the camera with the same keys, plus Q/E for altitude.
    if (this.god.active && !this.god.possessed) {
      const up = (input.isDown('ascend') ? 1 : 0) - (input.isDown('descend') ? 1 : 0);
      let fwd = 0;
      let rgt = 0;
      if (free) {
        if (input.isDown('moveForward')) fwd += 1;
        if (input.isDown('moveBack')) fwd -= 1;
        if (input.isDown('moveRight')) rgt += 1;
        if (input.isDown('moveLeft')) rgt -= 1;
      }
      this.cameras.flyGod(fwd, rgt, up, input.isDown('run'), dt);
      this.wishDir.set(0, 0, 0);
      this.updateGodCursor();
      if (free) this.handleGodClicks();
      return;
    }

    // In build and overview modes the camera pans instead of the player moving.
    if (this.cameras.mode === 'build' || this.cameras.mode === 'overview') {
      const panSpeed = this.cameras.distance * 1.1 * dt;
      if (this.wishDir.lengthSq() > 0) {
        this.cameras.pan(this.wishDir.x * panSpeed, this.wishDir.z * panSpeed);
        this.wishDir.set(0, 0, 0);
      }
    } else {
      this.cameras.clearPan();
    }

    // --- Placement -------------------------------------------------------
    if (free && this.build.isPlacing) {
      this.hud.placement = this.build.update(this.cameras.camera, input.ndcX, input.ndcY);
      if (input.mousePressed(0) && input.overViewport) this.build.beginDrag();
      if (input.mouseReleased(0)) {
        const placed = this.build.commit();
        if (placed > 0) {
          this.toast(
            placed === 1 ? t('build.blueprintPlaced') : t('build.sectionsPlaced', { count: placed }),
          );
          this.audio.play('place');
        } else if (!this.build.validNow) {
          this.toast(this.build.reasonNow || t('build.cannotBuildHere'));
        }
      }
      if (input.wasPressed('cancel') || input.mousePressed(1)) {
        this.build.select(null);
        this.hud.placement = null;
      }
    } else if (this.hud.placement) {
      this.hud.placement = null;
    }

    // --- World interaction ------------------------------------------------
    if (free && !this.build.isPlacing) {
      this.currentTarget = findTarget(this.world);

      if (input.wasPressed('interact')) {
        const result = interact(this.world, this.currentTarget);
        if (result.message) this.toast(result.message);
        if (result.kind === 'picked_up') this.audio.play('pickup');
        if (result.kind === 'stored') this.audio.play('store');
        // Standing at a finished storehouse opens its door: what went in can
        // now come out again, which it never could before.
        if (result.kind === 'stored' || result.kind === 'selected') {
          if (storeInReach(this.world)) this.onOpenPanel?.('store');
        }
      }

      if (input.isDown('useTool') && this.currentTarget.kind === 'node' && this.currentTarget.node) {
        const r = applyToolWork(this.world, this.currentTarget.node, dt);
        if (r.effect && r.x !== undefined && this.playerRig.impactThisFrame) {
          this.particles.emit(r.effect, r.x, r.y ?? 0, r.z ?? 0, 7);
          this.audio.play(r.effect === 'woodchips' ? 'chop' : 'mine');
        }
        if (r.message) this.toast(r.message);
      } else if (this.world.player.busyAction) {
        this.world.player.busyAction = null;
        this.world.player.busyTargetId = 0;
      }

      // --- The hands ------------------------------------------------------
      //
      // Number keys take something into the hand, F does whatever it is for,
      // and G puts one of it down where the player is looking. A tool only
      // speeds work while it is actually out.
      for (let slot = 0; slot < 6; slot++) {
        if (!input.keyPressed(`Digit${slot + 1}`)) continue;
        const r = equipSlot(this.world, slot);
        if (r.message) this.toast(r.message);
      }
      if (input.keyPressed('KeyF')) {
        const r = useEquipped(this.world);
        if (r.message) this.toast(r.message);
        if (r.kind === 'used') this.audio.play('pickup');
      }
      if (input.keyPressed('KeyT')) {
        // Thrown where the camera is pointed, at a slight lift, which is how
        // a person throws when they are not aiming at their own feet.
        const r = throwEquipped(this.world, this.cameras.pitch * -1 + 0.18);
        if (r.message) this.toast(r.message);
        if (r.kind === 'thrown') this.audio.play('pickup');
      }
      if (input.keyPressed('KeyG')) {
        // A pace in front of them, which is where a person puts things down.
        const p = this.world.player;
        const px = p.position.x + Math.sin(p.yaw) * 1.3;
        const pz = p.position.z + Math.cos(p.yaw) * 1.3;
        const r = placeEquipped(this.world, px, pz);
        if (r.message) this.toast(r.message);
        if (r.kind === 'placed') {
          this.audio.play('store');
          if (r.x !== undefined) this.particles.emit('dust', r.x, r.y ?? 0, r.z ?? 0, 4);
        }
      }

      if (input.mousePressed(0) && input.overViewport) this.pickUnderCursor();
    }
  }

  /** Ground point under the mouse, or null if the ray leaves the world. */
  private rayToGround(): { x: number; y: number; z: number } | null {
    const cam = this.cameras.camera;
    cam.getWorldPosition(this.pickOrigin);
    this.pickDir
      .set(this.input.ndcX, this.input.ndcY, 0.5)
      .unproject(cam)
      .sub(this.pickOrigin)
      .normalize();
    return this.world.terrain.raycast(
      this.pickOrigin.x, this.pickOrigin.y, this.pickOrigin.z,
      this.pickDir.x, this.pickDir.y, this.pickDir.z,
      4000,
    );
  }

  private pickUnderCursor(): void {
    const hit = this.rayToGround();
    if (!hit) return;

    let bestKind: 'npc' | 'building' | 'node' | null = null;
    let bestId = 0;
    let bestD = 3.2;

    this.world.npcGrid.forEachNear(hit.x, hit.z, 3.2, (n) => {
      const d = Math.hypot(n.x - hit.x, n.z - hit.z);
      if (d < bestD) {
        bestD = d;
        bestKind = 'npc';
        bestId = n.id;
      }
    });

    if (bestKind === null) {
      const tx = this.world.terrain.tileX(hit.x);
      const tz = this.world.terrain.tileZ(hit.z);
      const b = this.world.buildingAt(tx, tz);
      if (b) {
        bestKind = 'building';
        bestId = b.id;
      }
    }

    if (bestKind === null) {
      this.world.nodeGrid.forEachNear(hit.x, hit.z, 2.4, (n) => {
        if (n.depleted) return;
        const d = Math.hypot(n.x - hit.x, n.z - hit.z);
        if (d < bestD) {
          bestD = d;
          bestKind = 'node';
          bestId = n.id;
        }
      });
    }

    this.world.selection = bestKind ? { kind: bestKind, id: bestId } : null;
  }

  /** Where the god cursor is pointing, and the brush ring that shows it. */
  private updateGodCursor(): void {
    const hit = this.rayToGround();
    this.god.cursorValid = hit !== null;
    if (hit) this.god.cursor.set(hit.x, hit.y, hit.z);
    const power = this.god.currentPower;
    this.brush.update(
      this.god.active && !!power && !power.global && this.god.cursorValid,
      this.god.cursor,
      this.god.radius,
      this.world.terrain,
    );
  }

  private handleGodClicks(): void {
    const input = this.input;
    const power = this.god.currentPower;

    if (power?.global) {
      if (input.mousePressed(0) && input.overViewport) this.fireGodPower(0, 0);
      return;
    }

    if (power && this.god.cursorValid) {
      const held = power.continuous ? input.mouseDown(0) : input.mousePressed(0);
      if (held && input.overViewport) {
        this.fireGodPower(this.god.cursor.x, this.god.cursor.z);
      }
      return;
    }

    // With no power selected, clicking inspects and picks a target to possess.
    if (input.mousePressed(0) && input.overViewport) this.pickUnderCursor();
  }

  private fireGodPower(x: number, z: number): void {
    const id = this.god.apply(x, z);
    if (!id) return;
    this.toast(t('god.applied', { power: t(`god.power.${id}`) }));
    this.audio.play(id === 'earthquake' || id === 'meteor' ? 'mine' : 'place');
    // Terrain edits invalidate the vegetation and navigation caches.
    this.vegetation.markDirty();
  }

  toggleGodMode(): void {
    if (this.god.active) {
      this.god.release();
      this.god.active = false;
      this.god.selectPower(null);
      this.cameras.setMode('third');
      this.cameras.snap(this.focusPoint);
    } else {
      this.god.active = true;
      // Start the flight just above and behind where the player is standing.
      this.cameras.godPosition.copy(this.cameras.camera.position);
      this.cameras.godPosition.y += 12;
      this.cameras.setMode('god');
    }
  }

  /** Takes over the settler currently selected. */
  possessSelected(): boolean {
    const sel = this.world.selection;
    if (!sel || sel.kind !== 'npc') return false;
    const npc = this.world.npcById.get(sel.id);
    if (!npc) return false;
    this.god.possess(npc);
    this.god.selectPower(null);
    this.world.player.position.set(npc.x, npc.y, npc.z);
    this.world.player.velocity.set(0, 0, 0);
    this.world.player.yaw = npc.yaw;
    this.cameras.setMode('third');
    this.world.player.focusPoint(this.focusPoint);
    this.cameras.snap(this.focusPoint);
    this.rebuildPlayerLook(npc.profession);
    return true;
  }

  releasePossession(): void {
    if (!this.god.possessed) return;
    this.god.release();
    this.rebuildPlayerLook(null);
    if (this.god.active) {
      this.cameras.godPosition.copy(this.cameras.camera.position);
      this.cameras.godPosition.y += 10;
      this.cameras.setMode('god');
    }
  }

  /** Swaps the player body to a possessed settler's cloak, or back again. */
  private rebuildPlayerLook(profession: ProfessionId | null): void {
    const cloak = profession ? professionColour(profession) : PALETTE.cloak.player;
    const trim = profession ? undefined : PALETTE.cloak.playerTrim;
    const look = lookFor(cloak, this.world.config.seed, trim);
    this.scene.remove(this.playerRig.root);
    this.playerRig.dispose();
    this.playerRig = new CharacterRig(look, this.charMaterial);
    this.scene.add(this.playerRig.root);
  }

  private updatePlayer(dt: number): void {
    const player = this.world.player;
    const run = !this.uiCapturesInput && this.input.isDown('run');
    const jump = !this.uiCapturesInput && this.input.wasPressed('jump');

    const wish = player.busyAction ? ZERO : this.wishDir;
    player.update(dt, wish, run, jump, this.world.terrain, this.world.queryObstacles);

    if (player.wading && player.speed > 1.5 && Math.random() < dt * 8) {
      this.particles.emit('splash', player.position.x, player.position.y + 0.1, player.position.z, 3);
    }

    // A possessed settler's body follows the controls; everything about them
    // that the simulation cares about stays theirs.
    const host = this.god.possessedNpc;
    if (host) {
      host.x = player.position.x;
      host.z = player.position.z;
      host.y = player.position.y;
      host.yaw = player.yaw;
      host.speed = player.speed;
      host.activity = player.busyAction
        ? player.busyAction === 'chop'
          ? 'chopping'
          : player.busyAction === 'mine'
            ? 'mining'
            : 'farming'
        : player.speed > 0.2
          ? 'walking'
          : 'idle';
    }

    this.discoveryTimer += dt;
    if (this.discoveryTimer > 0.5) {
      this.discoveryTimer = 0;
      this.world.updateDiscovery(player.position.x, player.position.z);
    }
  }

  private cycleCameraMode(): void {
    const order: CameraMode[] = ['third', 'first', 'build', 'overview'];
    const next = order[(order.indexOf(this.cameras.mode) + 1) % order.length];
    this.cameras.setMode(next);
  }

  private cycleSpeed(dir: number): void {
    const opts: GameSpeed[] = [0, 1, 2, 4, 8];
    const i = opts.indexOf(this.world.time.speed);
    this.world.time.speed = opts[clamp(i + dir, 0, opts.length - 1)];
  }

  setSpeed(speed: GameSpeed): void {
    this.world.time.speed = speed;
  }

  setCameraMode(mode: CameraMode): void {
    this.cameras.setMode(mode);
  }

  selectBuilding(id: BuildingId | null): void {
    this.build.select(id);
    if (id && this.cameras.mode === 'third') this.cameras.setMode('build');
  }

  setOverlay(overlay: Overlay): void {
    this.overlays.set(overlay);
  }

  get overlay(): Overlay {
    return this.overlays.current;
  }

  /** Points the god camera at a place without moving the player. */
  lookAt(x: number, z: number): void {
    if (this.cameras.mode !== 'god') {
      this.focusOn(x, z);
      return;
    }
    const alt = Math.max(40, this.cameras.godAltitude());
    this.cameras.godPosition.set(x, this.world.terrain.heightAt(x, z) + alt, z + alt * 0.7);
    this.cameras.pitch = -0.85;
    this.vegetation.markDirty();
  }

  /** Moves the camera and player focus to a world position, used by the map. */
  focusOn(x: number, z: number): void {
    this.world.player.position.set(x, this.world.terrain.heightAt(x, z), z);
    this.world.player.velocity.set(0, 0, 0);
    this.world.player.focusPoint(this.focusPoint);
    this.cameras.snap(this.focusPoint);
    this.vegetation.markDirty();
  }

  /**
   * Where the eye is over the ground.
   *
   * In god mode the camera leaves the body behind, and the map went on
   * drawing the body: you could fly to the far corner of the world and the
   * marker never moved, which made the map look like it was of a different
   * and smaller world. This is the point the map should actually mark.
   */
  get viewPoint(): { x: number; z: number } {
    if (this.cameras.mode === 'god') {
      const c = this.cameras.camera.position;
      return { x: c.x, z: c.z };
    }
    const p = this.world.player.position;
    const pan = this.cameras.panned;
    return { x: p.x + pan.x, z: p.z + pan.z };
  }

  /** Which way the eye is facing, radians, for the map's view cone. */
  get viewYaw(): number {
    return this.cameras.yaw;
  }

  toast(message: string): void {
    this.toastText = message;
    this.toastTimer = 2.6;
  }

  // ---------------------------------------------------------- presentation

  /**
   * @param dt seconds of *presentation* time, already scaled by game speed.
   */
  private updatePresentation(dt: number): void {
    const world = this.world;
    const player = world.player;
    const camPos = this.cameras.camera.position;

    this.playerRig.root.position.copy(player.position);
    this.playerRig.root.rotation.y = player.yaw;
    this.playerRig.setState(
      player.busyAction === 'chop'
        ? 'chop'
        : player.busyAction === 'mine'
          ? 'mine'
          : player.busyAction === 'build'
            ? 'build'
            : player.busyAction === 'farm'
              ? 'farm'
              : player.speed > 0.2
                ? player.speed > 4.4
                  ? 'run'
                  : player.carriedWeightFraction() > 0.55
                    ? 'carry'
                    : 'walk'
                : 'idle',
    );
    this.playerRig.update(dt, player.speed);
    this.playerRig.root.visible = this.cameras.mode !== 'first';

    player.focusPoint(this.focusPoint);
    this.cameras.update(dt, this.focusPoint);
    this.renderer.resize(this.cameras.camera);

    const snap = world.time.snapshot();
    const skyState: SkyState = {
      timeOfDay: snap.timeOfDay,
      weather: world.weather.current,
      weatherBlend: world.weather.blend,
      daylightSkew: world.time.daylightSkew(),
    };
    // Where the moon actually is tonight, and how much of it is lit.
    const moment = world.astronomy.at(world.time);
    this.sky.moonBrightness = moment.moonIllumination;
    this.sky.moonDirection
      .set(Math.cos(moment.moonAzimuth), moment.moonAltitude * 1.05, -0.3)
      .normalize();
    this.sky.setEclipse(moment.eclipse);
    this.sky.setViewMatrix(this.cameras.camera.matrixWorldInverse.elements);
    this.sky.update(skyState, camPos, dt);

    // Water is lit by the same sun as everything else, and takes the colour of
    // the same sky, so it goes gold at dusk with the rest of the world.
    this.terrainRenderer.setSunlight(
      this.sky.sunDirection,
      this.sky.sun.color,
      this.sky.horizonColor,
      1 - this.sky.daylight,
    );

    this.stars.update(
      camPos,
      snap.totalHours / 24,
      1 - this.sky.daylight,
      this.sky.cloudCover,
      moment.meteorRate,
      dt,
    );

    this.terrainRenderer.update(camPos, dt, 4);
    this.vegetation.update(world.nodes, camPos);
    const nightFactor = 1 - this.sky.daylight;
    this.buildingRenderer.update(world, camPos, nightFactor);
    this.pileRenderer.update(world.piles, camPos);
    this.thrownRenderer.update(world.thrown);
    this.npcRenderer.setHidden(this.god.possessed);
    this.npcRenderer.update(world.npcs, camPos, dt);
    this.wildlifeRenderer.update(world.wildlife, camPos, dt);
    this.overlays.update(camPos, dt);

    this.updateSnowLine();
    this.emitAmbientEffects(dt, nightFactor);
    this.god.tick(dt);
    this.emitFireEffects(dt);
    this.particles.update(dt);
    this.skyfall.update(this.world.disasters.falling, this.particles, dt);
    this.audio.update(world, this.sky.daylight, dt);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastText = null;
    }
  }

  /** Chimney smoke, weather, and the details that sell a living world. */
  private emitAmbientEffects(dt: number, nightFactor: number): void {
    const world = this.world;
    const camPos = this.cameras.camera.position;

    this.smokeTimer += dt;
    if (this.smokeTimer > 0.5) {
      this.smokeTimer = 0;
      for (const b of world.buildings) {
        if (!b.complete) continue;
        const wantsSmoke = (b.def.housing ?? 0) > 0 || b.def.style === 'kiln' || b.def.style === 'workshop';
        if (!wantsSmoke) continue;
        if (b.residentIds.length === 0 && b.workerIds.length === 0) continue;
        const cold =
          world.terrain.temperatureAt(b.worldX, b.worldZ) + world.time.seasonalTemperatureOffset() < 9;
        if (!cold && nightFactor < 0.3) continue;
        if (Math.hypot(b.worldX - camPos.x, b.worldZ - camPos.z) > 180) continue;
        this.particles.emit(
          'smoke',
          b.worldX + b.footprintWidth * 0.4,
          b.groundY + b.def.height + 0.9,
          b.worldZ + b.footprintDepth * 0.2,
          1,
        );
      }

      for (const npc of world.npcs) {
        if (!npc.workAnim) continue;
        if (Math.hypot(npc.x - camPos.x, npc.z - camPos.z) > 70) continue;
        if (Math.random() > 0.45) continue;
        const effect =
          npc.activity === 'chopping'
            ? 'woodchips'
            : npc.activity === 'mining'
              ? 'stonedust'
              : npc.activity === 'building'
                ? 'dust'
                : null;
        if (effect) this.particles.emit(effect, npc.x, npc.y + 0.7, npc.z, 3);
      }
    }

    if (world.weather.isPrecipitating) {
      const isSnow = world.weather.current === 'snow';
      const heavy = world.weather.current === 'heavy_rain' || world.weather.current === 'storm';
      const n = Math.round((heavy ? 26 : 12) * dt * 60 * 0.03);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 22;
        this.particles.emit(
          isSnow ? 'leaves' : 'splash',
          camPos.x + Math.cos(a) * r,
          camPos.y + 12,
          camPos.z + Math.sin(a) * r,
          1,
        );
      }
    }

    if (this.tint.season === 'autumn' && Math.random() < dt * 4 && world.nodes.length > 0) {
      const node = world.nodes[Math.floor(Math.random() * world.nodes.length)];
      if (node && Math.hypot(node.x - camPos.x, node.z - camPos.z) < 60) {
        this.particles.emit('leaves', node.x, node.y + 4, node.z, 1);
      }
    }
  }

  /**
   * Repaints the ground when the snow line has genuinely moved. Rebuilding
   * every chunk is not cheap, so it waits for a change worth seeing rather
   * than chasing every hour's thaw.
   */
  private updateSnowLine(): void {
    const cover = this.world.climate.snowCover();
    const offset = this.world.climate.groundTemperatureOffset();
    if (
      Math.abs(cover - this.snowShown) < 0.05 &&
      Math.abs(offset - this.tint.seasonTempOffset) < 1.2
    ) {
      return;
    }
    this.snowShown = cover;
    this.tint = { ...this.tint, snowCover: cover, seasonTempOffset: offset };
    this.terrainRenderer.setTint(this.tint);
  }

  /** Flame and smoke above every active fire. */
  private emitFireEffects(dt: number): void {
    const camPos = this.cameras.camera.position;
    for (const f of this.world.disasters.fires) {
      if (Math.hypot(f.x - camPos.x, f.z - camPos.z) > 220) continue;
      const y = this.world.terrain.heightAt(f.x, f.z);
      if (Math.random() < dt * 22 * f.intensity) {
        this.particles.emit('sparks', f.x, y + 0.5, f.z, 2);
      }
      if (Math.random() < dt * 9) {
        this.particles.emit('smoke', f.x, y + 1.6, f.z, 1);
      }
    }
  }

  /**
   * Called once a time skip has finished.
   *
   * Centuries went by without a frame being drawn, so everything that is
   * cached from the world rather than read from it — the season's tint, the
   * snow line, the terrain colouring — is out of date and has to be rebuilt.
   */
  afterTimeSkip(): void {
    const season = this.world.time.snapshot().season as Season;
    this.tint = {
      season,
      seasonTempOffset: this.world.climate.groundTemperatureOffset(),
      snowCover: this.world.climate.snowCover(),
    };
    this.snowShown = this.tint.snowCover;
    this.terrainRenderer.setTint(this.tint);
    this.terrainRenderer.markAllDirty();
    this.vegetation.setSeason(season, this.world.config.climate === 'cold');
    this.buildingRenderer.setSeason(season);
    this.build.setSeason(season);
    this.publishHud();
  }

  private applySeason(season: Season): void {
    this.tint = {
      season,
      seasonTempOffset: this.world.climate.groundTemperatureOffset(),
      snowCover: this.world.climate.snowCover(),
    };
    this.snowShown = this.tint.snowCover;
    this.terrainRenderer.setTint(this.tint);
    this.vegetation.setSeason(season, this.world.config.climate === 'cold');
    this.buildingRenderer.setSeason(season);
    this.build.setSeason(season);
    this.world.log.add(this.world.time, 'settlement', 'ev.seasonArrives', { season }, { notable: true });
  }

  private publishHud(): void {
    // Towns are founded and emptied over years, so this is checked at the
    // rate the HUD updates rather than every frame, and rebuilt only when the
    // map of them has actually changed.
    const towns = this.world.nations.allTowns;
    if (towns.length !== this.townCount) {
      this.townCount = towns.length;
      this.towns.build(towns, this.world.terrain);
    }

    const snap = this.world.time.snapshot();
    const h = this.hud;
    h.version = ++this.hudVersion;
    h.clock = `${String(snap.hour).padStart(2, '0')}:${String(snap.minute).padStart(2, '0')}`;
    h.year = snap.year;
    h.month = snap.month;
    h.dayOfMonth = snap.dayOfMonth;
    h.season = snap.season as Season;
    h.speed = this.world.time.speed;
    h.weather = this.world.weather.current;
    h.temperature =
      this.world.terrain.temperatureAt(this.world.player.position.x, this.world.player.position.z) +
      this.world.time.seasonalTemperatureOffset();
    h.target = this.currentTarget;
    h.cameraMode = this.cameras.mode;
    h.godActive = this.god.active;
    h.godPower = this.god.selectedPower;
    h.godRadius = this.god.radius;
    h.godStrength = this.god.strength;
    h.possessedName = this.god.possessedNpc?.name ?? null;
    h.fps = this.renderer.stats.fps;
    h.drawCalls = this.renderer.stats.drawCalls;
    h.triangles = this.renderer.stats.triangles;
    h.toast = this.toastText;
    this.onHud?.(h);
  }

  applySettings(settings: GameSettings): void {
    this.settings = settings;
    this.renderer.setQuality(settings.quality);
    this.audio.setVolume(settings.masterVolume);
  }

  rebindAction(action: Action, codes: string[]): void {
    this.input.setBinding(action, codes);
  }

  dispose(): void {
    this.stop();
    this.input.detach();
    this.stars.dispose();
    this.brush.dispose();
    this.build.dispose();
    this.overlays.dispose();
    this.particles.dispose();
    this.wildlifeRenderer.dispose();
    this.npcRenderer.dispose();
    this.pileRenderer.dispose();
    this.thrownRenderer.dispose();
    this.buildingRenderer.dispose();
    this.vegetation.dispose();
    this.terrainRenderer.dispose();
    this.sky.dispose();
    this.playerRig.dispose();
    this.charMaterial.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}

const ZERO = new Vector3();

