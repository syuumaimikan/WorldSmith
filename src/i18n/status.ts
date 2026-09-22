/**
 * Localized status lines for world entities.
 *
 * `Building.statusText()` exists for logs and debugging and stays in English;
 * anything shown to the player goes through here instead.
 */

import { t } from './index';
import { stageName } from './names';
import type { Building } from '../sim/Building';

export function buildingStatus(b: Building): string {
  if (b.demolishing) return t('status.demolishing');
  if (b.complete) {
    if (b.paused) return t('status.paused');
    if (b.def.workSlots > 0 && b.workerIds.length === 0) return t('status.noWorkers');
    return t('status.operating');
  }
  const stage = b.currentStage;
  if (!stage) return t('status.complete');
  const name = stageName(stage.id, stage.name);
  if (!b.readyForWork()) return t('status.awaitingMaterials', { stage: name });
  return name;
}
