import { useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Pill, Tabs, Window } from '../components/common';
import { HaulJob } from '../../sim/Jobs';
import { useT } from '../../i18n';
import {
  activityName,
  buildingName,
  itemName,
  priorityName,
  professionName,
  stageName,
} from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

type Tab = 'queue' | 'sites' | 'workers';

export function JobsPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [tab, setTab] = useState<Tab>('queue');
  const [, refresh] = useState(0);

  const jobs = [...world.jobs.all].sort((a, b) => b.priority - a.priority);
  const sites = world.buildings.filter((b) => !b.complete);

  return (
    <Window title={t('jobs.title')} onClose={onClose} width="wide">
      <Tabs<Tab>
        tabs={[
          { id: 'queue', label: t('jobs.queue', { count: jobs.length }) },
          { id: 'sites', label: t('jobs.sites', { count: sites.length }) },
          { id: 'workers', label: t('jobs.workers', { count: world.npcs.length }) },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 14 }}>
        {tab === 'queue' && (
          <>
            <div className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
              {t('jobs.note')}
            </div>
            <div className="list">
              {jobs.map((j) => {
                const assignee = j.assignedTo ? world.npcById.get(j.assignedTo) : null;
                let label = '';
                if (j.kind === 'haul') {
                  const h = j as HaulJob;
                  const dest = world.buildingById.get(h.destId);
                  const source =
                    h.sourceType === 'pile'
                      ? t('jobs.ground')
                      : (() => {
                          const src = world.buildingById.get(h.sourceId);
                          return src ? buildingName(src.defId) : t('jobs.store');
                        })();
                  label = t('jobs.haul', {
                    count: h.amount,
                    item: itemName(h.item),
                    from: source,
                    to: dest ? buildingName(dest.defId) : '?',
                  });
                } else if (j.kind === 'build') {
                  const b = world.buildingById.get(j.buildingId);
                  label = t('jobs.buildJob', {
                    building: b ? buildingName(b.defId) : '?',
                    stage: b?.currentStage ? stageName(b.currentStage.id, b.currentStage.name) : '',
                  });
                } else {
                  const b = world.buildingById.get(j.buildingId);
                  label = t('jobs.demolishJob', { building: b ? buildingName(b.defId) : '?' });
                }
                return (
                  <div className="list-row" key={j.id} style={{ gridTemplateColumns: '1fr 120px 90px' }}>
                    <span>{label}</span>
                    <span className="tiny muted">{assignee ? assignee.name : t('jobs.unassigned')}</span>
                    <Pill tone={j.priority >= 3 ? 'bad' : j.priority === 2 ? 'warn' : undefined}>
                      {priorityName(j.priority)}
                    </Pill>
                  </div>
                );
              })}
            </div>
            {jobs.length === 0 && (
              <EmptyNote>
                {t('jobs.none')}
              </EmptyNote>
            )}
          </>
        )}

        {tab === 'sites' && (
          <>
            <div className="list">
              {sites.map((b) => {
                const missing = b.missingMaterials();
                const builders = world.jobs.all.filter(
                  (j) => j.kind === 'build' && j.buildingId === b.id && j.assignedTo !== 0,
                ).length;
                return (
                  <div
                    className="list-row clickable"
                    key={b.id}
                    style={{ gridTemplateColumns: '150px 1fr 100px 90px 120px' }}
                    onClick={() => {
                      world.selection = { kind: 'building', id: b.id };
                      game.focusOn(b.worldX, b.worldZ + 10);
                      onClose();
                    }}
                  >
                    <span>{buildingName(b.defId)}</span>
                    <div>
                      <div className="tiny">
                        {b.currentStage ? stageName(b.currentStage.id, b.currentStage.name) : '\u2014'}
                      </div>
                      <div className="tiny muted">
                        {missing.length > 0
                          ? t('jobs.waitingOn', {
                              list: missing.map((m) => `${m.amount} ${itemName(m.item)}`).join(', '),
                            })
                          : t('jobs.working', { count: builders })}
                      </div>
                    </div>
                    <span className="mono tiny">{Math.round(b.progress * 100)}%</span>
                    <Pill tone={missing.length > 0 ? 'warn' : builders > 0 ? 'good' : undefined}>
                      {missing.length > 0
                        ? t('jobs.materials')
                        : builders > 0
                          ? t('jobs.building')
                          : t('jobs.idle')}
                    </Pill>
                    <select
                      className="tiny"
                      value={b.priority}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        b.priority = Number(e.target.value);
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
                      {[0, 1, 2, 3].map((i) => (
                        <option key={i} value={i}>
                          {priorityName(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {sites.length === 0 && <EmptyNote>{t('jobs.noSites')}</EmptyNote>}
          </>
        )}

        {tab === 'workers' && (
          <div className="list">
            {world.npcs.map((n) => {
              const wp = world.buildingById.get(n.workplaceId);
              return (
                <div
                  className="list-row clickable"
                  key={n.id}
                  style={{ gridTemplateColumns: '150px 120px 1fr 140px' }}
                  onClick={() => {
                    world.selection = { kind: 'npc', id: n.id };
                    onClose();
                  }}
                >
                  <span>{n.name}</span>
                  <span className="tiny muted">{professionName(n.profession)}</span>
                  <span className="tiny">{activityName(n.activity)}</span>
                  <span className="tiny muted">{wp ? buildingName(wp.defId) : t('jobs.noWorkplace')}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Window>
  );
}
