/**
 * Duo Team — Planner → Builder Handoff Without Workflow
 *
 * Verifies that a planner can hand off to a builder without having an
 * active or draft workflow in the chatroom. This locks in the behavior
 * where workflows are fully optional for duo teams.
 *
 * Regression test for: backlog item ps7fjny9d5ycazxnkaaj4rqszn88cyha
 */

import { expect, test } from 'vitest';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { t } from '../../../../../test.setup';
import { createTestSession } from '../../../../helpers/integration';

test('Duo Team > Planner > Handoff to builder succeeds without workflow', async () => {
  // 1. Create test session and duo chatroom with planner+builder
  const testSessionId = `test-session-${Date.now()}`;
  const { sessionId } = await createTestSession(testSessionId);

  // Create a duo chatroom with planner+builder
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });

  // 2. Join as planner
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role: 'planner',
  });

  // 3. Send a user message to create initial context
  await t.mutation(api.messages.send, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Please implement feature X',
    type: 'message' as const,
  });

  // 4. Verify: no workflow exists in this chatroom
  const workflows = await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_workflows')
      .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  expect(workflows).toHaveLength(0);

  // 5. Planner hands off to builder WITHOUT creating a workflow
  // This is the key test: before the fix, this would return WORKFLOW_REQUIRED error
  const handoffResult = await t.mutation(api.messages.handoff, {
    sessionId,
    chatroomId,
    senderRole: 'planner',
    targetRole: 'builder',
    content: 'Please implement this feature.',
  });

  // 6. Assert: handoff succeeds (no WORKFLOW_REQUIRED error)
  expect(handoffResult.success).toBe(true);
  expect(handoffResult.error).toBeNull();
  expect(handoffResult.messageId).toBeDefined();
  expect(handoffResult.newTaskId).toBeDefined();

  // 7. Verify: message was created for builder
  const builderMessage = await t.run(async (ctx) => {
    return await ctx.db.get(handoffResult.messageId as Id<'chatroom_messages'>);
  });
  expect(builderMessage).toBeDefined();
  expect(builderMessage?.senderRole).toBe('planner');
  expect(builderMessage?.content).toBe('Please implement this feature.');
});
