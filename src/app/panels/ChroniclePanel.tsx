import { useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Tabs, Window } from '../components/common';
import { EventCategory } from '../../sim/EventLog';

interface Props {
  game: Game;
  onClose: () => void;
}

type Filter = 'all' | EventCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'construction', label: 'Building' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'people', label: 'People' },
  { id: 'weather', label: 'Weather' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'history', label: 'Before' },
];

export function ChroniclePanel({ game, onClose }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const world = game.world;

  const events = [...world.log.all()]
    .filter((e) => filter === 'all' || e.category === filter)
    .reverse();

  return (
    <Window title={`Chronicle of ${world.config.name}`} onClose={onClose} width="normal">
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
            <span className="mono tiny muted">{e.dateLabel}</span>
            <span>{e.text}</span>
          </div>
        ))}
        {events.length === 0 && <EmptyNote>Nothing recorded yet.</EmptyNote>}
      </div>
    </Window>
  );
}
