/**
 * Research progress.
 *
 * Points are produced only by scholars physically working in a study. Nothing
 * accrues passively — a settlement that has not spared anyone for research does
 * not advance, which is the intended trade-off.
 */

import { ALL_RESEARCH_IDS, availableResearch, RESEARCH, ResearchId, ResearchNode } from '../data/research';
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

  constructor() {
    // Everyone starts knowing how to make a tool out of a rock and a stick.
    this.unlocked.add('basic_tools');
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
    this.active = (data.active as ResearchId) ?? null;
    if (this.active && !RESEARCH[this.active]) this.active = null;
    this.progress = data.progress ?? 0;
    this.totalPoints = data.points ?? 0;
  }
}
