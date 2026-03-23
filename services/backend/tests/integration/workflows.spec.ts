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
// getWorkflowStatus — availableNextSteps
// ============================================================================

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
