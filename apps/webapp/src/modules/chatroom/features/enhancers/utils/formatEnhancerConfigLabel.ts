import { getHarnessDisplayName, getModelDisplayLabel } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

export function formatEnhancerConfigLabel(entry: EnhancerConfigEntry): string {
  const target = ENHANCER_TARGETS.find((t) => t.id === entry.targetId);
  const targetLabel = target?.label ?? entry.targetId;
  return `${targetLabel} / ${getHarnessDisplayName(entry.agentHarness)} / ${getModelDisplayLabel(entry.model)}`;
}
