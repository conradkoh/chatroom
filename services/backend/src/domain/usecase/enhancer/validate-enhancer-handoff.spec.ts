import { createTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { describe, expect, test } from 'vitest';

import { validateEnhancerHandoff } from './validate-enhancer-handoff';

function envelope(mode: TaskEnvelopeV1['conversationMode']): TaskEnvelopeV1 {
  return createTaskEnvelope({ conversationMode: mode, sessionPolicy: 'continue' });
}

describe('validateEnhancerHandoff', () => {
  test('uses the persisted task snapshot and ignores configuration availability', () => {
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: false }).allowed).toBe(false);
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: true })).toEqual({
      allowed: true,
    });
  });

  test('explicit conversation mode takes precedence over stale legacy scalars', () => {
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: true,
        taskEnvelope: envelope('chat'),
      }).allowed
    ).toBe(false);
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: false,
        taskEnvelope: envelope('code:enhanced'),
      }).allowed
    ).toBe(true);
  });

  test('legacy enhancer enqueue snapshot remains supported', () => {
    expect(validateEnhancerHandoff({ taskEnhancerEnabledAtEnqueue: true }).allowed).toBe(true);
    expect(validateEnhancerHandoff({ taskEnhancerEnabledAtEnqueue: false }).code).toBe(
      'ENHANCER_NOT_ENABLED'
    );
  });
});
