import { useCallback, useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, Window } from '../components/common';
import { useT } from '../../i18n';
import { ANCIENT_YEARS, preSimulate } from '../../sim/Presimulate';
import { DAYS_PER_YEAR } from '../../sim/Time';

interface Props {
  game: Game;
  onClose: () => void;
}

const OPTIONS = [1, 10, 100, 500];

/**
 * Letting the world get on without you.
 *
 * This runs the same world-scale systems the "ancient world" option runs
 * before the game starts: polities, wars, faith, know-how and the crust. It
 * does not run the settlement — a century of six people carrying planks is
 * not something that can be fast-forwarded honestly, so the settlement is
 * held where it stands and the panel says so rather than inventing a hundred
 * years of history for it.
 */
export function TimeSkipPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reachedYear, setReachedYear] = useState(world.time.snapshot().year);
  const [done, setDone] = useState<number | null>(null);

  const skip = useCallback(
    async (years: number) => {
      if (running) return;
      setRunning(true);
      setDone(null);
      const startYear = world.time.snapshot().year;

      // In slices, handing the thread back between them, so the bar moves and
      // the tab does not appear to have died.
      const slices = Math.max(1, Math.min(40, Math.round(years / 2) || 1));
      for (let i = 0; i < slices; i++) {
        preSimulate(world, years / slices);
        setProgress((i + 1) / slices);
        setReachedYear(world.time.snapshot().year);
        await new Promise((r) => setTimeout(r, 0));
      }

      game.afterTimeSkip();
      setRunning(false);
      setProgress(0);
      setDone(world.time.snapshot().year - startYear);
    },
    [game, running, world],
  );

  const year = world.time.snapshot().year;

  return (
    <Window title={t('skip.title')} onClose={running ? () => undefined : onClose} width="narrow">
      <div className="tiny muted" style={{ lineHeight: 1.7, marginBottom: 12 }}>
        {t('skip.blurb')}
      </div>

      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="tiny muted">{t('skip.now')}</span>
          <b className="mono">{t('hist.year', { year })}</b>
        </div>
        <div className="stat">
          <span className="tiny muted">{t('skip.settlers')}</span>
          <b className="mono">{world.npcs.length}</b>
        </div>
      </div>

      {running ? (
        <>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            {t('skip.running', { year: reachedYear })}
          </div>
          <Bar value={progress} />
        </>
      ) : (
        <div className="menu-actions" style={{ width: '100%' }}>
          {OPTIONS.map((y) => (
            <button key={y} className="btn" onClick={() => void skip(y)}>
              {t('skip.years', { years: y })}
            </button>
          ))}
          <button className="btn ghost" onClick={() => void skip(ANCIENT_YEARS)}>
            {t('skip.anAge', { years: ANCIENT_YEARS })}
          </button>
        </div>
      )}

      {done !== null && (
        <EmptyNote>
          {t('skip.done', { years: done, day: Math.round(world.time.totalDays / DAYS_PER_YEAR) })}
        </EmptyNote>
      )}
    </Window>
  );
}
