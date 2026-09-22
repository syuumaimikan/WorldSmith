import { useState } from 'react';
import { Window } from '../components/common';

interface Props {
  worldName: string;
  onResume: () => void;
  onSave: () => Promise<void>;
  onSettings: () => void;
  onExit: () => void;
}

export function PausePanel({ worldName, onResume, onSave, onSettings, onExit }: Props): JSX.Element {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(null);
    try {
      await onSave();
      setSaved('Saved.');
    } catch (e) {
      setSaved(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Window title={worldName} onClose={onResume} width="narrow">
      <div className="menu-actions" style={{ width: '100%' }}>
        <button className="btn primary" onClick={onResume}>
          Resume
        </button>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save world'}
        </button>
        <button className="btn" onClick={onSettings}>
          Settings
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Leave this world and return to the menu? Unsaved progress will be lost.')) {
              onExit();
            }
          }}
        >
          Save and exit to menu
        </button>
      </div>
      {saved && (
        <div className="tiny muted" style={{ marginTop: 12, textAlign: 'center' }}>
          {saved}
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 16, lineHeight: 1.7 }}>
        <b>Controls</b>
        <br />
        WASD move · Shift run · Space jump · Right mouse look · Wheel zoom
        <br />
        E interact · F use tool · B build · Tab pack · M map · V camera
        <br />
        C settlement · J work · P production · T research · O overlay
        <br />
        ` pause · [ and ] change speed · F1 debug
      </div>
    </Window>
  );
}
