import type { AgentHarness } from '../../../types/machine';

export type EnhancerTargetId = 'handoff:planner-to-builder';

export interface EnhancerTarget {
  readonly id: EnhancerTargetId;
  readonly label: string;
  readonly description: string;
}

export interface EnhancerConfig {
  readonly enabled: boolean;
  readonly targetId: EnhancerTargetId;
  readonly agentHarness: AgentHarness;
  readonly model: string;
}

export function isEnhancerConfigActive(config: EnhancerConfig | null): boolean {
  return config?.enabled === true && !!config.agentHarness && !!config.model;
}
