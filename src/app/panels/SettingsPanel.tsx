import { useEffect, useState } from 'react';
import { GameSettings } from '../../game/Game';
import { Tabs, Window } from '../components/common';
import { Action, DEFAULT_BINDINGS, Input } from '../../engine/Input';
import { loadBindings, saveBindings } from '../../persistence/settings';
import { QualityLevel } from '../../engine/Renderer';
import { LOCALES, Locale, getLocale, setLocale, useT } from '../../i18n';

interface Props {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  onClose: () => void;
  onRebind?: (action: Action, codes: string[]) => void;
}

type Tab = 'display' | 'controls' | 'game';

const QUALITIES: QualityLevel[] = ['low', 'medium', 'high'];

const ACTIONS: Action[] = Object.keys(DEFAULT_BINDINGS) as Action[];

export function SettingsPanel({ settings, onChange, onClose, onRebind }: Props): JSX.Element {
  const t = useT();
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
  const locale = getLocale();

  return (
    <Window title={t('settings.title')} onClose={onClose} width="narrow">
      <Tabs<Tab>
        tabs={[
          { id: 'display', label: t('settings.display') },
          { id: 'controls', label: t('settings.controls') },
          { id: 'game', label: t('settings.game') },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 14 }}>
        {tab === 'display' && (
          <>
            <div className="field">
              <label>{t('settings.language')}</label>
              <div className="choice-row">
                {LOCALES.map((l) => (
                  <button
                    key={l.id}
                    className={`choice ${locale === l.id ? 'active' : ''}`}
                    onClick={() => setLocale(l.id as Locale)}
                  >
                    {l.nativeLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>{t('settings.quality')}</label>
              <div className="choice-row">
                {QUALITIES.map((q) => (
                  <button
                    key={q}
                    className={`choice ${settings.quality === q ? 'active' : ''}`}
                    onClick={() => set({ quality: q })}
                  >
                    {t(`settings.quality.${q}`)}
                    <small>{t(`settings.quality.${q}.note`)}</small>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'controls' && (
          <>
            <div className="field">
              <label htmlFor="sens">
                {t('settings.sensitivity', { value: settings.mouseSensitivity.toFixed(2) })}
              </label>
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
                {t('settings.invertY')}
              </label>
            </div>

            <div className="section-label">{t('settings.bindings')}</div>
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              {t('settings.bindingsNote')}
            </div>
            <div className="list">
              {ACTIONS.map((action) => (
                <div className="list-row" key={action} style={{ gridTemplateColumns: '1fr 120px' }}>
                  <span>{t(`action.${action}`)}</span>
                  <button
                    className="btn small"
                    style={{ textAlign: 'center' }}
                    onClick={() => setListening(action)}
                  >
                    {listening === action
                      ? t('settings.pressKey')
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
              <label htmlFor="vol">
                {t('settings.volume', { value: Math.round(settings.masterVolume * 100) })}
              </label>
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
                {t('settings.autosave', {
                  value:
                    settings.autosaveMinutes === 0
                      ? t('settings.autosaveOff')
                      : t('settings.autosaveEvery', { n: settings.autosaveMinutes }),
                })}
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
                {t('settings.showTutorial')}
              </label>
            </div>
          </>
        )}
      </div>
    </Window>
  );
}
