import { useMemo, useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, ItemIcon, Pill, Tabs, Window } from '../components/common';
import {
  ALL_PROFESSIONS,
  ALL_SKILLS,
  ProfessionId,
  SKILL_LABELS,
  professionColour,
} from '../../data/professions';
import { ITEMS, ItemId } from '../../data/items';
import { hexToCss, PALETTE } from '../../render/Palette';
import { useT } from '../../i18n';
import {
  activityName,
  buildingName,
  itemName,
  moodName,
  professionName,
  tierName,
} from '../../i18n/names';
import { buildingStatus } from '../../i18n/status';

interface Props {
  game: Game;
  onClose: () => void;
}

type Tab = 'overview' | 'people' | 'stores' | 'buildings';

export function SettlementPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [tab, setTab] = useState<Tab>('overview');
  const [, refresh] = useState(0);
  const s = world.settlement;

  const stored = useMemo(() => {
    const totals = new Map<ItemId, number>();
    for (const b of world.buildings) {
      if (!b.complete) continue;
      for (const slot of b.inventory.slots) {
        if (slot) totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.count);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [world.buildings, tab]);

  return (
    <Window title={`${world.config.name} \u2014 ${tierName(s.tier)}`} onClose={onClose} width="wide">
      <Tabs<Tab>
        tabs={[
          { id: 'overview', label: t('set.overview') },
          { id: 'people', label: t('set.people', { count: world.npcs.length }) },
          { id: 'stores', label: t('set.stores') },
          { id: 'buildings', label: t('set.buildings', { count: world.buildings.length }) },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 14 }}>
        {tab === 'overview' && (
          <div className="two-col" style={{ gap: 24 }}>
            <div>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t('set.state')}
              </div>
              <Row label={t('set.population')} value={String(s.population)} />
              <Row label={t('set.housingCapacity')} value={String(s.housingCapacity)} />
              <Row
                label={t('set.homeless')}
                value={String(s.homeless)}
                tone={s.homeless > 0 ? 'warn' : undefined}
              />
              <Row label={t('set.unassigned')} value={String(s.unemployed)} />
              <Row label={t('set.averageMood')} value={`${Math.round(s.averageMood)}%`} />
              <Row
                label={t('set.foodInStore')}
                value={`${Math.round(s.foodStores)} (${s.foodDays > 90 ? '∞' : s.foodDays.toFixed(1)} days)`}
                tone={s.foodDays < 3 ? 'bad' : s.foodDays < 6 ? 'warn' : 'good'}
              />
              <Row label={t('set.founded')} value={t('set.day', { day: s.foundedDay })} />

              <div className="section-label">{t('set.infrastructure')}</div>
              {(
                [
                  [t('set.roads'), s.infrastructure.road],
                  [t('hud.food'), s.infrastructure.food],
                  [t('hud.housing'), s.housingCapacity],
                  [t('insp.storage'), s.infrastructure.storage],
                  [t('hud.production'), s.infrastructure.production],
                  [t('set.health'), s.infrastructure.health],
                  [t('set.education'), s.infrastructure.education],
                  [t('set.safety'), s.infrastructure.safety],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label} style={{ marginBottom: 7 }}>
                  <div className="kv">
                    <span>{label}</span>
                    <span className="mono">{Math.round(value)}</span>
                  </div>
                  <Bar value={value / 30} />
                </div>
              ))}
            </div>

            <div>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t('set.growth')}
              </div>
              {s.nextTierNeeds() ? (
                <>
                  <div className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
                    {t('set.toBecome', { tier: s.nextTierName() ?? '' })}
                  </div>
                  {s.nextTierNeeds()!.map((n) => (
                    <div key={n.label} style={{ marginBottom: 7 }}>
                      <div className="kv">
                        <span>{n.label}</span>
                        <span className="mono" style={{ color: n.have >= n.need ? hexToCss(PALETTE.ui.good) : undefined }}>
                          {Math.round(n.have)} / {n.need}
                        </span>
                      </div>
                      <Bar value={n.have / Math.max(1, n.need)} />
                    </div>
                  ))}
                </>
              ) : (
                <div className="tiny muted">{t('set.grownFully')}</div>
              )}

              <div className="section-label">{t('set.holdingUp')}</div>
              {world.economy.bottlenecks.length === 0 && (
                <div className="tiny muted">{t('set.runningSmoothly')}</div>
              )}
              {world.economy.bottlenecks.map((b, i) => (
                <div className="list-row" key={i} style={{ gridTemplateColumns: '1fr auto', marginBottom: 5 }}>
                  <div>
                    <div>{t(b.key, b.params)}</div>
                    <div className="tiny muted">{t(b.detailKey, b.params)}</div>
                  </div>
                  <Pill tone={b.severity === 'critical' ? 'bad' : b.severity === 'warn' ? 'warn' : undefined}>
                    {t(`severity.${b.severity}`)}
                  </Pill>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'people' && (
          <div className="list">
            {world.npcs.map((n) => (
              <div
                className="list-row clickable"
                key={n.id}
                style={{ gridTemplateColumns: '10px 140px 110px 1fr 90px 110px' }}
                onClick={() => {
                  world.selection = { kind: 'npc', id: n.id };
                  onClose();
                }}
              >
                <i
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: hexToCss(professionColour(n.profession)),
                  }}
                />
                <span>{n.name}</span>
                <select
                  className="tiny"
                  value={n.profession}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    world.setProfession(n, e.target.value as ProfessionId);
                    refresh((v) => v + 1);
                  }}
                  style={{
                    background: '#12141a',
                    color: 'inherit',
                    border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: 3,
                    padding: '2px 4px',
                  }}
                >
                  {ALL_PROFESSIONS.map((p) => (
                    <option key={p} value={p}>
                      {professionName(p)}
                    </option>
                  ))}
                </select>
                <span className="tiny muted">{activityName(n.activity)}</span>
                <span className="tiny muted">{moodName(n.needs.mood)}</span>
                <div>
                  <Bar
                    value={n.needs.mood / 100}
                    color={hexToCss(n.needs.mood > 60 ? PALETTE.ui.good : n.needs.mood > 35 ? PALETTE.ui.warn : PALETTE.ui.bad)}
                  />
                </div>
              </div>
            ))}
            {world.npcs.length === 0 && <EmptyNote>{t('set.nobodyLives')}</EmptyNote>}
          </div>
        )}

        {tab === 'stores' && (
          <>
            <div className="list">
              {stored.map(([item, count]) => (
                <div className="list-row" key={item} style={{ gridTemplateColumns: '24px 1fr 90px 70px' }}>
                  <ItemIcon item={item} size={18} />
                  <span>{itemName(item)}</span>
                  <span className="tiny muted">{ITEMS[item].category}</span>
                  <span className="mono right">{count}</span>
                </div>
              ))}
            </div>
            {stored.length === 0 && (
              <EmptyNote>
                {t('set.nothingInStore')}
              </EmptyNote>
            )}
          </>
        )}

        {tab === 'buildings' && (
          <div className="list">
            {world.buildings.map((b) => (
              <div
                className="list-row clickable"
                key={b.id}
                style={{ gridTemplateColumns: '150px 1fr 120px 90px' }}
                onClick={() => {
                  world.selection = { kind: 'building', id: b.id };
                  game.focusOn(b.worldX, b.worldZ + 10);
                  onClose();
                }}
              >
                <span>{buildingName(b.defId)}</span>
                <span className="tiny muted">{buildingStatus(b)}</span>
                <div>{!b.complete && <Bar value={b.progress} />}</div>
                <span className="mono tiny right">
                  {b.complete ? `${Math.round(b.condition * 100)}%` : `${Math.round(b.progress * 100)}%`}
                </span>
              </div>
            ))}
            {world.buildings.length === 0 && (
              <EmptyNote>{t('set.nothingBuilt')}</EmptyNote>
            )}
          </div>
        )}
      </div>
    </Window>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }): JSX.Element {
  const color =
    tone === 'good'
      ? hexToCss(PALETTE.ui.good)
      : tone === 'warn'
        ? hexToCss(PALETTE.ui.warn)
        : tone === 'bad'
          ? hexToCss(PALETTE.ui.bad)
          : undefined;
  return (
    <div className="kv">
      <span>{label}</span>
      <span className="mono" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

export { ALL_SKILLS, SKILL_LABELS };
