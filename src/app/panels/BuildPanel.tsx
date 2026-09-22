import { useMemo, useState } from 'react';
import { Game } from '../../game/Game';
import {
  ALL_BUILDING_IDS,
  BUILDINGS,
  BuildingCategory,
  BuildingId,
  CATEGORY_LABELS,
} from '../../data/buildings';
import { ITEMS, ItemId } from '../../data/items';
import { RESEARCH } from '../../data/research';
import { Window } from '../components/common';

interface Props {
  game: Game;
  onClose: () => void;
}

const CATEGORIES: BuildingCategory[] = [
  'housing',
  'storage',
  'gathering',
  'production',
  'farming',
  'civic',
  'infrastructure',
  'decoration',
];

export function BuildPanel({ game, onClose }: Props): JSX.Element {
  const world = game.world;
  const [category, setCategory] = useState<BuildingCategory>('housing');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BuildingId | null>(game.build.selected);

  const stored = useMemo(() => {
    const totals = new Map<ItemId, number>();
    for (const b of world.buildings) {
      if (!b.complete) continue;
      for (const s of b.inventory.slots) {
        if (s) totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
      }
    }
    for (const s of world.player.inventory.slots) {
      if (s) totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
    }
    return totals;
  }, [world.buildings, world.player.inventory]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_BUILDING_IDS.map((id) => BUILDINGS[id]).filter((d) => {
      if (q) return d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q);
      return d.category === category;
    });
  }, [category, search]);

  const def = selected ? BUILDINGS[selected] : null;

  const choose = (id: BuildingId): void => {
    setSelected(id);
  };

  const place = (): void => {
    if (!selected) return;
    game.selectBuilding(selected);
    onClose();
  };

  return (
    <Window title="Build" onClose={onClose} width="wide">
      <div className="field" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search buildings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => (game.input.textFocus = true)}
          onBlur={() => (game.input.textFocus = false)}
        />
      </div>

      <div className="build-layout">
        <div className="build-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`build-cat ${category === c && !search ? 'active' : ''}`}
              onClick={() => {
                setCategory(c);
                setSearch('');
              }}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="build-list">
          {visible.map((d) => {
            const locked = !world.research.buildingUnlocked(d.id);
            return (
              <button
                key={d.id}
                className={`build-card ${selected === d.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => choose(d.id)}
                title={locked && d.requiresResearch ? `Needs ${RESEARCH[d.requiresResearch].name}` : d.description}
              >
                <div className="name">{d.name}</div>
                <div className="foot">
                  {d.linear ? 'drag' : `${d.width}×${d.depth}`}
                  {locked ? ' · locked' : ''}
                </div>
              </button>
            );
          })}
          {visible.length === 0 && <div className="empty-note">Nothing matches that.</div>}
        </div>

        <div className="build-detail">
          {def ? (
            <>
              <h4>{def.name}</h4>
              <div className="desc">{def.description}</div>

              {!world.research.buildingUnlocked(def.id) && def.requiresResearch && (
                <div className="pill bad" style={{ marginBottom: 10 }}>
                  Requires {RESEARCH[def.requiresResearch].name}
                </div>
              )}

              <div className="section-label">Total materials</div>
              {Object.keys(def.totalMaterials).length === 0 && (
                <div className="tiny muted">Labour only — no materials needed.</div>
              )}
              {(Object.entries(def.totalMaterials) as [ItemId, number][]).map(([item, need]) => {
                const have = stored.get(item) ?? 0;
                return (
                  <div className="mat-row" key={item}>
                    <span>{ITEMS[item].name}</span>
                    <span className={have >= need ? 'have' : 'short'}>
                      {have}/{need}
                    </span>
                  </div>
                );
              })}

              <div className="section-label">Construction stages</div>
              {def.stages.map((s, i) => (
                <div className="mat-row" key={s.id + i}>
                  <span className="tiny">
                    {i + 1}. {s.name}
                  </span>
                  <span className="tiny muted">{s.work} work</span>
                </div>
              ))}

              <div className="section-label">Once complete</div>
              <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                {def.housing ? `Houses ${def.housing} settlers. ` : ''}
                {def.workSlots ? `Employs ${def.workSlots}. ` : ''}
                {def.storageSlots ? `Stores ${def.storageSlots} stacks. ` : ''}
                {def.recipes?.length ? `Can make: ${def.recipes.map((r) => r.replace(/_/g, ' ')).join(', ')}. ` : ''}
                {def.gathers ? `Extracts ${def.gathers}. ` : ''}
                {def.farmPlots ? `Farms ${def.farmPlots} plots. ` : ''}
              </div>

              <button
                className="btn primary"
                style={{ width: '100%', marginTop: 16 }}
                disabled={!world.research.buildingUnlocked(def.id)}
                onClick={place}
              >
                Place blueprint
              </button>
              <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                Placing marks out a site. Your settlers then have to deliver the materials and do
                the work.
              </div>
            </>
          ) : (
            <div className="empty-note">Choose something to build.</div>
          )}
        </div>
      </div>
    </Window>
  );
}
