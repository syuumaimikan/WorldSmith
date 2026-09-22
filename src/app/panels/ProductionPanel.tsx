import { useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, ItemIcon, Pill, Window } from '../components/common';
import { RECIPES, RecipeId } from '../../data/recipes';
import { Building } from '../../sim/Building';
import { useT } from '../../i18n';
import { buildingName, itemName, recipeName } from '../../i18n/names';

interface Props {
  game: Game;
  onClose: () => void;
}

export function ProductionPanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const world = game.world;
  const [, refresh] = useState(0);

  const producers = world.buildings.filter(
    (b) => b.complete && ((b.def.recipes?.length ?? 0) > 0 || b.def.gathers || b.def.farmPlots),
  );

  return (
    <Window title={t('prod.title')} onClose={onClose} width="wide">
      {producers.length === 0 ? (
        <EmptyNote>
          {t('prod.nothing')}
        </EmptyNote>
      ) : (
        <div className="list">
          {producers.map((b) => (
            <ProducerRow key={b.id} game={game} b={b} onChange={() => refresh((v) => v + 1)} onClose={onClose} />
          ))}
        </div>
      )}
    </Window>
  );
}

function ProducerRow({
  game,
  b,
  onChange,
  onClose,
}: {
  game: Game;
  b: Building;
  onChange: () => void;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const world = game.world;
  const [open, setOpen] = useState(false);

  const recentOutput = b.outputHistory
    .filter((o) => o.day >= world.time.totalDays - 3)
    .reduce((n, o) => n + o.amount, 0);

  const idleReason = (): string | null => {
    if (b.paused) return t('prod.idleReason.paused');
    if (b.workerIds.length === 0) return t('prod.idleReason.noWorkers');
    if (b.def.recipes?.length) {
      const recipe = world.chooseRecipe(b);
      if (!recipe) {
        // Name the first missing input, which is what the player actually needs.
        for (const rid of b.def.recipes) {
          if (b.disabledRecipes.has(rid)) continue;
          if (!world.research.recipeUnlocked(rid)) continue;
          for (const inp of RECIPES[rid].inputs) {
            if (b.inventory.count(inp.item) < inp.amount) {
              return t('prod.idleReason.waitingFor', { item: itemName(inp.item) });
            }
          }
        }
        if (b.inventory.fullness > 0.95) return t('prod.idleReason.storeFull');
        return t('prod.idleReason.nothingToMake');
      }
    }
    if (b.inventory.fullness > 0.98) return t('prod.idleReason.storeFull');
    return null;
  };

  const reason = idleReason();

  return (
    <div className="list-row" style={{ gridTemplateColumns: '1fr', display: 'block' }}>
      <div
        style={{ display: 'grid', gridTemplateColumns: '160px 1fr 120px 110px 70px', gap: 10, alignItems: 'center' }}
      >
        <span
          className="clickable"
          onClick={() => {
            world.selection = { kind: 'building', id: b.id };
            game.focusOn(b.worldX, b.worldZ + 10);
            onClose();
          }}
          style={{ cursor: 'pointer' }}
        >
          {buildingName(b.defId)}
        </span>
        <div>
          <div className="tiny">
            {b.activeRecipe
              ? recipeName(b.activeRecipe)
              : b.def.gathers
                ? t('prod.extracting', { what: b.def.gathers })
                : t('prod.idle')}
          </div>
          {b.activeRecipe && (
            <Bar value={b.productionProgress / Math.max(1, RECIPES[b.activeRecipe].work)} />
          )}
        </div>
        <span className="tiny muted">
          {t('prod.workersOf', { have: b.workerIds.length, total: b.def.workSlots })}
        </span>
        <span className="tiny muted">{t('prod.madeRecently', { count: recentOutput })}</span>
        <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>
          {open ? t('prod.less') : t('prod.more')}
        </button>
      </div>

      {reason && (
        <div style={{ marginTop: 6 }}>
          <Pill tone="warn">{reason}</Pill>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="two-col" style={{ gap: 20 }}>
            <div>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t('prod.inStore')}
              </div>
              {b.inventory.summary().map((s) => (
                <div className="mat-row" key={s.item}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ItemIcon item={s.item} size={14} />
                    {itemName(s.item)}
                  </span>
                  <span>{s.count}</span>
                </div>
              ))}
              {b.inventory.isEmpty() && <div className="tiny muted">{t('insp.empty')}</div>}
            </div>

            <div>
              {b.def.recipes && b.def.recipes.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 0 }}>
                    {t('prod.recipes')}
                  </div>
                  {b.def.recipes.map((rid: RecipeId) => {
                    const r = RECIPES[rid];
                    const disabled = b.disabledRecipes.has(rid);
                    const locked = !world.research.recipeUnlocked(rid);
                    return (
                      <div className="mat-row" key={rid}>
                        <span className={locked ? 'muted' : ''}>
                          {recipeName(rid)}
                          <span className="tiny muted">
                            {' '}
                            \u2014 {r.inputs.map((i) => `${i.amount} ${itemName(i.item)}`).join(' + ')}{' '}
                            \u2192 {r.outputs.map((o) => `${o.amount} ${itemName(o.item)}`).join(', ')}
                          </span>
                        </span>
                        <button
                          className="btn small ghost"
                          disabled={locked}
                          onClick={() => {
                            if (disabled) b.disabledRecipes.delete(rid);
                            else b.disabledRecipes.add(rid);
                            onChange();
                          }}
                        >
                          {locked ? t('build.locked') : disabled ? t('prod.off') : t('prod.on')}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              {b.fields.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 0 }}>
                    {t('prod.field')}
                  </div>
                  <div className="kv">
                    <span>{t('prod.plotsPlanted')}</span>
                    <span className="mono">
                      {b.fields.filter((f) => f.planted).length}/{b.fields.length}
                    </span>
                  </div>
                  <div className="kv">
                    <span>{t('prod.readyToHarvest')}</span>
                    <span className="mono">{b.fields.filter((f) => f.planted && f.growth >= 1).length}</span>
                  </div>
                </>
              )}

              <button
                className="btn small ghost"
                style={{ marginTop: 10 }}
                onClick={() => {
                  b.paused = !b.paused;
                  onChange();
                }}
              >
                {b.paused ? t('prod.resumeWork') : t('prod.pauseWork')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
