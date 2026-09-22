import { useEffect, useMemo, useState } from 'react';
import { Game, HudSnapshot } from '../../game/Game';
import { GameSpeed, SPEED_OPTIONS } from '../../sim/Time';
import { ItemId, ITEMS } from '../../data/items';
import { ItemIcon } from '../components/common';
import { hexToCss, PALETTE } from '../../render/Palette';
import { WorldEvent } from '../../sim/EventLog';
import { compactNumber } from '../../core/math';
import { useT } from '../../i18n';
import { eventDate, eventText, formatDate } from '../../i18n/events';
import {
  activityName,
  buildingName,
  itemName,
  moodName,
  professionName,
  resourceName,
  seasonName,
  tierName,
  weatherName,
  buildingStatus,
  carryingSummary,
} from '../../i18n/names';

export type PanelId =
  | 'none'
  | 'inventory'
  | 'build'
  | 'settlement'
  | 'jobs'
  | 'research'
  | 'production'
  | 'map'
  | 'climate'
  | 'sky'
  | 'chronicle'
  | 'menu';

interface Props {
  game: Game;
  hud: HudSnapshot;
  panel: PanelId;
  onOpenPanel: (p: PanelId) => void;
  showDebug: boolean;
  tutorialDismissed: boolean;
  onDismissTutorial: () => void;
}

const HEADLINE_RESOURCES: ItemId[] = ['log', 'plank', 'stone', 'bread', 'iron_ingot'];

export function Hud({
  game,
  hud,
  panel,
  onOpenPanel,
  showDebug,
  tutorialDismissed,
  onDismissTutorial,
}: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [toasts, setToasts] = useState<WorldEvent[]>([]);

  // Drain notable events into the toast stack.
  useEffect(() => {
    const drained = world.log.drainToasts();
    if (drained.length === 0) return;
    setToasts((prev) => [...prev, ...drained].slice(-4));
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [hud.version, world.log]);

  const stored = useMemo(() => {
    const totals = new Map<ItemId, number>();
    for (const b of world.buildings) {
      if (!b.complete) continue;
      for (const s of b.inventory.slots) {
        if (s) totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
      }
    }
    return totals;
    // Recomputed on every HUD tick; cheap relative to a frame.
  }, [hud.version, world.buildings]);

  const settlement = world.settlement;
  const player = world.player;
  const placement = hud.placement;
  const target = hud.target;
  const selection = world.selection;

  return (
    <div className="overlay">
      {/* ---------------------------------------------------------- top bar */}
      <div className="hud-topbar">
        <div className="hud-clock">{hud.clock}</div>
        <div className="hud-date">{formatDate(hud.year, hud.month, hud.dayOfMonth)}</div>
        <div className="hud-season">{seasonName(hud.season)}</div>
        <div className="tiny muted">{weatherName(hud.weather)}</div>
        <div className="tiny muted mono">{Math.round(hud.temperature)}°</div>
        <div className="speed-group">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`speed-btn ${hud.speed === s ? 'active' : ''}`}
              title={s === 0 ? t('hud.pause') : t('hud.speed', { value: s })}
              onClick={() => game.setSpeed(s as GameSpeed)}
            >
              {s === 0 ? '❚❚' : `${s}`}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------- left */}
      <div className="hud-left">
        <div className="panel stat-bars">
          <StatBar label={t('hud.health')} value={player.stats.health / 100} color={PALETTE.ui.bad} />
          <StatBar label={t('hud.stamina')} value={player.stats.stamina / 100} color={PALETTE.ui.good} />
          <StatBar label={t('hud.pack')} value={player.carriedWeightFraction()} color={PALETTE.ui.warn} />
        </div>

        <div className="panel resource-strip">
          {HEADLINE_RESOURCES.map((item) => (
            <div className="res-chip" key={item} title={ITEMS[item].name}>
              <i className="res-dot" style={{ background: hexToCss(ITEMS[item].color) }} />
              {compactNumber(stored.get(item) ?? 0)}
            </div>
          ))}
        </div>

        <div className="panel resource-strip" style={{ flexDirection: 'column', gap: 4 }}>
          <div className="kv">
            <span>{tierName(settlement.tier)}</span>
            <span className="mono">{t('hud.settlers', { count: settlement.population })}</span>
          </div>
          <div className="kv">
            <span>{t('hud.housing')}</span>
            <span className="mono">
              {settlement.population - settlement.homeless}/{settlement.housingCapacity}
            </span>
          </div>
          <div className="kv">
            <span>{t('hud.food')}</span>
            <span className="mono" style={{ color: settlement.foodDays < 3 ? hexToCss(PALETTE.ui.bad) : undefined }}>
              {settlement.foodDays > 90 ? '∞' : t('hud.days', { value: settlement.foodDays.toFixed(1) })}
            </span>
          </div>
        </div>

        {world.economy.bottlenecks.length > 0 && (
          <div className="panel resource-strip" style={{ flexDirection: 'column', gap: 5 }}>
            {world.economy.bottlenecks.slice(0, 3).map((b, i) => (
              <div
                key={i}
                className="tiny"
                style={{
                  color:
                    b.severity === 'critical'
                      ? hexToCss(PALETTE.ui.bad)
                      : b.severity === 'warn'
                        ? hexToCss(PALETTE.ui.warn)
                        : undefined,
                }}
                title={b.detail}
              >
                • {b.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ right */}
      <div className="hud-right">
        <div className="tool-buttons">
          <ToolButton label={t('hud.build')} hotkey="B" active={panel === 'build'} onClick={() => onOpenPanel('build')} />
          <ToolButton label={t('hud.inventory')} hotkey="Tab" active={panel === 'inventory'} onClick={() => onOpenPanel('inventory')} />
          <ToolButton label={t('hud.settlement')} hotkey="C" active={panel === 'settlement'} onClick={() => onOpenPanel('settlement')} />
          <ToolButton label={t('hud.jobs')} hotkey="J" active={panel === 'jobs'} onClick={() => onOpenPanel('jobs')} />
          <ToolButton label={t('hud.production')} hotkey="P" active={panel === 'production'} onClick={() => onOpenPanel('production')} />
          <ToolButton label={t('hud.research')} hotkey="T" active={panel === 'research'} onClick={() => onOpenPanel('research')} />
          <ToolButton label={t('hud.map')} hotkey="M" active={panel === 'map'} onClick={() => onOpenPanel('map')} />
          <ToolButton label={t('hud.climate')} hotkey="K" active={panel === 'climate'} onClick={() => onOpenPanel('climate')} />
          <ToolButton label={t('hud.sky')} hotkey="N" active={panel === 'sky'} onClick={() => onOpenPanel('sky')} />
          <ToolButton label={t('hud.chronicle')} hotkey="" active={panel === 'chronicle'} onClick={() => onOpenPanel('chronicle')} />
        </div>
        <div className="tiny muted mono" style={{ textAlign: 'right' }}>
          {t('overlay.' + game.overlay)} · O
        </div>
        <div className="tiny muted mono" style={{ textAlign: 'right' }}>
          {t('hud.cameraMode', { mode: hud.cameraMode })} · V
        </div>
      </div>

      {/* ----------------------------------------------------------- bottom */}
      <div className="hud-bottom">
        {placement && placement.buildingId && (
          <div className="interact-prompt" style={{ borderColor: placement.valid ? undefined : hexToCss(PALETTE.ui.bad) }}>
            {placement.valid ? (
              <>
                <kbd>LMB</kbd> {t('prompt.place')} · <kbd>R</kbd> {t('prompt.rotate')} ·{' '}
                <kbd>Esc</kbd> {t('prompt.cancel')}
              </>
            ) : (
              <span style={{ color: hexToCss(PALETTE.ui.bad) }}>{placement.reason}</span>
            )}
          </div>
        )}

        {!placement && target.kind !== 'none' && (
          <div className="interact-prompt">
            {target.kind === 'node' ? (
              <>
                <kbd>F</kbd> {target.verb} {target.label}
                <span className="muted tiny">{target.detail}</span>
              </>
            ) : (
              <>
                <kbd>E</kbd> {target.verb} — {target.label}
                {target.detail && <span className="muted tiny">{target.detail}</span>}
              </>
            )}
          </div>
        )}

        <div className="quickbar">
          {player.inventory.summary().slice(0, 6).map((stack, i) => (
            <div className="quick-slot" key={stack.item}>
              <span className="num">{i + 1}</span>
              <ItemIcon item={stack.item} />
              <span className="count">{stack.count}</span>
            </div>
          ))}
          {player.inventory.isEmpty() && (
            <div className="quick-slot">
              <span className="num">1</span>
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- selection */}
      {selection && <Inspector game={game} />}

      {/* ---------------------------------------------------------- tutorial */}
      {game.settings.showTutorial && !tutorialDismissed && world.tutorialStep < 7 && (
        <Tutorial step={world.tutorialStep} onDismiss={onDismissTutorial} />
      )}

      {/* ------------------------------------------------------------ toasts */}
      <div className="toast-stack">
        {hud.toast && (
          <div className="toast">
            <div>{hud.toast}</div>
          </div>
        )}
        {toasts.map((ev) => (
          <div className={`toast ${ev.category}`} key={ev.id}>
            <div className="when">{eventDate(ev)}</div>
            <div>{eventText(ev)}</div>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------------- debug */}
      {showDebug && <DebugPanel game={game} hud={hud} />}
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: number }): JSX.Element {
  return (
    <div className="stat-bar">
      <span>{label}</span>
      <div className="track">
        <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: hexToCss(color) }} />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  hotkey,
  active,
  onClick,
}: {
  label: string;
  hotkey: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={`tool-btn ${active ? 'active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {hotkey && <kbd>{hotkey}</kbd>}
    </button>
  );
}

const TUTORIAL_STEP_COUNT = 7;

function Tutorial({ step, onDismiss }: { step: number; onDismiss: () => void }): JSX.Element {
  const t = useT();
  const i = Math.min(step, TUTORIAL_STEP_COUNT - 1);
  return (
    <div className="tutorial">
      <h4>{t(`tut.${i}.title`)}</h4>
      <p>{t(`tut.${i}.body`)}</p>
      <div className="steps">
        {Array.from({ length: TUTORIAL_STEP_COUNT }, (_, k) => (
          <i key={k} className={k < step ? 'done' : k === step ? 'current' : ''} />
        ))}
      </div>
      <button
        className="btn small ghost"
        style={{ marginTop: 8, width: '100%', textAlign: 'center' }}
        onClick={onDismiss}
      >
        {t('tut.dismiss')}
      </button>
    </div>
  );
}

function Inspector({ game }: { game: Game }): JSX.Element | null {
  const t = useT();
  const sel = game.world.selection;
  if (!sel) return null;
  const world = game.world;

  if (sel.kind === 'npc') {
    const npc = world.npcById.get(sel.id);
    if (!npc) return null;
    const home = world.buildingById.get(npc.homeId);
    const work = world.buildingById.get(npc.workplaceId);
    return (
      <div className="panel inspector">
        <h4>{npc.name}</h4>
        <div className="sub">
          {professionName(npc.profession)} · {t('insp.age', { age: npc.age })} · {moodName(npc.needs.mood)}
        </div>
        <div className="kv">
          <span>{t('insp.doing')}</span>
          <span>{activityName(npc.activity)}</span>
        </div>
        <div className="kv">
          <span>{t('insp.carrying')}</span>
          <span className="mono tiny">{carryingSummary(npc.carrying())}</span>
        </div>
        <div className="kv">
          <span>{t('insp.home')}</span>
          <span>{home ? buildingName(home.defId) : t('insp.none')}</span>
        </div>
        <div className="kv">
          <span>{t('insp.worksAt')}</span>
          <span>{work ? buildingName(work.defId) : '—'}</span>
        </div>
        <div className="section-label">{t('insp.needs')}</div>
        <NeedBar label={t('need.food')} value={npc.needs.hunger / 100} />
        <NeedBar label={t('need.rest')} value={npc.needs.rest / 100} />
        <NeedBar label={t('need.social')} value={npc.needs.social / 100} />
        <NeedBar label={t('need.comfort')} value={npc.needs.comfort / 100} />
        <button className="btn small ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => (world.selection = null)}>
          {t('insp.close')}
        </button>
      </div>
    );
  }

  if (sel.kind === 'building') {
    const b = world.buildingById.get(sel.id);
    if (!b) return null;
    const materials = b.materialsDelivered();
    return (
      <div className="panel inspector">
        <h4>{buildingName(b.defId)}</h4>
        <div className="sub">{buildingStatus(b.status())}</div>
        {!b.complete && (
          <>
            <div className="kv">
              <span>{t('insp.stage')}</span>
              <span>
                {b.stageIndex + 1} of {b.def.stages.length}
              </span>
            </div>
            <div className="kv">
              <span>{t('insp.progress')}</span>
              <span className="mono">{Math.round(b.progress * 100)}%</span>
            </div>
            <div className="progress-ring">
              <div style={{ width: `${b.progress * 100}%` }} />
            </div>
            {materials.length > 0 && (
              <>
                <div className="section-label">{t('insp.materialsOnSite')}</div>
                {materials.map((m) => (
                  <div className="mat-row" key={m.item}>
                    <span>{itemName(m.item)}</span>
                    <span className={m.have >= m.need ? 'have' : 'short'}>
                      {m.have}/{m.need}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div className="kv">
              <span>{t('insp.builders')}</span>
              <span className="mono">
                {world.jobs.all.filter((j) => j.kind === 'build' && j.buildingId === b.id && j.assignedTo !== 0).length}
              </span>
            </div>
          </>
        )}
        {b.complete && (
          <>
            {b.def.workSlots > 0 && (
              <div className="kv">
                <span>{t('insp.workers')}</span>
                <span className="mono">
                  {b.workerIds.length}/{b.def.workSlots}
                </span>
              </div>
            )}
            {(b.def.housing ?? 0) > 0 && (
              <div className="kv">
                <span>{t('insp.residents')}</span>
                <span className="mono">
                  {b.residentIds.length}/{b.def.housing}
                </span>
              </div>
            )}
            {(b.def.storageSlots ?? 0) > 0 && (
              <>
                <div className="kv">
                  <span>{t('insp.storage')}</span>
                  <span className="mono">
                    {b.inventory.usedSlots()}/{b.inventory.capacity}
                  </span>
                </div>
                <div className="section-label">{t('insp.contents')}</div>
                {b.inventory.summary().slice(0, 6).map((s) => (
                  <div className="mat-row" key={s.item}>
                    <span>{itemName(s.item)}</span>
                    <span className="mono">{s.count}</span>
                  </div>
                ))}
                {b.inventory.isEmpty() && <div className="tiny muted">{t('insp.empty')}</div>}
              </>
            )}
            <div className="kv">
              <span>{t('insp.condition')}</span>
              <span className="mono">{Math.round(b.condition * 100)}%</span>
            </div>
            {b.builtBy.length > 0 && (
              <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {t('insp.builtBy', {
                  names: b.builtBy.slice(0, 3).join(', '),
                  day: b.completedDay,
                })}
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            className="btn small ghost"
            style={{ flex: 1 }}
            onClick={() => {
              b.paused = !b.paused;
            }}
          >
            {b.paused ? t('insp.resume') : t('insp.pause')}
          </button>
          <button
            className="btn small danger ghost"
            style={{ flex: 1 }}
            onClick={() => {
              world.startDemolition(b);
              world.selection = null;
            }}
          >
            {b.complete ? t('insp.demolish') : t('insp.cancel')}
          </button>
        </div>
      </div>
    );
  }

  if (sel.kind === 'node') {
    const n = world.nodeById.get(sel.id);
    if (!n) return null;
    return (
      <div className="panel inspector">
        <h4>{resourceName(n.kind)}</h4>
        <div className="sub">{t('insp.resource')}</div>
        <div className="kv">
          <span>{t('insp.remaining')}</span>
          <span className="mono">
            {n.amount}/{n.maxAmount}
          </span>
        </div>
        <div className="kv">
          <span>{t('insp.maturity')}</span>
          <span className="mono">{Math.round(n.growth * 100)}%</span>
        </div>
        <button className="btn small ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => (world.selection = null)}>
          {t('insp.close')}
        </button>
      </div>
    );
  }

  return null;
}

function NeedBar({ label, value }: { label: string; value: number }): JSX.Element {
  const color = value > 0.6 ? PALETTE.ui.good : value > 0.3 ? PALETTE.ui.warn : PALETTE.ui.bad;
  return (
    <div className="stat-bar">
      <span>{label}</span>
      <div className="track">
        <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: hexToCss(color) }} />
      </div>
    </div>
  );
}

function DebugPanel({ game, hud }: { game: Game; hud: HudSnapshot }): JSX.Element {
  const t = useT();
  const w = game.world;
  return (
    <div className="debug-panel">
      <div className="debug-row">
        <span>{t('common.fps')}</span>
        <b>{hud.fps.toFixed(0)}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.drawCalls')}</span>
        <b>{hud.drawCalls}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.triangles')}</span>
        <b>{compactNumber(hud.triangles)}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.settlers')}</span>
        <b>{w.npcs.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.buildings')}</span>
        <b>{w.buildings.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.resourceNodes')}</span>
        <b>{w.nodes.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.groundPiles')}</span>
        <b>{w.piles.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.openJobs')}</span>
        <b>{w.jobs.openCount}/{w.jobs.all.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.wildlife')}</span>
        <b>{w.wildlife.length}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.pathsQueued')}</span>
        <b>{w.nav.stats.queued}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.particles')}</span>
        <b>{game.particles.activeCount}</b>
      </div>
      <div className="debug-row">
        <span>{t('common.seed')}</span>
        <b>{w.config.seedText}</b>
      </div>
    </div>
  );
}
