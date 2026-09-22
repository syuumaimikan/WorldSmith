import { useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Pill, Tabs, Window } from '../components/common';
import { HaulJob, PRIORITY_LABELS } from '../../sim/Jobs';
import { ITEMS } from '../../data/items';
import { PROFESSIONS } from '../../data/professions';
import { ACTIVITY_LABELS } from '../../sim/Npc';

interface Props {
  game: Game;
  onClose: () => void;
}

type Tab = 'queue' | 'sites' | 'workers';

export function JobsPanel({ game, onClose }: Props): JSX.Element {
  const world = game.world;
  const [tab, setTab] = useState<Tab>('queue');
  const [, refresh] = useState(0);

  const jobs = [...world.jobs.all].sort((a, b) => b.priority - a.priority);
  const sites = world.buildings.filter((b) => !b.complete);

  return (
    <Window title="Work" onClose={onClose} width="wide">
      <Tabs<Tab>
        tabs={[
          { id: 'queue', label: `Queue (${jobs.length})` },
          { id: 'sites', label: `Sites (${sites.length})` },
          { id: 'workers', label: `Workers (${world.npcs.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 14 }}>
        {tab === 'queue' && (
          <>
            <div className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
              Hauling and construction are shared work. Everything else is done by whoever is
              assigned to that workplace.
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
                      ? 'ground'
                      : world.buildingById.get(h.sourceId)?.def.name ?? 'store';
                  label = `Haul ${h.amount} ${ITEMS[h.item].name} — ${source} → ${dest?.def.name ?? '?'}`;
                } else if (j.kind === 'build') {
                  const b = world.buildingById.get(j.buildingId);
                  label = `Build ${b?.def.name ?? '?'} — ${b?.currentStage?.name ?? ''}`;
                } else {
                  const b = world.buildingById.get(j.buildingId);
                  label = `Demolish ${b?.def.name ?? '?'}`;
                }
                return (
                  <div className="list-row" key={j.id} style={{ gridTemplateColumns: '1fr 120px 90px' }}>
                    <span>{label}</span>
                    <span className="tiny muted">{assignee ? assignee.name : 'unassigned'}</span>
                    <Pill tone={j.priority >= 3 ? 'bad' : j.priority === 2 ? 'warn' : undefined}>
                      {PRIORITY_LABELS[j.priority]}
                    </Pill>
                  </div>
                );
              })}
            </div>
            {jobs.length === 0 && (
              <EmptyNote>
                No shared work right now. Mark out a building, or drop goods that need collecting.
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
                    <span>{b.def.name}</span>
                    <div>
                      <div className="tiny">{b.currentStage?.name ?? 'Finishing'}</div>
                      <div className="tiny muted">
                        {missing.length > 0
                          ? `Waiting on ${missing.map((m) => `${m.amount} ${ITEMS[m.item].name.toLowerCase()}`).join(', ')}`
                          : `${builders} working`}
                      </div>
                    </div>
                    <span className="mono tiny">{Math.round(b.progress * 100)}%</span>
                    <Pill tone={missing.length > 0 ? 'warn' : builders > 0 ? 'good' : undefined}>
                      {missing.length > 0 ? 'materials' : builders > 0 ? 'building' : 'idle'}
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
                      {PRIORITY_LABELS.map((p, i) => (
                        <option key={p} value={i}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {sites.length === 0 && <EmptyNote>No construction sites. Press B to mark one out.</EmptyNote>}
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
                  <span className="tiny muted">{PROFESSIONS[n.profession].name}</span>
                  <span className="tiny">{ACTIVITY_LABELS[n.activity]}</span>
                  <span className="tiny muted">{wp ? wp.def.name : 'no workplace'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Window>
  );
}
