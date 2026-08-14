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
  readonly machineId: string;
}

export type ActiveEnhancerConfig = EnhancerConfig & { enabled: true };

export function isEnhancerConfigActive(
  config: EnhancerConfig | null
): config is ActiveEnhancerConfig {
  return Boolean(
    config?.enabled === true &&
      config.agentHarness &&
      config.model.trim() &&
      config.machineId.trim()
  );
}

export function hasEnhancerConfigFields(
  config: EnhancerConfig | null
): config is EnhancerConfig {
  return Boolean(config?.agentHarness && config.model.trim() && config.machineId.trim());
}

export function toActiveEnhancerConfig(
  config: EnhancerConfig | null
): ActiveEnhancerConfig | null {
  return isEnhancerConfigActive(config) ? config : null;
}
