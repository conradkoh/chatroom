import type { EnhancerTargetId } from './enhancer';
import type { AgentHarness } from '../../../types/machine';

export interface EnhancerConfigEntry {
  targetId: EnhancerTargetId;
  agentHarness: AgentHarness;
  model: string;
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
