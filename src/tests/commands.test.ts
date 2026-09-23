/**
 * The console.
 *
 * Two things matter here. One: every command works through the same public
 * methods the rest of the game uses, so a command cannot produce a state the
 * simulation could not have reached. Two: a world that has had a cheat used
 * on it says so, because a chronicle is only worth reading if it happened.
 */

import { describe, expect, it } from 'vitest';
import { runCommand, COMMANDS, completions } from '../game/Commands';
import { buildTestWorld, makeTestConfig } from './harness';
import type { Game } from '../game/Game';
import type { World } from '../sim/World';
import { RESEARCH } from '../data/research';

/** The console only ever touches `focusOn` and `setSpeed` on the game. */
function fakeGame(world: World): Game {
  return {
    world,
    focusOn: () => undefined,
    setSpeed: () => undefined,
  } as unknown as Game;
}

function ctxFor(world: World): { game: Game; world: World; t: (k: string) => string } {
  return { game: fakeGame(world), world, t: (k: string) => k };
}

describe('the console', () => {
  it('refuses a verb it does not have', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-1' }));
    const r = runCommand(ctxFor(world), '/wish for a pony');
    expect(r.ok).toBe(false);
    expect(world.cheated).toBe(false);
  });

  it('refuses nonsense arguments rather than acting on them', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-2' }));
    expect(runCommand(ctxFor(world), '/tp nowhere here').ok).toBe(false);
    expect(runCommand(ctxFor(world), '/give notathing 5').ok).toBe(false);
    expect(runCommand(ctxFor(world), '/gamemode invincible').ok).toBe(false);
    expect(runCommand(ctxFor(world), '/speed 99').ok).toBe(false);
    expect(world.cheated).toBe(false);
  });

  it('will not put you outside the world', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-3' }));
    const before = world.player.position.clone();
    const r = runCommand(ctxFor(world), '/tp 999999 999999');
    expect(r.ok).toBe(false);
    expect(world.player.position.x).toBe(before.x);
  });

  it('records that a cheat was used, and only for cheats', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-4' }));
    expect(runCommand(ctxFor(world), '/where').ok).toBe(true);
    expect(runCommand(ctxFor(world), '/seed').ok).toBe(true);
    expect(world.cheated).toBe(false);

    expect(runCommand(ctxFor(world), '/give stone 3').ok).toBe(true);
    expect(world.cheated).toBe(true);
    expect(world.player.inventory.count('stone')).toBe(3);
  });

  it('is the only way to change a mode chosen at generation', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-5', mode: 'survival' }));
    expect(world.config.mode).toBe('survival');
    expect(runCommand(ctxFor(world), '/gamemode creative').ok).toBe(true);
    expect(world.config.mode).toBe('creative');
  });

  it('never leaves the research tree in a state it could not have reached', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-6' }));
    runCommand(ctxFor(world), '/research metallurgy');
    for (const id of world.research.unlocked) {
      // Whatever it granted, everything that topic rests on came with it.
      for (const req of RESEARCH[id].requires) {
        expect(world.research.unlocked.has(req)).toBe(true);
      }
    }
    expect(world.research.unlocked.size).toBeGreaterThan(1);
  });

  it('completes a verb from its first letters', () => {
    expect(completions('gam')).toContain('gamemode');
    expect(completions('/he')).toContain('help');
    expect(completions('zzz')).toHaveLength(0);
  });

  it('describes every command it offers', () => {
    const world = buildTestWorld(makeTestConfig({ seedText: 'cmd-7' }));
    const help = runCommand(ctxFor(world), '/help');
    expect(help.ok).toBe(true);
    for (const c of COMMANDS) {
      expect(help.lines.some((l) => l.startsWith('/' + c.name))).toBe(true);
    }
  });
});
