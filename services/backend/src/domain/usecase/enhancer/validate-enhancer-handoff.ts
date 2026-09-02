import {
  hasRemoteEnhancerConfigFields,
  isCompleteRemoteEnhancerConfig,
} from './get-enhancer-team-agent-config';
import type { Doc } from '../../../../convex/_generated/dataModel';

export type EnhancerHandoffValidation =
  | { allowed: true; config: Doc<'chatroom_teamAgentConfigs'> }
  | { allowed: false; code: 'ENHANCER_NOT_ENABLED' | 'ENHANCER_CONFIG_INCOMPLETE' };

export function validateEnhancerHandoff(args: {
  taskEnhancerEnabledAtEnqueue?: boolean | undefined;
  taskPlannerEnhancerEnabled?: boolean | undefined;
  config: Doc<'chatroom_teamAgentConfigs'> | null | undefined;
}): EnhancerHandoffValidation {
  const snapshot = args.taskEnhancerEnabledAtEnqueue ?? args.taskPlannerEnhancerEnabled;
  if (snapshot === false) return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  if (snapshot === true) {
    if (!args.config) return { allowed: false, code: 'ENHANCER_CONFIG_INCOMPLETE' };
    return hasRemoteEnhancerConfigFields(args.config)
      ? { allowed: true, config: args.config }
      : { allowed: false, code: 'ENHANCER_CONFIG_INCOMPLETE' };
  }
  if (!args.config?.enabled) return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  return isCompleteRemoteEnhancerConfig(args.config)
    ? { allowed: true, config: args.config }
    : { allowed: false, code: 'ENHANCER_CONFIG_INCOMPLETE' };
}
