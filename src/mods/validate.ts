/**
 * Reading a mod that somebody else wrote.
 *
 * A manifest is a JSON file from outside the game. It may have been written
 * by hand, by a tool, by somebody who misread the documentation, or by
 * somebody who is not friendly. So nothing here trusts a field: every value
 * is checked for its type, clamped to a range the simulation can survive, and
 * dropped with a note if it cannot be made sense of.
 *
 * A mod with one bad item loses that item and keeps the rest. Reporting the
 * problem and carrying on is far more useful than refusing the file, because
 * the person who has to fix it is usually the person reading the report.
 */

import type {
  InstalledMod,
  ModBlock,
  ModCreature,
  ModEffect,
  ModItem,
  ModManifest,
  ModPanel,
  ModRecipe,
  ModSystem,
  ModTrigger,
  ModWidget,
} from './types';

/** Ids are namespaced by the mod, so they have to be safe to concatenate. */
const ID = /^[a-z][a-z0-9_]{0,40}$/;

/**
 * An id as written in a reference, which may name somebody else's namespace:
 * `core:log` is the game's own log, `otherMod:thing` is another mod's.
 */
const REF = /^([a-z][a-z0-9_]{0,40}:)?[a-z][a-z0-9_]{0,40}$/;

/** Text a mod supplies is rendered as text. This only bounds its length. */
function text(value: unknown, fallback = '', max = 400): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function num(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function int(value: unknown, lo: number, hi: number, fallback: number): number {
  return Math.round(num(value, lo, hi, fallback));
}

function colour(value: unknown, fallback = 0x888888): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return n < 0 || n > 0xffffff ? fallback : n;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function amounts(value: unknown, problems: string[], where: string): { item: string; amount: number }[] {
  const out: { item: string; amount: number }[] = [];
  for (const raw of list(value)) {
    const entry = raw as Record<string, unknown>;
    const item = text(entry.item, '', 90);
    if (!REF.test(item)) {
      problems.push(where + ': bad item id ' + JSON.stringify(entry.item));
      continue;
    }
    out.push({ item, amount: int(entry.amount, 1, 9999, 1) });
  }
  return out;
}

// ----------------------------------------------------------------- content

function readItem(raw: unknown, problems: string[]): ModItem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('item: bad id ' + JSON.stringify(r.id));
    return null;
  }
  return {
    id,
    name: text(r.name, id, 80),
    category: oneOf(r.category, ['raw', 'material', 'food', 'tool', 'good'] as const, 'material'),
    // A stack of a million would break every inventory sum in the game.
    stackSize: int(r.stackSize, 1, 999, 10),
    weight: num(r.weight, 0.01, 500, 1),
    value: num(r.value, 0, 100000, 1),
    color: colour(r.color),
    description: text(r.description, '', 400),
    nutrition: r.nutrition === undefined ? undefined : num(r.nutrition, 0, 100, 0),
    toolTier: r.toolTier === undefined ? undefined : int(r.toolTier, 0, 5, 0),
    toolFor:
      r.toolFor === undefined
        ? undefined
        : oneOf(r.toolFor, ['chop', 'mine', 'build', 'farm', 'saw', 'fish'] as const, 'chop'),
  };
}

function readBlock(raw: unknown, problems: string[]): ModBlock | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('block: bad id ' + JSON.stringify(r.id));
    return null;
  }
  const biomes: Record<string, number> = {};
  if (r.biomes && typeof r.biomes === 'object') {
    for (const [k, v] of Object.entries(r.biomes as Record<string, unknown>)) {
      biomes[text(k, '', 40)] = num(v, 0, 100, 0);
    }
  }
  const look = (r.look ?? {}) as Record<string, unknown>;
  return {
    id,
    name: text(r.name, id, 80),
    category: oneOf(r.category, ['tree', 'plant', 'mineral'] as const, 'plant'),
    skill: oneOf(r.skill, ['chop', 'mine', 'forage'] as const, 'forage'),
    yields: amounts(r.yields, problems, 'block ' + id),
    workPerUnit: num(r.workPerUnit, 0.5, 500, 10),
    units: int(r.units, 1, 500, 3),
    regrowDays: num(r.regrowDays, -1, 100000, -1),
    radius: num(r.radius, 0.1, 6, 0.8),
    blocks: r.blocks === true,
    spreads: r.spreads === true,
    biomes: Object.keys(biomes).length > 0 ? biomes : undefined,
    look: r.look
      ? {
          shape: oneOf(
            look.shape,
            ['tree', 'conifer', 'bush', 'rock', 'ore', 'crystal'] as const,
            'bush',
          ),
          color: colour(look.color, 0x5f8a3e),
        }
      : undefined,
  };
}

function readCreature(raw: unknown, problems: string[]): ModCreature | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('creature: bad id ' + JSON.stringify(r.id));
    return null;
  }
  const herd = list(r.herdSize);
  const span = list(r.lifespan);
  const lo = int(herd[0], 1, 60, 1);
  return {
    id,
    name: text(r.name, id, 80),
    diet: oneOf(r.diet, ['herbivore', 'predator', 'scavenger'] as const, 'herbivore'),
    speed: num(r.speed, 0.05, 12, 1),
    fleeSpeed: num(r.fleeSpeed, 0.1, 22, 4),
    awareness: num(r.awareness, 1, 120, 18),
    yields: amounts(r.yields, problems, 'creature ' + id),
    biomes: list(r.biomes).map((b) => text(b, '', 40)).filter((b) => b.length > 0),
    color: colour(r.color, 0x8a7a62),
    bellyColor: colour(r.bellyColor, 0xc4b498),
    size: num(r.size, 0.08, 6, 0.8),
    herdSize: [lo, Math.max(lo, int(herd[1], 1, 60, lo))],
    // A density of ten thousand per square kilometre is not a creature, it is
    // a denial of service.
    density: num(r.density, 0, 200, 8),
    lifespan: [num(span[0], 0.2, 400, 5), num(span[1], 0.2, 400, 12)],
    build: r.build === undefined
      ? undefined
      : oneOf(r.build, ['standard', 'heavy', 'sprawling', 'flyer'] as const, 'standard'),
    life: r.life === undefined
      ? undefined
      : list(r.life).map((l) => oneOf(l, ['primeval', 'settled', 'late'] as const, 'settled')),
  };
}

function readRecipe(raw: unknown, problems: string[]): ModRecipe | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('recipe: bad id ' + JSON.stringify(r.id));
    return null;
  }
  return {
    id,
    name: text(r.name, id, 80),
    building: text(r.building, '', 60),
    inputs: amounts(r.inputs, problems, 'recipe ' + id),
    outputs: amounts(r.outputs, problems, 'recipe ' + id),
    work: num(r.work, 1, 100000, 20),
  };
}

// --------------------------------------------------------------- behaviour

function readTrigger(raw: unknown): ModTrigger | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (r.on) {
    case 'day':
      return { on: 'day' };
    case 'year':
      return { on: 'year' };
    case 'season':
      return {
        on: 'season',
        season: r.season === undefined
          ? undefined
          : oneOf(r.season, ['spring', 'summer', 'autumn', 'winter'] as const, 'spring'),
      };
    case 'weather':
      return { on: 'weather', kind: r.kind === undefined ? undefined : text(r.kind, '', 40) };
    case 'harvest':
      return { on: 'harvest', block: r.block === undefined ? undefined : text(r.block, '', 60) };
    case 'craft':
      return { on: 'craft', recipe: r.recipe === undefined ? undefined : text(r.recipe, '', 60) };
    case 'disaster':
      return { on: 'disaster', kind: r.kind === undefined ? undefined : text(r.kind, '', 40) };
    default:
      return null;
  }
}

function readEffect(raw: unknown): ModEffect | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (r.do) {
    case 'log':
      return { do: 'log', key: text(r.key, '', 80), notable: r.notable === true };
    case 'give':
      return { do: 'give', item: text(r.item, '', 60), amount: int(r.amount, 1, 999, 1) };
    case 'spawnBlock':
      return {
        do: 'spawnBlock',
        block: text(r.block, '', 60),
        count: int(r.count, 1, 40, 1),
        radius: num(r.radius, 1, 400, 20),
      };
    case 'spawnCreature':
      return {
        do: 'spawnCreature',
        creature: text(r.creature, '', 60),
        count: int(r.count, 1, 20, 1),
        radius: num(r.radius, 1, 400, 20),
      };
    case 'weather':
      return { do: 'weather', kind: text(r.kind, '', 40), hours: num(r.hours, 0.5, 240, 6) };
    case 'setCounter':
      return {
        do: 'setCounter',
        counter: text(r.counter, '', 60),
        value: num(r.value, -1e9, 1e9, 0),
      };
    case 'addCounter':
      return {
        do: 'addCounter',
        counter: text(r.counter, '', 60),
        amount: num(r.amount, -1e9, 1e9, 1),
      };
    default:
      return null;
  }
}

function readSystem(raw: unknown, problems: string[]): ModSystem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('system: bad id ' + JSON.stringify(r.id));
    return null;
  }
  const when = readTrigger(r.when);
  if (!when) {
    problems.push('system ' + id + ': unknown trigger');
    return null;
  }
  const then = list(r.then).map(readEffect).filter((e): e is ModEffect => e !== null);
  if (then.length === 0) {
    problems.push('system ' + id + ': no effects it knows how to do');
    return null;
  }
  const req = (r.requires ?? null) as Record<string, unknown> | null;
  return {
    id,
    when,
    chance: r.chance === undefined ? undefined : num(r.chance, 0, 1, 1),
    requires: req
      ? { counter: text(req.counter, '', 60), atLeast: num(req.atLeast, -1e9, 1e9, 0) }
      : undefined,
    // A single trigger firing a hundred effects is a mod with a bug in it.
    then: then.slice(0, 16),
  };
}

// ---------------------------------------------------------------------- UI

function readWidget(raw: unknown): ModWidget | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case 'text':
      return { kind: 'text', text: text(r.text, '', 600) };
    case 'heading':
      return { kind: 'heading', text: text(r.text, '', 120) };
    case 'counter':
      return { kind: 'counter', label: text(r.label, '', 80), counter: text(r.counter, '', 60) };
    case 'itemCount':
      return { kind: 'itemCount', label: text(r.label, '', 80), item: text(r.item, '', 60) };
    case 'bar':
      return {
        kind: 'bar',
        label: text(r.label, '', 80),
        counter: text(r.counter, '', 60),
        max: num(r.max, 0.0001, 1e9, 100),
      };
    case 'button': {
      const then = list(r.then).map(readEffect).filter((e): e is ModEffect => e !== null);
      return { kind: 'button', label: text(r.label, '', 80), then: then.slice(0, 8) };
    }
    case 'list':
      return {
        kind: 'list',
        label: text(r.label, '', 80),
        source: oneOf(r.source, ['items', 'blocks', 'creatures'] as const, 'items'),
      };
    default:
      return null;
  }
}

function readPanel(raw: unknown, problems: string[]): ModPanel | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id, '', 60);
  if (!ID.test(id)) {
    problems.push('panel: bad id ' + JSON.stringify(r.id));
    return null;
  }
  const widgets = list(r.widgets).map(readWidget).filter((w): w is ModWidget => w !== null);
  return { id, title: text(r.title, id, 80), widgets: widgets.slice(0, 60) };
}

// -------------------------------------------------------------------------

/**
 * Turns whatever was in the file into a manifest the game can apply.
 *
 * Returns the mod and everything that was wrong with it. A mod with problems
 * still loads: it loads without the parts that could not be read.
 */
export function readManifest(raw: unknown, source: 'bundled' | 'file'): InstalledMod | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];

  const id = text(r.id, '', 60);
  if (!ID.test(id)) return null;

  const strings: Record<string, Record<string, string>> = {};
  if (r.strings && typeof r.strings === 'object') {
    for (const [lang, table] of Object.entries(r.strings as Record<string, unknown>)) {
      if (!table || typeof table !== 'object') continue;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(table as Record<string, unknown>)) {
        out[text(k, '', 80)] = text(v, '', 600);
      }
      strings[text(lang, '', 8)] = out;
    }
  }

  const manifest: ModManifest = {
    id,
    name: text(r.name, id, 80),
    version: text(r.version, '0', 24),
    author: text(r.author, '', 80),
    description: text(r.description, '', 600),
    gameVersion: text(r.gameVersion, '', 24),
    items: list(r.items).map((x) => readItem(x, problems)).filter((x): x is ModItem => x !== null),
    blocks: list(r.blocks).map((x) => readBlock(x, problems)).filter((x): x is ModBlock => x !== null),
    creatures: list(r.creatures)
      .map((x) => readCreature(x, problems))
      .filter((x): x is ModCreature => x !== null),
    recipes: list(r.recipes)
      .map((x) => readRecipe(x, problems))
      .filter((x): x is ModRecipe => x !== null),
    systems: list(r.systems)
      .map((x) => readSystem(x, problems))
      .filter((x): x is ModSystem => x !== null),
    ui: list(r.ui).map((x) => readPanel(x, problems)).filter((x): x is ModPanel => x !== null),
    strings,
  };

  return { manifest, enabled: true, source, problems };
}
