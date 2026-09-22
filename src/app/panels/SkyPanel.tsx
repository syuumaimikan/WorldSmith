import { useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Pill, Window } from '../components/common';
import { useT } from '../../i18n';
import { DAYS_PER_YEAR } from '../../sim/Time';

interface Props {
  game: Game;
  onClose: () => void;
}

export function SkyPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const astro = world.astronomy;
  const [, refresh] = useState(0);

  const day = world.time.totalDays;
  const moment = astro.at(world.time);
  const phase = astro.moonPhaseName(day + world.time.snapshot().timeOfDay);
  const overhead = astro.overhead(day + world.time.snapshot().timeOfDay);
  const nextEclipse = astro.nextEclipse(day);
  const nextShower = astro.nextShower(day);

  return (
    <Window title={t('sky.title')} onClose={onClose}>
      <div className="section-label" style={{ marginTop: 0 }}>
        {t('sky.tonight')}
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span className="tiny muted">{t('sky.moon')}</span>
          <b>{t(`sky.phase.${phase}`)}</b>
        </div>
        <div className="stat">
          <span className="tiny muted">{t('sky.moonlit')}</span>
          <b className="mono">{Math.round(moment.moonIllumination * 100)} %</b>
        </div>
        <div className="stat">
          <span className="tiny muted">{t('sky.overhead')}</span>
          <b>{overhead ? overhead.name : '—'}</b>
        </div>
        <div className="stat">
          <span className="tiny muted">{t('sky.stars')}</span>
          <b className="mono">{astro.stars.length}</b>
        </div>
      </div>

      {moment.eclipse && (
        <div style={{ marginTop: 8 }}>
          <Pill tone="bad">
            {t(`sky.eclipse.${moment.eclipse.kind}`)} · {Math.round(moment.eclipse.magnitude * 100)}%
          </Pill>
        </div>
      )}

      <div className="kv" style={{ marginTop: 10 }}>
        <span className="tiny muted">{t('sky.nextEclipse')}</span>
        <span className="tiny">
          {nextEclipse
            ? `${t(`sky.eclipse.${nextEclipse.kind}`)} · ${
                nextEclipse.day === day
                  ? t('sky.today')
                  : t('sky.inDays', { days: nextEclipse.day - day })
              }`
            : t('sky.noneForecast')}
        </span>
      </div>
      <div className="kv">
        <span className="tiny muted">{t('sky.nextShower')}</span>
        <span className="tiny">
          {nextShower
            ? `${nextShower.shower.name} · ${
                nextShower.inDays === 0 ? t('sky.today') : t('sky.inDays', { days: nextShower.inDays })
              }`
            : '—'}
        </span>
      </div>

      <div className="section-label">{t('sky.constellations')}</div>
      <button
        className="btn small ghost"
        style={{ width: '100%', marginBottom: 8 }}
        onClick={() => {
          game.stars.setConstellationsVisible(!game.stars.constellationsVisible);
          refresh((v) => v + 1);
        }}
      >
        {game.stars.constellationsVisible ? t('sky.hideLines') : t('sky.showLines')}
      </button>

      {astro.constellations.length === 0 ? (
        <EmptyNote>—</EmptyNote>
      ) : (
        <div className="list">
          {astro.constellations.map((c) => (
            <div key={c.id} className="list-row" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div>
                  {c.name}
                  {overhead?.id === c.id && (
                    <span className="tiny muted"> · {t('sky.overhead').toLowerCase()}</span>
                  )}
                </div>
                <div className="tiny muted" style={{ lineHeight: 1.5 }}>
                  {t(c.loreKey)}
                </div>
                <div className="tiny muted">
                  {t('sky.domain', { domain: t(`sky.domain.${c.domain}`) })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-label">{t('sky.showers')}</div>
      <div className="list">
        {astro.showers.map((s) => (
          <div key={s.id} className="list-row" style={{ gridTemplateColumns: '1fr' }}>
            <span className="tiny">
              {t('sky.showerLine', {
                name: s.name,
                day: s.peakDay % DAYS_PER_YEAR,
                rate: Math.round(s.peakRate),
              })}
            </span>
          </div>
        ))}
      </div>
    </Window>
  );
}
