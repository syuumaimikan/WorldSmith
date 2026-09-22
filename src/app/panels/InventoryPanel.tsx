import { useState } from 'react';
import { Game } from '../../game/Game';
import { ITEMS } from '../../data/items';
import { ItemIcon, Window } from '../components/common';
import { useT } from '../../i18n';
import { itemDescription, itemName } from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

export function InventoryPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
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
    <Window title={t('inv.title')} onClose={onClose} width="narrow">
      <div className="inv-meta">
        <span>{t('inv.slots', { used: inv.usedSlots(), total: inv.capacity })}</span>
        <span className="mono">
          {t('inv.weight', { used: weight.toFixed(0), total: inv.weightLimit })}
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
            title={
              slot ? `${itemName(slot.item)} \u2014 ${itemDescription(slot.item)}` : t('insp.empty')
            }
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

      <div className="section-label">{t('inv.carried')}</div>
      <div className="list">
        {inv.summary().map((s) => (
          <div className="list-row" key={s.item} style={{ gridTemplateColumns: '24px 1fr auto auto' }}>
            <ItemIcon item={s.item} size={18} />
            <span>{itemName(s.item)}</span>
            <span className="mono muted tiny">{(ITEMS[s.item].weight * s.count).toFixed(0)} kg</span>
            <span className="mono">{s.count}</span>
          </div>
        ))}
        {inv.isEmpty() && <div className="empty-note">{t('inv.packEmpty')}</div>}
      </div>

      <div className="tiny muted" style={{ marginTop: 14, lineHeight: 1.6 }}>
        {t('inv.note')}
      </div>
    </Window>
  );
}
