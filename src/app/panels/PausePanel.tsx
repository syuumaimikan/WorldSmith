import { useState } from 'react';
import { Window } from '../components/common';
import { useT } from '../../i18n';

interface Props {
  worldName: string;
  onResume: () => void;
  onSave: () => Promise<void>;
  onSettings: () => void;
  onTimeSkip: () => void;
  onExit: () => void;
}

export function PausePanel({
  worldName,
  onResume,
  onSave,
  onSettings,
  onTimeSkip,
  onExit,
}: Props): JSX.Element {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(null);
    try {
      await onSave();
      setSaved(t('pause.saved'));
    } catch (e) {
      setSaved(t('pause.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Window title={worldName} onClose={onResume} width="narrow">
      <div className="menu-actions" style={{ width: '100%' }}>
        <button className="btn primary" onClick={onResume}>
          {t('pause.resume')}
        </button>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('pause.saving') : t('pause.save')}
        </button>
        <button className="btn" onClick={onTimeSkip}>
          {t('skip.title')}
        </button>
        <button className="btn" onClick={onSettings}>
          {t('menu.settings')}
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(t('pause.exitConfirm'))) onExit();
          }}
        >
          {t('pause.exit')}
        </button>
      </div>
      {saved && (
        <div className="tiny muted" style={{ marginTop: 12, textAlign: 'center' }}>
          {saved}
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 16, lineHeight: 1.8, whiteSpace: 'pre-line' }}>
        <b>{t('pause.controls')}</b>
        {'\n'}
        {t('pause.controlsBody')}
      </div>
    </Window>
  );
}
