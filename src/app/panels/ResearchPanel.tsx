import { useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, Pill, Window } from '../components/common';
import { ALL_RESEARCH_IDS, RESEARCH, ResearchId } from '../../data/research';
import { useT } from '../../i18n';
import { researchDescription, researchName } from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

export function ResearchPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
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
    <Window title={t('res.title')} onClose={onClose} width="wide">
      <div className="two-col" style={{ gap: 24, marginBottom: 14 }}>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            {t('res.current')}
          </div>
          {research.activeNode ? (
            <>
              <div style={{ marginBottom: 6 }}>{researchName(research.activeNode.id)}</div>
              <Bar value={research.activeProgress} />
              <div className="kv" style={{ marginTop: 6 }}>
                <span>{t('insp.progress')}</span>
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
                {t('res.stop')}
              </button>
            </>
          ) : (
            <div className="tiny muted">{t('res.nothingActive')}</div>
          )}
        </div>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            {t('res.capacity')}
          </div>
          <div className="kv">
            <span>{t('res.studies')}</span>
            <span className="mono">{studies}</span>
          </div>
          <div className="kv">
            <span>{t('res.scholars')}</span>
            <span className="mono">{scholars}</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {studies === 0
              ? t('res.needStudy')
              : scholars === 0
                ? t('res.needScholar')
                : t('res.accrues')}
          </div>
        </div>
      </div>

      {[...tiers.keys()]
        .sort((a, b) => a - b)
        .map((tier) => (
          <div key={tier}>
            <div className="section-label">{t('res.tier', { n: tier + 1 })}</div>
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
                    title={researchDescription(node.id)}
                  >
                    <div className="name">
                      {researchName(node.id)} {done && <Pill tone="good">{t('res.known')}</Pill>}
                      {active && <Pill tone="warn">{t('res.active')}</Pill>}
                    </div>
                    <div className="foot">{done ? '\u2014' : t('res.points', { cost: node.cost })}</div>
                    <div className="tiny muted" style={{ marginTop: 5, lineHeight: 1.45 }}>
                      {node.unlocksText.join(' · ')}
                    </div>
                    {!done && node.requires.length > 0 && (
                      <div className="tiny muted" style={{ marginTop: 4 }}>
                        {t('res.needs', { list: node.requires.map(researchName).join(', ') })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      {ALL_RESEARCH_IDS.length === 0 && <EmptyNote>{t('common.none')}</EmptyNote>}
    </Window>
  );
}
