import type { Doc } from '../../../../convex/_generated/dataModel';

export function resolvePlannerEnhancerEnabledFromConfig(
  config: Doc<'chatroom_enhancerConfigs'> | null | undefined
): boolean {
  return config?.enabled === true && config.targetId === 'handoff:planner-to-builder';
}

/** Delivery prompt only — uses task snapshot when set, else live config. */
export function resolveTaskPlannerEnhancerEnabled(args: {
  taskPlannerEnhancerEnabled?: boolean;
  liveConfig: Doc<'chatroom_enhancerConfigs'> | null | undefined;
  role: string;
}): boolean {
  if (args.taskPlannerEnhancerEnabled !== undefined) {
    return args.taskPlannerEnhancerEnabled;
  }
  return (
    args.role.toLowerCase() === 'planner' &&
    resolvePlannerEnhancerEnabledFromConfig(args.liveConfig)
  );
}

function hasUsableEnhancerConfig(
  config: Doc<'chatroom_enhancerConfigs'> | null | undefined
): config is Doc<'chatroom_enhancerConfigs'> {
  return (
    config?.targetId === 'handoff:planner-to-builder' &&
    !!config.agentHarness &&
    !!config.model &&
    !!config.machineId
  );
}

export type PlannerEnhancerHandoffValidation =
  | { allowed: true; config: Doc<'chatroom_enhancerConfigs'> }
  | { allowed: false; code: 'ENHANCER_NOT_ENABLED' | 'ENHANCER_CONFIG_INCOMPLETE' };

/** Handoff guard — three-case logic per task snapshot. */
export function validatePlannerEnhancerHandoff(args: {
  taskPlannerEnhancerEnabled: boolean | undefined;
  config: Doc<'chatroom_enhancerConfigs'> | null | undefined;
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
  if (!args.config?.enabled || args.config.targetId !== 'handoff:planner-to-builder') {
    return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  }
  return { allowed: true, config: args.config };
}
