import { useState } from 'react';
import { Game } from '../../game/Game';
import { ITEMS } from '../../data/items';
import { ItemIcon, Window } from '../components/common';

interface Props {
  game: Game;
  onClose: () => void;
}

export function InventoryPanel({ game, onClose }: Props): JSX.Element {
  const inv = game.world.player.inventory;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [, forceRender] = useState(0);

  const drop = (to: number): void => {
    if (dragFrom === null) return;
    if (dragFrom !== to) {
      if (!inv.mergeSlots(dragFrom, to)) inv.swap(dragFrom, to);
    }
    setDragFrom(null);
    setDragOver(null);
    forceRender((n) => n + 1);
  };

  const weight = inv.totalWeight();

  return (
    <Window title="Pack" onClose={onClose} width="narrow">
      <div className="inv-meta">
        <span>
          {inv.usedSlots()} / {inv.capacity} slots
        </span>
        <span className="mono">
          {weight.toFixed(0)} / {inv.weightLimit} kg
        </span>
      </div>

      <div className="inv-grid">
        {inv.slots.map((slot, i) => (
          <button
            key={i}
            className={`inv-slot ${dragOver === i ? 'drag-over' : ''}`}
            draggable={!!slot}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              drop(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            title={slot ? `${ITEMS[slot.item].name} — ${ITEMS[slot.item].description}` : 'Empty'}
          >
            {slot && (
              <>
                <ItemIcon item={slot.item} size={28} />
                <span className="count">{slot.count}</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div className="section-label">Carried</div>
      <div className="list">
        {inv.summary().map((s) => (
          <div className="list-row" key={s.item} style={{ gridTemplateColumns: '24px 1fr auto auto' }}>
            <ItemIcon item={s.item} size={18} />
            <span>{ITEMS[s.item].name}</span>
            <span className="mono muted tiny">{(ITEMS[s.item].weight * s.count).toFixed(0)} kg</span>
            <span className="mono">{s.count}</span>
          </div>
        ))}
        {inv.isEmpty() && <div className="empty-note">Your pack is empty.</div>}
      </div>

      <div className="tiny muted" style={{ marginTop: 14, lineHeight: 1.6 }}>
        Stand next to a stockpile or warehouse and press E to unload everything you are carrying.
        Stand at a construction site and press E to hand over materials it is waiting for.
      </div>
    </Window>
  );
}
