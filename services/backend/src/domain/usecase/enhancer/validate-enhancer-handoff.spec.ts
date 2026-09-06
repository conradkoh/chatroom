import { createTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { describe, expect, test } from 'vitest';

import { validateEnhancerHandoff } from './validate-enhancer-handoff';

const config = {
  type: 'remote',
  enabled: true,
  machineId: 'm',
  model: 'model',
  agentHarness: 'opencode',
  workingDir: '/tmp',
} as any;

describe('validateEnhancerHandoff', () => {
  test('honors false, true, and live snapshots', () => {
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: false, config }).code).toBe(
      'ENHANCER_NOT_ENABLED'
    );
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: true, config }).allowed).toBe(
      true
    );
    expect(validateEnhancerHandoff({ config }).allowed).toBe(true);
  });
  test('rejects incomplete enabled configuration', () => {
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: true,
        config: { ...config, workingDir: undefined } as any,
      }).code
    ).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });
});

function envelope(mode: TaskEnvelopeV1['conversationMode']): TaskEnvelopeV1 {
  return createTaskEnvelope({ conversationMode: mode, sessionPolicy: 'continue' });
}

describe('validateEnhancerHandoff — explicit envelope precedence', () => {
  test('explicit chat cannot be authorized by a stale plannerEnhancerEnabled=true scalar', () => {
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: true,
        taskEnvelope: envelope('chat'),
        config,
      }).code
    ).toBe('ENHANCER_NOT_ENABLED');
  });

  test('explicit code cannot be authorized by a stale true scalar', () => {
    expect(
      validateEnhancerHandoff({
        taskEnhancerEnabledAtEnqueue: true,
        taskEnvelope: envelope('code'),
        config,
      }).allowed
    ).toBe(false);
  });

  test('explicit code:enhanced is not disabled by a stale false scalar', () => {
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: false,
        taskEnvelope: envelope('code:enhanced'),
        config,
      }).allowed
    ).toBe(true);
  });

  test('explicit code:enhanced with missing config reports incomplete config', () => {
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: false,
        taskEnvelope: envelope('code:enhanced'),
        config: null,
      }).code
    ).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });

  test('explicit code:enhanced with incomplete config reports incomplete config', () => {
    expect(
      validateEnhancerHandoff({
        taskEnvelope: envelope('code:enhanced'),
        config: { ...config, workingDir: undefined } as any,
      }).code
    ).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });

  test('legacy scalar-only behavior is preserved when no envelope is present', () => {
    expect(validateEnhancerHandoff({ taskEnhancerEnabledAtEnqueue: true, config }).allowed).toBe(
      true
    );
    expect(
      validateEnhancerHandoff({
        taskPlannerEnhancerEnabled: false,
        taskEnvelope: undefined,
        config,
      }).code
    ).toBe('ENHANCER_NOT_ENABLED');
  });
});
