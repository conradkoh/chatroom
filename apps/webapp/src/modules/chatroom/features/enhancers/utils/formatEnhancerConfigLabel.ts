import { getHarnessDisplayName, getModelDisplayLabel } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

/** Harness + model only — for favorites shown in target context. */
export function formatEnhancerHarnessModelLabel(
  entry: Pick<EnhancerConfigEntry, 'agentHarness' | 'model'>
): string {
  return `${getHarnessDisplayName(entry.agentHarness)} / ${getModelDisplayLabel(entry.model)}`;
}

/** Full label including target — for tooltips or non-target-scoped display. */
export function formatEnhancerConfigLabel(entry: EnhancerConfigEntry): string {
  const target = ENHANCER_TARGETS.find((t) => t.id === entry.targetId);
  const targetLabel = target?.label ?? entry.targetId;
  return `${targetLabel} / ${formatEnhancerHarnessModelLabel(entry)}`;
}
