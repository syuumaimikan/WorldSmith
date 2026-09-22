import { useEffect, useState } from 'react';
import { GameSettings } from '../../game/Game';
import { Tabs, Window } from '../components/common';
import { ACTION_LABELS, Action, DEFAULT_BINDINGS, Input } from '../../engine/Input';
import { loadBindings, saveBindings } from '../../persistence/settings';
import { QualityLevel } from '../../engine/Renderer';

interface Props {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  onClose: () => void;
  onRebind?: (action: Action, codes: string[]) => void;
}

type Tab = 'display' | 'controls' | 'game';

const QUALITIES: { id: QualityLevel; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'No shadows, 1x resolution' },
  { id: 'medium', label: 'Medium', note: 'Soft shadows, reduced resolution' },
  { id: 'high', label: 'High', note: 'Soft shadows, full resolution' },
];

export function SettingsPanel({ settings, onChange, onClose, onRebind }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('display');
  const [bindings, setBindings] = useState(() => loadBindings());
  const [listening, setListening] = useState<Action | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setListening(null);
        return;
      }
      const next = { ...bindings, [listening]: [e.code] };
      setBindings(next);
      saveBindings(next);
      onRebind?.(listening, [e.code]);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, bindings, onRebind]);

  const set = (patch: Partial<GameSettings>): void => onChange({ ...settings, ...patch });

  return (
    <Window title="Settings" onClose={onClose} width="narrow">
      <Tabs<Tab>
        tabs={[
          { id: 'display', label: 'Display' },
          { id: 'controls', label: 'Controls' },
          { id: 'game', label: 'Game' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 14 }}>
        {tab === 'display' && (
          <>
            <div className="field">
              <label>Graphics quality</label>
              <div className="choice-row">
                {QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    className={`choice ${settings.quality === q.id ? 'active' : ''}`}
                    onClick={() => set({ quality: q.id })}
                  >
                    {q.label}
                    <small>{q.note}</small>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'controls' && (
          <>
            <div className="field">
              <label htmlFor="sens">Mouse sensitivity — {settings.mouseSensitivity.toFixed(2)}x</label>
              <input
                id="sens"
                type="range"
                min={0.25}
                max={2.5}
                step={0.05}
                value={settings.mouseSensitivity}
                onChange={(e) => set({ mouseSensitivity: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={settings.invertY}
                  onChange={(e) => set({ invertY: e.target.checked })}
                />{' '}
                Invert vertical look
              </label>
            </div>

            <div className="section-label">Key bindings</div>
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              Click a binding then press a key. Escape cancels.
            </div>
            <div className="list">
              {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
                <div className="list-row" key={action} style={{ gridTemplateColumns: '1fr 110px' }}>
                  <span>{ACTION_LABELS[action]}</span>
                  <button
                    className="btn small"
                    style={{ textAlign: 'center' }}
                    onClick={() => setListening(action)}
                  >
                    {listening === action
                      ? 'press a key…'
                      : (bindings[action] ?? DEFAULT_BINDINGS[action]).map(Input.keyLabel).join(' / ')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'game' && (
          <>
            <div className="field">
              <label htmlFor="vol">Volume — {Math.round(settings.masterVolume * 100)}%</label>
              <input
                id="vol"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.masterVolume}
                onChange={(e) => set({ masterVolume: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="autosave">
                Autosave — {settings.autosaveMinutes === 0 ? 'off' : `every ${settings.autosaveMinutes} min`}
              </label>
              <input
                id="autosave"
                type="range"
                min={0}
                max={20}
                step={1}
                value={settings.autosaveMinutes}
                onChange={(e) => set({ autosaveMinutes: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showTutorial}
                  onChange={(e) => set({ showTutorial: e.target.checked })}
                />{' '}
                Show guidance prompts
              </label>
            </div>
          </>
        )}
      </div>
    </Window>
  );
}
