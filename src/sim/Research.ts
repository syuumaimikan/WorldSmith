/**
 * Research progress.
 *
 * Points are produced only by scholars physically working in a study. Nothing
 * accrues passively — a settlement that has not spared anyone for research does
 * not advance, which is the intended trade-off.
 */

import {
  ALL_RESEARCH_IDS,
  availableResearch,
  RESEARCH,
  ResearchEffects,
  researchEffects,
  ResearchId,
  ResearchNode,
} from '../data/research';
import { BUILDINGS, BuildingId } from '../data/buildings';
import { RECIPES, RecipeId } from '../data/recipes';

export class ResearchSystem {
  readonly unlocked = new Set<ResearchId>();
  active: ResearchId | null = null;
  progress = 0;
  /** Lifetime points produced, shown in the UI. */
  totalPoints = 0;

  /** Set for one tick when a project completes. */
  justCompleted: ResearchId | null = null;

  /**
   * What everything known adds up to, recomputed only when the set changes.
   *
   * Read on hot paths -- every worker's work rate, every day's harvest --
   * so it is not worth summing fifty entries each time somebody swings an
   * axe.
   */
  private cached: ResearchEffects | null = null;

  get effects(): ResearchEffects {
    if (!this.cached) this.cached = researchEffects(this.unlocked);
    return this.cached;
  }

  /** Called whenever the unlocked set changes. */
  private invalidate(): void {
    this.cached = null;
  }

  constructor() {
    // Everyone starts knowing how to make a tool out of a rock and a stick --
    // which means knowing how to break the rock first. Unlocking the hafting
    // without the knapping left a tree whose own rules said the settlement
    // could not have got there.
    this.unlocked.add('knapping');
    this.unlocked.add('fire_making');
    this.unlocked.add('basic_tools');
  }

  /**
   * What the world you were born into already takes for granted.
   *
   * A person who grows up in a medieval kingdom does not have to invent rope.
   * `depth` is how far down the tree that common knowledge reaches, 0..1, and
   * everything at or above that depth is simply known -- in dependency order,
   * so nothing is unlocked whose prerequisites are not.
   *
   * This is not a head start handed out for free. It is the difference
   * between founding a civilisation and being born into one, which is
   * precisely what choosing a later age means.
   */
  seedCommonKnowledge(depth: number): void {
    if (depth <= 0) return;
    const maxTier = Math.max(...ALL_RESEARCH_IDS.map((id) => RESEARCH[id].tier));
    const reach = depth * maxTier;
    // Several passes, because a topic can only be taken once the things it
    // rests on have been.
    for (let pass = 0; pass <= maxTier; pass++) {
      for (const id of ALL_RESEARCH_IDS) {
        const topic = RESEARCH[id];
        if (topic.tier > reach) continue;
        if (this.unlocked.has(id)) continue;
        if (!topic.requires.every((r) => this.unlocked.has(r))) continue;
        this.unlocked.add(id);
      }
    }
    this.invalidate();
  }

  /**
   * Unlocks one topic and everything it rests on.
   *
   * Only the console calls this. Unlocking a topic without its prerequisites
   * would leave a tree that says the settlement can build a forge but has
   * never worked out how to smelt anything, so the chain comes with it.
   */
  forceUnlock(id: ResearchId): void {
    const add = (target: ResearchId, depth: number): void => {
      if (depth > 24 || this.unlocked.has(target)) return;
      for (const req of RESEARCH[target].requires) add(req, depth + 1);
      this.unlocked.add(target);
    };
    add(id, 0);
    this.invalidate();
  }

  isUnlocked(id: ResearchId): boolean {
    return this.unlocked.has(id);
  }

  canStart(id: ResearchId): boolean {
    if (this.unlocked.has(id)) return false;
    return RESEARCH[id].requires.every((r) => this.unlocked.has(r));
  }

  start(id: ResearchId): boolean {
    if (!this.canStart(id)) return false;
    if (this.active === id) return true;
    this.active = id;
    this.progress = 0;
    return true;
  }

  cancel(): void {
    this.active = null;
    this.progress = 0;
  }

  contribute(points: number): void {
    if (!this.active) return;
    this.progress += points;
    this.totalPoints += points;
    const node = RESEARCH[this.active];
    if (this.progress >= node.cost) {
      this.unlocked.add(this.active);
      this.invalidate();
      this.justCompleted = this.active;
      this.active = null;
      this.progress = 0;
    }
  }

  clearJustCompleted(): void {
    this.justCompleted = null;
  }

  get activeNode(): ResearchNode | null {
    return this.active ? RESEARCH[this.active] : null;
  }

  get activeProgress(): number {
    if (!this.active) return 0;
    return Math.min(1, this.progress / RESEARCH[this.active].cost);
  }

  available(): ResearchNode[] {
    return availableResearch(this.unlocked);
  }

  /** Building types the settlement is currently allowed to construct. */
  buildingUnlocked(id: BuildingId): boolean {
    const req = BUILDINGS[id].requiresResearch;
    return !req || this.unlocked.has(req);
  }

  recipeUnlocked(id: RecipeId): boolean {
    const req = RECIPES[id].requiresResearch;
    return !req || this.unlocked.has(req);
  }

  serialize(): { unlocked: string[]; active: string | null; progress: number; points: number } {
    return {
      unlocked: [...this.unlocked],
      active: this.active,
      progress: this.progress,
      points: this.totalPoints,
    };
  }

  restore(data: { unlocked?: string[]; active?: string | null; progress?: number; points?: number } | undefined): void {
    if (!data) return;
    this.unlocked.clear();
    for (const id of data.unlocked ?? []) {
      if (ALL_RESEARCH_IDS.includes(id as ResearchId)) this.unlocked.add(id as ResearchId);
    }
    if (this.unlocked.size === 0) this.unlocked.add('basic_tools');
    this.invalidate();
    this.active = (data.active as ResearchId) ?? null;
    if (this.active && !RESEARCH[this.active]) this.active = null;
    this.progress = data.progress ?? 0;
    this.totalPoints = data.points ?? 0;
  }
}
