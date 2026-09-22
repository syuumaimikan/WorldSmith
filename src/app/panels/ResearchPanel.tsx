import { useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, Pill, Window } from '../components/common';
import { ALL_RESEARCH_IDS, RESEARCH, ResearchId } from '../../data/research';

interface Props {
  game: Game;
  onClose: () => void;
}

export function ResearchPanel({ game, onClose }: Props): JSX.Element {
  const world = game.world;
  const research = world.research;
  const [, refresh] = useState(0);

  const scholars = world.npcs.filter((n) => n.profession === 'researcher').length;
  const studies = world.buildings.filter((b) => b.complete && b.defId === 'research_hut').length;

  const tiers = new Map<number, ResearchId[]>();
  for (const id of ALL_RESEARCH_IDS) {
    const t = RESEARCH[id].tier;
    const list = tiers.get(t) ?? [];
    list.push(id);
    tiers.set(t, list);
  }

  return (
    <Window title="Research" onClose={onClose} width="wide">
      <div className="two-col" style={{ gap: 24, marginBottom: 14 }}>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            Current project
          </div>
          {research.activeNode ? (
            <>
              <div style={{ marginBottom: 6 }}>{research.activeNode.name}</div>
              <Bar value={research.activeProgress} />
              <div className="kv" style={{ marginTop: 6 }}>
                <span>Progress</span>
                <span className="mono">
                  {Math.round(research.progress)} / {research.activeNode.cost}
                </span>
              </div>
              <button
                className="btn small ghost"
                style={{ marginTop: 8 }}
                onClick={() => {
                  research.cancel();
                  refresh((v) => v + 1);
                }}
              >
                Stop working on this
              </button>
            </>
          ) : (
            <div className="tiny muted">Nothing is being researched. Pick something below.</div>
          )}
        </div>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            Capacity
          </div>
          <div className="kv">
            <span>Studies built</span>
            <span className="mono">{studies}</span>
          </div>
          <div className="kv">
            <span>Scholars</span>
            <span className="mono">{scholars}</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {studies === 0
              ? 'Research needs somewhere to happen. Build a Study.'
              : scholars === 0
                ? 'Nobody is working in the study. Assign someone as a Scholar from the Settlement panel.'
                : 'Progress accrues only while a scholar is actually at work in a study.'}
          </div>
        </div>
      </div>

      {[...tiers.keys()]
        .sort((a, b) => a - b)
        .map((tier) => (
          <div key={tier}>
            <div className="section-label">Tier {tier + 1}</div>
            <div className="build-list">
              {tiers.get(tier)!.map((id) => {
                const node = RESEARCH[id];
                const done = research.isUnlocked(id);
                const canStart = research.canStart(id);
                const active = research.active === id;
                return (
                  <button
                    key={id}
                    className={`build-card ${active ? 'active' : ''} ${!done && !canStart ? 'locked' : ''}`}
                    onClick={() => {
                      if (canStart) {
                        research.start(id);
                        refresh((v) => v + 1);
                      }
                    }}
                    title={node.description}
                  >
                    <div className="name">
                      {node.name} {done && <Pill tone="good">known</Pill>}
                      {active && <Pill tone="warn">active</Pill>}
                    </div>
                    <div className="foot">{done ? '—' : `${node.cost} pts`}</div>
                    <div className="tiny muted" style={{ marginTop: 5, lineHeight: 1.45 }}>
                      {node.unlocksText.join(' · ')}
                    </div>
                    {!done && node.requires.length > 0 && (
                      <div className="tiny muted" style={{ marginTop: 4 }}>
                        needs {node.requires.map((r) => RESEARCH[r].name).join(', ')}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      {ALL_RESEARCH_IDS.length === 0 && <EmptyNote>Nothing to research.</EmptyNote>}
    </Window>
  );
}
