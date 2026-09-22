import { useEffect, useMemo, useState } from 'react';
import { Game, HudSnapshot } from '../../game/Game';
import { GameSpeed, SPEED_OPTIONS } from '../../sim/Time';
import { ItemId, ITEMS } from '../../data/items';
import { ItemIcon } from '../components/common';
import { hexToCss, PALETTE } from '../../render/Palette';
import { WorldEvent } from '../../sim/EventLog';
import { ACTIVITY_LABELS } from '../../sim/Npc';
import { PROFESSIONS } from '../../data/professions';
import { OVERLAY_LABELS } from '../../render/OverlayRenderer';
import { TIER_LABELS } from '../../sim/Settlement';
import { compactNumber } from '../../core/math';

export type PanelId =
  | 'none'
  | 'inventory'
  | 'build'
  | 'settlement'
  | 'jobs'
  | 'research'
  | 'production'
  | 'map'
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
        <div className="hud-date">{hud.date}</div>
        <div className="hud-season">{hud.season}</div>
        <div className="tiny muted">{hud.weather}</div>
        <div className="tiny muted mono">{Math.round(hud.temperature)}°</div>
        <div className="speed-group">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`speed-btn ${hud.speed === s ? 'active' : ''}`}
              title={s === 0 ? 'Pause' : `${s}x speed`}
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
          <StatBar label="Health" value={player.stats.health / 100} color={PALETTE.ui.bad} />
          <StatBar label="Stamina" value={player.stats.stamina / 100} color={PALETTE.ui.good} />
          <StatBar label="Pack" value={player.carriedWeightFraction()} color={PALETTE.ui.warn} />
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
            <span>{TIER_LABELS[settlement.tier]}</span>
            <span className="mono">{settlement.population} settlers</span>
          </div>
          <div className="kv">
            <span>Housing</span>
            <span className="mono">
              {settlement.population - settlement.homeless}/{settlement.housingCapacity}
            </span>
          </div>
          <div className="kv">
            <span>Food</span>
            <span className="mono" style={{ color: settlement.foodDays < 3 ? hexToCss(PALETTE.ui.bad) : undefined }}>
              {settlement.foodDays > 90 ? '∞' : `${settlement.foodDays.toFixed(1)}d`}
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
          <ToolButton label="Build" hotkey="B" active={panel === 'build'} onClick={() => onOpenPanel('build')} />
          <ToolButton label="Inventory" hotkey="Tab" active={panel === 'inventory'} onClick={() => onOpenPanel('inventory')} />
          <ToolButton label="Settlement" hotkey="C" active={panel === 'settlement'} onClick={() => onOpenPanel('settlement')} />
          <ToolButton label="Jobs" hotkey="J" active={panel === 'jobs'} onClick={() => onOpenPanel('jobs')} />
          <ToolButton label="Production" hotkey="P" active={panel === 'production'} onClick={() => onOpenPanel('production')} />
          <ToolButton label="Research" hotkey="T" active={panel === 'research'} onClick={() => onOpenPanel('research')} />
          <ToolButton label="Map" hotkey="M" active={panel === 'map'} onClick={() => onOpenPanel('map')} />
          <ToolButton label="Chronicle" hotkey="" active={panel === 'chronicle'} onClick={() => onOpenPanel('chronicle')} />
        </div>
        <div className="tiny muted mono" style={{ textAlign: 'right' }}>
          {OVERLAY_LABELS[game.overlay]} · O
        </div>
        <div className="tiny muted mono" style={{ textAlign: 'right' }}>
          {hud.cameraMode} view · V
        </div>
      </div>

      {/* ----------------------------------------------------------- bottom */}
      <div className="hud-bottom">
        {placement && placement.buildingId && (
          <div className="interact-prompt" style={{ borderColor: placement.valid ? undefined : hexToCss(PALETTE.ui.bad) }}>
            {placement.valid ? (
              <>
                <kbd>LMB</kbd> place · <kbd>R</kbd> rotate · <kbd>Esc</kbd> cancel
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
        {toasts.map((t) => (
          <div className={`toast ${t.category}`} key={t.id}>
            <div className="when">{t.dateLabel}</div>
            <div>{t.text}</div>
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

const TUTORIAL_STEPS = [
  {
    title: 'Look around',
    body:
      'WASD to walk, hold right mouse to turn the camera, Shift to run. Your settlers arrived with a few supplies dropped on the ground nearby.',
  },
  {
    title: 'Mark out a shelter',
    body:
      'Press B and place a Tent or Stockpile. Placing a blueprint does not build it — it stakes out a site and asks the settlement for materials.',
  },
  {
    title: 'Gather what it needs',
    body:
      'Walk up to a tree and hold F to fell it. Press E to pick up logs lying on the ground. Your loggers will do the same on their own.',
  },
  {
    title: 'Get materials on site',
    body:
      'Haulers carry goods from stores to sites. You can help: stand at a site with materials in your pack and press E to hand them over.',
  },
  {
    title: 'Watch it go up',
    body:
      'Builders work the site stage by stage: footings, frame, walls, roof. Press O to see construction progress above each site.',
  },
  {
    title: 'It becomes a home',
    body:
      'Finished housing gets residents. Finished workshops get workers and start producing. Check the Settlement panel with C.',
  },
  {
    title: 'Keep it running',
    body:
      'A settlement stalls when it runs out of hands, materials or storage. The warnings on the left tell you which. You are on your own from here.',
  },
];

function Tutorial({ step, onDismiss }: { step: number; onDismiss: () => void }): JSX.Element {
  const s = TUTORIAL_STEPS[Math.min(step, TUTORIAL_STEPS.length - 1)];
  return (
    <div className="tutorial">
      <h4>{s.title}</h4>
      <p>{s.body}</p>
      <div className="steps">
        {TUTORIAL_STEPS.map((_, i) => (
          <i key={i} className={i < step ? 'done' : i === step ? 'current' : ''} />
        ))}
      </div>
      <button
        className="btn small ghost"
        style={{ marginTop: 8, width: '100%', textAlign: 'center' }}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function Inspector({ game }: { game: Game }): JSX.Element | null {
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
          {PROFESSIONS[npc.profession].name} · {npc.age} years · {npc.moodLabel()}
        </div>
        <div className="kv">
          <span>Doing</span>
          <span>{ACTIVITY_LABELS[npc.activity]}</span>
        </div>
        <div className="kv">
          <span>Carrying</span>
          <span className="mono tiny">{npc.carryingSummary()}</span>
        </div>
        <div className="kv">
          <span>Home</span>
          <span>{home ? home.def.name : 'None'}</span>
        </div>
        <div className="kv">
          <span>Works at</span>
          <span>{work ? work.def.name : '—'}</span>
        </div>
        <div className="section-label">Needs</div>
        <NeedBar label="Food" value={npc.needs.hunger / 100} />
        <NeedBar label="Rest" value={npc.needs.rest / 100} />
        <NeedBar label="Social" value={npc.needs.social / 100} />
        <NeedBar label="Comfort" value={npc.needs.comfort / 100} />
        <button className="btn small ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => (world.selection = null)}>
          Close
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
        <h4>{b.def.name}</h4>
        <div className="sub">{b.statusText()}</div>
        {!b.complete && (
          <>
            <div className="kv">
              <span>Stage</span>
              <span>
                {b.stageIndex + 1} of {b.def.stages.length}
              </span>
            </div>
            <div className="kv">
              <span>Progress</span>
              <span className="mono">{Math.round(b.progress * 100)}%</span>
            </div>
            <div className="progress-ring">
              <div style={{ width: `${b.progress * 100}%` }} />
            </div>
            {materials.length > 0 && (
              <>
                <div className="section-label">Materials on site</div>
                {materials.map((m) => (
                  <div className="mat-row" key={m.item}>
                    <span>{ITEMS[m.item].name}</span>
                    <span className={m.have >= m.need ? 'have' : 'short'}>
                      {m.have}/{m.need}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div className="kv">
              <span>Builders</span>
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
                <span>Workers</span>
                <span className="mono">
                  {b.workerIds.length}/{b.def.workSlots}
                </span>
              </div>
            )}
            {(b.def.housing ?? 0) > 0 && (
              <div className="kv">
                <span>Residents</span>
                <span className="mono">
                  {b.residentIds.length}/{b.def.housing}
                </span>
              </div>
            )}
            {(b.def.storageSlots ?? 0) > 0 && (
              <>
                <div className="kv">
                  <span>Storage</span>
                  <span className="mono">
                    {b.inventory.usedSlots()}/{b.inventory.capacity}
                  </span>
                </div>
                <div className="section-label">Contents</div>
                {b.inventory.summary().slice(0, 6).map((s) => (
                  <div className="mat-row" key={s.item}>
                    <span>{ITEMS[s.item].name}</span>
                    <span className="mono">{s.count}</span>
                  </div>
                ))}
                {b.inventory.isEmpty() && <div className="tiny muted">Empty</div>}
              </>
            )}
            <div className="kv">
              <span>Condition</span>
              <span className="mono">{Math.round(b.condition * 100)}%</span>
            </div>
            {b.builtBy.length > 0 && (
              <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                Built by {b.builtBy.slice(0, 3).join(', ')}
                {b.completedDay >= 0 && `, finished on day ${b.completedDay}`}.
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
            {b.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="btn small danger ghost"
            style={{ flex: 1 }}
            onClick={() => {
              world.startDemolition(b);
              world.selection = null;
            }}
          >
            {b.complete ? 'Demolish' : 'Cancel'}
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
        <h4>{n.kind.replace(/_/g, ' ')}</h4>
        <div className="sub">Resource</div>
        <div className="kv">
          <span>Remaining</span>
          <span className="mono">
            {n.amount}/{n.maxAmount}
          </span>
        </div>
        <div className="kv">
          <span>Maturity</span>
          <span className="mono">{Math.round(n.growth * 100)}%</span>
        </div>
        <button className="btn small ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => (world.selection = null)}>
          Close
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
  const w = game.world;
  return (
    <div className="debug-panel">
      <div className="debug-row">
        <span>FPS</span>
        <b>{hud.fps.toFixed(0)}</b>
      </div>
      <div className="debug-row">
        <span>Draw calls</span>
        <b>{hud.drawCalls}</b>
      </div>
      <div className="debug-row">
        <span>Triangles</span>
        <b>{compactNumber(hud.triangles)}</b>
      </div>
      <div className="debug-row">
        <span>Settlers</span>
        <b>{w.npcs.length}</b>
      </div>
      <div className="debug-row">
        <span>Buildings</span>
        <b>{w.buildings.length}</b>
      </div>
      <div className="debug-row">
        <span>Resource nodes</span>
        <b>{w.nodes.length}</b>
      </div>
      <div className="debug-row">
        <span>Ground piles</span>
        <b>{w.piles.length}</b>
      </div>
      <div className="debug-row">
        <span>Open jobs</span>
        <b>{w.jobs.openCount}/{w.jobs.all.length}</b>
      </div>
      <div className="debug-row">
        <span>Wildlife</span>
        <b>{w.wildlife.length}</b>
      </div>
      <div className="debug-row">
        <span>Paths queued</span>
        <b>{w.nav.stats.queued}</b>
      </div>
      <div className="debug-row">
        <span>Particles</span>
        <b>{game.particles.activeCount}</b>
      </div>
      <div className="debug-row">
        <span>Seed</span>
        <b>{w.config.seedText}</b>
      </div>
    </div>
  );
}
