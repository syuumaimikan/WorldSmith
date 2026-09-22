import { useCallback, useEffect, useRef, useState } from 'react';
import { MainMenu } from './screens/MainMenu';
import { NewWorldScreen } from './screens/NewWorldScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { GameView } from './GameView';
import { assembleWorld, generate, GenerationProgress, makeConfig, NewWorldOptions } from '../game/WorldLoader';
import { World } from '../sim/World';
import { GameSettings } from '../game/Game';
import { SettingsPanel } from './panels/SettingsPanel';
import { loadSettings, saveSettings } from '../persistence/settings';
import { deleteSave, listSaves, loadWorld, SaveSummary } from '../persistence/saves';

type Screen = 'menu' | 'new' | 'loading' | 'playing' | 'error';

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('menu');
  const [progress, setProgress] = useState<GenerationProgress>({ stage: 'Preparing', fraction: 0 });
  const [world, setWorld] = useState<World | null>(null);
  const [saveId, setSaveId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string>('');
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const generating = useRef(false);

  const refreshSaves = useCallback(() => {
    listSaves()
      .then(setSaves)
      .catch((e) => console.warn('Could not list saves', e));
  }, []);

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const startNewWorld = useCallback(
    async (options: NewWorldOptions) => {
      if (generating.current) return;
      generating.current = true;
      setScreen('loading');
      setProgress({ stage: 'Preparing', fraction: 0 });
      try {
        const config = makeConfig(options);
        const payload = await generate(config, setProgress);
        setProgress({ stage: 'Waking the world', fraction: 1 });
        const w = await assembleWorld(config, payload, setProgress);
        // Let the loading screen paint its final state before the heavy
        // scene build starts on the same thread.
        await new Promise((r) => setTimeout(r, 30));
        setSaveId(undefined);
        setWorld(w);
        setScreen('playing');
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e));
        setScreen('error');
      } finally {
        generating.current = false;
      }
    },
    [],
  );

  const continueSave = useCallback(async (id: string) => {
    if (generating.current) return;
    generating.current = true;
    setScreen('loading');
    setProgress({ stage: 'Reading the chronicle', fraction: 0.2 });
    try {
      const w = await loadWorld(id, (f) => setProgress({ stage: 'Restoring the world', fraction: f }));
      await new Promise((r) => setTimeout(r, 30));
      setSaveId(id.startsWith('auto:') ? id.slice(5) : id);
      setWorld(w);
      setScreen('playing');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e));
      setScreen('error');
    } finally {
      generating.current = false;
    }
  }, []);

  const exitToMenu = useCallback(() => {
    setWorld(null);
    setScreen('menu');
    refreshSaves();
  }, [refreshSaves]);

  return (
    <div className="app">
      {screen === 'menu' && (
        <MainMenu
          saves={saves}
          onNew={() => setScreen('new')}
          onContinue={continueSave}
          onDeleteSave={(id) => deleteSave(id).then(refreshSaves)}
          onSettings={() => setShowSettings(true)}
        />
      )}

      {screen === 'new' && (
        <NewWorldScreen onCancel={() => setScreen('menu')} onCreate={startNewWorld} />
      )}

      {screen === 'loading' && <LoadingScreen progress={progress} />}

      {screen === 'playing' && world && (
        <GameView
          world={world}
          settings={settings}
          onSettingsChange={setSettings}
          onExit={exitToMenu}
          saveId={saveId}
        />
      )}

      {screen === 'error' && (
        <div className="menu-screen">
          <div className="title-block">
            <h1 className="title">
              World<em>Smith</em>
            </h1>
            <div className="subtitle">Something went wrong</div>
          </div>
          <div className="error-box">{error}</div>
          <button className="btn primary" style={{ width: 200 }} onClick={() => setScreen('menu')}>
            Back to menu
          </button>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
