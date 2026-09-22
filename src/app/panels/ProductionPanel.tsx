import { useState } from 'react';
import { Game } from '../../game/Game';
import { Bar, EmptyNote, ItemIcon, Pill, Window } from '../components/common';
import { RECIPES, RecipeId } from '../../data/recipes';
import { ITEMS } from '../../data/items';
import { Building } from '../../sim/Building';

interface Props {
  game: Game;
  onClose: () => void;
}

export function ProductionPanel({ game, onClose }: Props): JSX.Element {
  const world = game.world;
  const [, refresh] = useState(0);

  const producers = world.buildings.filter(
    (b) => b.complete && ((b.def.recipes?.length ?? 0) > 0 || b.def.gathers || b.def.farmPlots),
  );

  return (
    <Window title="Production" onClose={onClose} width="wide">
      {producers.length === 0 ? (
        <EmptyNote>
          Nothing is producing yet. Build a lumber camp, quarry or workshop and staff it.
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
  const world = game.world;
  const [open, setOpen] = useState(false);

  const recentOutput = b.outputHistory
    .filter((o) => o.day >= world.time.totalDays - 3)
    .reduce((n, o) => n + o.amount, 0);

  const idleReason = (): string | null => {
    if (b.paused) return 'paused by you';
    if (b.workerIds.length === 0) return 'no workers assigned';
    if (b.def.recipes?.length) {
      const recipe = world.chooseRecipe(b);
      if (!recipe) {
        // Name the first missing input, which is what the player actually needs.
        for (const rid of b.def.recipes) {
          if (b.disabledRecipes.has(rid)) continue;
          if (!world.research.recipeUnlocked(rid)) continue;
          for (const inp of RECIPES[rid].inputs) {
            if (b.inventory.count(inp.item) < inp.amount) {
              return `waiting for ${ITEMS[inp.item].name.toLowerCase()}`;
            }
          }
        }
        if (b.inventory.fullness > 0.95) return 'store is full';
        return 'nothing to make';
      }
    }
    if (b.inventory.fullness > 0.98) return 'store is full';
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
          {b.def.name}
        </span>
        <div>
          <div className="tiny">
            {b.activeRecipe ? RECIPES[b.activeRecipe].name : b.def.gathers ? `Extracting ${b.def.gathers}` : 'Idle'}
          </div>
          {b.activeRecipe && (
            <Bar value={b.productionProgress / Math.max(1, RECIPES[b.activeRecipe].work)} />
          )}
        </div>
        <span className="tiny muted">
          {b.workerIds.length}/{b.def.workSlots} workers
        </span>
        <span className="tiny muted">{recentOutput} made recently</span>
        <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Less' : 'More'}
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
                In store
              </div>
              {b.inventory.summary().map((s) => (
                <div className="mat-row" key={s.item}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ItemIcon item={s.item} size={14} />
                    {ITEMS[s.item].name}
                  </span>
                  <span>{s.count}</span>
                </div>
              ))}
              {b.inventory.isEmpty() && <div className="tiny muted">Empty</div>}
            </div>

            <div>
              {b.def.recipes && b.def.recipes.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 0 }}>
                    Recipes
                  </div>
                  {b.def.recipes.map((rid: RecipeId) => {
                    const r = RECIPES[rid];
                    const disabled = b.disabledRecipes.has(rid);
                    const locked = !world.research.recipeUnlocked(rid);
                    return (
                      <div className="mat-row" key={rid}>
                        <span className={locked ? 'muted' : ''}>
                          {r.name}
                          <span className="tiny muted">
                            {' '}
                            — {r.inputs.map((i) => `${i.amount} ${ITEMS[i.item].name}`).join(' + ')} →{' '}
                            {r.outputs.map((o) => `${o.amount} ${ITEMS[o.item].name}`).join(', ')}
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
                          {locked ? 'locked' : disabled ? 'off' : 'on'}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              {b.fields.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 0 }}>
                    Field
                  </div>
                  <div className="kv">
                    <span>Plots planted</span>
                    <span className="mono">
                      {b.fields.filter((f) => f.planted).length}/{b.fields.length}
                    </span>
                  </div>
                  <div className="kv">
                    <span>Ready to harvest</span>
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
                {b.paused ? 'Resume work' : 'Pause work'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
