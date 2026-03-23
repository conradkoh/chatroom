/**
 * Structured Workflows — Integration Tests
 *
 * Tests the workflow CRUD operations: create, specify, execute, complete/cancel
 * steps, exit workflow, and status queries.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';

// ============================================================================
// Helper: shorthand for a simple 3-step linear DAG (A → B → C)
// ============================================================================

function linearSteps() {
  return [
    { stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1 },
    { stepKey: 'b', description: 'Step B', dependsOn: ['a'], order: 2 },
    { stepKey: 'c', description: 'Step C', dependsOn: ['b'], order: 3 },
  ];
}

/**
 * Helper: specify a step with a minimal specification.
 * Required before completing steps due to the MISSING_SPECIFICATION guard.
 */
async function specifyStepHelper(
  sessionId: string,
  chatroomId: any,
  workflowKey: string,
  stepKey: string,
  assigneeRole = 'builder'
) {
  await t.mutation(api.workflows.specifyStep, {
    sessionId: sessionId as any,
    chatroomId,
    workflowKey,
    stepKey,
    assigneeRole,
    goal: `Complete ${stepKey}`,
    requirements: `Requirements for ${stepKey}`,
  });
}

// ============================================================================
// createWorkflow
// ============================================================================

describe('workflows.createWorkflow', () => {
  test('creates a draft workflow with steps', async () => {
    const { sessionId } = await createTestSession('test-wf-create-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    const result = await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'deploy-v1',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    expect(result.workflowId).toBeDefined();

    // Verify via status query
    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'deploy-v1',
    });

    expect(status.workflow.status).toBe('draft');
    expect(status.workflow.createdBy).toBe('planner');
    expect(status.steps).toHaveLength(3);
    expect(status.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  test('rejects duplicate workflowKey', async () => {
    const { sessionId } = await createTestSession('test-wf-dup-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'dup-key',
      createdBy: 'planner',
      steps: [{ stepKey: 'x', description: 'X', dependsOn: [], order: 1 }],
    });

    await expect(
      t.mutation(api.workflows.createWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'dup-key',
        createdBy: 'planner',
        steps: [{ stepKey: 'y', description: 'Y', dependsOn: [], order: 1 }],
      })
    ).rejects.toThrow('already exists');
  });

  test('rejects empty steps array', async () => {
    const { sessionId } = await createTestSession('test-wf-empty-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await expect(
      t.mutation(api.workflows.createWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'empty',
        createdBy: 'planner',
        steps: [],
      })
    ).rejects.toThrow('at least one step');
  });

  test('rejects DAG with cycle', async () => {
    const { sessionId } = await createTestSession('test-wf-cycle-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await expect(
      t.mutation(api.workflows.createWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'cycled',
        createdBy: 'planner',
        steps: [
          { stepKey: 'a', description: 'A', dependsOn: ['b'], order: 1 },
          { stepKey: 'b', description: 'B', dependsOn: ['a'], order: 2 },
        ],
      })
    ).rejects.toThrow('cycle');
  });

  test('rejects dangling dependency reference', async () => {
    const { sessionId } = await createTestSession('test-wf-dangle-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await expect(
      t.mutation(api.workflows.createWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'dangle',
        createdBy: 'planner',
        steps: [
          { stepKey: 'a', description: 'A', dependsOn: ['nonexistent'], order: 1 },
        ],
      })
    ).rejects.toThrow('does not exist');
  });

  test('rejects duplicate stepKeys', async () => {
    const { sessionId } = await createTestSession('test-wf-dupkeys-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await expect(
      t.mutation(api.workflows.createWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'dupkeys',
        createdBy: 'planner',
        steps: [
          { stepKey: 'a', description: 'A1', dependsOn: [], order: 1 },
          { stepKey: 'a', description: 'A2', dependsOn: [], order: 2 },
        ],
      })
    ).rejects.toThrow('Duplicate');
  });
});

// ============================================================================
// specifyStep
// ============================================================================

describe('workflows.specifyStep', () => {
  test('adds specification to a step', async () => {
    const { sessionId } = await createTestSession('test-wf-spec-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'spec-test',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    await t.mutation(api.workflows.specifyStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'spec-test',
      stepKey: 'a',
      assigneeRole: 'builder',
      goal: 'Implement the data model',
      requirements: '- Create schema\n- Add indexes',
      warnings: 'Do not modify existing tables',
    });

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'spec-test',
    });

    const stepA = status.steps.find((s) => s.stepKey === 'a');
    expect(stepA?.assigneeRole).toBe('builder');
    expect(stepA?.specification?.goal).toBe('Implement the data model');
    expect(stepA?.specification?.requirements).toBe('- Create schema\n- Add indexes');
    expect(stepA?.specification?.warnings).toBe('Do not modify existing tables');
  });
});

// ============================================================================
// executeWorkflow
// ============================================================================

describe('workflows.executeWorkflow', () => {
  test('activates workflow and starts root steps', async () => {
    const { sessionId } = await createTestSession('test-wf-exec-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exec-test',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exec-test',
    });

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exec-test',
    });

    expect(status.workflow.status).toBe('active');
    expect(status.steps.find((s) => s.stepKey === 'a')?.status).toBe('in_progress');
    expect(status.steps.find((s) => s.stepKey === 'b')?.status).toBe('pending');
    expect(status.steps.find((s) => s.stepKey === 'c')?.status).toBe('pending');
  });

  test('rejects executing non-draft workflow', async () => {
    const { sessionId } = await createTestSession('test-wf-exec-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exec-err',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'A', dependsOn: [], order: 1 }],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exec-err',
    });

    // Try to execute again
    await expect(
      t.mutation(api.workflows.executeWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'exec-err',
      })
    ).rejects.toThrow('must be draft');
  });
});

// ============================================================================
// completeStep
// ============================================================================

describe('workflows.completeStep', () => {
  test('completes a step and promotes dependent steps', async () => {
    const { sessionId } = await createTestSession('test-wf-complete-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'complete-test',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    // Specify step before executing so it can be completed
    await specifyStepHelper(sessionId, chatroomId, 'complete-test', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'complete-test',
    });

    // Complete step A → B should become in_progress
    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'complete-test',
      stepKey: 'a',
    });

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'complete-test',
    });

    expect(status.steps.find((s) => s.stepKey === 'a')?.status).toBe('completed');
    expect(status.steps.find((s) => s.stepKey === 'b')?.status).toBe('in_progress');
    expect(status.steps.find((s) => s.stepKey === 'c')?.status).toBe('pending');
    expect(status.workflow.status).toBe('active');
  });

  test('auto-completes workflow when all steps are done', async () => {
    const { sessionId } = await createTestSession('test-wf-autocomp-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'autocomp',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    // Specify all steps before executing
    for (const key of ['a', 'b', 'c']) {
      await specifyStepHelper(sessionId, chatroomId, 'autocomp', key);
    }

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'autocomp',
    });

    // Complete all steps in order
    for (const key of ['a', 'b', 'c']) {
      await t.mutation(api.workflows.completeStep, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'autocomp',
        stepKey: key,
      });
    }

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'autocomp',
    });

    expect(status.workflow.status).toBe('completed');
    expect(status.workflow.completedAt).toBeDefined();
  });

  test('rejects completing non-in_progress step', async () => {
    const { sessionId } = await createTestSession('test-wf-comp-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'comp-err',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'comp-err',
    });

    // Step B is pending, not in_progress
    await expect(
      t.mutation(api.workflows.completeStep, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'comp-err',
        stepKey: 'b',
      })
    ).rejects.toThrow('must be in_progress');
  });

  test('rejects completing step without specification', async () => {
    const { sessionId } = await createTestSession('test-wf-comp-nospec-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'comp-nospec',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'A', dependsOn: [], order: 1 }],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'comp-nospec',
    });

    // Step A is in_progress but has no specification
    await expect(
      t.mutation(api.workflows.completeStep, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'comp-nospec',
        stepKey: 'a',
      })
    ).rejects.toThrow('no specification has been set');
  });
});

// ============================================================================
// cancelStep
// ============================================================================

describe('workflows.cancelStep', () => {
  test('cancels an in_progress step with reason', async () => {
    const { sessionId } = await createTestSession('test-wf-cancel-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-test',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'A', dependsOn: [], order: 1 }],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-test',
    });

    await t.mutation(api.workflows.cancelStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-test',
      stepKey: 'a',
      reason: 'No longer needed',
    });

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-test',
    });

    expect(status.steps.find((s) => s.stepKey === 'a')?.status).toBe('cancelled');
    expect(status.steps.find((s) => s.stepKey === 'a')?.cancelReason).toBe('No longer needed');
    // Single step workflow — should auto-complete
    expect(status.workflow.status).toBe('completed');
  });

  test('rejects cancelling a completed step', async () => {
    const { sessionId } = await createTestSession('test-wf-cancel-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-err',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'A', dependsOn: [], order: 1 }],
    });

    await specifyStepHelper(sessionId, chatroomId, 'cancel-err', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-err',
    });

    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'cancel-err',
      stepKey: 'a',
    });

    await expect(
      t.mutation(api.workflows.cancelStep, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'cancel-err',
        stepKey: 'a',
        reason: 'Oops',
      })
    ).rejects.toThrow(); // workflow is now completed, not active
  });
});

// ============================================================================
// exitWorkflow
// ============================================================================

describe('workflows.exitWorkflow', () => {
  test('cancels workflow and all non-completed steps', async () => {
    const { sessionId } = await createTestSession('test-wf-exit-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-test',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    await specifyStepHelper(sessionId, chatroomId, 'exit-test', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-test',
    });

    // Complete step A first
    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-test',
      stepKey: 'a',
    });

    // Exit workflow
    await t.mutation(api.workflows.exitWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-test',
      reason: 'Requirements changed',
    });

    const status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-test',
    });

    expect(status.workflow.status).toBe('cancelled');
    expect(status.workflow.cancelReason).toBe('Requirements changed');
    // Step A stays completed, B and C are cancelled
    expect(status.steps.find((s) => s.stepKey === 'a')?.status).toBe('completed');
    expect(status.steps.find((s) => s.stepKey === 'b')?.status).toBe('cancelled');
    expect(status.steps.find((s) => s.stepKey === 'c')?.status).toBe('cancelled');
  });

  test('rejects exiting already completed workflow', async () => {
    const { sessionId } = await createTestSession('test-wf-exit-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-err',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'A', dependsOn: [], order: 1 }],
    });

    await specifyStepHelper(sessionId, chatroomId, 'exit-err', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-err',
    });

    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'exit-err',
      stepKey: 'a',
    });

    await expect(
      t.mutation(api.workflows.exitWorkflow, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'exit-err',
        reason: 'Too late',
      })
    ).rejects.toThrow('Cannot exit');
  });
});

// ============================================================================
// Event Stream Emission Tests
// ============================================================================

describe('workflows — event stream emissions', () => {
  test('executeWorkflow emits workflow.started event', async () => {
    const { sessionId } = await createTestSession('test-wf-es-start-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-start-test',
      createdBy: 'planner',
      steps: linearSteps(),
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-start-test',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const startedEvent = events.find((e) => e.type === 'workflow.started');
    expect(startedEvent).toBeDefined();
    if (startedEvent && startedEvent.type === 'workflow.started') {
      expect(startedEvent.chatroomId).toBe(chatroomId);
      expect(startedEvent.workflowKey).toBe('es-start-test');
      expect(startedEvent.createdBy).toBe('planner');
      expect(startedEvent.stepCount).toBe(3);
      expect(typeof startedEvent.workflowId).toBe('string');
      expect(typeof startedEvent.timestamp).toBe('number');
      // Verify steps array is included
      expect(Array.isArray(startedEvent.steps)).toBe(true);
      expect(startedEvent.steps).toHaveLength(3);
      expect(startedEvent.steps[0]).toMatchObject({
        stepKey: 'a',
        description: 'Step A',
        dependsOn: [],
        order: 1,
      });
    }
  });

  test('completeStep emits workflow.stepCompleted event', async () => {
    const { sessionId } = await createTestSession('test-wf-es-stepcomplete-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-complete',
      createdBy: 'planner',
      steps: [
        { stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1, },
      ],
    });

    await specifyStepHelper(sessionId, chatroomId, 'es-step-complete', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-complete',
    });

    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-complete',
      stepKey: 'a',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const stepCompletedEvent = events.find((e) => e.type === 'workflow.stepCompleted');
    expect(stepCompletedEvent).toBeDefined();
    if (stepCompletedEvent && stepCompletedEvent.type === 'workflow.stepCompleted') {
      expect(stepCompletedEvent.chatroomId).toBe(chatroomId);
      expect(stepCompletedEvent.workflowKey).toBe('es-step-complete');
      expect(stepCompletedEvent.stepKey).toBe('a');
      expect(typeof stepCompletedEvent.workflowId).toBe('string');
      expect(typeof stepCompletedEvent.timestamp).toBe('number');
    }
  });

  test('cancelStep emits workflow.stepCancelled event', async () => {
    const { sessionId } = await createTestSession('test-wf-es-stepcancel-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-cancel',
      createdBy: 'planner',
      steps: [
        { stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1 },
        { stepKey: 'b', description: 'Step B', dependsOn: [] as string[], order: 2 },
      ],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-cancel',
    });

    await t.mutation(api.workflows.cancelStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-step-cancel',
      stepKey: 'a',
      reason: 'no longer needed',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const stepCancelledEvent = events.find((e) => e.type === 'workflow.stepCancelled');
    expect(stepCancelledEvent).toBeDefined();
    if (stepCancelledEvent && stepCancelledEvent.type === 'workflow.stepCancelled') {
      expect(stepCancelledEvent.chatroomId).toBe(chatroomId);
      expect(stepCancelledEvent.workflowKey).toBe('es-step-cancel');
      expect(stepCancelledEvent.stepKey).toBe('a');
      expect(stepCancelledEvent.reason).toBe('no longer needed');
      expect(typeof stepCancelledEvent.workflowId).toBe('string');
      expect(typeof stepCancelledEvent.timestamp).toBe('number');
    }
  });

  test('completing all steps emits workflow.completed event with finalStatus=completed', async () => {
    const { sessionId } = await createTestSession('test-wf-es-wfcomplete-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-wf-complete',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1 }],
    });

    await specifyStepHelper(sessionId, chatroomId, 'es-wf-complete', 'a');

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-wf-complete',
    });

    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-wf-complete',
      stepKey: 'a',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const wfCompletedEvent = events.find((e) => e.type === 'workflow.completed');
    expect(wfCompletedEvent).toBeDefined();
    if (wfCompletedEvent && wfCompletedEvent.type === 'workflow.completed') {
      expect(wfCompletedEvent.chatroomId).toBe(chatroomId);
      expect(wfCompletedEvent.workflowKey).toBe('es-wf-complete');
      expect(wfCompletedEvent.finalStatus).toBe('completed');
      expect(typeof wfCompletedEvent.workflowId).toBe('string');
      expect(typeof wfCompletedEvent.timestamp).toBe('number');
    }
  });

  test('exitWorkflow emits workflow.completed event with finalStatus=cancelled', async () => {
    const { sessionId } = await createTestSession('test-wf-es-exit-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-exit-test',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1 }],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-exit-test',
    });

    await t.mutation(api.workflows.exitWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-exit-test',
      reason: 'shutting down',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    const wfCompletedEvent = events.find((e) => e.type === 'workflow.completed');
    expect(wfCompletedEvent).toBeDefined();
    if (wfCompletedEvent && wfCompletedEvent.type === 'workflow.completed') {
      expect(wfCompletedEvent.chatroomId).toBe(chatroomId);
      expect(wfCompletedEvent.workflowKey).toBe('es-exit-test');
      expect(wfCompletedEvent.finalStatus).toBe('cancelled');
    }
  });

  test('cancelling a step also emits workflow.completed when it is the only step', async () => {
    const { sessionId } = await createTestSession('test-wf-es-cancel-complete-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-cancel-complete',
      createdBy: 'planner',
      steps: [{ stepKey: 'a', description: 'Step A', dependsOn: [] as string[], order: 1 }],
    });

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-cancel-complete',
    });

    await t.mutation(api.workflows.cancelStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'es-cancel-complete',
      stepKey: 'a',
      reason: 'skipping',
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );

    // Both a stepCancelled and a workflow.completed event should exist
    const stepCancelledEvent = events.find((e) => e.type === 'workflow.stepCancelled');
    expect(stepCancelledEvent).toBeDefined();

    const wfCompletedEvent = events.find((e) => e.type === 'workflow.completed');
    expect(wfCompletedEvent).toBeDefined();
    if (wfCompletedEvent && wfCompletedEvent.type === 'workflow.completed') {
      expect(wfCompletedEvent.finalStatus).toBe('completed');
    }
  });
});


describe('workflows.getWorkflowStatus', () => {
  test('computes available next steps correctly', async () => {
    const { sessionId } = await createTestSession('test-wf-status-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Diamond DAG: A → B, A → C, B+C → D
    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
      createdBy: 'planner',
      steps: [
        { stepKey: 'a', description: 'A', dependsOn: [], order: 1 },
        { stepKey: 'b', description: 'B', dependsOn: ['a'], order: 2 },
        { stepKey: 'c', description: 'C', dependsOn: ['a'], order: 3 },
        { stepKey: 'd', description: 'D', dependsOn: ['b', 'c'], order: 4 },
      ],
    });

    // Specify all steps so they can be completed
    for (const key of ['a', 'b', 'c', 'd']) {
      await specifyStepHelper(sessionId, chatroomId, 'diamond', key);
    }

    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
    });

    // After execution: A is in_progress, no pending steps ready
    let status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
    });
    expect(status.availableNextSteps).toEqual([]);

    // Complete A → B and C become in_progress
    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
      stepKey: 'a',
    });

    status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
    });
    // B and C are now in_progress, D is pending but deps not met
    expect(status.availableNextSteps).toEqual([]);

    // Complete B → D still waiting on C
    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
      stepKey: 'b',
    });

    status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
    });
    expect(status.availableNextSteps).toEqual([]);

    // Complete C → D becomes in_progress
    await t.mutation(api.workflows.completeStep, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
      stepKey: 'c',
    });

    status = await t.query(api.workflows.getWorkflowStatus, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'diamond',
    });
    // D was promoted to in_progress by advanceWorkflow, so availableNextSteps is empty
    expect(status.steps.find((s) => s.stepKey === 'd')?.status).toBe('in_progress');
  });

  test('returns error for non-existent workflow', async () => {
    const { sessionId } = await createTestSession('test-wf-status-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await expect(
      t.query(api.workflows.getWorkflowStatus, {
        sessionId: sessionId as any,
        chatroomId,
        workflowKey: 'nope',
      })
    ).rejects.toThrow('not found');
  });
});
