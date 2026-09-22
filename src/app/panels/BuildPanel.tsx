import { useMemo, useState } from 'react';
import { Game } from '../../game/Game';
import { ALL_BUILDING_IDS, BUILDINGS, BuildingCategory, BuildingId } from '../../data/buildings';
import { ItemId } from '../../data/items';
import { Window } from '../components/common';
import { useT } from '../../i18n';
import {
  buildingDescription,
  buildingName,
  categoryName,
  itemName,
  recipeName,
  researchName,
  stageName,
} from '../../i18n/names';

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
  const t = useT();
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
      if (q) {
        return (
          buildingName(d.id).toLowerCase().includes(q) ||
          buildingDescription(d.id).toLowerCase().includes(q)
        );
      }
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
    <Window title={t('build.title')} onClose={onClose} width="wide">
      <div className="field" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder={t('build.search')}
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
              {categoryName(c)}
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
                title={
                  locked && d.requiresResearch
                    ? t('build.requires', { name: researchName(d.requiresResearch) })
                    : buildingDescription(d.id)
                }
              >
                <div className="name">{buildingName(d.id)}</div>
                <div className="foot">
                  {d.linear ? t('build.drag') : `${d.width}\u00d7${d.depth}`}
                  {locked ? ` \u00b7 ${t('build.locked')}` : ''}
                </div>
              </button>
            );
          })}
          {visible.length === 0 && <div className="empty-note">{t('build.nothingMatches')}</div>}
        </div>

        <div className="build-detail">
          {def ? (
            <>
              <h4>{buildingName(def.id)}</h4>
              <div className="desc">{buildingDescription(def.id)}</div>

              {!world.research.buildingUnlocked(def.id) && def.requiresResearch && (
                <div className="pill bad" style={{ marginBottom: 10 }}>
                  {t('build.requires', { name: researchName(def.requiresResearch) })}
                </div>
              )}

              <div className="section-label">{t('build.totalMaterials')}</div>
              {Object.keys(def.totalMaterials).length === 0 && (
                <div className="tiny muted">{t('build.labourOnly')}</div>
              )}
              {(Object.entries(def.totalMaterials) as [ItemId, number][]).map(([item, need]) => {
                const have = stored.get(item) ?? 0;
                return (
                  <div className="mat-row" key={item}>
                    <span>{itemName(item)}</span>
                    <span className={have >= need ? 'have' : 'short'}>
                      {have}/{need}
                    </span>
                  </div>
                );
              })}

              <div className="section-label">{t('build.stages')}</div>
              {def.stages.map((s, i) => (
                <div className="mat-row" key={s.id + i}>
                  <span className="tiny">
                    {i + 1}. {stageName(s.id, s.name)}
                  </span>
                  <span className="tiny muted">{t('build.work', { value: s.work })}</span>
                </div>
              ))}

              <div className="section-label">{t('build.onceComplete')}</div>
              <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                {def.housing ? t('build.houses', { count: def.housing }) + ' ' : ''}
                {def.workSlots ? t('build.employs', { count: def.workSlots }) + ' ' : ''}
                {def.storageSlots ? t('build.stores', { count: def.storageSlots }) + ' ' : ''}
                {def.recipes?.length
                  ? t('build.canMake', { list: def.recipes.map(recipeName).join(', ') }) + ' '
                  : ''}
                {def.gathers ? t('build.extracts', { what: def.gathers }) + ' ' : ''}
                {def.farmPlots ? t('build.farms', { count: def.farmPlots }) + ' ' : ''}
              </div>

              <button
                className="btn primary"
                style={{ width: '100%', marginTop: 16 }}
                disabled={!world.research.buildingUnlocked(def.id)}
                onClick={place}
              >
                {t('build.place')}
              </button>
              <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {t('build.placeNote')}
              </div>
            </>
          ) : (
            <div className="empty-note">{t('build.chooseSomething')}</div>
          )}
        </div>
      </div>
    </Window>
  );
}
