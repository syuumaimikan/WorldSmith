/**
 * The manual.
 *
 * Everything in here that is a list is generated from the data the game
 * actually runs on -- the recipes are the recipe table, the building costs
 * are the bills the sites demand, the plants are the flora tables world
 * generation reads. So the guide cannot go stale, and a mod that adds a
 * recipe adds a line to the guide without anybody writing one.
 *
 * The prose is the part a table cannot say: what the game expects of you, and
 * what it refuses to do on your behalf.
 */

import { useMemo, useState } from 'react';
import { Game } from '../../game/Game';
import { EmptyNote, ItemIcon, Tabs, Window } from '../components/common';
import { useT } from '../../i18n';
import { buildingName, itemName, resourceName, biomeName } from '../../i18n/names';
import { ITEMS, ItemId } from '../../data/items';
import { RECIPES, Recipe } from '../../data/recipes';
import { BUILDINGS, BuildingDef } from '../../data/buildings';
import { RESOURCES, BIOME_FLORA, PRIMEVAL_FLORA, ResourceKind } from '../../world/resources';
import { Biome } from '../../world/types';
import { eraProfile } from '../../world/eras';
import { RESEARCH, ResearchId } from '../../data/research';

type Tab = 'living' | 'gathering' | 'crafting' | 'building' | 'world';

interface Props {
  game: Game;
  onClose: () => void;
}

export function GuidePanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<Tab>('living');
  const world = game.world;

  return (
    <Window title={t('guide.title')} onClose={onClose} width="wide">
      <Tabs<Tab>
        tabs={[
          { id: 'living', label: t('guide.living') },
          { id: 'gathering', label: t('guide.gathering') },
          { id: 'crafting', label: t('guide.crafting') },
          { id: 'building', label: t('guide.building') },
          { id: 'world', label: t('guide.world') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'living' && <Living />}
      {tab === 'gathering' && <Gathering game={game} />}
      {tab === 'crafting' && <Crafting game={game} />}
      {tab === 'building' && <BuildingGuide game={game} />}
      {tab === 'world' && <WorldGuide world={world} />}
    </Window>
  );
}

function Prose({ keys }: { keys: string[] }): JSX.Element {
  const t = useT();
  return (
    <>
      {keys.map((k) => (
        <p key={k} className="guide-para">
          {t(k)}
        </p>
      ))}
    </>
  );
}

function Living(): JSX.Element {
  const t = useT();
  return (
    <div>
      <div className="section-label">{t('guide.living.who')}</div>
      <Prose keys={['guide.living.p1', 'guide.living.p2']} />

      <div className="section-label">{t('guide.living.body')}</div>
      <Prose keys={['guide.living.p3', 'guide.living.p4']} />

      <div className="section-label">{t('guide.living.hands')}</div>
      <Prose keys={['guide.living.p5']} />
      <div className="list">
        {[
          ['E', 'guide.key.interact'],
          ['F', 'guide.key.use'],
          ['X', 'guide.key.place'],
          ['Y', 'guide.key.throw'],
          ['H', 'guide.key.drink'],
          ['1-6', 'guide.key.hands'],
          ['/', 'guide.key.console'],
        ].map(([key, label]) => (
          <div className="list-row" key={key} style={{ gridTemplateColumns: '60px 1fr' }}>
            <span className="mono">{key}</span>
            <span>{t(label)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gathering({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const life = eraProfile(world.config.era).life;

  // Which biomes hold what, read from the same tables world generation used,
  // so this is where things actually are rather than where they used to be.
  const byBiome = useMemo(() => {
    const table = life === 'primeval' ? PRIMEVAL_FLORA : BIOME_FLORA;
    const out: { biome: Biome; kinds: { kind: ResourceKind; weight: number }[] }[] = [];
    for (const [key, flora] of Object.entries(table)) {
      if (!flora) continue;
      const kinds = [...flora.entries].sort((a, b) => b.weight - a.weight).slice(0, 12);
      out.push({ biome: Number(key) as Biome, kinds });
    }
    return out;
  }, [life]);

  return (
    <div>
      <Prose keys={['guide.gathering.p1', 'guide.gathering.p2']} />
      <div className="hint">{t('guide.gathering.mapHint')}</div>

      {byBiome.map(({ biome, kinds }) => (
        <div key={biome}>
          <div className="section-label">{biomeName(biome)}</div>
          <div className="list">
            {kinds.map(({ kind }) => {
              const def = RESOURCES[kind];
              if (!def) return null;
              return (
                <div
                  className="list-row"
                  key={kind}
                  style={{ gridTemplateColumns: '1fr 90px 1fr' }}
                >
                  <span>{resourceName(kind)}</span>
                  <span className="tiny muted">{t('guide.skill.' + def.skill)}</span>
                  <span className="tiny">
                    {def.yields.map((y) => y.amount + ' ' + itemName(y.item)).join(', ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Crafting({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;

  // Which building does which recipe, taken from the buildings themselves.
  const byBuilding = useMemo(() => {
    const out = new Map<string, Recipe[]>();
    for (const b of Object.values(BUILDINGS) as BuildingDef[]) {
      for (const id of b.recipes ?? []) {
        const recipe = (RECIPES as Record<string, Recipe>)[id];
        if (!recipe) continue;
        const list = out.get(b.id) ?? [];
        list.push(recipe);
        out.set(b.id, list);
      }
    }
    return out;
  }, []);

  return (
    <div>
      <Prose keys={['guide.crafting.p1']} />
      {[...byBuilding.entries()].map(([buildingId, recipes]) => (
        <div key={buildingId}>
          <div className="section-label">{buildingName(buildingId as never)}</div>
          <div className="list">
            {recipes.map((r) => {
              const locked =
                r.requiresResearch !== undefined && !world.research.isUnlocked(r.requiresResearch);
              return (
                <div
                  className="list-row"
                  key={r.id}
                  style={{ gridTemplateColumns: '1fr 1fr 70px 110px' }}
                >
                  <span className={locked ? 'muted' : ''}>
                    {r.inputs.map((i) => i.amount + ' ' + itemName(i.item)).join(' + ') ||
                      t('guide.nothing')}
                  </span>
                  <span className={locked ? 'muted' : ''}>
                    &rarr; {r.outputs.map((o) => o.amount + ' ' + itemName(o.item)).join(', ')}
                  </span>
                  <span className="mono tiny muted">{Math.round(r.work)}</span>
                  <span className="tiny muted">
                    {locked ? t('guide.needs', { what: researchName(r.requiresResearch!) }) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function researchName(id: ResearchId): string {
  return RESEARCH[id]?.name ?? id;
}

function BuildingGuide({ game }: { game: Game }): JSX.Element {
  const t = useT();
  const world = game.world;
  const all = Object.values(BUILDINGS) as BuildingDef[];

  return (
    <div>
      <Prose keys={['guide.building.p1']} />
      <div className="list">
        {all.map((b) => {
          const bill = Object.entries(b.totalMaterials ?? {}) as [ItemId, number][];
          const locked =
            b.requiresResearch !== undefined && !world.research.isUnlocked(b.requiresResearch);
          return (
            <div
              className="list-row"
              key={b.id}
              style={{ gridTemplateColumns: '140px 1fr 70px 110px' }}
            >
              <span className={locked ? 'muted' : ''}>{buildingName(b.id)}</span>
              <span className="tiny">
                {bill.length > 0
                  ? bill.map(([item, n]) => n + ' ' + itemName(item)).join(', ')
                  : t('guide.nothing')}
              </span>
              <span className="mono tiny muted">{Math.round(b.totalWork ?? 0)}</span>
              <span className="tiny muted">
                {locked ? t('guide.needs', { what: researchName(b.requiresResearch!) }) : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorldGuide({ world }: { world: Game['world'] }): JSX.Element {
  const t = useT();
  const profile = eraProfile(world.config.era);
  const items = Object.values(ITEMS);

  return (
    <div>
      <div className="section-label">{t('guide.world.thisOne')}</div>
      <div className="list">
        <Row label={t('guide.world.era')} value={t('new.era.' + world.config.era)} />
        <Row label={t('guide.world.mode')} value={t('new.mode.' + world.config.mode)} />
        <Row
          label={t('guide.world.size')}
          value={t('map.scaleNote', { km: (world.terrain.worldSize / 1000).toFixed(2) })}
        />
        <Row label={t('guide.world.life')} value={t('guide.life.' + profile.life)} />
        <Row label={t('guide.world.seed')} value={world.config.seedText} />
      </div>

      <Prose keys={['guide.world.p1', 'guide.world.p2', 'guide.world.p3']} />

      <div className="section-label">{t('guide.world.everything')}</div>
      <div className="list">
        <Row label={t('guide.count.items')} value={String(items.length)} />
        <Row label={t('guide.count.blocks')} value={String(Object.keys(RESOURCES).length)} />
        <Row label={t('guide.count.recipes')} value={String(Object.keys(RECIPES).length)} />
        <Row label={t('guide.count.buildings')} value={String(Object.keys(BUILDINGS).length)} />
        <Row label={t('guide.count.research')} value={String(Object.keys(RESEARCH).length)} />
      </div>

      <div className="section-label">{t('guide.world.carried')}</div>
      <div className="list">
        {items
          .filter((i) => i.category === 'food')
          .slice(0, 24)
          .map((i) => (
            <div className="list-row" key={i.id} style={{ gridTemplateColumns: '24px 1fr auto' }}>
              <ItemIcon item={i.id} size={16} />
              <span>{itemName(i.id)}</span>
              <span className="mono tiny muted">{i.nutrition ?? 0}</span>
            </div>
          ))}
      </div>
      {items.length === 0 && <EmptyNote>{t('guide.nothing')}</EmptyNote>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="list-row" style={{ gridTemplateColumns: '1fr auto' }}>
      <span>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
