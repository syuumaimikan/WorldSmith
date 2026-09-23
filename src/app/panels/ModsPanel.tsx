/**
 * The mods, and what they added.
 *
 * Two things live here: the list of installed mods with a switch each, and
 * the panels the mods themselves asked for. A mod's panel is built from a
 * fixed set of widgets -- a heading, some text, a counter, a bar, a button --
 * so nothing a mod wrote is ever rendered as markup. Its text is text.
 *
 * Switching a mod off takes effect on the next world rather than instantly,
 * and the panel says so, because the alternative is a terrain full of plants
 * whose definition has just been deleted.
 */

import { useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, Tabs, Window } from '../components/common';
import { useT } from '../../i18n';
import { mods } from '../../mods/ModRegistry';
import { installFromText, setModEnabled, uninstall } from '../../mods/load';
import { runEffects } from '../../mods/ModRuntime';
import type { InstalledMod, ModPanel, ModWidget } from '../../mods/types';
import { ITEMS, ItemId } from '../../data/items';
import { ModRegistry } from '../../mods/ModRegistry';

interface Props {
  game: Game;
  onClose: () => void;
}

export function ModsPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<string>('installed');
  const [, refresh] = useState(0);
  const bump = (): void => refresh((n) => n + 1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');

  const installed = mods.mods;
  const panels = installed
    .filter((m) => m.enabled)
    .flatMap((m) => (m.manifest.ui ?? []).map((panel) => ({ mod: m, panel })));

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    // Bounded on purpose: a manifest is a page of JSON, not a payload.
    if (file.size > 2_000_000) {
      setNote(t('mods.tooBig'));
      return;
    }
    const mod = installFromText(await file.text());
    setNote(mod ? t('mods.added', { name: mod.manifest.name }) : t('mods.notReadable'));
    bump();
  };

  return (
    <Window title={t('mods.title')} onClose={onClose} width="wide">
      <Tabs<string>
        tabs={[
          { id: 'installed', label: t('mods.installed', { count: installed.length }) },
          ...panels.map(({ mod, panel }) => ({
            id: mod.manifest.id + ':' + panel.id,
            label: panel.title,
          })),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'installed' && (
        <>
          <div className="hint">{t('mods.note')}</div>

          <div className="list">
            {installed.map((mod) => (
              <ModRow key={mod.manifest.id} mod={mod} onChange={bump} />
            ))}
          </div>
          {installed.length === 0 && <EmptyNote>{t('mods.none')}</EmptyNote>}

          <div className="section-label">{t('mods.add')}</div>
          <div className="hint">{t('mods.addNote')}</div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {t('mods.chooseFile')}
          </button>
          {note && <div className="hint">{note}</div>}
        </>
      )}

      {panels.map(({ mod, panel }) =>
        tab === mod.manifest.id + ':' + panel.id ? (
          <ModPanelView key={panel.id} game={game} mod={mod} panel={panel} />
        ) : null,
      )}
    </Window>
  );
}

function ModRow({ mod, onChange }: { mod: InstalledMod; onChange: () => void }): JSX.Element {
  const t = useT();
  const m = mod.manifest;
  const counts = [
    m.items?.length ? t('mods.countItems', { n: m.items.length }) : '',
    m.blocks?.length ? t('mods.countBlocks', { n: m.blocks.length }) : '',
    m.creatures?.length ? t('mods.countCreatures', { n: m.creatures.length }) : '',
    m.recipes?.length ? t('mods.countRecipes', { n: m.recipes.length }) : '',
    m.systems?.length ? t('mods.countSystems', { n: m.systems.length }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mod-row">
      <div>
        <div className="mod-name">
          {m.name} <span className="tiny muted mono">{m.version}</span>
        </div>
        {m.author && <div className="tiny muted">{m.author}</div>}
        {m.description && <div className="tiny">{m.description}</div>}
        <div className="tiny muted mono">{counts}</div>
        {mod.problems.length > 0 && (
          <div className="tiny bad">
            {t('mods.problems', { n: mod.problems.length })}: {mod.problems.slice(0, 4).join('; ')}
          </div>
        )}
      </div>
      <div className="mod-actions">
        <button
          className={mod.enabled ? 'mini primary' : 'mini'}
          onClick={() => {
            setModEnabled(m.id, !mod.enabled);
            onChange();
          }}
        >
          {mod.enabled ? t('mods.on') : t('mods.off')}
        </button>
        {mod.source === 'file' && (
          <button
            className="mini"
            onClick={() => {
              uninstall(m.id);
              onChange();
            }}
          >
            {t('mods.remove')}
          </button>
        )}
      </div>
    </div>
  );
}

function ModPanelView({
  game,
  mod,
  panel,
}: {
  game: Game;
  mod: InstalledMod;
  panel: ModPanel;
}): JSX.Element {
  const t = useT();
  const [, refresh] = useState(0);
  const world = game.world;
  const counter = (name: string): number => world.modCounters.get(mod.manifest.id + '.' + name);

  const itemId = (written: string): ItemId => {
    const own = ModRegistry.qualify(mod.manifest.id, written);
    return (own in ITEMS ? own : written) as ItemId;
  };

  const render = (w: ModWidget, i: number): JSX.Element | null => {
    switch (w.kind) {
      case 'heading':
        return (
          <div className="section-label" key={i}>
            {w.text}
          </div>
        );
      case 'text':
        return (
          <div className="tiny" key={i} style={{ lineHeight: 1.7, marginBottom: 8 }}>
            {w.text}
          </div>
        );
      case 'counter':
        return (
          <div className="list-row" key={i} style={{ gridTemplateColumns: '1fr auto' }}>
            <span>{w.label}</span>
            <span className="mono">{Math.round(counter(w.counter))}</span>
          </div>
        );
      case 'itemCount':
        return (
          <div className="list-row" key={i} style={{ gridTemplateColumns: '1fr auto' }}>
            <span>{w.label}</span>
            <span className="mono">{world.player.inventory.count(itemId(w.item))}</span>
          </div>
        );
      case 'bar': {
        const value = Math.max(0, Math.min(1, counter(w.counter) / w.max));
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div className="list-row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span>{w.label}</span>
              <span className="mono">
                {Math.round(counter(w.counter))} / {w.max}
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${value * 100}%`, background: '#e0b24a' }} />
            </div>
          </div>
        );
      }
      case 'button':
        return (
          <button
            className="mini"
            key={i}
            style={{ marginRight: 8, marginBottom: 8 }}
            onClick={() => {
              runEffects(world, mod.manifest, w.then);
              refresh((n) => n + 1);
            }}
          >
            {w.label}
          </button>
        );
      case 'list': {
        const rows =
          w.source === 'items'
            ? (mod.manifest.items ?? []).map((x) => x.name)
            : w.source === 'blocks'
              ? (mod.manifest.blocks ?? []).map((x) => x.name)
              : (mod.manifest.creatures ?? []).map((x) => x.name);
        return (
          <div key={i}>
            <div className="section-label">{w.label}</div>
            <div className="list">
              {rows.map((name, j) => (
                <div className="list-row" key={j} style={{ gridTemplateColumns: '1fr' }}>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            {rows.length === 0 && <EmptyNote>{t('mods.nothingHere')}</EmptyNote>}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return <div>{panel.widgets.map(render)}</div>;
}
