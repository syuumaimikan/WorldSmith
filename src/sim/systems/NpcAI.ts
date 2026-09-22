/**
 * Settler decision making and task execution.
 *
 * Behaviour is chosen by scoring candidate actions rather than by a tree of
 * conditionals, so a hungry exhausted builder at dusk resolves sensibly without
 * anyone having written that exact case. Once an action is chosen it becomes a
 * concrete task with a real destination, and the settler physically walks
 * there and does the work.
 */

import type { World } from '../World';
import { isChild } from '../Generations';
import { Npc, NPC_WALK_SPEED, NpcActivity } from '../Npc';
import { Building } from '../Building';
import { HaulJob, Job } from '../Jobs';
import { ItemId, ITEMS, FOOD_PRIORITY, isFood, nutritionOf } from '../../data/items';
import { RESOURCES } from '../../world/resources';
import { RECIPES, Recipe } from '../../data/recipes';
import { PROFESSIONS, SkillId } from '../../data/professions';
import { clamp, clamp01, damp } from '../../core/math';
import { OVERLAY } from '../../world/Terrain';

/** Work produced per simulated second by an average worker. */
const BUILD_RATE = 3.6;
const GATHER_RATE = 3.2;
const CRAFT_RATE = 3.4;
const FARM_RATE = 3.0;
const RESEARCH_RATE = 0.6;

const ARRIVE_DISTANCE = 1.15;
/**
 * Ticks a settler may spend on one task before giving up. This has to be
 * generous: at 15 ticks a second of simulated time, crossing a settlement can
 * easily take a thousand ticks, and abandoning tasks early is what makes a
 * workforce look aimless.
 */
const MAX_TASK_ATTEMPTS = 2700;

/** How often a settler on a filler task looks up for real work. */
const RECONSIDER_TICKS = 40;

export function updateNpc(world: World, npc: Npc, dt: number): void {
  updateNeeds(world, npc, dt);

  // A settler the player has taken over still gets hungry and tired, but the
  // player decides what they do. Their AI resumes the moment control is let go.
  if (world.possessed === npc.id) {
    npc.y = world.terrain.heightAt(npc.x, npc.z);
    npc.updateMood();
    return;
  }

  maybeReconsider(world, npc);

  if (npc.task.type === 'none') {
    chooseTask(world, npc);
  }

  executeTask(world, npc, dt);
  moveAlongPath(world, npc, dt);

  npc.y = world.terrain.heightAt(npc.x, npc.z);
  npc.updateMood();
}

// -------------------------------------------------------------------------
// Needs
// -------------------------------------------------------------------------

function updateNeeds(world: World, npc: Npc, dt: number): void {
  const hours = world.time.hoursFor(dt);
  const n = npc.needs;
  const sleeping = npc.activity === 'sleeping';

  n.hunger = clamp(n.hunger - hours * 4.2, 0, 100);
  n.rest = clamp(n.rest + (sleeping ? hours * 11 : -hours * 4.6), 0, 100);
  n.social = clamp(n.social - hours * 2.2, 0, 100);

  // Comfort comes from having a home, and from the weather.
  const home = npc.homeId ? world.buildingById.get(npc.homeId) : undefined;
  const shelterQuality = home ? (home.def.housing ?? 0) >= 5 ? 1 : 0.7 : 0.25;
  const exposure = world.weather.severity * (sleeping && home ? 0.15 : 1);
  const comfortTarget = clamp01(shelterQuality - exposure * 0.45) * 100;
  n.comfort = damp(n.comfort, comfortTarget, 0.4, hours);

  // Going hungry or sleeping cold does not wound anybody. It wastes them,
  // and being fed and warm brings it back -- which is what the body does with
  // this, rather than a bar going down and up.
  let toll = 0;
  if (n.hunger < 12) toll += hours * 0.012;
  if (n.comfort < 18) toll += hours * 0.004;
  if (toll > 0) npc.body.starve(toll);
  const fed = clamp01(n.hunger / 100);
  npc.body.advance(hours / 24, fed, world.careQuality(npc), npc.rng);
  if (npc.body.failure()) {
    world.killNpc(npc, 'ev.diedOfInjury', { name: npc.name });
  }
}

// -------------------------------------------------------------------------
// Choosing what to do
// -------------------------------------------------------------------------

interface Candidate {
  score: number;
  apply: () => void;
}

function chooseTask(world: World, npc: Npc): void {
  const snap = world.time.snapshot();
  const hour = snap.hour + snap.minute / 60;
  const n = npc.needs;

  const candidates: Candidate[] = [];

  // --- Sleep -------------------------------------------------------------
  const nightFactor = hour >= npc.sleepHour || hour < npc.wakeHour ? 1 : 0;
  const tiredness = 1 - clamp01(n.rest / 100);
  const sleepScore = nightFactor * (0.55 + tiredness * 0.5) + Math.max(0, tiredness - 0.75) * 1.4;
  candidates.push({
    score: sleepScore,
    apply: () => {
      const home = npc.homeId ? world.buildingById.get(npc.homeId) : undefined;
      if (home) {
        const p = home.accessPoint(world.terrain.tileSize);
        npc.setTask('sleep', { targetId: home.id, x: p.x, z: p.z });
      } else {
        // No bed: sleep where they are, badly.
        npc.setTask('sleep', { targetId: 0, x: npc.x, z: npc.z });
      }
    },
  });

  // --- Eat ---------------------------------------------------------------
  const hungerUrgency = 1 - clamp01(n.hunger / 100);
  if (hungerUrgency > 0.32) {
    const carriedFood = findCarriedFood(npc);
    const foodSource = carriedFood ? null : world.findFoodStore(npc.x, npc.z);
    if (carriedFood || foodSource) {
      candidates.push({
        score: 0.5 + hungerUrgency * 1.35,
        apply: () => {
          if (carriedFood) {
            npc.setTask('eat', { targetId: 0, x: npc.x, z: npc.z });
          } else if (foodSource) {
            const p = foodSource.accessPoint(world.terrain.tileSize);
            npc.setTask('eat', { targetId: foodSource.id, x: p.x, z: p.z });
          }
        },
      });
    }
  }

  // --- Work --------------------------------------------------------------
  const workHours = hour >= npc.wakeHour + 0.6 && hour < npc.sleepHour - 1.2;
  const fitToWork = clamp01(n.rest / 100) > 0.12 && clamp01(n.hunger / 100) > 0.1;
  if (workHours && fitToWork) {
    const workScore = 0.62 + clamp01(n.rest / 100) * 0.25;
    candidates.push({
      score: workScore,
      apply: () => assignWork(world, npc),
    });
  }

  // --- Socialise ---------------------------------------------------------
  const lonely = 1 - clamp01(n.social / 100);
  if (!workHours && hour > npc.wakeHour && hour < npc.sleepHour) {
    const target = world.findSocialSpot(npc);
    candidates.push({
      score: 0.3 + lonely * 0.7,
      apply: () => {
        npc.setTask('socialise', { x: target.x, z: target.z, targetId: target.id, interruptible: true });
      },
    });
  }

  // --- Idle --------------------------------------------------------------
  candidates.push({
    score: 0.2,
    apply: () => {
      const a = npc.rng.range(0, Math.PI * 2);
      const r = npc.rng.range(3, 14);
      npc.setTask('wander', {
        x: clamp(npc.x + Math.cos(a) * r, 4, world.terrain.worldSize - 4),
        z: clamp(npc.z + Math.sin(a) * r, 4, world.terrain.worldSize - 4),
        interruptible: true,
      });
    },
  });

  let best = candidates[0];
  for (const c of candidates) if (c.score > best.score) best = c;
  best.apply();
}

/**
 * Lets a settler abandon filler work when something real turns up. This is the
 * difference between a workforce that responds to a new building site and one
 * that finishes picking every berry in the valley first.
 */
function maybeReconsider(world: World, npc: Npc): void {
  if (npc.task.type === 'none' || !npc.task.interruptible) return;
  if (--npc.reconsiderIn > 0) return;
  npc.reconsiderIn = RECONSIDER_TICKS;
  if (world.jobs.openCount === 0) return;
  abandonTask(world, npc);
}

/**
 * Whether they are holding settlement goods, as opposed to their own lunch
 * and the tool they work with.
 */
function carriesGoods(npc: Npc): boolean {
  for (const slot of npc.inventory.slots) {
    if (!slot) continue;
    if (isFood(slot.item)) continue;
    if (ITEMS[slot.item].category === 'tool') continue;
    return true;
  }
  return false;
}

function findCarriedFood(npc: Npc): ItemId | null {
  for (const f of FOOD_PRIORITY) if (npc.inventory.has(f)) return f;
  return null;
}

/**
 * Resolves the abstract intent "work" into a concrete task. Builders and
 * haulers look at the shared job board first; everyone else does the job their
 * workplace exists to do, and falls back to the board when it has nothing.
 */
function assignWork(world: World, npc: Npc): void {
  // A child is not a small adult with a smaller axe. They eat, they sleep,
  // they get under people's feet, and one day they are old enough to work.
  if (isChild(npc)) {
    const c = world.settlement.centre;
    npc.setTask('wander', {
      x: c.x + npc.rng.range(-16, 16),
      z: c.z + npc.rng.range(-16, 16),
      interruptible: true,
    });
    return;
  }

  // Anything still in their arms goes down first.
  //
  // Somebody who broke off a delivery for supper, or because night fell, is
  // standing there holding three logs. If they simply start something else
  // those logs are out of the world: the site that needed them waits for
  // ever, the job is reissued, and the next carrier does the same thing. A
  // person puts down what they are carrying before they pick up new work.
  if (carriesGoods(npc)) {
    npc.setTask('deliver_carried');
    return;
  }

  const boardFirst =
    npc.profession === 'builder' || npc.profession === 'hauler' || npc.profession === 'settler';

  if (boardFirst && tryClaimJob(world, npc)) return;
  if (tryWorkplaceTask(world, npc)) return;
  if (!boardFirst && tryClaimJob(world, npc)) return;
  if (tryOpportunisticGather(world, npc)) return;

  // Nothing to do: drift toward the settlement centre rather than standing still.
  const c = world.settlement.centre;
  npc.setTask('wander', {
    x: c.x + npc.rng.range(-12, 12),
    z: c.z + npc.rng.range(-12, 12),
    interruptible: true,
  });
}

function tryClaimJob(world: World, npc: Npc): boolean {
  const canDo = (job: Job): boolean => {
    if (job.kind !== 'haul') {
      // Anyone can lend a hand with building, repair or demolition; profession
      // affinity sorts out who actually should in the scoring below.
      return true;
    }
    return npc.inventory.spaceFor(job.item) > 0;
  };
  const affinity = (job: Job): number => {
    if (job.kind === 'build' || job.kind === 'repair' || job.kind === 'demolish') {
      return npc.profession === 'builder' ? 1.4 : npc.profession === 'settler' ? 0.6 : 0.15;
    }
    return npc.profession === 'hauler' ? 1.4 : npc.profession === 'settler' ? 0.55 : 0.2;
  };

  const job = world.jobs.claim(npc.id, npc.x, npc.z, canDo, affinity);
  if (!job) return false;

  if (job.kind === 'build') {
    npc.setTask('build', { jobId: job.id, targetId: job.buildingId, x: job.x, z: job.z });
  } else if (job.kind === 'repair') {
    npc.setTask('repair', { jobId: job.id, targetId: job.buildingId, x: job.x, z: job.z });
  } else if (job.kind === 'demolish') {
    npc.setTask('demolish', { jobId: job.id, targetId: job.buildingId, x: job.x, z: job.z });
  } else {
    npc.setTask('haul', { jobId: job.id, targetId: job.sourceId, phase: 0, x: job.x, z: job.z });
  }
  return true;
}

function tryWorkplaceTask(world: World, npc: Npc): boolean {
  if (!npc.workplaceId) return false;
  const wp = world.buildingById.get(npc.workplaceId);
  if (!wp || !wp.complete || wp.paused) return false;
  const ts = world.terrain.tileSize;

  // Gathering buildings that send people out into the world.
  if (wp.def.gathers === 'wood') {
    const node = world.findNode(wp.worldX, wp.worldZ, 46, (nd) => {
      if (RESOURCES[nd.kind].category !== 'tree') return false;
      return nd.reservedBy === 0 || nd.reservedBy === npc.id;
    });
    if (node) {
      node.reservedBy = npc.id;
      npc.setTask('gather', { targetId: node.id, x: node.x, z: node.z });
      return true;
    }
  }

  if (wp.def.gathers === 'game') {
    const animal = world.findHuntTarget(wp.worldX, wp.worldZ, 70, npc.id);
    if (animal) {
      npc.setTask('gather', { targetId: -animal.id, x: animal.x, z: animal.z, index: -1 });
      return true;
    }
  }

  // Farms: pick whichever plot needs attention most.
  if (wp.def.farmPlots && wp.fields.length > 0) {
    const plot = world.findFarmWork(wp, npc);
    if (plot >= 0) {
      const f = wp.fields[plot];
      f.reservedBy = npc.id;
      npc.setTask('farm', {
        targetId: wp.id,
        index: plot,
        x: (f.tx + 0.5) * ts,
        z: (f.tz + 0.5) * ts,
      });
      return true;
    }
  }

  // Study.
  if (wp.def.profession === 'researcher' && world.research.active) {
    const p = wp.accessPoint(ts);
    npc.setTask('research', { targetId: wp.id, x: p.x, z: p.z });
    return true;
  }

  // Workshops and extraction sites worked at the building itself.
  if (wp.def.recipes?.length || wp.def.gathers === 'stone' || wp.def.gathers === 'ore' ||
      wp.def.gathers === 'clay' || wp.def.gathers === 'fish') {
    const p = wp.accessPoint(ts);
    npc.setTask('produce', { targetId: wp.id, x: p.x, z: p.z });
    return true;
  }

  return false;
}

/**
 * Idle hands find something useful. What that is depends on the person and on
 * what the settlement is short of — a logger with nothing else to do fells
 * timber rather than standing about, and anyone will cut wood when the stores
 * are empty, because otherwise a settlement with no lumber camp can never build
 * the lumber camp.
 */
function tryOpportunisticGather(world: World, npc: Npc): boolean {
  const isWoodcutter = npc.profession === 'logger' || npc.profession === 'forester';
  const shortOfWood = world.economy.statOf('log').stored + world.economy.statOf('plank').stored < 24;
  const wantsTimber = isWoodcutter || (shortOfWood && npc.profession !== 'farmer');
  const isMiner = npc.profession === 'miner';

  const pick = (category: 'tree' | 'plant' | 'mineral', radius: number) =>
    world.findNode(npc.x, npc.z, radius, (nd) => {
      if (RESOURCES[nd.kind].category !== category) return false;
      return nd.reservedBy === 0 || nd.reservedBy === npc.id;
    });

  let node = null;
  if (wantsTimber) node = pick('tree', 130);
  if (!node && isMiner) node = pick('mineral', 130);
  if (!node) node = pick('plant', 70);
  if (!node && !wantsTimber) node = pick('tree', 130);
  if (!node) node = pick('mineral', 110);
  if (!node) return false;

  node.reservedBy = npc.id;
  // Opportunistic gathering is filler: drop it the moment real work appears.
  npc.setTask('gather', { targetId: node.id, x: node.x, z: node.z, interruptible: true });
  return true;
}

// -------------------------------------------------------------------------
// Executing the current task
// -------------------------------------------------------------------------

function executeTask(world: World, npc: Npc, dt: number): void {
  const task = npc.task;
  if (task.type === 'none') return;

  task.attempts++;
  if (task.attempts > MAX_TASK_ATTEMPTS) {
    abandonTask(world, npc);
    return;
  }

  switch (task.type) {
    case 'haul':
      executeHaul(world, npc, dt);
      break;
    case 'repair':
      executeRepair(world, npc, dt);
      break;
    case 'build':
      executeBuild(world, npc, dt);
      break;
    case 'demolish':
      executeDemolish(world, npc, dt);
      break;
    case 'gather':
      executeGather(world, npc, dt);
      break;
    case 'produce':
      executeProduce(world, npc, dt);
      break;
    case 'farm':
      executeFarm(world, npc, dt);
      break;
    case 'research':
      executeResearch(world, npc, dt);
      break;
    case 'eat':
      executeEat(world, npc, dt);
      break;
    case 'sleep':
      executeSleep(world, npc, dt);
      break;
    case 'socialise':
      executeSocialise(world, npc, dt);
      break;
    case 'wander':
      if (arriveAt(world, npc, task.x, task.z)) npc.clearTask();
      else npc.activity = 'walking';
      break;
    case 'flee':
      // Running from a fire or a quake overrides everything until they are
      // clear of it, which is why this task is not interruptible.
      npc.activity = 'walking';
      npc.speed = Math.max(npc.speed, NPC_WALK_SPEED * 1.9);
      if (arriveAt(world, npc, task.x, task.z, 2.5) || task.attempts > 400) npc.clearTask();
      break;
    case 'deliver_carried':
      executeDeliverCarried(world, npc);
      break;
    default:
      npc.clearTask();
  }
}

function abandonTask(world: World, npc: Npc): void {
  const task = npc.task;
  if (task.jobId) {
    // Release any ground pile this job had claimed, or it is stranded.
    const job = world.jobs.byId(task.jobId);
    if (job && job.kind === 'haul' && job.sourceType === 'pile') {
      const pile = world.pileById.get(job.sourceId);
      if (pile && pile.reservedBy === npc.id) pile.reservedBy = 0;
    }
    world.jobs.release(task.jobId);
  }
  if (task.type === 'gather' && task.targetId > 0) {
    const node = world.nodeById.get(task.targetId);
    if (node && node.reservedBy === npc.id) node.reservedBy = 0;
  }
  if (task.type === 'gather' && task.targetId < 0) {
    const animal = world.wildlifeById.get(-task.targetId);
    if (animal && animal.huntedBy === npc.id) animal.huntedBy = 0;
  }
  if (npc.task.type === 'farm') {
    const wp = world.buildingById.get(npc.task.targetId);
    const f = wp?.fields[npc.task.index];
    if (f && f.reservedBy === npc.id) f.reservedBy = 0;
  }
  npc.clearTask();
  npc.activity = 'idle';
}

// ------------------------------------------------------------------ hauling

function executeHaul(world: World, npc: Npc, dt: number): void {
  void dt;
  const job = world.jobs.byId(npc.task.jobId) as HaulJob | undefined;
  if (!job || job.kind !== 'haul') {
    // Job vanished. If we are holding its goods, still deliver them somewhere.
    if (npc.isCarrying()) npc.setTask('deliver_carried');
    else abandonTask(world, npc);
    return;
  }

  const ts = world.terrain.tileSize;

  if (npc.task.phase === 0) {
    // Leg 1: go to the source and pick up.
    if (job.sourceType === 'pile') {
      const pile = world.pileById.get(job.sourceId);
      if (!pile) {
        world.jobs.remove(job.id);
        npc.clearTask();
        return;
      }
      pile.reservedBy = npc.id;
      npc.activity = 'walking';
      if (!arriveAt(world, npc, pile.x, pile.z)) return;

      const take = Math.min(pile.count, npc.inventory.spaceFor(pile.item));
      if (take <= 0) {
        world.jobs.release(job.id);
        pile.reservedBy = 0;
        npc.setTask('deliver_carried');
        return;
      }
      npc.inventory.add(pile.item, take);
      pile.count -= take;
      if (pile.count <= 0) world.removePile(pile);
      npc.task.phase = 1;
      npc.clearPath();
    } else {
      const src = world.buildingById.get(job.sourceId);
      if (!src) {
        world.jobs.remove(job.id);
        npc.clearTask();
        return;
      }
      const p = src.accessPoint(ts);
      npc.activity = 'walking';
      if (!arriveAt(world, npc, p.x, p.z)) return;

      const want = Math.min(job.amount, npc.inventory.spaceFor(job.item));
      const took = src.inventory.remove(job.item, want);
      if (took <= 0) {
        world.jobs.remove(job.id);
        npc.clearTask();
        return;
      }
      npc.inventory.add(job.item, took);
      job.amount = took;
      npc.task.phase = 1;
      npc.clearPath();
    }
    return;
  }

  // Leg 2: deliver.
  const dest = world.buildingById.get(job.destId);
  if (!dest) {
    world.jobs.remove(job.id);
    npc.setTask('deliver_carried');
    return;
  }
  const dp = dest.accessPoint(ts);
  npc.activity = 'hauling';
  if (!arriveAt(world, npc, dp.x, dp.z)) return;

  // Materials for construction, and for a repair, go to the site store; a
  // finished building's own inventory is its stock, not its scaffolding.
  const store = job.toSite && (!dest.complete || dest.repairNeeded) ? dest.siteStore : dest.inventory;
  const moved = npc.inventory.transferTo(store, job.item, npc.inventory.count(job.item));
  npc.addXp('hauling', moved * 1.4);

  if (moved === 0) {
    // Destination filled up while we walked. Take it somewhere else.
    world.jobs.remove(job.id);
    npc.setTask('deliver_carried');
    return;
  }

  world.jobs.remove(job.id);
  world.onGoodsDelivered(dest, job.item, moved);
  if (npc.isCarrying()) npc.setTask('deliver_carried');
  else npc.clearTask();
}

/** Fallback when a carrier ends up holding goods with nowhere to put them. */
function executeDeliverCarried(world: World, npc: Npc): void {
  const summary = npc.inventory.summary();
  if (summary.length === 0) {
    npc.clearTask();
    return;
  }
  const item = summary[0].item;
  const dest = world.findDestinationFor(item, npc.x, npc.z);
  if (!dest) {
    // Nowhere to store it: drop it on the ground rather than carrying forever.
    world.dropPile(item, npc.inventory.count(item), npc.x, npc.z);
    npc.inventory.remove(item, npc.inventory.count(item));
    npc.clearTask();
    return;
  }
  const p = dest.accessPoint(world.terrain.tileSize);
  npc.activity = 'hauling';
  if (!arriveAt(world, npc, p.x, p.z)) return;
  const moved = npc.inventory.transferTo(dest.inventory, item, npc.inventory.count(item));
  if (moved === 0) {
    world.dropPile(item, npc.inventory.count(item), npc.x, npc.z);
    npc.inventory.remove(item, npc.inventory.count(item));
  }
  npc.clearTask();
}

// ----------------------------------------------------------------- building

function executeBuild(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || b.complete || b.demolishing) {
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.clearTask();
    return;
  }

  const p = b.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z, 2.0)) return;

  if (!b.consumeStageMaterials()) {
    // Materials ran out. Release the job and find something else.
    if (npc.task.jobId) world.jobs.release(npc.task.jobId);
    npc.clearTask();
    return;
  }

  npc.activity = 'building';
  npc.workAnim = true;
  faceToward(npc, b.worldX, b.worldZ);

  const tool = npc.tool === 'hammer' ? 1.35 : 1;
  const weather = world.weather.workPenalty;
  const amount = BUILD_RATE * npc.workRate('construction', tool) * weather * dt;
  const result = b.applyWork(amount, npc.name);
  npc.addXp('construction', amount * 0.5);

  if (result === 'complete') {
    world.onBuildingCompleted(b, npc);
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.remember(world.time.totalDays, `Finished building the ${b.def.name.toLowerCase()}.`);
    npc.clearTask();
  } else if (result === 'stage') {
    world.onStageCompleted(b);
    if (npc.task.jobId) world.jobs.release(npc.task.jobId);
    npc.clearTask();
  }
}

/**
 * Putting a damaged building back together.
 *
 * Deliberately the same shape as new construction: walk there, spend the
 * materials that were hauled in, then swing a hammer for as long as the
 * damage warrants. A building is never restored by the passage of time.
 */
function executeRepair(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || !b.repairNeeded || b.demolishing) {
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.clearTask();
    return;
  }

  const p = b.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z, 2.0)) return;

  if (!b.consumeRepairMaterials()) {
    // The materials were taken for something else. Let someone re-haul them.
    if (npc.task.jobId) world.jobs.release(npc.task.jobId);
    npc.clearTask();
    return;
  }

  npc.activity = 'building';
  npc.workAnim = true;
  faceToward(npc, b.worldX, b.worldZ);

  const tool = npc.tool === 'hammer' ? 1.35 : 1;
  const amount = BUILD_RATE * npc.workRate('construction', tool) * world.weather.workPenalty * dt;
  npc.addXp('construction', amount * 0.5);

  if (world.applyRepair(b, amount)) {
    world.onBuildingRepaired(b, npc);
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.remember(world.time.totalDays, 'memory.repaired');
    npc.clearTask();
  }
}

function executeDemolish(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || !b.demolishing) {
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.clearTask();
    return;
  }
  const p = b.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z, 2.0)) return;

  npc.activity = 'demolishing';
  npc.workAnim = true;
  b.demolishWork += BUILD_RATE * npc.workRate('construction') * dt;
  if (b.demolishWork >= b.def.totalWork * 0.35) {
    world.completeDemolition(b);
    if (npc.task.jobId) world.jobs.remove(npc.task.jobId);
    npc.clearTask();
  }
}

// --------------------------------------------------------------- gathering

function executeGather(world: World, npc: Npc, dt: number): void {
  // Negative target ids mean wildlife.
  if (npc.task.targetId < 0) {
    executeHunt(world, npc, dt);
    return;
  }

  const node = world.nodeById.get(npc.task.targetId);
  if (!node || node.depleted) {
    if (node && node.reservedBy === npc.id) node.reservedBy = 0;
    npc.clearTask();
    return;
  }

  npc.activity = 'walking';
  if (!arriveAt(world, npc, node.x, node.z, 1.5)) return;

  const def = RESOURCES[node.kind];
  faceToward(npc, node.x, node.z);
  npc.workAnim = true;
  npc.activity =
    def.skill === 'chop' ? 'chopping' : def.skill === 'mine' ? 'mining' : 'foraging';

  const skill: SkillId = def.skill === 'chop' ? 'woodcutting' : def.skill === 'mine' ? 'mining' : 'farming';
  const toolBonus =
    (def.skill === 'chop' && npc.tool === 'axe') || (def.skill === 'mine' && npc.tool === 'pickaxe')
      ? 1.45
      : 1;
  const amount = GATHER_RATE * npc.workRate(skill, toolBonus) * world.weather.workPenalty * dt;
  const result = world.harvestNode(node, amount);
  npc.addXp(skill, amount * 0.45);

  for (const y of result.items) {
    // Harvest lands on the ground where the work happened. Haulers move it.
    world.dropPile(y.item, y.amount, node.x, node.z);
  }

  if (result.nodeDepleted) {
    if (node.reservedBy === npc.id) node.reservedBy = 0;
    if (def.category === 'tree') {
      world.log.add(world.time, 'production', 'ev.felled', { who: npc.name, what: node.kind });
    }
    npc.clearTask();
  }
}

function executeHunt(world: World, npc: Npc, dt: number): void {
  const animal = world.wildlifeById.get(-npc.task.targetId);
  if (!animal || animal.dead) {
    npc.clearTask();
    return;
  }
  npc.task.x = animal.x;
  npc.task.z = animal.z;
  npc.activity = 'hunting';
  if (!arriveAt(world, npc, animal.x, animal.z, 2.2)) return;

  npc.workAnim = true;
  npc.task.work += GATHER_RATE * npc.workRate('hunting') * dt;
  if (npc.task.work > 22) {
    world.killAnimal(animal, npc);
    npc.addXp('hunting', 14);
    npc.clearTask();
  }
}

// -------------------------------------------------------------- production

function executeProduce(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || !b.complete || b.paused) {
    npc.clearTask();
    return;
  }

  const p = b.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z, 1.6)) return;

  faceToward(npc, b.worldX, b.worldZ);

  // Extraction sites: the building itself is the resource.
  if (b.def.gathers === 'stone' || b.def.gathers === 'ore' || b.def.gathers === 'clay' || b.def.gathers === 'fish') {
    npc.activity =
      b.def.gathers === 'fish' ? 'fishing' : b.def.gathers === 'clay' ? 'mining' : 'mining';
    npc.workAnim = true;
    const skill: SkillId = b.def.gathers === 'fish' ? 'hunting' : 'mining';
    const toolBonus = npc.tool === 'pickaxe' && b.def.gathers !== 'fish' ? 1.4 : 1;
    const amount = GATHER_RATE * npc.workRate(skill, toolBonus) * world.weather.workPenalty * dt;
    npc.task.work += amount;
    npc.addXp(skill, amount * 0.4);
    const needed = world.extractionCost(b);
    if (npc.task.work >= needed) {
      npc.task.work -= needed;
      world.produceExtraction(b, npc);
    }
    // Stop when the building is full so the shortage is visible.
    if (b.inventory.fullness > 0.98) npc.clearTask();
    return;
  }

  // Workshops.
  const recipe = world.chooseRecipe(b);
  if (!recipe) {
    npc.clearTask();
    return;
  }
  if (b.activeRecipe !== recipe.id) {
    b.activeRecipe = recipe.id;
    b.productionProgress = 0;
  }

  npc.activity = 'crafting';
  npc.workAnim = true;
  const skill = craftSkillFor(recipe);
  const toolBonus = recipe.skill === 'woodworking' && npc.tool === 'saw' ? 1.4 : 1;
  const amount = CRAFT_RATE * npc.workRate(skill, toolBonus) * dt;
  b.productionProgress += amount;
  npc.addXp(skill, amount * 0.4);

  if (b.productionProgress >= recipe.work) {
    b.productionProgress = 0;
    world.completeRecipe(b, recipe, npc);
  }
}

function craftSkillFor(recipe: Recipe): SkillId {
  switch (recipe.skill) {
    case 'woodworking':
      return 'woodworking';
    case 'smithing':
      return 'smithing';
    case 'cooking':
      return 'cooking';
    case 'masonry':
      return 'crafting';
    default:
      return 'crafting';
  }
}

// ----------------------------------------------------------------- farming

function executeFarm(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || npc.task.index < 0 || !b.fields[npc.task.index]) {
    npc.clearTask();
    return;
  }
  const plot = b.fields[npc.task.index];
  npc.activity = 'walking';
  if (!arriveAt(world, npc, npc.task.x, npc.task.z, 1.1)) return;

  npc.workAnim = true;
  npc.activity = plot.planted && plot.growth >= 1 ? 'farming' : 'planting';
  const toolBonus = npc.tool === 'hoe' ? 1.4 : 1;
  const amount = FARM_RATE * npc.workRate('farming', toolBonus) * world.weather.workPenalty * dt;
  npc.task.work += amount;
  npc.addXp('farming', amount * 0.4);

  if (npc.task.work >= 14) {
    world.applyFarmWork(b, plot, npc);
    plot.reservedBy = 0;
    npc.clearTask();
  }
}

// ---------------------------------------------------------------- research

function executeResearch(world: World, npc: Npc, dt: number): void {
  const b = world.buildingById.get(npc.task.targetId);
  if (!b || !b.complete || !world.research.active) {
    npc.clearTask();
    return;
  }
  const p = b.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z, 1.4)) return;

  npc.activity = 'researching';
  npc.workAnim = true;
  const amount = RESEARCH_RATE * npc.workRate('research') * dt;
  world.research.contribute(amount);
  npc.addXp('research', amount * 2.5);

  npc.task.work += dt;
  if (npc.task.work > 40) npc.clearTask();
}

// ----------------------------------------------------------- personal needs

function executeEat(world: World, npc: Npc, dt: number): void {
  const carried = findCarriedFood(npc);
  if (carried) {
    npc.activity = 'eating';
    npc.task.work += dt;
    if (npc.task.work > 1.4) {
      npc.inventory.remove(carried, 1);
      npc.needs.hunger = clamp(npc.needs.hunger + nutritionOf(carried), 0, 100);
      npc.needs.mood += 2;
      npc.clearTask();
    }
    return;
  }

  const store = world.buildingById.get(npc.task.targetId);
  if (!store) {
    npc.clearTask();
    return;
  }
  const p = store.accessPoint(world.terrain.tileSize);
  npc.activity = 'walking';
  if (!arriveAt(world, npc, p.x, p.z)) return;

  const food = store.inventory.findFirst((i) => FOOD_PRIORITY.includes(i));
  if (!food) {
    npc.clearTask();
    return;
  }
  // Take a couple of meals so they are not back here in ten minutes.
  const take = Math.min(2, store.inventory.count(food), npc.inventory.spaceFor(food));
  store.inventory.remove(food, take);
  npc.inventory.add(food, take);
  npc.task.work = 0;
}

function executeSleep(world: World, npc: Npc, dt: number): void {
  void dt;
  const snap = world.time.snapshot();
  const hour = snap.hour + snap.minute / 60;

  if (npc.task.targetId) {
    const home = world.buildingById.get(npc.task.targetId);
    if (home) {
      const c = home.centre(world.terrain.tileSize);
      npc.activity = 'walking';
      if (!arriveAt(world, npc, c.x, c.z, 1.6)) return;
    }
  } else if (!arriveAt(world, npc, npc.task.x, npc.task.z)) {
    npc.activity = 'walking';
    return;
  }

  npc.activity = 'sleeping';
  npc.workAnim = false;

  const shouldWake = hour >= npc.wakeHour && hour < npc.sleepHour && npc.needs.rest > 82;
  if (shouldWake) {
    npc.hoursWorkedToday = 0;
    npc.clearTask();
  }
}

function executeSocialise(world: World, npc: Npc, dt: number): void {
  npc.activity = 'walking';
  if (!arriveAt(world, npc, npc.task.x, npc.task.z, 1.6)) return;

  npc.activity = 'socialising';
  npc.task.work += dt;
  npc.needs.social = clamp(npc.needs.social + world.time.hoursFor(dt) * 26, 0, 100);

  const other = world.nearestNpc(npc, 4);
  if (other) {
    npc.adjustRelationship(other.id, 0.4);
    other.adjustRelationship(npc.id, 0.4);
    faceToward(npc, other.x, other.z);
  }

  if (npc.task.work > 24 || npc.needs.social > 92) npc.clearTask();
}

// -------------------------------------------------------------------------
// Movement
// -------------------------------------------------------------------------

/**
 * Walks toward a point, pathing around obstacles. Returns true on arrival.
 */
function arriveAt(world: World, npc: Npc, x: number, z: number, radius = ARRIVE_DISTANCE): boolean {
  const dx = x - npc.x;
  const dz = z - npc.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= radius) {
    npc.clearPath();
    npc.speed = 0;
    return true;
  }

  const targetMoved = Math.hypot(x - npc.pathTargetX, z - npc.pathTargetZ) > 2.5;
  if (!npc.path || targetMoved) {
    if (npc.repathCooldown > 0) {
      // While waiting for a path slot, edge directly toward the target.
      stepDirect(world, npc, dx, dz, dist);
      return false;
    }
    const path = world.nav.findPath(npc.x, npc.z, x, z);
    npc.repathCooldown = path ? 26 : 9;
    if (path) {
      npc.path = path;
      npc.pathIndex = 0;
      npc.pathTargetX = x;
      npc.pathTargetZ = z;
    } else {
      stepDirect(world, npc, dx, dz, dist);
      return false;
    }
  }
  return false;
}

function stepDirect(world: World, npc: Npc, dx: number, dz: number, dist: number): void {
  if (dist < 0.001) return;
  npc.speed = NPC_WALK_SPEED * 0.55;
  npc.yaw = Math.atan2(dx, dz);
  void world;
}

function moveAlongPath(world: World, npc: Npc, dt: number): void {
  if (npc.repathCooldown > 0) npc.repathCooldown--;

  if (!npc.path || npc.pathIndex >= npc.path.length) {
    if (npc.speed > 0 && npc.activity === 'walking') {
      // Direct-stepping fallback: creep toward the task destination.
      const dx = npc.task.x - npc.x;
      const dz = npc.task.z - npc.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, npc.speed * dt);
        moveBy(world, npc, (dx / d) * step, (dz / d) * step);
      }
    } else {
      npc.speed = damp(npc.speed, 0, 12, dt);
    }
    return;
  }

  const target = npc.path[npc.pathIndex];
  const dx = target.x - npc.x;
  const dz = target.z - npc.z;
  const dist = Math.hypot(dx, dz);

  if (dist < 0.5) {
    npc.pathIndex++;
    if (npc.pathIndex >= npc.path.length) npc.clearPath();
    return;
  }

  const tile = world.terrain;
  const onRoad = tile.hasOverlay(tile.tileX(npc.x), tile.tileZ(npc.z), OVERLAY.Road | OVERLAY.Path);
  const carrying = npc.inventory.totalWeight();
  const loadPenalty = 1 - clamp01(carrying / 90) * 0.32;
  const targetSpeed = NPC_WALK_SPEED * (onRoad ? 1.42 : 1) * loadPenalty * world.weather.moveMultiplier;
  npc.speed = damp(npc.speed, targetSpeed, 8, dt);

  const step = Math.min(dist, npc.speed * dt);
  const nx = (dx / dist) * step;
  const nz = (dz / dist) * step;
  const before = { x: npc.x, z: npc.z };
  moveBy(world, npc, nx, nz);
  npc.yaw = Math.atan2(dx, dz);

  // Stuck detection: if we barely moved while trying to, force a repath.
  const moved = Math.hypot(npc.x - before.x, npc.z - before.z);
  if (moved < step * 0.25) {
    npc.stuckTimer += dt;
    if (npc.stuckTimer > 1.4) {
      npc.stuckTimer = 0;
      npc.clearPath();
      npc.repathCooldown = 0;
    }
  } else {
    npc.stuckTimer = 0;
  }

  tile.addTraffic(npc.x, npc.z, dt * 2.2);
}

function moveBy(world: World, npc: Npc, dx: number, dz: number): void {
  const t = world.terrain;
  const nx = npc.x + dx;
  const nz = npc.z + dz;

  // The legs obey exactly the rule the pathfinder plans with.
  //
  // They used not to: the map called a tile passable if it had less than
  // three-quarters of a metre of water on it, and the body refused to step
  // anywhere the bilinear depth came out over nine-tenths. Along a gently
  // shelving coast those two disagree over a wide band, and a settler routed
  // across it walks into the shallows, stops, repaths, and stands there for
  // the rest of their life -- while the site they were carrying three logs to
  // waits for them. One rule, asked the same way, or this comes back.
  const here = t.isWalkableTile(t.tileX(npc.x), t.tileZ(npc.z));
  if (here && !t.isWalkableTile(t.tileX(nx), t.tileZ(nz))) return;

  npc.x = clamp(nx, 2, t.worldSize - 2);
  npc.z = clamp(nz, 2, t.worldSize - 2);
}

function faceToward(npc: Npc, x: number, z: number): void {
  npc.yaw = Math.atan2(x - npc.x, z - npc.z);
}

/** Maps activity to the animation state the rig should play. */
export function animationFor(npc: Npc): NpcActivity {
  return npc.activity;
}

export const PROFESSION_TABLE = PROFESSIONS;
export const ITEM_TABLE = ITEMS;
export const RECIPE_TABLE = RECIPES;
export type { Building };
