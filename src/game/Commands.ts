/**
 * The console.
 *
 * Typed commands, in the manner every sandbox has had since the first one:
 * a slash, a verb, some arguments. Most of these are cheats and are labelled
 * as such, because that is what they are -- the game otherwise refuses to let
 * anything be conjured, finished instantly or teleported, and the honest way
 * to offer a back door is to call it a back door rather than to hide one
 * behind a menu that looks like a feature.
 *
 * So a world that has had cheats used on it remembers. Not to punish anybody:
 * a chronicle that says a kingdom rose over three hundred years is worth
 * reading, and one that says so after somebody typed the kingdom into
 * existence is not, and the difference should be visible.
 *
 * Every handler works through the same public methods the rest of the game
 * uses. Nothing here reaches inside a system to set a field it would not
 * otherwise be allowed to set.
 */

import type { Game } from './Game';
import type { World } from '../sim/World';
import { ITEMS, ItemId } from '../data/items';
import { ANIMALS, AnimalSpecies, speciesForBiome } from '../sim/Wildlife';
import { GAME_MODES, GameMode } from '../world/modes';
import { RESEARCH, ResearchId } from '../data/research';
import { eraProfile } from '../world/eras';
import { SPEED_OPTIONS, GameSpeed } from '../sim/Time';
import type { WeatherKind } from '../render/Sky';

export interface CommandResult {
  ok: boolean;
  /** Lines to print in the console, already in the player's language. */
  lines: string[];
}

export interface CommandDef {
  name: string;
  /** Argument shape for the help listing. Not translated: it is syntax. */
  usage: string;
  /** Translation key for the one-line description. */
  about: string;
  /**
   * Whether running this is cheating.
   *
   * A cheat is anything that produces a result the world's own rules would
   * not have produced. Reading the seed is not one; conjuring an ingot is.
   */
  cheat: boolean;
  run: (ctx: CommandContext, args: string[]) => CommandResult;
}

export interface CommandContext {
  game: Game;
  world: World;
  /** Translates a key. Passed in so this file never imports the interface. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const ok = (...lines: string[]): CommandResult => ({ ok: true, lines });
const fail = (...lines: string[]): CommandResult => ({ ok: false, lines });

/** Case-insensitive lookup against a list of allowed words. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (allowed as readonly string[]).includes(lower) ? (lower as T) : null;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const WEATHERS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'heavy_rain', 'fog', 'storm', 'snow'];

export const COMMANDS: CommandDef[] = [
  {
    name: 'help',
    usage: '[command]',
    about: 'cmd.help.about',
    cheat: false,
    run: (ctx, args) => {
      if (args[0]) {
        const def = findCommand(args[0]);
        if (!def) return fail(ctx.t('cmd.unknown', { name: args[0] }));
        return ok('/' + def.name + ' ' + def.usage, ctx.t(def.about));
      }
      return ok(
        ctx.t('cmd.help.header'),
        ...COMMANDS.map((c) => '/' + c.name + ' ' + c.usage + (c.cheat ? ' *' : '')),
        ctx.t('cmd.help.footer'),
      );
    },
  },

  {
    name: 'gamemode',
    usage: '<survival|creative|god|hardcore>',
    about: 'cmd.gamemode.about',
    cheat: true,
    run: (ctx, args) => {
      const mode = oneOf<GameMode>(args[0], GAME_MODES);
      if (!mode) return fail(ctx.t('cmd.gamemode.which', { modes: GAME_MODES.join(', ') }));
      ctx.world.setMode(mode);
      return ok(ctx.t('cmd.gamemode.done', { mode: ctx.t('new.mode.' + mode) }));
    },
  },

  {
    name: 'give',
    usage: '<item> [count]',
    about: 'cmd.give.about',
    cheat: true,
    run: (ctx, args) => {
      const id = args[0] as ItemId;
      if (!args[0] || !ITEMS[id]) return fail(ctx.t('cmd.give.noSuchItem', { name: args[0] ?? '' }));
      const want = Math.max(1, Math.min(9999, Math.round(num(args[1], 1))));
      const added = ctx.world.player.inventory.add(id, want);
      if (added <= 0) return fail(ctx.t('inv.full'));
      return ok(ctx.t('cmd.give.done', { count: added, item: id }));
    },
  },

  {
    name: 'tp',
    usage: '<x> <z>',
    about: 'cmd.tp.about',
    cheat: true,
    run: (ctx, args) => {
      const t = ctx.world.terrain;
      const x = num(args[0], NaN);
      const z = num(args[1], NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return fail(ctx.t('cmd.tp.usage'));
      if (!t.inWorld(x, z)) return fail(ctx.t('cmd.outsideWorld', { size: Math.round(t.worldSize) }));
      ctx.world.player.position.set(x, t.heightAt(x, z) + 0.2, z);
      ctx.game.focusOn(x, z);
      return ok(ctx.t('cmd.tp.done', { x: Math.round(x), z: Math.round(z) }));
    },
  },

  {
    name: 'where',
    usage: '',
    about: 'cmd.where.about',
    cheat: false,
    run: (ctx) => {
      const p = ctx.world.player.position;
      const t = ctx.world.terrain;
      return ok(
        ctx.t('cmd.where.at', {
          x: Math.round(p.x),
          z: Math.round(p.z),
          h: Math.round(t.heightAt(p.x, p.z)),
        }),
        ctx.t('cmd.where.world', { size: Math.round(t.worldSize) }),
      );
    },
  },

  {
    name: 'seed',
    usage: '',
    about: 'cmd.seed.about',
    cheat: false,
    run: (ctx) => ok(ctx.world.config.seedText, String(ctx.world.config.seed)),
  },

  {
    name: 'time',
    usage: '<dawn|noon|dusk|midnight|HH:MM>',
    about: 'cmd.time.about',
    cheat: true,
    run: (ctx, args) => {
      const named: Record<string, number> = { midnight: 0, dawn: 6, noon: 12, dusk: 18 };
      let hour = named[args[0]?.toLowerCase() ?? ''];
      if (hour === undefined && args[0] && args[0].includes(':')) {
        const [h, m] = args[0].split(':');
        hour = num(h, 12) + num(m, 0) / 60;
      }
      if (hour === undefined || !Number.isFinite(hour)) return fail(ctx.t('cmd.time.usage'));
      ctx.world.setHourOfDay(hour);
      return ok(ctx.t('cmd.time.done', { hour: hour.toFixed(2) }));
    },
  },

  {
    name: 'speed',
    usage: '<0|1|2|4|8>',
    about: 'cmd.speed.about',
    cheat: false,
    run: (ctx, args) => {
      const n = Math.round(num(args[0], 1));
      if (!(SPEED_OPTIONS as readonly number[]).includes(n)) {
        return fail(ctx.t('cmd.speed.usage', { options: SPEED_OPTIONS.join(', ') }));
      }
      ctx.game.setSpeed(n as GameSpeed);
      return ok(ctx.t('cmd.speed.done', { value: n }));
    },
  },

  {
    name: 'weather',
    usage: '<clear|cloudy|rain|heavy_rain|fog|storm|snow> [hours]',
    about: 'cmd.weather.about',
    cheat: true,
    run: (ctx, args) => {
      const kind = oneOf<WeatherKind>(args[0], WEATHERS);
      if (!kind) return fail(ctx.t('cmd.weather.usage', { kinds: WEATHERS.join(', ') }));
      ctx.world.weather.force(kind, Math.max(1, Math.min(240, num(args[1], 8))));
      return ok(ctx.t('cmd.weather.done', { kind }));
    },
  },

  {
    name: 'spawn',
    usage: '<species> [count]',
    about: 'cmd.spawn.about',
    cheat: true,
    run: (ctx, args) => {
      const species = args[0] as AnimalSpecies;
      if (!args[0] || !ANIMALS[species]) {
        const p = ctx.world.player.position;
        const here = speciesForBiome(
          ctx.world.terrain.biomeAt(p.x, p.z),
          eraProfile(ctx.world.config.era).life,
        );
        return fail(ctx.t('cmd.spawn.which', { list: here.join(', ') }));
      }
      const count = Math.max(1, Math.min(40, Math.round(num(args[1], 1))));
      const p = ctx.world.player.position;
      let made = 0;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const x = p.x + Math.cos(a) * 6;
        const z = p.z + Math.sin(a) * 6;
        if (!ctx.world.terrain.inWorld(x, z)) continue;
        if (ctx.world.terrain.waterDepthAt(x, z) > 0.6) continue;
        ctx.world.addAnimal(species, x, z);
        made++;
      }
      return ok(ctx.t('cmd.spawn.done', { count: made, species }));
    },
  },

  {
    name: 'research',
    usage: '<topic|all>',
    about: 'cmd.research.about',
    cheat: true,
    run: (ctx, args) => {
      if (!args[0]) return fail(ctx.t('cmd.research.usage'));
      if (args[0].toLowerCase() === 'all') {
        ctx.world.research.seedCommonKnowledge(1);
        return ok(ctx.t('cmd.research.all', { count: ctx.world.research.unlocked.size }));
      }
      const id = args[0] as ResearchId;
      if (!RESEARCH[id]) return fail(ctx.t('cmd.research.noSuchTopic', { name: args[0] }));
      ctx.world.research.forceUnlock(id);
      return ok(ctx.t('cmd.research.done', { name: id }));
    },
  },

  {
    name: 'heal',
    usage: '',
    about: 'cmd.heal.about',
    cheat: true,
    run: (ctx) => {
      const p = ctx.world.player;
      p.body.treatEverything();
      p.stats.hunger = 100;
      p.stats.thirst = 100;
      p.stats.stamina = p.stats.maxStamina;
      return ok(ctx.t('cmd.heal.done'));
    },
  },

  {
    name: 'name',
    usage: '<text>',
    about: 'cmd.name.about',
    cheat: false,
    run: (ctx, args) => {
      const name = args.join(' ').trim().slice(0, 32);
      if (!name) return fail(ctx.t('cmd.name.usage'));
      ctx.world.player.name = name;
      ctx.world.config.playerName = name;
      return ok(ctx.t('cmd.name.done', { name }));
    },
  },

  {
    name: 'nations',
    usage: '',
    about: 'cmd.nations.about',
    cheat: false,
    run: (ctx) => {
      const rows = ctx.world.nations.nations.map(
        (n) =>
          n.name +
          ' — ' +
          Math.round(n.population) +
          ' · ' +
          ctx.world.technology.eraOf(ctx.world, n).id,
      );
      return ok(...(rows.length > 0 ? rows : [ctx.t('cmd.nations.none')]));
    },
  },

  {
    name: 'locate',
    usage: '<town|landmark|water>',
    about: 'cmd.locate.about',
    cheat: false,
    run: (ctx, args) => {
      const p = ctx.world.player.position;
      const what = oneOf(args[0], ['town', 'landmark', 'water'] as const);
      if (!what) return fail(ctx.t('cmd.locate.usage'));

      if (what === 'town') {
        const town = ctx.world.nations.townNear(p.x, p.z);
        if (!town) return fail(ctx.t('cmd.locate.none'));
        return ok(bearing(ctx, town.name, town.x, town.z, p.x, p.z));
      }

      if (what === 'landmark') {
        let best: { name: string; x: number; z: number } | null = null;
        let bestD = Infinity;
        for (const poi of ctx.world.pois) {
          const d = Math.hypot(poi.x - p.x, poi.z - p.z);
          if (d >= bestD) continue;
          bestD = d;
          best = poi;
        }
        if (!best) return fail(ctx.t('cmd.locate.none'));
        return ok(bearing(ctx, best.name, best.x, best.z, p.x, p.z));
      }

      const t = ctx.world.terrain;
      for (let r = 6; r < t.worldSize; r *= 1.5) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          if (!t.inWorld(x, z)) continue;
          // Fresh water only: the sea is no use and saying otherwise could
          // send somebody a long way for nothing.
          if (t.waterDepthAt(x, z) > 0.15 && t.heightAt(x, z) > 0.4) {
            return ok(bearing(ctx, ctx.t('cmd.locate.freshWater'), x, z, p.x, p.z));
          }
        }
      }
      return fail(ctx.t('cmd.locate.none'));
    },
  },

  {
    name: 'cheats',
    usage: '',
    about: 'cmd.cheats.about',
    cheat: false,
    run: (ctx) => ok(ctx.world.cheated ? ctx.t('cmd.cheats.yes') : ctx.t('cmd.cheats.no')),
  },
];

function bearing(
  ctx: CommandContext,
  name: string,
  x: number,
  z: number,
  fromX: number,
  fromZ: number,
): string {
  const d = Math.round(Math.hypot(x - fromX, z - fromZ));
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // Screen z grows southward, which is why north is negative z.
  const angle = Math.atan2(x - fromX, -(z - fromZ));
  const point = points[(Math.round((angle / (Math.PI * 2)) * 8) + 8) % 8];
  return ctx.t('cmd.locate.found', { name, distance: d, bearing: point });
}

export function findCommand(name: string): CommandDef | null {
  const lower = name.replace(/^\//, '').toLowerCase();
  return COMMANDS.find((c) => c.name === lower) ?? null;
}

/**
 * Parses and runs one line.
 *
 * Quoted arguments work because a name can have a space in it. Nothing else
 * about the syntax is clever, on purpose: a console that guesses what you
 * meant is a console you cannot trust.
 */
export function runCommand(ctx: CommandContext, line: string): CommandResult {
  const text = line.trim().replace(/^\//, '');
  if (!text) return fail(ctx.t('cmd.empty'));
  const parts = text.match(/"[^"]*"|\S+/g) ?? [];
  const args = parts.map((a) => a.replace(/^"|"$/g, ''));
  const name = args.shift() ?? '';
  const def = findCommand(name);
  if (!def) return fail(ctx.t('cmd.unknown', { name }));
  try {
    const result = def.run(ctx, args);
    if (def.cheat && result.ok) ctx.world.markCheated();
    return result;
  } catch (err) {
    // A bad command should not take the game down with it.
    console.error('[WorldSmith] command failed', err);
    return fail(ctx.t('cmd.failed'));
  }
}

/** Command names beginning with `prefix`, for tab completion. */
export function completions(prefix: string): string[] {
  const lower = prefix.replace(/^\//, '').toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(lower)).map((c) => c.name);
}
