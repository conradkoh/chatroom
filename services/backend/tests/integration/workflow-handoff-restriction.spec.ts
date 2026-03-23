/**
 * Workflow Handoff Restriction — Integration Tests
 *
 * Tests that handoff to user is blocked while an active workflow exists,
 * and allowed after the workflow completes or is exited.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';

describe('Workflow Handoff Restriction', () => {
  test('blocks handoff to user while workflow is active', async () => {
    const { sessionId } = await createTestSession('test-wf-handoff-block-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Create and execute a workflow
    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
      createdBy: 'builder',
      steps: [
        { stepKey: 'step1', description: 'Step 1', dependsOn: [] as string[], order: 1 },
      ],
    });
    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
    });

    // Send a user message to create a task context
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'do something',
      type: 'message' as const,
    });

    // Attempt handoff to user — should be blocked
    const result = await t.mutation(api.messages.handoff, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'All done!',
      targetRole: 'user',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('WORKFLOW_ACTIVE');
    expect(result.error?.message).toContain('Cannot hand off to user while workflow');
    expect(result.error?.message).toContain('test-wf');
  });

  test('allows handoff to user after workflow is exited', async () => {
    const { sessionId } = await createTestSession('test-wf-handoff-exit-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Create and execute a workflow
    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
      createdBy: 'builder',
      steps: [
        { stepKey: 'step1', description: 'Step 1', dependsOn: [] as string[], order: 1 },
      ],
    });
    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
    });

    // Send a user message
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'do something',
      type: 'message' as const,
    });

    // Exit the workflow
    await t.mutation(api.workflows.exitWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
      reason: 'Changed approach',
    });

    // Handoff to user should now succeed
    const result = await t.mutation(api.messages.handoff, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'All done!',
      targetRole: 'user',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  test('allows handoff to non-user roles while workflow is active', async () => {
    const { sessionId } = await createTestSession('test-wf-handoff-nonuser-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Create and execute a workflow
    await t.mutation(api.workflows.createWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
      createdBy: 'builder',
      steps: [
        { stepKey: 'step1', description: 'Step 1', dependsOn: [] as string[], order: 1 },
      ],
    });
    await t.mutation(api.workflows.executeWorkflow, {
      sessionId: sessionId as any,
      chatroomId,
      workflowKey: 'test-wf',
    });

    // Send a user message
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'do something',
      type: 'message' as const,
    });

    // Handoff to reviewer (non-user) should succeed even with active workflow
    const result = await t.mutation(api.messages.handoff, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'Please review',
      targetRole: 'reviewer',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
  });
});
