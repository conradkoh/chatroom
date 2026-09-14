import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

export type EnhancerHandoffValidation =
  { allowed: true } | { allowed: false; code: 'ENHANCER_NOT_ENABLED' };

export function validateEnhancerHandoff(args: {
  taskEnhancerEnabledAtEnqueue?: boolean | undefined;
  taskPlannerEnhancerEnabled?: boolean | undefined;
  /** Explicit canonical snapshot; the authoritative policy source when present. */
  taskEnvelope?: TaskEnvelopeV1 | undefined;
}): EnhancerHandoffValidation {
  // An explicit envelope is the source of enhancer authorization: only an
  // explicit code:enhanced mode enables enrichment, regardless of stale legacy
  // scalar values. Legacy rows use only their persisted scalar snapshot.
  const explicitEnvelopeMode =
    args.taskEnvelope === undefined
      ? undefined
      : normalizeTaskEnvelope({ taskEnvelope: args.taskEnvelope }).conversationMode;
  const snapshot =
    explicitEnvelopeMode !== undefined
      ? explicitEnvelopeMode === 'code:enhanced'
      : (args.taskEnhancerEnabledAtEnqueue ?? args.taskPlannerEnhancerEnabled);

  if (snapshot === false) return { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
  return snapshot === true ? { allowed: true } : { allowed: false, code: 'ENHANCER_NOT_ENABLED' };
}
