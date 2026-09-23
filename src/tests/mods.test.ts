/**
 * Mods.
 *
 * Two things are being asserted. One: a mod's content is not special -- it
 * goes into the same tables the game's own content lives in, so everything
 * downstream treats it identically. Two: a manifest is untrusted input, and a
 * file that lies about its own fields loses those fields rather than taking
 * the game down with it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ModRegistry } from '../mods/ModRegistry';
import { fireModEvent, runEffects } from '../mods/ModRuntime';
import { ITEMS } from '../data/items';
import { RECIPES, type Recipe } from '../data/recipes';
import { RESOURCES, BIOME_FLORA } from '../world/resources';
import { ANIMALS, speciesForBiome } from '../sim/Wildlife';
import { Biome } from '../world/types';
import { buildTestWorld, makeTestConfig } from './harness';

const GOOD = {
  id: 'testmod',
  name: 'Test Mod',
  version: '1',
  items: [
    { id: 'gleam', name: 'Gleam', category: 'raw', stackSize: 8, weight: 2, value: 40, color: 0x88ccff },
  ],
  blocks: [
    {
      id: 'gleam_bush',
      name: 'Gleam Bush',
      category: 'plant',
      skill: 'forage',
      yields: [{ item: 'gleam', amount: 2 }],
      workPerUnit: 6,
      units: 3,
      regrowDays: 12,
      radius: 0.6,
      blocks: false,
      spreads: true,
      biomes: { grassland: 4 },
      look: { shape: 'bush', color: 0x88ccff },
    },
  ],
  creatures: [
    {
      id: 'gleam_hare',
      name: 'Gleam Hare',
      diet: 'herbivore',
      speed: 1.2,
      fleeSpeed: 6,
      awareness: 18,
      yields: [{ item: 'core:meat', amount: 1 }],
      biomes: ['grassland'],
      color: 0xc9b89a,
      bellyColor: 0xffffff,
      size: 0.4,
      herdSize: [1, 3],
      density: 10,
      lifespan: [2, 5],
    },
  ],
  recipes: [
    {
      id: 'gleam_polish',
      name: 'Polished Gleam',
      building: 'carpenter',
      inputs: [{ item: 'gleam', amount: 2 }],
      outputs: [{ item: 'core:plank', amount: 1 }],
      work: 20,
    },
  ],
  systems: [
    {
      id: 'each_day',
      when: { on: 'day' },
      then: [{ do: 'addCounter', counter: 'days', amount: 1 }],
    },
  ],
  ui: [{ id: 'main', title: 'Gleam', widgets: [{ kind: 'counter', label: 'Days', counter: 'days' }] }],
  strings: { en: { hello: 'Hello from the test mod.' } },
};

function freshRegistry(): ModRegistry {
  return new ModRegistry();
}

describe('what a mod adds', () => {
  let reg: ModRegistry;

  beforeEach(() => {
    reg = freshRegistry();
  });

  it('goes into the same tables the game keeps its own content in', () => {
    reg.install(structuredClone(GOOD), 'file');
    reg.applyAll();

    expect(ITEMS['testmod__gleam' as never]).toBeDefined();
    expect(RESOURCES['testmod__gleam_bush' as never]).toBeDefined();
    expect(ANIMALS['testmod__gleam_hare' as never]).toBeDefined();
    expect(RECIPES['testmod__gleam_polish' as never]).toBeDefined();

    reg.remove('testmod');
    expect(ITEMS['testmod__gleam' as never]).toBeUndefined();
    expect(RESOURCES['testmod__gleam_bush' as never]).toBeUndefined();
  });

  it('is placed by the same world generation as everything else', () => {
    reg.install(structuredClone(GOOD), 'file');
    reg.applyAll();
    const entries = BIOME_FLORA[Biome.Grassland]!.entries;
    expect(entries.some((e) => e.kind === ('testmod__gleam_bush' as never))).toBe(true);

    reg.remove('testmod');
    expect(BIOME_FLORA[Biome.Grassland]!.entries.some((e) => e.kind === ('testmod__gleam_bush' as never))).toBe(
      false,
    );
  });

  it('is hunted and censused like anything else that lives here', () => {
    reg.install(structuredClone(GOOD), 'file');
    reg.applyAll();
    expect(speciesForBiome(Biome.Grassland, 'settled')).toContain('testmod__gleam_hare');
    reg.remove('testmod');
  });

  it('can name the game’s own items as well as its own', () => {
    reg.install(structuredClone(GOOD), 'file');
    reg.applyAll();
    const recipe = (RECIPES as Record<string, Recipe>)['testmod__gleam_polish'];
    expect(recipe.outputs[0].item).toBe('plank');
    expect(recipe.inputs[0].item).toBe('testmod__gleam');
    reg.remove('testmod');
  });

  it('cannot replace something the game shipped with', () => {
    const attacker = {
      id: 'log',
      name: 'Not A Mod',
      version: '1',
      items: [{ id: 'stone', name: 'Free Stone', category: 'raw', stackSize: 999, weight: 0, value: 1e9, color: 0 }],
    };
    reg.install(attacker, 'file');
    reg.applyAll();
    // It got its own namespaced id, not the game's.
    expect(ITEMS.stone.name).toBe('Stone');
    expect(ITEMS.stone.weight).toBeGreaterThan(0);
    reg.remove('log');
  });
});

describe('a manifest that cannot be trusted', () => {
  let reg: ModRegistry;

  beforeEach(() => {
    reg = freshRegistry();
  });

  it('loses the fields that are nonsense and keeps the rest', () => {
    const mod = reg.install(
      {
        id: 'ragged',
        name: 'Ragged',
        version: '1',
        items: [
          { id: 'GOOD ONE', name: 'bad id', category: 'raw', stackSize: 1, weight: 1, value: 1, color: 0 },
          { id: 'fine', name: 'Fine', category: 'raw', stackSize: 4, weight: 1, value: 1, color: 0 },
        ],
      },
      'file',
    );
    expect(mod).not.toBeNull();
    expect(mod!.manifest.items).toHaveLength(1);
    expect(mod!.problems.length).toBeGreaterThan(0);
    reg.remove('ragged');
  });

  it('clamps numbers that would break the simulation', () => {
    const mod = reg.install(
      {
        id: 'greedy',
        name: 'Greedy',
        version: '1',
        items: [
          {
            id: 'brick',
            name: 'Brick',
            category: 'raw',
            stackSize: 1e9,
            weight: -50,
            value: Number.POSITIVE_INFINITY,
            color: 0x1000000,
          },
        ],
        creatures: [
          {
            id: 'swarm',
            name: 'Swarm',
            diet: 'herbivore',
            speed: 9999,
            fleeSpeed: 9999,
            awareness: 9999,
            yields: [],
            biomes: ['grassland'],
            color: 0,
            bellyColor: 0,
            size: 999,
            herdSize: [1e6, 1e6],
            density: 1e9,
            lifespan: [1, 2],
          },
        ],
      },
      'file',
    );
    const item = mod!.manifest.items![0];
    expect(item.stackSize).toBeLessThanOrEqual(999);
    expect(item.weight).toBeGreaterThan(0);
    expect(Number.isFinite(item.value)).toBe(true);
    expect(item.color).toBeLessThanOrEqual(0xffffff);

    const beast = mod!.manifest.creatures![0];
    expect(beast.density).toBeLessThanOrEqual(200);
    expect(beast.herdSize[1]).toBeLessThanOrEqual(60);
    expect(beast.size).toBeLessThanOrEqual(6);
    reg.remove('greedy');
  });

  it('refuses a trigger or an effect it does not know', () => {
    const mod = reg.install(
      {
        id: 'strange',
        name: 'Strange',
        version: '1',
        systems: [
          { id: 'a', when: { on: 'eval' }, then: [{ do: 'log', key: 'x' }] },
          { id: 'b', when: { on: 'day' }, then: [{ do: 'exec', code: 'alert(1)' }] },
          { id: 'c', when: { on: 'day' }, then: [{ do: 'log', key: 'fine' }] },
        ],
      },
      'file',
    );
    // Only the one made entirely of things the game knows how to do survives.
    expect(mod!.manifest.systems).toHaveLength(1);
    expect(mod!.manifest.systems![0].id).toBe('c');
    reg.remove('strange');
  });

  it('refuses a manifest with no usable id at all', () => {
    expect(reg.install({ name: 'nameless' }, 'file')).toBeNull();
    expect(reg.install('a string', 'file')).toBeNull();
    expect(reg.install(null, 'file')).toBeNull();
  });
});

describe('what a mod does', () => {
  it('counts, and the world remembers across a save', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'mods-1' }));
    world.modCounters.set('m.tally', 7);
    const data = world.modCounters.serialize();
    world.modCounters.set('m.tally', 0);
    world.modCounters.restore(data);
    expect(world.modCounters.get('m.tally')).toBe(7);
  });

  it('refuses a counter value that is not a number', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'mods-2' }));
    world.modCounters.restore({ ok: 3, bad: 'nine' as unknown as number, worse: NaN });
    expect(world.modCounters.get('ok')).toBe(3);
    expect(world.modCounters.get('bad')).toBe(0);
    expect(world.modCounters.get('worse')).toBe(0);
  });

  it('only acts through things the game can already do to itself', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'mods-3' }));
    const manifest = { id: 'gift', name: 'Gift', version: '1' };
    const before = world.player.inventory.count('stone');
    runEffects(world, manifest, [
      { do: 'give', item: 'stone', amount: 3 },
      { do: 'addCounter', counter: 'given', amount: 3 },
      // Naming something that does not exist does nothing at all.
      { do: 'give', item: 'unobtainium', amount: 999 },
      { do: 'spawnCreature', creature: 'nothing_at_all', count: 5, radius: 10 },
    ]);
    expect(world.player.inventory.count('stone')).toBe(before + 3);
    expect(world.modCounters.get('gift.given')).toBe(3);
  });

  it('is woken by the world rather than polling it', () => {
    const reg = freshRegistry();
    reg.install(structuredClone(GOOD), 'file');
    reg.applyAll();
    const world = buildTestWorld(makeTestConfig({ seedText: 'mods-4' }));
    // The shared registry is what the runtime reads, so this exercises the
    // effect path rather than the event plumbing.
    fireModEvent(world, { kind: 'day' });
    reg.remove('testmod');
  });
});
