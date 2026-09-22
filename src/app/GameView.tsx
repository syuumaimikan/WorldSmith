import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, GameSettings, HudSnapshot } from '../game/Game';
import { World } from '../sim/World';
import { Hud, PanelId } from './hud/Hud';
import { GodPanel } from './hud/GodPanel';
import { BuildPanel } from './panels/BuildPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { SettlementPanel } from './panels/SettlementPanel';
import { JobsPanel } from './panels/JobsPanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { ProductionPanel } from './panels/ProductionPanel';
import { MapPanel } from './panels/MapPanel';
import { ClimatePanel } from './panels/ClimatePanel';
import { ChroniclePanel } from './panels/ChroniclePanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { PausePanel } from './panels/PausePanel';
import { autosaveWorld, newSaveId, saveWorld } from '../persistence/saves';
import { loadBindings } from '../persistence/settings';
import { Action } from '../engine/Input';

interface Props {
  world: World;
  settings: GameSettings;
  onSettingsChange: (s: GameSettings) => void;
  onExit: () => void;
  saveId?: string;
}

/** Panels that take over keyboard input while open. */
const MODAL_PANELS: PanelId[] = [
  'inventory',
  'build',
  'settlement',
  'jobs',
  'research',
  'production',
  'map',
  'climate',
  'chronicle',
  'menu',
];

export function GameView({ world, settings, onSettingsChange, onExit, saveId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const idRef = useRef<string>(saveId ?? newSaveId());
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [panel, setPanel] = useState<PanelId>('none');
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootLabel, setBootLabel] = useState('Building the world');
  const [bootProgress, setBootProgress] = useState(0);

  // ---------------------------------------------------------------- mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new Game(world, container, settings);
    gameRef.current = instance;

    const bindings = loadBindings();
    for (const [action, codes] of Object.entries(bindings)) {
      instance.rebindAction(action as Action, codes);
    }

    instance.onHud = (snapshot) => {
      // Copy so React sees a new object and re-renders.
      setHud({ ...snapshot });
    };

    instance.onAutosave = () => {
      void autosaveWorld(world, idRef.current).catch((e) => console.warn('Autosave failed', e));
    };

    setGame(instance);

    // Build the scene across a couple of frames so the browser can paint the
    // progress text rather than freezing on a white screen.
    let cancelled = false;
    const boot = (): void => {
      if (cancelled) return;
      instance.warmUp((f, label) => {
        setBootProgress(f);
        setBootLabel(label);
      });
      if (cancelled) return;
      world.markExplored(world.player.position.x, world.player.position.z, 110);
      instance.start();
      setBooting(false);
    };
    const handle = window.setTimeout(boot, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      instance.dispose();
      gameRef.current = null;
    };
    // The game owns the world for its lifetime; remounting on settings change
    // would throw the whole scene away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ------------------------------------------------------------- settings
  useEffect(() => {
    gameRef.current?.applySettings(settings);
  }, [settings]);

  // --------------------------------------------------------- input capture
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.uiCapturesInput = MODAL_PANELS.includes(panel) || showSettings;
  }, [panel, showSettings, game]);

  // ------------------------------------------------------- keyboard panels
  const togglePanel = useCallback((next: PanelId) => {
    setPanel((cur) => (cur === next ? 'none' : next));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      switch (e.code) {
        case 'Tab':
          e.preventDefault();
          togglePanel('inventory');
          break;
        case 'KeyB':
          togglePanel('build');
          break;
        case 'KeyC':
          togglePanel('settlement');
          break;
        case 'KeyJ':
          togglePanel('jobs');
          break;
        case 'KeyT':
          togglePanel('research');
          break;
        case 'KeyP':
          togglePanel('production');
          break;
        case 'KeyM':
          togglePanel('map');
          break;
        case 'KeyK':
          togglePanel('climate');
          break;
        case 'F1':
          e.preventDefault();
          setShowDebug((v) => !v);
          break;
        case 'KeyG':
          // The game itself toggles god mode; this only nudges React to
          // re-render the panel on the same frame.
          setPanel('none');
          break;
        case 'Escape': {
          const g = gameRef.current;
          if (showSettings) setShowSettings(false);
          else if (panel !== 'none') setPanel('none');
          else if (g?.build.isPlacing) g.build.select(null);
          else setPanel('menu');
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, showSettings, togglePanel]);

  // ------------------------------------------------------------------ save
  const doSave = useCallback(async () => {
    await saveWorld(world, idRef.current);
  }, [world]);

  const exitWithSave = useCallback(() => {
    void saveWorld(world, idRef.current)
      .catch((e) => console.warn('Save on exit failed', e))
      .finally(onExit);
  }, [world, onExit]);

  const closePanel = useCallback(() => setPanel('none'), []);

  return (
    <>
      <div className="viewport" ref={containerRef} />

      {booting && (
        <div className="loading-screen">
          <div className="loading-stage">{bootLabel}</div>
          <div className="loading-bar">
            <div style={{ width: `${Math.round(bootProgress * 100)}%` }} />
          </div>
          <div className="loading-detail">{Math.round(bootProgress * 100)}%</div>
        </div>
      )}

      {game && hud && !booting && (
        <>
          <Hud
            game={game}
            hud={hud}
            panel={panel}
            onOpenPanel={togglePanel}
            showDebug={showDebug}
            tutorialDismissed={tutorialDismissed}
            onDismissTutorial={() => setTutorialDismissed(true)}
          />

          {hud.godActive && (
            <GodPanel game={game} hud={hud} onExit={() => game.toggleGodMode()} />
          )}

          {panel === 'build' && <BuildPanel game={game} onClose={closePanel} />}
          {panel === 'inventory' && <InventoryPanel game={game} onClose={closePanel} />}
          {panel === 'settlement' && <SettlementPanel game={game} onClose={closePanel} />}
          {panel === 'jobs' && <JobsPanel game={game} onClose={closePanel} />}
          {panel === 'research' && <ResearchPanel game={game} onClose={closePanel} />}
          {panel === 'production' && <ProductionPanel game={game} onClose={closePanel} />}
          {panel === 'map' && <MapPanel game={game} onClose={closePanel} />}
          {panel === 'climate' && <ClimatePanel game={game} onClose={closePanel} />}
          {panel === 'chronicle' && <ChroniclePanel game={game} onClose={closePanel} />}
          {panel === 'menu' && (
            <PausePanel
              worldName={world.config.name}
              onResume={closePanel}
              onSave={doSave}
              onSettings={() => setShowSettings(true)}
              onExit={exitWithSave}
            />
          )}

          {showSettings && (
            <SettingsPanel
              settings={settings}
              onChange={onSettingsChange}
              onClose={() => setShowSettings(false)}
              onRebind={(action, codes) => game.rebindAction(action, codes)}
            />
          )}
        </>
      )}
    </>
  );
}
