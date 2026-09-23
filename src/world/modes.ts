/**
 * How you are playing, decided once and then lived with.
 *
 * A mode is not a difficulty slider. It is a statement about what kind of
 * story this world is, and changing it halfway through would make the story
 * retroactively false -- a hardcore world whose death you undid was never a
 * hardcore world. So the choice is made at generation and the save carries
 * it; the only way past it is a console command, which is a deliberate act
 * of cheating rather than a menu you wandered into.
 */

export type GameMode = 'survival' | 'creative' | 'god' | 'hardcore';

export const GAME_MODES: GameMode[] = ['survival', 'creative', 'god', 'hardcore'];

export interface ModeRules {
  id: GameMode;
  /** Whether hunger, thirst, injury and the weather can kill you. */
  mortal: boolean;
  /** Whether death is final and the world is closed afterwards. */
  permadeath: boolean;
  /** Whether building costs materials and time. */
  payForBuilding: boolean;
  /** Whether the god tools are available from the start. */
  godToolsFromStart: boolean;
  /** Whether the player can fly. */
  canFly: boolean;
}

export const MODE_RULES: Record<GameMode, ModeRules> = {
  // The game as it is meant to be played: you are one person in a world that
  // does not care whether you eat.
  survival: {
    id: 'survival',
    mortal: true,
    permadeath: false,
    payForBuilding: true,
    godToolsFromStart: false,
    canFly: false,
  },
  // Nothing is scarce and nothing can hurt you, so the world is a place to
  // build in rather than a place to survive.
  creative: {
    id: 'creative',
    mortal: false,
    permadeath: false,
    payForBuilding: false,
    godToolsFromStart: false,
    canFly: true,
  },
  // The world is the thing being played with, not the person in it.
  god: {
    id: 'god',
    mortal: false,
    permadeath: false,
    payForBuilding: false,
    godToolsFromStart: true,
    canFly: true,
  },
  // Survival, once.
  hardcore: {
    id: 'hardcore',
    mortal: true,
    permadeath: true,
    payForBuilding: true,
    godToolsFromStart: false,
    canFly: false,
  },
};

export function modeRules(mode: GameMode): ModeRules {
  return MODE_RULES[mode] ?? MODE_RULES.survival;
}

/** Reads a mode out of untrusted data; anything unrecognised is survival. */
export function readMode(value: unknown): GameMode {
  if (typeof value === 'string' && (GAME_MODES as string[]).includes(value)) {
    return value as GameMode;
  }
  return 'survival';
}
