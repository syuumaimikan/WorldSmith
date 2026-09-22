import { useCallback, useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Window } from '../components/common';
import { useT } from '../../i18n';
import { DAYS_PER_YEAR } from '../../sim/Time';
import { LoadingScreen } from '../screens/LoadingScreen';

interface Props {
  game: Game;
  onClose: () => void;
}

const OPTIONS = [1, 10, 100, 500];

/**
 * Letting the years go by.
 *
 * The world is not paused and the settlement is not held: every day of it is
 * actually stepped, at day scale rather than second scale. Nobody walks
 * anywhere, but food is grown and eaten, buildings weather, people age and
 * die, children are born, countries rise and fall, and the chronicle records
 * all of it. A hundred years later the settlement is standing there full of
 * people nobody has met.
 */
export function TimeSkipPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reachedYear, setReachedYear] = useState(world.time.snapshot().year);
  const [done, setDone] = useState<{ years: number; born: number; died: number } | null>(null);

  const skip = useCallback(
    async (years: number) => {
      if (running) return;
      setRunning(true);
      setDone(null);
      const startYear = world.time.snapshot().year;

      // Counted as they happen, because the event log will have rolled over
      // long before a century is out.
      let born = 0;
      let died = 0;
      const log = world.log;
      const original = log.add.bind(log);
      log.add = ((...args: Parameters<typeof original>) => {
        const key = args[2];
        if (key === 'ev.born') born++;
        if (key === 'ev.diedOfAge' || key === 'ev.diedOfHunger' || key === 'ev.diedOfIllness') {
          died++;
        }
        return original(...args);
      }) as typeof log.add;

      const totalDays = Math.max(1, Math.round(years * DAYS_PER_YEAR));
      // Long enough a slice that this is not mostly scheduling overhead, short
      // enough that the bar moves and the tab stays answerable.
      const slice = Math.max(1, Math.ceil(totalDays / 120));
      for (let day = 0; day < totalDays; day += slice) {
        const n = Math.min(slice, totalDays - day);
        for (let i = 0; i < n; i++) world.skipDay();
        setProgress((day + n) / totalDays);
        setReachedYear(world.time.snapshot().year);
        await new Promise((r) => setTimeout(r, 0));
      }

      log.add = original;
      game.afterTimeSkip();
      setRunning(false);
      setProgress(0);
      setDone({ years: world.time.snapshot().year - startYear, born, died });
    },
    [game, running, world],
  );

  if (running) {
    return (
      <LoadingScreen
        progress={{
          stage: 'skip.running',
          fraction: progress,
          params: { year: reachedYear },
        }}
      />
    );
  }

  const year = world.time.snapshot().year;

  return (
    <Window title={t('skip.title')} onClose={onClose} width="narrow">
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

      <div className="menu-actions" style={{ width: '100%' }}>
        {OPTIONS.map((y) => (
          <button key={y} className="btn" onClick={() => void skip(y)}>
            {t('skip.years', { years: y })}
          </button>
        ))}
      </div>

      {done !== null && (
        <EmptyNote>
          {t('skip.done', {
            years: done.years,
            born: done.born,
            died: done.died,
            people: world.npcs.length,
          })}
        </EmptyNote>
      )}
    </Window>
  );
}
