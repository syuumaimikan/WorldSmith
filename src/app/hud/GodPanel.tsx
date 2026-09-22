import { useState } from 'react';
import { Game, HudSnapshot } from '../../game/Game';
import { GOD_POWERS, GodCategory, GodPowerId } from '../../game/GodMode';
import { useT } from '../../i18n';
import { professionName } from '../../i18n/names';
import { eventDate, eventText } from '../../i18n/events';
import { hexToCss, PALETTE } from '../../render/Palette';

interface Props {
  game: Game;
  hud: HudSnapshot;
  onExit: () => void;
}

const CATEGORIES: GodCategory[] = ['weather', 'geology', 'water', 'life', 'civilization', 'disaster'];

/**
 * The god-mode interface: a tool palette down the left, the selected thing on
 * the right, and the world's history along the bottom. Deliberately laid out
 * as a game screen rather than a debug window.
 */
export function GodPanel({ game, hud, onExit }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [category, setCategory] = useState<GodCategory>('weather');
  const [, refresh] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);

  const powers = GOD_POWERS.filter((p) => p.category === category);
  const selected = hud.godPower as GodPowerId | null;
  const def = selected ? GOD_POWERS.find((p) => p.id === selected) ?? null : null;
  const selection = world.selection;
  const possessed = game.god.possessedNpc;

  const pick = (id: GodPowerId): void => {
    game.god.selectPower(selected === id ? null : id);
    refresh((v) => v + 1);
  };

  return (
    <>
      {/* ------------------------------------------------------- tool palette */}
      <div className="god-palette panel">
        <div className="god-head">
          <span>{t('god.title')}</span>
          <button className="btn small ghost" onClick={onExit}>
            {t('god.exit')}
          </button>
        </div>

        <div className="god-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`god-cat ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {t(`god.cat.${c}`)}
            </button>
          ))}
        </div>

        <div className="god-powers">
          {powers.map((p) => (
            <button
              key={p.id}
              className={`god-power ${selected === p.id ? 'active' : ''}`}
              title={t(`god.desc.${p.id}`)}
              onClick={() => pick(p.id)}
            >
              {t(`god.power.${p.id}`)}
            </button>
          ))}
        </div>

        {def && (
          <div className="god-settings">
            <div className="tiny muted" style={{ lineHeight: 1.5, marginBottom: 8 }}>
              {t(`god.desc.${def.id}`)}
            </div>
            {!def.global && (
              <div className="field" style={{ marginBottom: 8 }}>
                <label>{t('god.brushSize', { value: Math.round(hud.godRadius) })}</label>
                <input
                  type="range"
                  min={def.minRadius}
                  max={def.maxRadius}
                  step={1}
                  value={hud.godRadius}
                  onChange={(e) => {
                    game.god.radius = Number(e.target.value);
                    refresh((v) => v + 1);
                  }}
                />
              </div>
            )}
            {def.hasStrength && (
              <div className="field" style={{ marginBottom: 8 }}>
                <label>{t('god.intensity', { value: hud.godStrength.toFixed(2) })}</label>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={hud.godStrength}
                  onChange={(e) => {
                    game.god.strength = Number(e.target.value);
                    refresh((v) => v + 1);
                  }}
                />
              </div>
            )}
            <div className="tiny muted">{def.global ? t('god.apply') : t('god.apply')}</div>
            {def.undoable && (
              <button
                className="btn small ghost"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => {
                  const ok = world.editor.undo();
                  game.vegetation.markDirty();
                  game.toast(ok ? t('god.undone') : t('god.nothingToUndo'));
                }}
              >
                {t('god.undo')}
              </button>
            )}
          </div>
        )}

        <button
          className="btn small ghost"
          style={{ marginTop: 10, width: '100%' }}
          onClick={() => setShowTimeline((v) => !v)}
        >
          {t('god.timeline')}
        </button>
      </div>

      {/* ---------------------------------------------------------- inspector */}
      <div className="god-inspector panel">
        <div className="section-label" style={{ marginTop: 0 }}>
          {t('god.selected')}
        </div>

        {possessed ? (
          <>
            <div style={{ marginBottom: 6 }}>{t('god.possessing', { name: possessed.name })}</div>
            <div className="tiny muted" style={{ marginBottom: 10 }}>
              {professionName(possessed.profession)}
            </div>
            <button
              className="btn small"
              style={{ width: '100%' }}
              onClick={() => {
                game.releasePossession();
                refresh((v) => v + 1);
              }}
            >
              {t('god.release')}
            </button>
          </>
        ) : selection?.kind === 'npc' ? (
          <SelectedNpc game={game} onChange={() => refresh((v) => v + 1)} />
        ) : selection?.kind === 'building' ? (
          <SelectedBuilding game={game} />
        ) : (
          <div className="tiny muted" style={{ lineHeight: 1.6 }}>
            {t('god.nothingSelected')}
          </div>
        )}

        <div className="section-label">{t('god.layers')}</div>
        <div className="tiny muted" style={{ lineHeight: 1.7 }}>
          <div>
            {t('common.wildlife')}: <b>{world.wildlife.length}</b>
          </div>
          <div>
            {t('common.settlers')}: <b>{world.npcs.length}</b>
          </div>
          <div>
            {t('common.buildings')}: <b>{world.buildings.length}</b>
          </div>
          <div>
            {t('disaster.wildfire')}: <b>{world.disasters.activeFireCount}</b>
          </div>
          <div>
            {t('god.power.volcano')}: <b>{world.volcanoes.length}</b>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- timeline */}
      {showTimeline && (
        <div className="god-timeline panel">
          <div className="section-label" style={{ marginTop: 0 }}>
            {t('god.timeline')}
          </div>
          <div className="god-timeline-rows">
            {world.log
              .recent(40)
              .map((e) => (
                <button
                  key={e.id}
                  className="god-timeline-row"
                  onClick={() => {
                    if (e.x !== undefined && e.z !== undefined) game.lookAt(e.x, e.z);
                  }}
                  style={{ borderLeftColor: categoryColour(e.category) }}
                >
                  <span className="mono tiny muted">{eventDate(e)}</span>
                  <span className="tiny">{eventText(e)}</span>
                </button>
              ))}
            {world.log.all().length === 0 && (
              <div className="tiny muted">{t('chron.nothing')}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SelectedNpc({ game, onChange }: { game: Game; onChange: () => void }): JSX.Element | null {
  const t = useT();
  const npc = game.world.npcById.get(game.world.selection?.id ?? 0);
  if (!npc) return null;
  return (
    <>
      <div style={{ marginBottom: 2 }}>{npc.name}</div>
      <div className="tiny muted" style={{ marginBottom: 10 }}>
        {professionName(npc.profession)} · {t('insp.age', { age: npc.age })}
      </div>
      <button
        className="btn small primary"
        style={{ width: '100%' }}
        onClick={() => {
          game.possessSelected();
          onChange();
        }}
      >
        {t('god.possess')}
      </button>
    </>
  );
}

function SelectedBuilding({ game }: { game: Game }): JSX.Element | null {
  const t = useT();
  const b = game.world.buildingById.get(game.world.selection?.id ?? 0);
  if (!b) return null;
  return (
    <>
      <div style={{ marginBottom: 2 }}>{b.def.name}</div>
      <div className="tiny muted">
        {t('insp.condition')}: {Math.round(b.condition * 100)}%
      </div>
    </>
  );
}

function categoryColour(category: string): string {
  switch (category) {
    case 'disaster':
      return hexToCss(PALETTE.ui.bad);
    case 'construction':
      return hexToCss(PALETTE.build.wood);
    case 'settlement':
      return hexToCss(PALETTE.ui.good);
    case 'weather':
      return hexToCss(PALETTE.sky.dayZenith);
    case 'discovery':
      return '#b98fd8';
    default:
      return 'rgba(255,255,255,0.25)';
  }
}
