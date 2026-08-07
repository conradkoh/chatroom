import type { EnhancerTargetId } from './enhancer';
import type { AgentHarness } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';

export interface EnhancerConfigEntry {
  targetId: EnhancerTargetId;
  agentHarness: AgentHarness;
  model: string;
}

const DEFAULT_ENHANCER_TARGET_ID = ENHANCER_TARGETS[0].id;

// fallow-ignore-next-line unused-export
export function normalizeEnhancerTargetId(
  targetId: EnhancerTargetId | undefined
): EnhancerTargetId {
  return targetId ?? DEFAULT_ENHANCER_TARGET_ID;
}

export function filterFavoritesForTarget(
  favorites: EnhancerConfigEntry[],
  targetId: EnhancerTargetId
): EnhancerConfigEntry[] {
  return favorites.filter((f) => normalizeEnhancerTargetId(f.targetId) === targetId);
}

export function isEnhancerConfigFavoriteForTarget(
  favorites: EnhancerConfigEntry[],
  entry: Pick<EnhancerConfigEntry, 'agentHarness' | 'model'>,
  targetId: EnhancerTargetId
): boolean {
  return favorites.some(
    (f) =>
      normalizeEnhancerTargetId(f.targetId) === targetId &&
      f.agentHarness === entry.agentHarness &&
      f.model === entry.model
  );
}

export function buildEnhancerConfigKey(entry: EnhancerConfigEntry): string {
  return `${entry.targetId}|${entry.agentHarness}|${entry.model}`;
}

export function enhancerConfigEntriesEqual(
  a: EnhancerConfigEntry,
  b: EnhancerConfigEntry
): boolean {
  return a.targetId === b.targetId && a.agentHarness === b.agentHarness && a.model === b.model;
}
