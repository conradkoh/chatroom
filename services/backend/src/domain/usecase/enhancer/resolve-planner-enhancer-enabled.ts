import {
  type EnhancerTeamLike,
  isEnhancerEntryPointRole,
} from '@workspace/shared/domain/enhancer-team-capability';

import type { EnhancerAgentLaunchConfig } from './get-enhancer-team-agent-config';

/** Delivery prompt only — uses handoff validation for unified behavior. */
export function resolveTaskPlannerEnhancerEnabled(args: {
  taskPlannerEnhancerEnabled?: boolean | undefined;
  liveConfig: EnhancerAgentLaunchConfig | null | undefined;
  role: string;
  team: EnhancerTeamLike;
}): boolean {
  if (!isEnhancerEntryPointRole(args.team, args.role)) {
    return false;
  }
  return validatePlannerEnhancerHandoff({
    taskPlannerEnhancerEnabled: args.taskPlannerEnhancerEnabled,
    config: args.liveConfig,
  }).allowed;
}

export function resolvePlannerEnhancerEnabledFromConfig(
  config: EnhancerAgentLaunchConfig | null | undefined
): boolean {
  return config?.enabled === true && hasUsableEnhancerConfig(config);
}

export type PlannerEnhancerHandoffValidation =
  | { allowed: true; config: EnhancerAgentLaunchConfig }
  | { allowed: false; code: 'ENHANCER_NOT_ENABLED' | 'ENHANCER_CONFIG_INCOMPLETE' };

function hasUsableEnhancerConfig(
  config: EnhancerAgentLaunchConfig | null | undefined
): config is EnhancerAgentLaunchConfig {
  return (
    !!config?.agentHarness && config?.model.trim().length > 0 && config?.machineId.trim().length > 0
  );
}

/** Handoff guard — three-case logic per task snapshot. */
export function validatePlannerEnhancerHandoff(args: {
  taskPlannerEnhancerEnabled: boolean | undefined;
  config: EnhancerAgentLaunchConfig | null | undefined;
}): PlannerEnhancerHandoffValidation {
  if (args.taskPlannerEnhancerEnabled === false) {
    return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  }
  if (args.taskPlannerEnhancerEnabled === true) {
    if (!hasUsableEnhancerConfig(args.config)) {
      return { allowed: false, code: 'ENHANCER_CONFIG_INCOMPLETE' };
    }
    return { allowed: true, config: args.config };
  }
  if (!args.config?.enabled) {
    return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  }
  if (!hasUsableEnhancerConfig(args.config)) {
    return { allowed: false, code: 'ENHANCER_CONFIG_INCOMPLETE' };
  }
  return { allowed: true, config: args.config };
}
