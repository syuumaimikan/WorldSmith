/**
 * Reaching into a storehouse.
 *
 * Goods went into a store and never came out again, which made every
 * warehouse in the world a one-way hole in the economy. This is the door:
 * two lists, the store's and yours, and goods move one way or the other.
 *
 * It is only open while you are standing at the building. Walk away and it
 * closes, because reaching into a barn from across the valley is exactly the
 * kind of teleporting logistics the rest of the game refuses.
 */

import { useEffect, useState } from 'react';
import { Game } from '../../game/Game';
import { Building } from '../../sim/Building';
import { ITEMS, ItemId } from '../../data/items';
import { EmptyNote, ItemIcon, Window } from '../components/common';
import { useT } from '../../i18n';
import { buildingName, itemName } from '../../i18n/names';
import { putIntoStore, STORE_REACH, takeFromStore } from '../../game/PlayerActions';

interface Props {
  game: Game;
  building: Building;
  onClose: () => void;
}

export function StorePanel({ game, building, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [, refresh] = useState(0);
  const bump = (): void => refresh((n) => n + 1);

  // Walking out of reach closes it. Checked on a timer rather than on render
  // because the player moves while the panel is open.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = world.player.position;
      const d = Math.hypot(building.worldX - p.x, building.worldZ - p.z);
      if (d > STORE_REACH) onClose();
      else bump();
    }, 400);
    return () => window.clearInterval(id);
  }, [world, building, onClose]);

  const stored = building.inventory.summary();
  const carried = world.player.inventory.summary().filter((s) => ITEMS[s.item].category !== 'tool');

  const take = (item: ItemId, count: number): void => {
    const r = takeFromStore(world, building, item, count);
    if (r.message) game.toast(r.message);
    bump();
  };
  const put = (item: ItemId, count: number): void => {
    const r = putIntoStore(world, building, item, count);
    if (r.message) game.toast(r.message);
    bump();
  };

  return (
    <Window
      title={`${t('store.title')} — ${buildingName(building.defId)}`}
      onClose={onClose}
      width="wide"
    >
      <div className="store-columns">
        <div>
          <div className="section-label">{t('store.contents')}</div>
          <div className="list">
            {stored.map((s) => (
              <div
                className="list-row"
                key={s.item}
                style={{ gridTemplateColumns: '22px 1fr 44px auto auto' }}
              >
                <ItemIcon item={s.item} size={18} />
                <span>{itemName(s.item)}</span>
                <span className="mono right">{s.count}</span>
                <button className="mini" onClick={() => take(s.item, 1)}>
                  1
                </button>
                <button className="mini" onClick={() => take(s.item, s.count)}>
                  {t('store.take')}
                </button>
              </div>
            ))}
          </div>
          {stored.length === 0 && <EmptyNote>{t('store.empty')}</EmptyNote>}
        </div>

        <div>
          <div className="section-label">{t('store.yourPack')}</div>
          <div className="list">
            {carried.map((s) => (
              <div
                className="list-row"
                key={s.item}
                style={{ gridTemplateColumns: '22px 1fr 44px auto auto' }}
              >
                <ItemIcon item={s.item} size={18} />
                <span>{itemName(s.item)}</span>
                <span className="mono right">{s.count}</span>
                <button className="mini" onClick={() => put(s.item, 1)}>
                  1
                </button>
                <button className="mini" onClick={() => put(s.item, s.count)}>
                  {t('store.put')}
                </button>
              </div>
            ))}
          </div>
          {carried.length === 0 && <EmptyNote>{t('inv.packEmpty')}</EmptyNote>}
        </div>
      </div>
    </Window>
  );
}
