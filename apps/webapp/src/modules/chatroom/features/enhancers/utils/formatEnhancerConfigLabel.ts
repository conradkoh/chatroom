import { getHarnessDisplayName, getModelDisplayLabel } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

/** Harness + model only — for favorites shown in target context. */
export function formatEnhancerHarnessModelLabel(
  entry: Pick<EnhancerConfigEntry, 'agentHarness' | 'model'>
): string {
  return `${getHarnessDisplayName(entry.agentHarness)} / ${getModelDisplayLabel(entry.model)}`;
}

/** Max characters shown in favorite row labels (full label remains in title). */
const ENHANCER_HARNESS_MODEL_LABEL_MAX_LENGTH = 40;

function truncateEnhancerFavoriteLabel(
  label: string,
  maxLength = ENHANCER_HARNESS_MODEL_LABEL_MAX_LENGTH
): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength).trimEnd()}...`;
}

/** Truncated harness+model label for compact favorite row display. */
export function formatEnhancerHarnessModelLabelDisplay(
  entry: Pick<EnhancerConfigEntry, 'agentHarness' | 'model'>,
  maxLength = ENHANCER_HARNESS_MODEL_LABEL_MAX_LENGTH
): string {
  return truncateEnhancerFavoriteLabel(formatEnhancerHarnessModelLabel(entry), maxLength);
}

/** Full label including target — for tooltips or non-target-scoped display. */
// fallow-ignore-next-line unused-export
export function formatEnhancerConfigLabel(entry: EnhancerConfigEntry): string {
  const target = ENHANCER_TARGETS.find((t) => t.id === entry.targetId);
  const targetLabel = target?.label ?? entry.targetId;
  return `${targetLabel} / ${formatEnhancerHarnessModelLabel(entry)}`;
}
