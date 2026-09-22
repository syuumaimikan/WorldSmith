/**
 * What a thing looks like in your hands.
 *
 * Every item in the game used to be drawn as a coloured square, which meant
 * that a pickaxe, a loaf of bread and a bar of silver were the same object in
 * three different shades. An inventory is read at a glance and a square cannot
 * be read at all, so each item now gets a silhouette.
 *
 * These are drawn rather than painted: a small set of shapes, each shared by
 * the family of items it suits, tinted from that item's own palette colour.
 * That keeps sixty items down to twenty drawings, keeps every one of them
 * consistent with the colour it has on the ground and in the world, and means
 * a new item picks up a sensible icon by the family it belongs to rather than
 * by somebody remembering to draw one.
 */

import { JSX } from 'react';
import { ItemId, ITEMS } from '../../data/items';
import { hexToCss, mixHex, shade } from '../../render/Palette';
import { useLocale } from '../../i18n';
import { itemName } from '../../i18n/names';

type IconShape =
  | 'logs'
  | 'planks'
  | 'rock'
  | 'ore'
  | 'ingot'
  | 'sack'
  | 'cloth'
  | 'rope'
  | 'berries'
  | 'nuts'
  | 'mushroom'
  | 'leaf'
  | 'bread'
  | 'fish'
  | 'meat'
  | 'hide'
  | 'pot'
  | 'brick'
  | 'axe'
  | 'pick'
  | 'hammer'
  | 'hoe'
  | 'saw'
  | 'rod'
  | 'nails'
  | 'glass'
  | 'chair'
  | 'jar'
  | 'crystal'
  | 'grains'
  | 'cane';

const SHAPES: Partial<Record<ItemId, IconShape>> = {
  log: 'logs',
  plank: 'planks',
  beam: 'planks',
  stone: 'rock',
  stone_block: 'brick',
  brick: 'brick',
  limestone: 'rock',
  flint: 'rock',
  obsidian: 'crystal',
  iron_ore: 'ore',
  copper_ore: 'ore',
  tin_ore: 'ore',
  silver_ore: 'ore',
  gold_nugget: 'crystal',
  coal: 'rock',
  clay: 'rock',
  sand: 'grains',
  salt: 'grains',
  iron_ingot: 'ingot',
  copper_ingot: 'ingot',
  bronze_ingot: 'ingot',
  charcoal: 'rock',
  grain: 'sack',
  flour: 'sack',
  fiber: 'sack',
  reed: 'cane',
  bamboo: 'cane',
  thatch: 'cane',
  cloth: 'cloth',
  rope: 'rope',
  leather: 'hide',
  hide: 'hide',
  berries: 'berries',
  nuts: 'nuts',
  mushrooms: 'mushroom',
  herbs: 'leaf',
  vegetables: 'leaf',
  bread: 'bread',
  fish: 'fish',
  meat: 'meat',
  preserves: 'jar',
  pottery: 'pot',
  glass: 'glass',
  nails: 'nails',
  furniture: 'chair',
  axe: 'axe',
  pickaxe: 'pick',
  hammer: 'hammer',
  hoe: 'hoe',
  saw: 'saw',
  fishing_rod: 'rod',
};

const WOOD = 0x7a5230;
const STEEL = 0x9aa0a6;
const DARK = 0x2b2620;

/** The drawing for one shape, in a 24x24 box. */
function draw(shape: IconShape, c: string, dim: string, lit: string): JSX.Element {
  switch (shape) {
    case 'logs':
      return (
        <>
          <rect x="2" y="8" width="20" height="6" rx="3" fill={dim} />
          <rect x="3" y="14" width="18" height="6" rx="3" fill={c} />
          <ellipse cx="21" cy="17" rx="2" ry="3" fill={lit} />
          <ellipse cx="21" cy="17" rx="0.8" ry="1.4" fill={dim} />
        </>
      );
    case 'planks':
      return (
        <>
          <rect x="2" y="7" width="20" height="4" rx="1" fill={c} />
          <rect x="3" y="12" width="19" height="4" rx="1" fill={lit} />
          <rect x="2" y="17" width="20" height="4" rx="1" fill={dim} />
        </>
      );
    case 'rock':
      return (
        <>
          <path d="M4 18 L7 8 L14 6 L20 12 L18 19 Z" fill={c} />
          <path d="M7 8 L14 6 L13 12 Z" fill={lit} />
          <path d="M13 12 L20 12 L18 19 Z" fill={dim} />
        </>
      );
    case 'ore':
      return (
        <>
          <path d="M4 18 L7 8 L14 6 L20 12 L18 19 Z" fill="#6e7178" />
          <path d="M7 8 L14 6 L13 12 Z" fill="#8a8d93" />
          <path d="M9 14 l3 -3 2 3 -3 3 Z" fill={c} />
          <path d="M15 9 l2 -2 1.5 2 -2 2 Z" fill={lit} />
        </>
      );
    case 'ingot':
      return (
        <>
          <path d="M3 17 L6 11 L18 11 L21 17 Z" fill={c} />
          <path d="M6 11 L18 11 L17 9 L7 9 Z" fill={lit} />
          <path d="M3 17 L21 17 L20 19 L4 19 Z" fill={dim} />
        </>
      );
    case 'sack':
      return (
        <>
          <path d="M6 10 q6 -4 12 0 q3 9 -1 11 h-10 q-4 -2 -1 -11 Z" fill={c} />
          <path d="M8 9 q4 -3 8 0 l-1 -3 q-3 -2 -6 0 Z" fill={dim} />
          <rect x="8" y="7" width="8" height="2" rx="1" fill={lit} />
        </>
      );
    case 'cloth':
      return (
        <>
          <path d="M3 8 q5 3 9 0 q5 3 9 0 v9 q-4 3 -9 0 q-5 3 -9 0 Z" fill={c} />
          <path d="M3 12 q5 3 9 0 q5 3 9 0" stroke={lit} strokeWidth="1" fill="none" />
        </>
      );
    case 'rope':
      return (
        <>
          <circle cx="12" cy="13" r="7" fill="none" stroke={c} strokeWidth="3.4" />
          <circle cx="12" cy="13" r="7" fill="none" stroke={lit} strokeWidth="1" strokeDasharray="2 3" />
        </>
      );
    case 'berries':
      return (
        <>
          <path d="M12 6 q4 1 3 4" stroke="#4a7d3c" strokeWidth="1.6" fill="none" />
          <circle cx="9" cy="14" r="3.4" fill={c} />
          <circle cx="15" cy="15" r="3.4" fill={dim} />
          <circle cx="12" cy="10" r="3.2" fill={lit} />
        </>
      );
    case 'nuts':
      return (
        <>
          <path d="M6 16 q0 -5 4 -5 q4 0 4 5 q-4 3 -8 0 Z" fill={c} />
          <path d="M13 18 q0 -4 3 -4 q3 0 3 4 q-3 2.4 -6 0 Z" fill={lit} />
        </>
      );
    case 'mushroom':
      return (
        <>
          <rect x="10.5" y="12" width="3" height="7" rx="1.2" fill="#e4dcc8" />
          <path d="M4 12 q1 -7 8 -7 q7 0 8 7 Z" fill={c} />
          <circle cx="9" cy="9" r="1.2" fill={lit} />
          <circle cx="15" cy="10" r="1" fill={lit} />
        </>
      );
    case 'leaf':
      return (
        <>
          <path d="M12 20 q-8 -4 -6 -12 q8 -1 10 4 q1 6 -4 8 Z" fill={c} />
          <path d="M12 20 q-1 -8 -5 -11" stroke={dim} strokeWidth="1" fill="none" />
          <path d="M17 6 q4 3 2 8" stroke={lit} strokeWidth="1.6" fill="none" />
        </>
      );
    case 'bread':
      return (
        <>
          <path d="M3 16 q0 -8 9 -8 q9 0 9 8 q0 3 -9 3 q-9 0 -9 -3 Z" fill={c} />
          <path d="M7 11 l2 -2 M11 10 l2 -2 M15 11 l2 -2" stroke={dim} strokeWidth="1.2" />
        </>
      );
    case 'fish':
      return (
        <>
          <path d="M3 12 q6 -6 13 0 q-7 6 -13 0 Z" fill={c} />
          <path d="M16 12 l5 -4 v8 Z" fill={dim} />
          <circle cx="7" cy="11" r="1" fill={hexToCss(DARK)} />
        </>
      );
    case 'meat':
      return (
        <>
          <path d="M6 18 q-3 -9 5 -11 q7 -2 8 5 q1 6 -6 7 Z" fill={c} />
          <path d="M6 18 l-3 3 M6 18 l3 3" stroke="#e8e0cc" strokeWidth="2.4" strokeLinecap="round" />
        </>
      );
    case 'hide':
      return (
        <>
          <path d="M5 5 q3 3 7 2 q4 1 7 -2 q2 6 -1 8 q3 4 -1 8 q-5 -2 -10 0 q-4 -4 -1 -8 q-3 -2 -1 -8 Z" fill={c} />
          <path d="M10 10 q3 2 5 0" stroke={dim} strokeWidth="1" fill="none" />
        </>
      );
    case 'pot':
      return (
        <>
          <path d="M6 10 q6 -3 12 0 q2 9 -2 10 h-8 q-4 -1 -2 -10 Z" fill={c} />
          <ellipse cx="12" cy="10" rx="6" ry="2" fill={lit} />
          <path d="M6 14 q6 2 12 0" stroke={dim} strokeWidth="1" fill="none" />
        </>
      );
    case 'brick':
      return (
        <>
          <rect x="2" y="8" width="9" height="5" rx="1" fill={c} />
          <rect x="12" y="8" width="10" height="5" rx="1" fill={lit} />
          <rect x="2" y="14" width="13" height="5" rx="1" fill={dim} />
          <rect x="16" y="14" width="6" height="5" rx="1" fill={c} />
        </>
      );
    case 'axe':
      return (
        <>
          <rect x="11" y="4" width="2.6" height="17" rx="1.2" fill={hexToCss(WOOD)} transform="rotate(14 12 12)" />
          <path d="M13 5 q6 1 6 5 q-4 3 -7 1 Z" fill={hexToCss(STEEL)} />
        </>
      );
    case 'pick':
      return (
        <>
          <rect x="11" y="6" width="2.6" height="15" rx="1.2" fill={hexToCss(WOOD)} />
          <path d="M3 8 q9 -5 18 0 q-9 -1 -18 0 Z" fill={hexToCss(STEEL)} />
        </>
      );
    case 'hammer':
      return (
        <>
          <rect x="11" y="8" width="2.6" height="13" rx="1.2" fill={hexToCss(WOOD)} />
          <rect x="6" y="4" width="12" height="5" rx="1.4" fill={hexToCss(STEEL)} />
        </>
      );
    case 'hoe':
      return (
        <>
          <rect x="11" y="4" width="2.4" height="17" rx="1.2" fill={hexToCss(WOOD)} transform="rotate(-12 12 12)" />
          <path d="M6 6 h9 v4 h-6 Z" fill={hexToCss(STEEL)} />
        </>
      );
    case 'saw':
      return (
        <>
          <path d="M3 9 h16 v4 h-16 Z" fill={hexToCss(STEEL)} />
          <path d="M3 13 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3" fill={hexToCss(STEEL)} />
          <rect x="18" y="7" width="4" height="7" rx="1.6" fill={hexToCss(WOOD)} />
        </>
      );
    case 'rod':
      return (
        <>
          <path d="M4 20 L19 5" stroke={hexToCss(WOOD)} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M19 5 q3 6 -3 9" stroke="#cfd6dd" strokeWidth="1" fill="none" />
          <circle cx="16" cy="15" r="1.6" fill={c} />
        </>
      );
    case 'nails':
      return (
        <>
          <path d="M6 4 h5 l-1.6 3 h-1.8 Z M8 7 h1.4 l-0.5 13 Z" fill={c} />
          <path d="M14 6 h5 l-1.6 3 h-1.8 Z M16 9 h1.4 l-0.5 11 Z" fill={lit} />
        </>
      );
    case 'glass':
      return (
        <>
          <path d="M7 4 h10 l-2 9 v7 h-6 v-7 Z" fill={c} opacity="0.75" />
          <path d="M9 5 l-1 7" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" />
        </>
      );
    case 'chair':
      return (
        <>
          <rect x="6" y="4" width="3" height="16" rx="1" fill={c} />
          <rect x="6" y="12" width="13" height="3" rx="1" fill={lit} />
          <rect x="16" y="14" width="3" height="6" rx="1" fill={dim} />
          <rect x="6" y="7" width="9" height="2" rx="1" fill={dim} />
        </>
      );
    case 'jar':
      return (
        <>
          <rect x="8" y="4" width="8" height="3" rx="1" fill={hexToCss(WOOD)} />
          <path d="M7 8 h10 v9 q0 3 -5 3 q-5 0 -5 -3 Z" fill={c} />
          <rect x="7" y="12" width="10" height="4" fill={lit} opacity="0.6" />
        </>
      );
    case 'crystal':
      return (
        <>
          <path d="M12 3 L19 11 L12 21 L5 11 Z" fill={c} />
          <path d="M12 3 L19 11 L12 12 Z" fill={lit} />
          <path d="M12 12 L19 11 L12 21 Z" fill={dim} />
        </>
      );
    case 'grains':
      return (
        <>
          <path d="M3 19 q9 -9 18 0 Z" fill={c} />
          <circle cx="9" cy="15" r="1" fill={lit} />
          <circle cx="14" cy="16" r="1" fill={lit} />
          <circle cx="12" cy="18" r="1" fill={dim} />
        </>
      );
    case 'cane':
      return (
        <>
          <rect x="6" y="3" width="3" height="18" rx="1.4" fill={c} />
          <rect x="11" y="4" width="3" height="17" rx="1.4" fill={lit} />
          <rect x="16" y="6" width="3" height="15" rx="1.4" fill={dim} />
          <path d="M6 10 h3 M11 12 h3 M16 13 h3" stroke={dim} strokeWidth="1" />
        </>
      );
  }
}

/**
 * Anything without a drawing of its own gets one from what it is made of,
 * so a new item is never a blank square.
 */
function shapeFor(item: ItemId): IconShape {
  const known = SHAPES[item];
  if (known) return known;
  switch (ITEMS[item].category) {
    case 'tool':
      return 'hammer';
    case 'food':
      return 'berries';
    case 'material':
      return 'ingot';
    default:
      return 'rock';
  }
}

export function ItemIcon({ item, size = 26 }: { item: ItemId; size?: number }): JSX.Element {
  const def = ITEMS[item];
  useLocale();
  const base = def.color;
  return (
    <div className="item-icon" title={itemName(item)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        {draw(
          shapeFor(item),
          hexToCss(base),
          hexToCss(shade(base, 0.72)),
          hexToCss(mixHex(base, 0xffffff, 0.34)),
        )}
      </svg>
    </div>
  );
}
