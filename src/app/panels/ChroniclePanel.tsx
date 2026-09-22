import { useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Tabs, Window } from '../components/common';
import { EventCategory } from '../../sim/EventLog';
import { useT } from '../../i18n';
import { eventDate, eventText } from '../../i18n/events';

interface Props {
  game: Game;
  onClose: () => void;
}

type Filter = 'all' | EventCategory;

const FILTER_IDS: { id: Filter; key: string }[] = [
  { id: 'all', key: 'chron.everything' },
  { id: 'construction', key: 'chron.building' },
  { id: 'settlement', key: 'chron.settlement' },
  { id: 'people', key: 'chron.people' },
  { id: 'weather', key: 'chron.weather' },
  { id: 'discovery', key: 'chron.discovery' },
  { id: 'history', key: 'chron.before' },
];

export function ChroniclePanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const FILTERS = FILTER_IDS.map((f) => ({ id: f.id, label: t(f.key) }));
  const world = game.world;

  const events = [...world.log.all()]
    .filter((e) => filter === 'all' || e.category === filter)
    .reverse();

  return (
    <Window title={t('chron.title', { name: world.config.name })} onClose={onClose} width="normal">
      <Tabs<Filter> tabs={FILTERS} active={filter} onChange={setFilter} />

      <div className="list" style={{ paddingTop: 14 }}>
        {events.map((e) => (
          <div
            className={`list-row ${e.x !== undefined ? 'clickable' : ''}`}
            key={e.id}
            style={{ gridTemplateColumns: '92px 1fr' }}
            onClick={() => {
              if (e.x !== undefined && e.z !== undefined) {
                game.focusOn(e.x, e.z);
                onClose();
              }
            }}
          >
            <span className="mono tiny muted">{eventDate(e)}</span>
            <span>{eventText(e)}</span>
          </div>
        ))}
        {events.length === 0 && <EmptyNote>{t('chron.nothing')}</EmptyNote>}
      </div>
    </Window>
  );
}
