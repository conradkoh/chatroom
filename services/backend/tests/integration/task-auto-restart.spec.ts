/**
 * Task Auto-Restart Integration Tests
 *
 * Tests for task pre-assignment behavior:
 *
 * User message tasks are pre-assigned to the entry point at creation.
 * (Fix A — messages.ts: assignedTo = teamEntryPoint instead of undefined)
 *
 * Note: The ensureAgentHandler has been removed (PR #98) and its functionality
 * moved to the daemon layer. The daemon's task monitor now handles agent restart
 * for stale/stuck tasks.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createDuoTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

// ─── Fix A: Pre-assignment at task creation ──────────────────────────────────

describe('Fix A: User message tasks pre-assigned to entry point', () => {
  test('user message task is assigned to teamEntryPoint at creation', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please help me with a task',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    // Pre-assigned to entry point (planner), NOT undefined
    expect(tasks[0]?.assignedTo).toBe('planner');
  });

  test('user message task is assigned to first role when no teamEntryPoint', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-2');
    // Create chatroom without explicit entry point
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      // teamEntryPoint intentionally omitted — should fall back to first role
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Hello',
      senderRole: 'user',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    // Falls back to first role
    expect(tasks[0]?.assignedTo).toBe('planner');
  });

  test('handoff message task remains assigned to the target role (unchanged)', async () => {
    const { sessionId } = await createTestSession('test-ar-preassign-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Implement feature X',
      senderRole: 'planner',
      targetRole: 'builder',
    });

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });

    expect(tasks.length).toBe(1);
    expect(tasks[0]?.assignedTo).toBe('builder');
  });
});

// ─── Handoff target role validation ──────────────────────────────────────────

describe('Handoff target role validation', () => {
  test('handoff to non-existent role returns INVALID_TARGET_ROLE error', async () => {
    const { sessionId } = await createTestSession('test-invalid-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Handing off to reviewer',
      senderRole: 'planner',
      targetRole: 'reviewer',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('INVALID_TARGET_ROLE');
    expect(result.error?.message).toContain('Cannot hand off to "reviewer"');
    expect(result.error?.message).toContain('not part of the current team');
    expect(result.error?.suggestedTargets).toEqual(['user', 'planner', 'builder']);
  });

  test('handoff to valid team role succeeds', async () => {
    const { sessionId } = await createTestSession('test-valid-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Implement this feature',
      senderRole: 'planner',
      targetRole: 'builder',
    });

    expect(result.success).toBe(true);
  });

  test('handoff to user is always valid (even in duo team)', async () => {
    const { sessionId } = await createTestSession('test-user-target-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.mutation(api.messages.sendHandoff, {
      sessionId,
      chatroomId,
      content: 'Done with the task',
      senderRole: 'planner',
      targetRole: 'user',
    });

    expect(result.success).toBe(true);
  });
});