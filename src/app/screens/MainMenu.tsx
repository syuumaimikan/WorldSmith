import { SaveSummary } from '../../persistence/saves';
import { useT } from '../../i18n';

interface Props {
  saves: SaveSummary[];
  onNew: () => void;
  onContinue: (id: string) => void;
  onDeleteSave: (id: string) => void;
  onSettings: () => void;
}

export function MainMenu({ saves, onNew, onContinue, onDeleteSave, onSettings }: Props): JSX.Element {
  const t = useT();
  const latest = saves[0];

  return (
    <div className="menu-screen">
      <div className="title-block">
        <h1 className="title">
          World<em>Smith</em>
        </h1>
        <div className="subtitle">{t('app.tagline')}</div>
      </div>

      <div className="menu-actions">
        <button className="btn primary" onClick={onNew}>
          {t('menu.newWorld')}
        </button>
        {latest && (
          <button className="btn" onClick={() => onContinue(latest.id)}>
            {t('menu.continue')} — {latest.name}
            <div className="tiny muted" style={{ marginTop: 3 }}>
              {t('menu.saveSummary', {
                year: latest.year,
                day: latest.day,
                population: latest.population,
                buildings: latest.buildings,
              })}
            </div>
          </button>
        )}
        <button className="btn ghost" onClick={onSettings}>
          {t('menu.settings')}
        </button>
      </div>

      {saves.length > 0 && (
        <div className="panel form-card" style={{ maxWidth: 560 }}>
          <div className="section-label" style={{ marginTop: 0 }}>
            {t('menu.savedWorlds')}
          </div>
          <div className="list">
            {saves.map((s) => (
              <div className="list-row" key={s.id} style={{ gridTemplateColumns: '1fr auto auto' }}>
                <div>
                  <div>{s.name}</div>
                  <div className="tiny muted mono">
                    {t('menu.seedLabel', { seed: s.seedText })} ·{' '}
                    {t('menu.saveSummary', {
                      year: s.year,
                      day: s.day,
                      population: s.population,
                      buildings: s.buildings,
                    })}
                  </div>
                </div>
                <button className="btn small" onClick={() => onContinue(s.id)}>
                  {t('menu.load')}
                </button>
                <button
                  className="btn small danger ghost"
                  onClick={() => {
                    if (confirm(t('menu.deleteConfirm', { name: s.name }))) onDeleteSave(s.id);
                  }}
                >
                  {t('menu.delete')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tiny muted" style={{ maxWidth: 520, textAlign: 'center', lineHeight: 1.7 }}>
        {t('app.blurb')}
      </div>
    </div>
  );
}
