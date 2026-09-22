import { useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, Pill, Tabs, Window } from '../components/common';
import { hexToCss, mixHex, PALETTE } from '../../render/Palette';
import { clamp01 } from '../../core/math';
import { useT } from '../../i18n';
import { LAWS, LawId, Nation } from '../../sim/Nations';
import { DAYS_PER_YEAR } from '../../sim/Time';

interface Props {
  game: Game;
  onClose: () => void;
}

type NationTab = 'us' | 'world' | 'wars';

const ALL_LAWS = Object.keys(LAWS) as LawId[];

export function NationPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<NationTab>('us');

  return (
    <Window title={t('nation.title')} onClose={onClose}>
      <Tabs
        tabs={[
          { id: 'us', label: t('nation.tab.us') },
          { id: 'world', label: t('nation.tab.world') },
          { id: 'wars', label: t('dip.wars') },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'us' && <UsTab game={game} />}
      {tab === 'world' && <WorldTab game={game} />}
      {tab === 'wars' && <WarsTab game={game} />}
    </Window>
  );
}

function UsTab({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const [, refresh] = useState(0);
  const world = game.world;
  const nation = world.nations.playerNation;
  if (!nation) return <EmptyNote>—</EmptyNote>;

  const reignYears = Math.floor((world.time.totalDays - nation.leader.since) / DAYS_PER_YEAR);

  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>
        {nation.name}
      </div>
      <div className="stat-grid">
        <Reading label={t('nation.government')} value={t(`gov.${nation.government}`)} />
        <Reading label={t('nation.population')} value={String(Math.round(nation.population))} />
        <Reading label={t('nation.territory')} value={String(nation.territory)} />
        <Reading label={t('nation.treasury')} value={Math.round(nation.treasury).toString()} />
        <Reading label={t('nation.army')} value={String(Math.round(nation.army))} />
        <Reading
          label={t('nation.regimeChanges')}
          value={String(nation.regimeChanges)}
        />
      </div>

      <div className="section-label">{t('nation.leader')}</div>
      <div style={{ marginBottom: 2 }}>{nation.leader.name}</div>
      <div className="tiny muted" style={{ marginBottom: 8 }}>
        {t(`nation.cameBy.${nation.leader.cameBy}`)} ·{' '}
        {t('nation.reign')} {t('nation.years', { years: reignYears })}
      </div>
      <TraitBar label={t('nation.trait.competence')} value={nation.leader.competence} good />
      <TraitBar label={t('nation.trait.ambition')} value={nation.leader.ambition} />
      <TraitBar label={t('nation.trait.cruelty')} value={nation.leader.cruelty} />
      <TraitBar label={t('nation.trait.piety')} value={nation.leader.piety} />

      <div className="section-label">{t('nation.stability')}</div>
      <TraitBar label={t('nation.stability')} value={nation.stability} good />
      <TraitBar label={t('nation.legitimacy')} value={nation.legitimacy} good />
      <TraitBar label={t('nation.unrest')} value={nation.unrest} />
      {nation.inCivilWar && (
        <div style={{ marginTop: 6 }}>
          <Pill tone="bad">{t('nation.civilWar')}</Pill>
        </div>
      )}

      <div className="section-label">{t('nation.taxRate')}</div>
      <div className="field">
        <label>{Math.round(nation.taxRate * 100)} %</label>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={nation.taxRate}
          onChange={(e) => {
            nation.taxRate = Number(e.target.value);
            refresh((v) => v + 1);
          }}
        />
      </div>

      <div className="section-label">{t('nation.laws')}</div>
      <div className="list">
        {ALL_LAWS.map((id) => {
          const held = nation.laws.has(id);
          return (
            <div key={id} className="list-row" style={{ gridTemplateColumns: '1fr 90px' }}>
              <div>
                <div>{t(`law.${id}`)}</div>
                <div className="tiny muted" style={{ lineHeight: 1.5 }}>
                  {t(`law.${id}.desc`)}
                </div>
                <div className="tiny muted">
                  {t('law.upkeep', { percent: Math.round(LAWS[id].upkeep * 100) })}
                </div>
              </div>
              <button
                className={`btn small ${held ? 'ghost' : ''}`}
                onClick={() => {
                  if (held) nation.laws.delete(id);
                  else nation.laws.add(id);
                  refresh((v) => v + 1);
                }}
              >
                {held ? t('law.repeal') : t('law.enact')}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function WorldTab({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const mine = world.nations.playerNation;
  const others = world.nations.nations.filter((n) => !n.isPlayer);
  const neighbours = mine ? new Set(world.nations.neighboursOf(mine).map((n) => n.id)) : new Set();

  if (others.length === 0) return <EmptyNote>{t('nation.none')}</EmptyNote>;

  return (
    <div className="list">
      {others
        .slice()
        .sort((a, b) => b.population - a.population)
        .map((n) => (
          <button
            key={n.id}
            className="list-row"
            style={{ gridTemplateColumns: '1fr 110px', textAlign: 'left' }}
            onClick={() => game.lookAt(n.x, n.z)}
          >
            <div>
              <div>
                {n.name}
                {neighbours.has(n.id) && (
                  <span className="tiny muted"> · {t('nation.neighbours').toLowerCase()}</span>
                )}
              </div>
              <div className="tiny muted">
                {t(`gov.${n.government}`)} · {n.leader.name}
              </div>
              <div className="tiny muted mono">
                {Math.round(n.population)} · {n.territory} · {Math.round(n.army)}
              </div>
            </div>
            <StabilityPill nation={n} />
          </button>
        ))}
    </div>
  );
}

function WarsTab({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const dip = world.diplomacy;
  const mine = world.nations.playerNation;

  return (
    <>
      {dip.wars.length === 0 ? (
        <EmptyNote>{t('dip.noWars')}</EmptyNote>
      ) : (
        <div className="list">
          {dip.wars.map((w) => {
            const attacker = world.nations.byId(w.attacker);
            const defender = world.nations.byId(w.defender);
            const involvesUs = mine && (w.attacker === mine.id || w.defender === mine.id);
            return (
              <div key={w.id} className="list-row" style={{ gridTemplateColumns: '1fr 90px' }}>
                <div>
                  <div>
                    {attacker?.name ?? '?'} — {defender?.name ?? '?'}
                  </div>
                  <div className="tiny muted">
                    {t(`wargoal.${w.goal}`)} · {t('dip.since', { day: w.startedDay })} ·{' '}
                    {t('dip.battles', { count: w.battles })}
                  </div>
                  <div className="tiny muted mono">
                    {t('dip.warScore')} {(w.warScore * 100).toFixed(0)} · {t('dip.exhaustion')}{' '}
                    {Math.round(w.attackerExhaustion * 100)}/{Math.round(w.defenderExhaustion * 100)}
                  </div>
                </div>
                {involvesUs && <Pill tone="bad">{t('nation.tab.us')}</Pill>}
              </div>
            );
          })}
        </div>
      )}

      <div className="section-label">{t('dip.armies')}</div>
      {dip.armies.length === 0 ? (
        <EmptyNote>—</EmptyNote>
      ) : (
        <div className="list">
          {dip.armies.map((a) => {
            const owner = world.nations.byId(a.nation);
            return (
              <button
                key={a.id}
                className="list-row"
                style={{ gridTemplateColumns: '1fr 80px', textAlign: 'left' }}
                onClick={() => game.lookAt(a.x, a.z)}
              >
                <span className="tiny">
                  {t('dip.armyLine', {
                    nation: owner?.name ?? '?',
                    strength: Math.round(a.strength),
                    stance: t(`dip.stance.${a.stance}`),
                  })}
                </span>
                <span className="tiny mono muted">
                  {t('dip.supply')} {Math.round(a.supply * 100)}%
                </span>
              </button>
            );
          })}
        </div>
      )}

      {mine && (
        <>
          <div className="section-label">{t('dip.title')}</div>
          <div className="list">
            {world.nations.nations
              .filter((n) => !n.isPlayer)
              .map((n) => {
                const r = dip.relation(mine.id, n.id);
                return (
                  <div key={n.id} className="list-row" style={{ gridTemplateColumns: '1fr 110px' }}>
                    <div>
                      <div>{n.name}</div>
                      <div className="tiny muted">
                        {t('dip.treaty')}: {t(`dip.treaty.${r.treaty}`)}
                        {r.truceDays > 0 && ` · ${t('dip.truce', { days: Math.round(r.truceDays) })}`}
                        {r.wars > 0 && ` · ${t('dip.pastWars')} ${r.wars}`}
                      </div>
                    </div>
                    <span className="tiny mono">
                      {t('dip.opinion')} {r.opinion > 0 ? '+' : ''}
                      {Math.round(r.opinion)}
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </>
  );
}

function StabilityPill({ nation }: { nation: Nation }): JSX.Element {
  const t = useT();
  const tone = nation.stability < 0.25 ? 'bad' : nation.stability < 0.5 ? 'warn' : 'good';
  return (
    <Pill tone={tone}>
      {t('nation.stability')} {Math.round(nation.stability * 100)}%
    </Pill>
  );
}

function Reading({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <span className="tiny muted">{label}</span>
      <b className="mono">{value}</b>
    </div>
  );
}

function TraitBar({
  label,
  value,
  good,
}: {
  label: string;
  value: number;
  good?: boolean;
}): JSX.Element {
  const colour = good
    ? mixHex(PALETTE.ui.bad, PALETTE.ui.good, clamp01(value))
    : mixHex(PALETTE.ui.good, PALETTE.ui.bad, clamp01(value));
  return (
    <div className="kv" style={{ alignItems: 'center', gap: 8 }}>
      <span className="tiny muted" style={{ minWidth: 92 }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>
        <Bar value={value} color={hexToCss(colour)} />
      </div>
      <span className="tiny mono muted" style={{ minWidth: 34, textAlign: 'right' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
