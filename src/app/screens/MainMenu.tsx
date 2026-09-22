import { SaveSummary } from '../../persistence/saves';

interface Props {
  saves: SaveSummary[];
  onNew: () => void;
  onContinue: (id: string) => void;
  onDeleteSave: (id: string) => void;
  onSettings: () => void;
}

export function MainMenu({ saves, onNew, onContinue, onDeleteSave, onSettings }: Props): JSX.Element {
  const latest = saves[0];

  return (
    <div className="menu-screen">
      <div className="title-block">
        <h1 className="title">
          World<em>Smith</em>
        </h1>
        <div className="subtitle">Nothing here is built in a moment</div>
      </div>

      <div className="menu-actions">
        <button className="btn primary" onClick={onNew}>
          New World
        </button>
        {latest && (
          <button className="btn" onClick={() => onContinue(latest.id)}>
            Continue — {latest.name}
            <div className="tiny muted" style={{ marginTop: 3 }}>
              Year {latest.year}, day {latest.day} · {latest.population} settlers ·{' '}
              {latest.buildings} buildings
            </div>
          </button>
        )}
        <button className="btn ghost" onClick={onSettings}>
          Settings
        </button>
      </div>

      {saves.length > 0 && (
        <div className="panel form-card" style={{ maxWidth: 560 }}>
          <div className="section-label" style={{ marginTop: 0 }}>
            Saved worlds
          </div>
          <div className="list">
            {saves.map((s) => (
              <div
                className="list-row"
                key={s.id}
                style={{ gridTemplateColumns: '1fr auto auto' }}
              >
                <div>
                  <div>{s.name}</div>
                  <div className="tiny muted mono">
                    seed {s.seedText} · Y{s.year} d{s.day} · {s.population} settlers
                  </div>
                </div>
                <button className="btn small" onClick={() => onContinue(s.id)}>
                  Load
                </button>
                <button
                  className="btn small danger ghost"
                  onClick={() => {
                    if (confirm(`Delete "${s.name}" permanently? This cannot be undone.`)) {
                      onDeleteSave(s.id);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tiny muted" style={{ maxWidth: 520, textAlign: 'center', lineHeight: 1.7 }}>
        Walk the world yourself while your settlement builds itself around you — one delivered
        plank, one raised frame, one finished roof at a time.
      </div>
    </div>
  );
}
