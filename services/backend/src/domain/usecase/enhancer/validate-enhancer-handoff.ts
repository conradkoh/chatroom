import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

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
  /** Explicit canonical snapshot; the authoritative policy source when present. */
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  config: Doc<'chatroom_teamAgentConfigs'> | null | undefined;
}): EnhancerHandoffValidation {
  // An explicit envelope is the source of enhancer authorization: only an
  // explicit code:enhanced mode enables enrichment, regardless of stale legacy
  // scalar values. A malformed explicit envelope must throw (shared
  // normalization), never silently fall back. Without an envelope the legacy
  // scalar/live-config behavior is preserved exactly.
  const explicitEnvelopeMode =
    args.taskEnvelope === undefined
      ? undefined
      : normalizeTaskEnvelope({ taskEnvelope: args.taskEnvelope }).conversationMode;
  const snapshot =
    explicitEnvelopeMode !== undefined
      ? explicitEnvelopeMode === 'code:enhanced'
      : (args.taskEnhancerEnabledAtEnqueue ?? args.taskPlannerEnhancerEnabled);

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
